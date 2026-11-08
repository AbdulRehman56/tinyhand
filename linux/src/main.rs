// TinyHand for Linux — entry point.
//
// Dead_code is allowed crate-wide: several modules carry parity-complete
// helpers (thumbnails, text rasterizer, UI window plumbing) that the X11 app's
// v1 builds its tray/selftest around but does not yet call directly.
#![allow(dead_code)]

mod app;
mod asset;
mod config;
mod model;
mod pose;
mod render;
mod sound;
mod tray;
mod x11;

use std::path::PathBuf;

const VERSION: &str = env!("CARGO_PKG_VERSION");

fn usage() -> String {
    "tinyhand — a tiny hand on a stick that points at things on your screen

USAGE:
  tinyhand                 run TinyHand (X11 full experience)
  tinyhand --selftest      render sample poses to /tmp/tinyhand-selftest/*.png (no X needed)
  tinyhand --config        print the config file path
  tinyhand --version       print version
  tinyhand --help          this text

Hotkeys (default): Ctrl+Alt+H toggle · Ctrl+Alt+X clear drawing · Ctrl+Alt+P next hand
Config:             ~/.config/tinyhand/config.json
GNOME Wayland:      install the companion shell extension instead (see linux/README.md)"
        .into()
}

fn session_is_x() -> Result<(), String> {
    let display = std::env::var("DISPLAY").unwrap_or_default();
    let wayland = std::env::var("WAYLAND_DISPLAY").is_ok();
    if display.is_empty() {
        if wayland {
            return Err("This is a Wayland session without XWayland.\n\
                 TinyHand's native app needs X11. On GNOME, install the companion\n\
                 shell extension instead:  linux/scripts/install.sh --extension\n\
                 (full guide: linux/README.md)"
                .into());
        }
        return Err("DISPLAY is not set: TinyHand needs an X11 session.".into());
    }
    if wayland {
        eprintln!(
            "warning: running inside XWayland on Wayland.\n\
             Global cursor hiding / click capture only affect X11 apps there.\n\
             On GNOME, prefer the companion shell extension (linux/scripts/install.sh --extension)."
        );
    }
    Ok(())
}

fn selftest() -> Result<(), String> {
    let out_dir = PathBuf::from("/tmp/tinyhand-selftest");
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let assets = asset::Assets::new();

    let cases: &[(&str, (f64, f64), f64, bool)] = &[
        ("lavender", (1350.0, 380.0), 0.13, false),
        ("lavender", (300.0, 150.0), 0.13, true),
        ("coral", (960.0, 540.0), 0.20, false),
        ("robot", (200.0, 900.0), 0.10, false),
        ("glove", (1700.0, 850.0), 0.15, true),
    ];

    for (i, (style, cursor, size, held)) in cases.iter().enumerate() {
        let a = assets.get(style).ok_or(format!("asset {style} missing"))?;
        let mut st = pose::PoseState::new(*size);
        if *held {
            // two ticks so press & easing settle like a real session
            let _ = st.aim(*cursor, 1920.0, 1080.0, &a.geo, true);
        }
        let p = st.aim(*cursor, 1920.0, 1080.0, &a.geo, *held);
        let (tx, ty) = p.tip_point(&a.geo);
        if ((tx - cursor.0).abs() > 1.0) || ((ty - cursor.1).abs() > 1.0) {
            return Err(format!(
                "selftest: tip mismatch for {style}: tip=({tx:.1},{ty:.1}) cursor={cursor:?}"
            ));
        }

        let mut pix = tiny_skia::Pixmap::new(1920, 1080).unwrap();
        render::draw_shadow(&mut pix, &a, &p);
        render::draw_hand(&mut pix, &a, &p, 1.0);
        if i == 1 {
            // also draw a sample stroke for the draw-mode check
            render::draw_stroke(
                &mut pix,
                &[
                    (300.0, 150.0),
                    (380.0, 220.0),
                    (520.0, 240.0),
                    (700.0, 210.0),
                ],
                asset::ink_rgb(asset::InkChoice::Red),
                6.0,
                1.0,
            );
        }
        // save as PNG (un-premultiply into straight RGBA)
        let mut img = image::RgbaImage::new(pix.width(), pix.height());
        for (x, y, o) in img.enumerate_pixels_mut() {
            let px = pix.pixel(x, y).unwrap();
            let a = px.alpha() as u32;
            let (r, g, b) = if a == 0 {
                (0u8, 0u8, 0u8)
            } else {
                let un = |v: u8| ((v as u32 * 255 + 127) / a.max(1)) as u8;
                (un(px.red()), un(px.green()), un(px.blue()))
            };
            *o = image::Rgba([r, g, b, px.alpha()]);
        }
        let name = format!("{}-{}.png", style, i);
        img.save(out_dir.join(&name)).map_err(|e| e.to_string())?;
        println!("selftest: {name} tip=({tx:.1},{ty:.1}) match");
    }
    println!("selftest OK -> {}", out_dir.display());
    Ok(())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let arg = args.get(1).map(String::as_str).unwrap_or("run");
    match arg {
        "--help" | "-h" => {
            println!("{}", usage());
        }
        "--version" | "-V" => {
            println!("tinyhand {VERSION} (linux)");
        }
        "--config" | "--settings" => {
            if let Err(e) = config::ensure_exists() {
                eprintln!("tinyhand: could not create config: {e}");
                std::process::exit(1);
            }
            println!("{}", config::config_path().display());
        }
        "--selftest" => match selftest() {
            Ok(()) => {}
            Err(e) => {
                eprintln!("selftest failed: {e}");
                std::process::exit(1);
            }
        },
        "run" | "" => match session_is_x() {
            Ok(()) => match app::App::init() {
                Ok(app) => std::process::exit(app.run()),
                Err(e) => {
                    eprintln!("tinyhand: {e}");
                    std::process::exit(1);
                }
            },
            Err(e) => {
                eprintln!("tinyhand: {e}");
                std::process::exit(2);
            }
        },
        other => {
            eprintln!("tinyhand: unknown argument '{other}'\n\n{}", usage());
            std::process::exit(1);
        }
    }
}
