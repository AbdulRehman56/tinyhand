// TinyHand application state + event loop for X11. Single-threaded on purpose:
// every X call happens on the same thread that renders frames.

use crate::asset::{self, Assets, InkChoice};
use crate::config::{self, Config};
use crate::model::Screen;
use crate::pose::{Pose, PoseState};
use crate::render;
use crate::sound;
use crate::tray::{self, Cmd};
use crate::x11::{PtrEvent, PtrEventKind, X};
use std::time::{Duration, Instant};

struct Stroke {
    points: Vec<(f64, f64)>,
    color: [f32; 4],
    width: f64,
    start: Instant,
}

impl Stroke {
    fn alpha(&self, fade: f64) -> f64 {
        if fade <= 0.0 {
            return 1.0;
        }
        let elapsed = self.start.elapsed().as_secs_f64();
        if elapsed <= fade {
            return 1.0;
        }
        let t = (elapsed - fade) / 0.6;
        (1.0 - t).clamp(0.0, 1.0)
    }
}

pub struct App {
    x: X,
    cfg: Config,
    assets: Assets,
    ink_choice: InkChoice,
    style: String,
    pose_state: PoseState,
    laser: bool,
    enabled: bool,
    strokes: Vec<Stroke>,
    active: Option<Vec<(f64, f64)>>,
    overlay: u32,
    frame: tiny_skia::Pixmap,
    zones: Vec<(i32, i32, i32, i32)>,
    interact_mask: u16,
    hotkeys: Vec<(u8, u16)>,
    tray_rx: Option<std::sync::mpsc::Receiver<Cmd>>,
    tray: tray::Tray,
    cursor_last_move: Instant,
    cursor_prev: (i32, i32),
    quit: bool,
    // GA-style one-shot config watcher mtime
    cfg_mtime: Option<std::time::SystemTime>,
}

const BUSY: Duration = Duration::from_millis(10);
const IDLE: Duration = Duration::from_millis(60);
const SLEEP: Duration = Duration::from_millis(250);

impl App {
    pub fn init() -> Result<Self, String> {
        let x = X::connect()?;
        let cfg = config::load();
        if !cfg.pointer.size.is_finite() || !(0.08..=0.20).contains(&cfg.pointer.size) {
            return Err("pointer.size must be between 0.08 and 0.20".into());
        }
        let style = cfg.pointer.style.clone();
        let laser = style == "laser";
        let ink_choice = InkChoice::parse(&cfg.ink.choice);

        // Pass-through zones: strip outside _NET_WORKAREA (panels/docks).
        let zones = query_workarea_zones(&x);

        // Hotkeys.
        let mut hotkeys = Vec::new();
        for (spec, name) in [
            (cfg.hotkeys.toggle.as_str(), "toggle"),
            (cfg.hotkeys.clear.as_str(), "clear"),
            (cfg.hotkeys.cycle.as_str(), "cycle"),
        ] {
            if let Some((code, mods)) = parse_hotkey(&x, spec) {
                hotkeys.push((code, mods));
            } else {
                log(&format!("hotkey {name} '{}' could not be resolved", spec));
                hotkeys.push((0, 0));
            }
        }
        x.grab_hotkeys(
            &hotkeys
                .iter()
                .copied()
                .filter(|(key, _)| *key != 0)
                .collect::<Vec<_>>(),
        );

        // Overlay window: whole virtual screen.
        let overlay = x.create_overlay_win(x.root_w, x.root_h)?;
        let frame =
            tiny_skia::Pixmap::new(x.root_w, x.root_h).ok_or("failed to allocate frame buffer")?;

        let interact_mask = interact_mask(&cfg.interact.key);

        // Tray (best-effort; if DBus isn't around we still run).
        let (tx, rx) = std::sync::mpsc::channel();
        let tray_rx = Some(rx);
        let tray = tray::Tray::spawn(cfg.clone(), tx);

        let cfg_mtime = std::fs::metadata(config::config_path())
            .and_then(|m| m.modified())
            .ok();

        let mut app = Self {
            x,
            cfg: cfg.clone(),
            assets: Assets::new(),
            ink_choice,
            style,
            pose_state: PoseState::new(cfg.pointer.size),
            laser,
            enabled: cfg.enabled.unwrap_or(true),
            strokes: Vec::new(),
            active: None,
            overlay,
            frame,
            zones,
            interact_mask,
            hotkeys,
            tray_rx,
            tray,
            cursor_last_move: Instant::now(),
            cursor_prev: (0, 0),
            quit: false,
            cfg_mtime,
        };
        if !app.laser && app.assets.get(&app.style).is_none() {
            return Err(format!(
                "hand asset '{}' missing or invalid; run linux/scripts/install.sh",
                app.style
            ));
        }
        app.preload();
        Ok(app)
    }

