// X11 toolbox (x11rb only, no system C deps): connection, monitors, pointer query,
// cursor hiding, input capture with pass-through replay, passive hotkey grabs,
// ARGB overlay windows with empty input shape, and chunked frame uploads.
//
// The full TinyHand experience requires a real X11 (Xorg) session. On GNOME Wayland
// the companion shell extension provides the same UX instead.

use crate::model::Screen;
use std::time::Duration;
use x11rb::connection::Connection;
use x11rb::protocol::shape::ConnectionExt as _;
use x11rb::protocol::shape::SK;
use x11rb::protocol::shape::SO;
use x11rb::protocol::xfixes::ConnectionExt as _;
use x11rb::protocol::xproto::*;
use x11rb::protocol::xtest::ConnectionExt as _;
use x11rb::rust_connection::RustConnection;
use x11rb::CURRENT_TIME;

pub struct X {
    pub conn: RustConnection,
    pub screen_num: usize,
    pub root: u32,
    pub screens: Vec<Screen>,
    pub root_w: u32,
    pub root_h: u32,
    argb_visual: Visualid,
    argb_cmap: Colormap,
    pub grabbed: bool,
    pub cursor_hidden: bool,
    gcs: std::collections::HashMap<u32, u32>,
}

pub struct PtrEvent {
    pub kind: PtrEventKind,
    pub detail: u8,
    pub x: i32,
    pub y: i32,
    pub mods: u16,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PtrEventKind {
    Press,
    Release,
    Motion,
}

impl X {
    pub fn connect() -> Result<Self, String> {
        let (conn, screen_num) = x11rb::connect(None).map_err(|e| e.to_string())?;
        // HideCursor/ShowCursor require XFixes 4 and version negotiation first.
        let fixes = conn
            .xfixes_query_version(4, 0)
            .map_err(|e| e.to_string())?
            .reply()
            .map_err(|e| e.to_string())?;
        if fixes.major_version < 4 {
            return Err("TinyHand requires XFixes 4 for cursor hiding".into());
        }
        let (root, root_w, root_h, argb_visual) = {
            let setup = conn.setup();
            let screen = &setup.roots[screen_num];
            let root = screen.root;

            // Locate a depth-32 (ARGB) visual; required for a translucent overlay.
            let mut argb: Option<Visualid> = None;
            for d in &screen.allowed_depths {
                if d.depth != 32 {
                    continue;
                }
                for v in &d.visuals {
                    if v.red_mask == 0xff0000 && v.green_mask == 0xff00 && v.blue_mask == 0xff {
                        argb = Some(v.visual_id);
                        break;
                    }
                }
            }
            let argb =
                argb.ok_or("no 32-bit RGBA visual: a composited desktop is required for TinyHand")?;
            (
                root,
                screen.width_in_pixels as u32,
                screen.height_in_pixels as u32,
                argb,
            )
        };

        let argb_cmap = conn.generate_id().map_err(|e| e.to_string())?;
        conn.create_colormap(ColormapAlloc::NONE, argb_cmap, root, argb_visual)
            .map_err(|e| e.to_string())?;
        conn.flush().map_err(|e| e.to_string())?;

        // Monitors via Xinerama; fall back to the root screen as one monitor.
        let mut screens = Vec::new();
        if let Ok(reply) = x11rb::protocol::xinerama::query_screens(&conn) {
            if let Ok(r) = reply.reply() {
                for s in &r.screen_info {
                    screens.push(Screen {
                        x: s.x_org as i32,
                        y: s.y_org as i32,
                        width: s.width as i32,
                        height: s.height as i32,
                    });
                }
            }
        }
        if screens.is_empty() {
            screens.push(Screen {
                x: 0,
                y: 0,
                width: root_w as i32,
                height: root_h as i32,
            });
        }

        Ok(Self {
            conn,
            screen_num,
            root,
            root_w,
            root_h,
            screens,
            argb_visual,
            argb_cmap,
            grabbed: false,
            cursor_hidden: false,
            gcs: std::collections::HashMap::new(),
        })
    }

    pub fn screen_at(&self, x: i32, y: i32) -> Screen {
        crate::model::Screen::index_of(&self.screens, x, y)
            .and_then(|i| self.screens.get(i).cloned())
            .unwrap_or_else(|| self.screens[0].clone())
    }

    // -- pointer ---------------------------------------------------------

    /// Root pointer position + modifier/button mask (Button1Mask bit 8, Mod1=Alt bit 3,
    /// Control bit 2, Shift bit 0, Super (Mod4) bit 6).
    pub fn pointer(&self) -> (i32, i32, u16) {
        match self.conn.query_pointer(self.root) {
            Ok(cookie) => match cookie.reply() {
                Ok(r) => (r.root_x as i32, r.root_y as i32, u16::from(r.mask)),
                Err(_) => (0, 0, 0),
            },
            Err(_) => (0, 0, 0),
        }
    }

    // -- cursor hiding -----------------------------------------------------

