// Tap sounds via paplay (PulseAudio/PipeWire surely present on the user's desktop).

use crate::config;
use std::process::{Command, Stdio};

pub fn play(tap: &str) {
    if let Some(path) = config::resolve_sound(tap) {
        // Spawn and wait on a worker so playback never blocks the X11 loop and
        // every successfully spawned child is reaped.
        let _ = std::thread::Builder::new()
            .name("tinyhand-sound".into())
            .spawn(move || {
                if let Ok(mut child) = Command::new("paplay")
                    .arg(path)
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                {
                    let _ = child.wait();
                }
            });
    }
}

pub fn play_hand(cfg: &config::SoundCfg) {
    if cfg.hand {
        play(&cfg.tap);
    }
}

pub fn play_laser(cfg: &config::SoundCfg) {
    if cfg.laser {
        play("boop");
    }
}