    fn preload(&mut self) {
        if !self.laser {
            self.assets.get(&self.style);
        }
    }

    fn current_screen(&self, x: i32, y: i32) -> Screen {
        self.x.screen_at(x, y)
    }

    fn ink_color(&self) -> [f32; 4] {
        if self.ink_choice == InkChoice::Match {
            if let Some(s) = asset::BUILT_INS.iter().find(|s| s.id == self.style) {
                return asset::ink_rgb(s.ink);
            }
            return asset::ink_rgb(InkChoice::Purple);
        }
        asset::ink_rgb(self.ink_choice)
    }

    fn stroke_width(screen_h: f64) -> f64 {
        (3.0f64).max(screen_h * 0.0055)
    }

    pub fn run(mut self) -> i32 {
        if self.enabled {
            if let Err(e) = self.set_enabled(true) {
                log(&format!("startup failed: {e}"));
                return 1;
            }
        }
        log("tinyhand (linux x11) started");
        while !self.quit {
            let timeout = self.tick();
            let tick_when = Instant::now() + timeout;
            loop {
                let remaining = tick_when
                    .checked_duration_since(Instant::now())
                    .unwrap_or(Duration::from_millis(0));
                match self.x.wait_event(Some(remaining)) {
                    Ok(Some(ev)) => {
                        self.handle_event(ev);
                        if self.quit {
                            break;
                        }
                    }
                    Ok(None) => break,
                    Err(e) => {
                        log(&format!("X11 connection failed: {e}"));
                        self.shutdown();
                        return 1;
                    }
                }
            }
        }
        self.shutdown();
        0
    }

    fn tick_timeout(&self) -> Duration {
        if !self.enabled {
            return SLEEP;
        }
        if self.active.is_some()
            || self.pose_state.is_settling()
            || self.cursor_last_move.elapsed() < Duration::from_millis(120)
            || self
                .strokes
                .iter()
                .any(|s| s.alpha(self.cfg.ink.fade) < 1.0)
        {
            BUSY
        } else {
            IDLE
        }
    }

    fn set_enabled(&mut self, on: bool) -> Result<(), String> {
        self.enabled = on;
        if on {
            self.preload();
            self.x.map_win(self.overlay);
            self.x.raise(self.overlay);
        } else {
            self.x.unmap_win(self.overlay);
            self.x.ungrab_pointer();
            self.x.show_cursor();
            self.poses_clear();
        }
        self.save_enabled();
        Ok(())
    }

    fn poses_clear(&mut self) {
        self.pose_state = PoseState::new(self.cfg.pointer.size);
        self.active = None;
    }

    fn save_enabled(&mut self) {
        self.cfg.enabled = Some(self.enabled);
        config::save(&self.cfg);
        self.tray.sync(&self.cfg);
    }

    fn next_style(&mut self) {
        let pool: Vec<&str> = asset::DEFAULT_PINNED.to_vec();
        let cur = pool
            .iter()
            .position(|s| **s == self.style)
            .map(|i| i + 1)
            .unwrap_or(0);
        let next = pool[cur % pool.len()];
        self.set_style(next);
    }

    fn set_style(&mut self, style: &str) {
        self.style = style.to_string();
        self.laser = style == "laser";
        self.cfg.pointer.style = style.to_string();
        config::save(&self.cfg);
        self.preload();
        self.poses_clear();
    }

    fn clear_ink(&mut self) {
        self.strokes.clear();
        self.active = None;
    }

    // ---------------------------------------------------------------------