    pub fn hide_cursor(&mut self) {
        if !self.cursor_hidden {
            self.cursor_hidden = self
                .conn
                .xfixes_hide_cursor(self.root)
                .ok()
                .is_some_and(|cookie| cookie.check().is_ok());
        }
    }

    pub fn show_cursor(&mut self) {
        if self.cursor_hidden {
            if self
                .conn
                .xfixes_show_cursor(self.root)
                .ok()
                .is_some_and(|cookie| cookie.check().is_ok())
            {
                self.cursor_hidden = false;
            }
        }
    }

    // -- input capture ------------------------------------------------------

    pub fn grab_pointer(&mut self) {
        if self.grabbed {
            return;
        }
        let mask = EventMask::BUTTON_PRESS | EventMask::BUTTON_RELEASE | EventMask::POINTER_MOTION;
        self.grabbed = self
            .conn
            .grab_pointer(
                false,
                self.root,
                mask,
                GrabMode::ASYNC,
                GrabMode::ASYNC,
                self.root,
                0u32, // no cursor
                CURRENT_TIME,
            )
            .ok()
            .and_then(|cookie| cookie.reply().ok())
            .is_some_and(|reply| reply.status == GrabStatus::SUCCESS);
        let _ = self.conn.flush();
    }

    pub fn ungrab_pointer(&mut self) {
        if !self.grabbed {
            return;
        }
        let _ = self.conn.ungrab_pointer(CURRENT_TIME);
        let _ = self.conn.flush();
        self.grabbed = false;
    }

    // -- synthetic input (XTest) ---------------------------------------------

    pub fn fake_button_down(&self, button: u8) {
        let _ = self.conn.xtest_fake_input(
            BUTTON_PRESS_EVENT,
            button,
            0u32,
            self.root,
            0i16,
            0i16,
            0u8,
        );
        let _ = self.conn.flush();
    }

    pub fn fake_button_up(&self, button: u8) {
        let _ = self.conn.xtest_fake_input(
            BUTTON_RELEASE_EVENT,
            button,
            0u32,
            self.root,
            0i16,
            0i16,
            0u8,
        );
        let _ = self.conn.flush();
    }

    // -- hotkeys ---------------------------------------------------------------

    /// combos are (keycode, ModMask-bits).
    pub fn grab_hotkeys(&self, combos: &[(u8, u16)]) {
        for (key, mods) in combos {
            for extra in [0u16, 2, 16, 18] {
                // 2=NumLock(Mod2), 16=CapsLock(LOCK), 18=both
                let mask_mods = ModMask::from(u16::from(*mods) | extra);
                let _ = self.conn.grab_key(
                    false,
                    self.root,
                    mask_mods,
                    *key,
                    GrabMode::ASYNC,
                    GrabMode::ASYNC,
                );
            }
        }
        let _ = self.conn.flush();
    }

    pub fn ungrab_keys(&self) {
        let _ = self.conn.ungrab_key(0u8, self.root, ModMask::ANY);
        let _ = self.conn.flush();
    }

    /// Resolve a keysym (single lowercase letter or digit as ASCII) to a keycode.
    pub fn keycode_for_keysym(&self, keysym: u32) -> Option<u8> {
        let setup = self.conn.setup();
        let min = setup.min_keycode;
        let max = setup.max_keycode;
        if max < min {
            return None;
        }
        let count = (max - min + 1).min(200) as u8;
        let reply = self
            .conn
            .get_keyboard_mapping(min, count)
            .ok()?
            .reply()
            .ok()?;
        let per = reply.keysyms_per_keycode as usize;
        if per == 0 {
            return None;
        }
        let cols = reply.keysyms.len() / per;
        for i in 0..cols.min(count as usize) {
            for k in 0..per {
                if reply.keysyms[i * per + k] == keysym {
                    return Some(min + i as u8);
                }
            }
        }
        None
    }

    // -- windows -----------------------------------------------------------------

    pub fn create_overlay_win(&self, w: u32, h: u32) -> Result<u32, String> {
        let win = self.conn.generate_id().map_err(|e| e.to_string())?;
        self.conn
            .create_window(
                32,
                win,
                self.root,
                0,
                0,
                w.max(1) as u16,
                h.max(1) as u16,
                0,
                WindowClass::INPUT_OUTPUT,
                self.argb_visual,
                &CreateWindowAux::new()
                    .colormap(self.argb_cmap)
                    .override_redirect(1u32),
            )
            .map_err(|e| e.to_string())?;

        // Empty input shape => all pointer input passes through to windows below.
        let _ =
            self.conn
                .shape_rectangles(SO::SET, SK::INPUT, ClipOrdering::UNSORTED, win, 0, 0, &[]);
        self.conn.flush().map_err(|e| e.to_string())?;
        Ok(win)
    }