    fn handle_event(&mut self, ev: x11rb::protocol::Event) {
        use x11rb::protocol::Event as E;
        match ev {
            E::KeyPress(ke) => self.on_key(ke.detail, u16::from(ke.state)),
            E::ButtonPress(be) => self.on_ptr(PtrEvent {
                kind: PtrEventKind::Press,
                detail: be.detail,
                x: be.root_x as i32,
                y: be.root_y as i32,
                mods: u16::from(be.state),
            }),
            E::ButtonRelease(be) => self.on_ptr(PtrEvent {
                kind: PtrEventKind::Release,
                detail: be.detail,
                x: be.root_x as i32,
                y: be.root_y as i32,
                mods: u16::from(be.state),
            }),
            E::MotionNotify(me) => self.on_ptr(PtrEvent {
                kind: PtrEventKind::Motion,
                detail: 0,
                x: me.root_x as i32,
                y: me.root_y as i32,
                mods: u16::from(me.state),
            }),
            _ => {}
        }
    }

    fn on_key(&mut self, keycode: u8, _state: u16) {
        for (i, (code, _)) in self.hotkeys.iter().enumerate() {
            if *code == keycode {
                match i {
                    0 => {
                        let on = !self.enabled;
                        let _ = self.set_enabled(on);
                    }
                    1 => self.clear_ink(),
                    2 => self.next_style(),
                    _ => {}
                }
                return;
            }
        }
    }

    fn on_ptr(&mut self, ev: PtrEvent) {
        if !self.enabled {
            return;
        }
        self.cursor_prev = (ev.x, ev.y);
        self.cursor_last_move = Instant::now();
        match ev.kind {
            PtrEventKind::Motion => {
                if self.x.grabbed {
                    if let Some(active) = &mut self.active {
                        if let Some(last) = active.last() {
                            if (ev.x as f64 - last.0).hypot(ev.y as f64 - last.1) >= 1.5 {
                                active.push((ev.x as f64, ev.y as f64));
                            }
                        }
                    }
                }
            }
            PtrEventKind::Press => {
                // Swallowed clicks while grabbed become taps; interact key,
                // pass-through zones and scroll replay the press for real input.
                // (The physical release then reaches the app natively.)
                let pass_through = !self.x.grabbed
                    || self.zone_hit(ev.x, ev.y)
                    || (ev.mods & self.interact_mask) != 0
                    || ev.detail >= 4;
                if pass_through {
                    let replay = self.x.grabbed;
                    self.active = None;
                    self.pose_state.release();
                    self.x.ungrab_pointer();
                    self.x.show_cursor();
                    if replay {
                        self.x.fake_button_down(ev.detail);
                    }
                    return;
                }
                // Swallow: tap!
                self.pose_state.press();
                if self.laser {
                    sound::play_laser(&self.cfg.sound);
                } else {
                    sound::play_hand(&self.cfg.sound);
                }
                if ev.detail == 1 && self.x.grabbed {
                    self.active = Some(vec![(ev.x as f64, ev.y as f64)]);
                }
            }
            PtrEventKind::Release => {
                if ev.detail == 1 {
                    if let Some(points) = self.active.take() {
                        if points.len() > 1 {
                            self.strokes.push(Stroke {
                                points,
                                color: self.ink_color(),
                                width: Self::stroke_width(self.y_screen_h()),
                                start: Instant::now(),
                            });
                        }
                    }
                    self.pose_state.release();
                }
            }
        }
    }

    fn y_screen_h(&self) -> f64 {
        self.x.screens[0].height as f64
    }

    fn zone_hit(&self, x: i32, y: i32) -> bool {
        self.zones
            .iter()
            .any(|z| x >= z.0 && x < z.0 + z.2 && y >= z.1 && y < z.1 + z.3)
    }

    // -------------------------------------------------------------------

    fn tick(&mut self) -> Duration {
        // Tray commands.
        while let Some(cmd) = self.tray_rx.as_ref().and_then(|rx| rx.try_recv().ok()) {
            match cmd {
                Cmd::Toggle => {
                    let _ = self.set_enabled(!self.enabled);
                }
                Cmd::NextHand => self.next_style(),
                Cmd::Clear => self.clear_ink(),
                Cmd::Quit => {
                    self.quit = true;
                    return SLEEP;
                }
            }
        }

        // Config file hot-reload (mtime).
        if let Ok(meta) = std::fs::metadata(config::config_path()) {
            if let Ok(m) = meta.modified() {
                if self.cfg_mtime.map(|t| t != m).unwrap_or(true) {
                    self.cfg_mtime = Some(m);
                    match config::try_load() {
                        Ok(cfg) => self.apply_config(cfg),
                        Err(e) => log(&format!("config reload ignored: {e}")),
                    }
                }
            }
        }

        if !self.enabled {
            return SLEEP;
        }

        let (px, py, mods) = self.x.pointer();
        let interact = mods & self.interact_mask != 0;
        let zone = self.zone_hit(px, py);
        // Never steal a release belonging to an underlying application's press.
        let want_grab = !zone && !interact && (self.x.grabbed || mods & 0x1f00 == 0);

        if want_grab != self.x.grabbed {
            if want_grab {
                self.x.grab_pointer();
                if self.x.grabbed {
                    self.x.hide_cursor();
                }
            } else {
                self.active = None;
                self.pose_state.release();
                self.x.ungrab_pointer();
                self.x.show_cursor();
            }
        }

        // The hand pose is drawn in monitor-local coordinates, then offset.
        let screen = self.current_screen(px, py);
        let cursor_local = ((px - screen.x) as f64, (py - screen.y) as f64);
        let sw = screen.width as f64;
        let sh = screen.height as f64;
        let geo = self
            .assets
            .get(&self.style)
            .map(|a| a.geo)
            .unwrap_or_default();

        let mut pose: Option<Pose> = if self.laser {
            None
        } else {
            Some(
                self.pose_state
                    .aim(cursor_local, sw, sh, &geo, self.active.is_some()),
            )
        };

        // A fresh transparent frame prevents motion trails and accumulated ink
        // opacity. Borrow stroke data directly; no per-frame point cloning.
        self.frame.fill(tiny_skia::Color::TRANSPARENT);
        self.strokes.retain(|s| s.alpha(self.cfg.ink.fade) > 0.0);
        for s in &self.strokes {
            let a = s.alpha(self.cfg.ink.fade);
            if a > 0.003 {
                render::draw_stroke(&mut self.frame, &s.points, s.color, s.width, a);
            }
        }
        if let Some(active) = &self.active {
            let color = self.ink_color();
            let width = Self::stroke_width(sh);
            render::draw_stroke(&mut self.frame, active, color, width, 1.0);
        }
        // Hand poses were computed in monitor-local space; shift the grip into
        // virtual-screen coordinates for drawing.
        if let Some(p) = &mut pose {
            p.grip_x += screen.x as f64;
            p.grip_y += screen.y as f64;
        }
        if interact && !self.cfg.interact.keeps_hand {
            // Ink remains visible while the real pointer interacts with apps.
        } else if let Some(p) = &pose {
            if self.cfg.pointer.shadow {
                if let Some(a) = self.assets.get(&self.style) {
                    render::draw_shadow(&mut self.frame, &a, p);
                }
                if let Some(a) = self.assets.get(&self.style) {
                    render::draw_hand(&mut self.frame, &a, p, 1.0);
                }
            } else if let Some(a) = self.assets.get(&self.style) {
                render::draw_hand(&mut self.frame, &a, p, 1.0);
            }
        } else {
            let r = self
                .pose_state
                .laser_radius(sh, self.pose_state.press_amount());
            render::draw_laser(&mut self.frame, (px as f64, py as f64), r);
        }

        self.x.put_region(self.overlay, &self.frame, None);

        self.tick_timeout()
    }

    fn apply_config(&mut self, cfg: Config) {
        if !cfg.pointer.size.is_finite() || !(0.08..=0.20).contains(&cfg.pointer.size) {
            log("config reload ignored: pointer.size must be between 0.08 and 0.20");
            return;
        }
        if cfg.pointer.style != "laser" && self.assets.get(&cfg.pointer.style).is_none() {
            log("config reload ignored: hand asset missing or invalid");
            return;
        }
        let reset_pose = cfg.pointer.style != self.style
            || (cfg.pointer.size - self.cfg.pointer.size).abs() > 1e-9;
        self.style = cfg.pointer.style.clone();
        self.laser = self.style == "laser";
        self.ink_choice = InkChoice::parse(&cfg.ink.choice);
        self.interact_mask = interact_mask(&cfg.interact.key);
        self.x.ungrab_keys();
        // Keep action indices stable even if a binding cannot be resolved.
        self.hotkeys = [&cfg.hotkeys.toggle, &cfg.hotkeys.clear, &cfg.hotkeys.cycle]
            .iter()
            .map(|spec| parse_hotkey(&self.x, spec).unwrap_or((0, 0)))
            .collect();
        let grabs: Vec<_> = self
            .hotkeys
            .iter()
            .copied()
            .filter(|(key, _)| *key != 0)
            .collect();
        self.x.grab_hotkeys(&grabs);
        let enabled = cfg.enabled.unwrap_or(true);
        self.cfg = cfg;
        self.tray.sync(&self.cfg);
        if reset_pose {
            self.poses_clear();
        }
        self.preload();
        if enabled != self.enabled {
            self.enabled = enabled;
            if enabled {
                self.x.map_win(self.overlay);
            } else {
                self.x.unmap_win(self.overlay);
                self.x.ungrab_pointer();
                self.x.show_cursor();
                self.poses_clear();
            }
        }
    }