    /// A UI window we own input for (tray popovers are elsewhere; this is reserved
    /// for future toolbar/settings panes).
    pub fn create_ui_win(&self, w: u32, h: u32) -> Result<u32, String> {
        let win = self.conn.generate_id().map_err(|e| e.to_string())?;
        self.conn
            .create_window(
                32,
                win,
                self.root,
                0,
                0,
                w.max(1) as u16,
                h.max(1) as u16,
                0,
                WindowClass::INPUT_OUTPUT,
                self.argb_visual,
                &CreateWindowAux::new()
                    .colormap(self.argb_cmap)
                    .override_redirect(0u32),
            )
            .map_err(|e| e.to_string())?;
        self.conn.flush().map_err(|e| e.to_string())?;
        Ok(win)
    }

    pub fn move_win(&self, win: u32, x: i32, y: i32, w: u32, h: u32) {
        let _ = self.conn.configure_window(
            win,
            &ConfigureWindowAux::new()
                .x(x as i32)
                .y(y as i32)
                .width(w.max(1) as u32)
                .height(h.max(1) as u32),
        );
        let _ = self.conn.flush();
    }

    pub fn map_win(&self, win: u32) {
        let _ = self.conn.map_window(win);
        self.raise(win);
    }

    pub fn unmap_win(&self, win: u32) {
        let _ = self.conn.unmap_window(win);
        let _ = self.conn.flush();
    }

    pub fn raise(&self, win: u32) {
        let _ = self
            .conn
            .configure_window(win, &ConfigureWindowAux::new().stack_mode(StackMode::ABOVE));
        let _ = self.conn.flush();
    }

    fn gc_for(&mut self, win: u32) -> u32 {
        if let Some(gc) = self.gcs.get(&win) {
            return *gc;
        }
        let gc = self.conn.generate_id().unwrap_or(0);
        let _ = self.conn.create_gc(gc, win, &CreateGCAux::new());
        self.gcs.insert(win, gc);
        gc
    }

    /// Upload a region of an RGBA8 (tiny-skia byte order) pixmap to an ARGB window.
    /// Swizzles R<->B and chunks the upload by row bands to respect request size
    /// limits. `region` = (x, y, w, h); None for the whole pixmap.
    pub fn put_region(
        &mut self,
        win: u32,
        pix: &tiny_skia::Pixmap,
        region: Option<(i32, i32, u32, u32)>,
    ) {
        let pw = pix.width();
        let ph = pix.height();
        let (rx, ry, rw, rh) = region.unwrap_or((0, 0, pw, ph));
        let x = rx.clamp(0, pw as i32 - 1);
        let y = ry.clamp(0, ph as i32 - 1);
        let w = rw.min(pw - x.max(0) as u32);
        let h = rh.min(ph - y.max(0) as u32);
        if w == 0 || h == 0 {
            return;
        }
        let gc = self.gc_for(win);
        let src = pix.data();
        // Band size: cap ~512KB per request.
        let rows_per_band = ((512 * 1024) / (w as usize * 4)).clamp(1, 1024) as u32;
        let mut band = vec![0u8; (w * rows_per_band * 4) as usize];
        let mut yy = y as i32;
        let bottom = y as i32 + h as i32;
        while yy < bottom {
            let remaining = bottom - yy;
            let rows = (rows_per_band as i32).min(remaining).max(0) as u32;
            if rows == 0 {
                break;
            }
            for r in 0..rows {
                let src_row = ((yy as u32 + r) as usize) * pw as usize * 4 + (x as usize * 4);
                let dst_row = (r * w * 4) as usize;
                for px in 0..w as usize {
                    let so = src_row + px * 4;
                    let doff = dst_row + px * 4;
                    // tiny-skia bytes: R G B A (premul). X ARGB32 little-endian: B G R A.
                    band[doff] = src[so + 2];
                    band[doff + 1] = src[so + 1];
                    band[doff + 2] = src[so];
                    band[doff + 3] = src[so + 3];
                }
            }
            let _ = self.conn.put_image(
                ImageFormat::Z_PIXMAP,
                win,
                gc,
                w as u16,
                rows as u16,
                x as i16,
                yy as i16,
                0,
                32,
                &band[..(rows * w * 4) as usize],
            );
            yy += rows as i32;
        }
        let _ = self.conn.flush();
    }

    pub fn flush(&self) {
        let _ = self.conn.flush();
    }

    /// Wait for an event, polling with a short sleep (x11rb 0.14 dropped the
    /// blocking-with-timeout API). Returns None once the deadline passes.
    pub fn wait_event(
        &self,
        timeout: Option<Duration>,
    ) -> Result<Option<x11rb::protocol::Event>, String> {
        let deadline = timeout
            .map(|t| std::time::Instant::now() + t)
            .unwrap_or_else(std::time::Instant::now);
        loop {
            match self.conn.poll_for_event() {
                Ok(Some(ev)) => return Ok(Some(ev)),
                Ok(None) => {}
                Err(e) => return Err(e.to_string()),
            }
            if std::time::Instant::now() >= deadline {
                return Ok(None);
            }
            std::thread::sleep(Duration::from_millis(2));
        }
    }
}