    fn shutdown(&mut self) {
        self.x.ungrab_pointer();
        self.x.show_cursor();
        self.x.unmap_win(self.overlay);
        log("tinyhand: bye");
    }
}

fn interact_mask(key: &str) -> u16 {
    match key {
        "ctrl" | "control" => 0x4,
        "super" => 0x40,
        "alt" => 0x8,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strokes_expire_but_zero_fade_is_persistent() {
        let mut stroke = Stroke {
            points: vec![(2.0, 2.0), (18.0, 2.0)],
            color: [1.0, 0.0, 0.0, 1.0],
            width: 2.0,
            start: Instant::now() - Duration::from_secs(2),
        };
        assert_eq!(stroke.alpha(1.0), 0.0);
        assert_eq!(stroke.alpha(0.0), 1.0);
        stroke.start = Instant::now() - Duration::from_millis(1300);
        assert!((0.45..0.55).contains(&stroke.alpha(1.0)));
    }
}

fn query_workarea_zones(x: &X) -> Vec<(i32, i32, i32, i32)> {
    use x11rb::protocol::xproto::ConnectionExt as _;
    let mut zones = Vec::new();
    if let Ok(cookie) = x.conn.intern_atom(false, b"_NET_WORKAREA") {
        if let Ok(atom) = cookie.reply() {
            let property = atom.atom;
            if let Ok(prop) = x
                .conn
                .get_property(false, x.root, property, 6u32 /* CARDINAL */, 0, 4)
            {
                if let Ok(p) = prop.reply() {
                    if p.value.len() >= 16 {
                        let v: Vec<u32> = p
                            .value
                            .chunks_exact(4)
                            .map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                            .collect();
                        let (wx, wy, ww, wh) = (v[0] as i32, v[1] as i32, v[2] as i32, v[3] as i32);
                        if ww > 0 && wh > 0 {
                            let (rw, rh) = (x.root_w as i32, x.root_h as i32);
                            if wy > 0 {
                                zones.push((0, 0, rw, wy));
                            }
                            if wy + wh < rh {
                                zones.push((0, wy + wh, rw, rh - (wy + wh)));
                            }
                            if wx > 0 {
                                zones.push((0, wy, wx, wh));
                            }
                            if wx + ww < rw {
                                zones.push((wx + ww, wy, rw - (wx + ww), wh));
                            }
                        }
                    }
                }
            }
        }
    }
    if zones.is_empty() {
        // Fallback: GNOME-ish top 28px + bottom 64px.
        let (rw, rh) = (x.root_w as i32, x.root_h as i32);
        zones.push((0, 0, rw, 28));
        zones.push((0, rh - 64, rw, 64));
    }
    zones
}

fn parse_hotkey(x: &X, spec: &str) -> Option<(u8, u16)> {
    let mut mods = 0u16;
    let mut key = None;
    for part in spec.split('+') {
        match part.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => mods |= 0x4,
            "alt" | "option" => mods |= 0x8,
            "shift" => mods |= 0x1,
            "super" | "meta" => mods |= 0x40,
            other => {
                let ch = other.chars().next()?;
                let ks = ch as u32;
                key = x.keycode_for_keysym(ks);
            }
        }
    }
    key.map(|k| (k, mods))
}

#[allow(soft_unstable)]
fn log(msg: &str) {
    let dir = dirs::state_dir()
        .map(|d| d.join("tinyhand"))
        .unwrap_or_else(|| std::path::PathBuf::from("/tmp"));
    let _ = std::fs::create_dir_all(&dir);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("log.txt"))
    {
        use std::io::Write;
        let _ = writeln!(f, "{} {msg}", ts);
    }
}
