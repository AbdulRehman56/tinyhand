// Config file shared by the Rust app (X11) and the GNOME Wayland companion.
// JSON schema:
// {
//   "flag_hotkeys_warning_shown": false,
//   "pointer": { "style": "lavender", "size": 0.13, "shadow": true },
//   "ink":     { "choice": "match", "fade": 3.0 },
//   "sound":   { "hand": true, "laser": false, "tap": "thock" },
//   "interact":{ "key": "alt", "keepsHand": false },
//   "hotkeys": { "toggle": "ctrl+alt+h", "clear": "ctrl+alt+x", "cycle": "ctrl+alt+p" }
// }

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const KEYS: [&str; 8] = [
    "red", "orange", "yellow", "green", "blue", "purple", "white", "black",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PointerCfg {
    pub style: String,
    pub size: f64,
    pub shadow: bool,
}

impl Default for PointerCfg {
    fn default() -> Self {
        Self {
            style: "lavender".into(),
            size: 0.13,
            shadow: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct InkCfg {
    pub choice: String, // "match" | red|orange|yellow|green|blue|purple|white|black
    pub fade: f64,
}

impl Default for InkCfg {
    fn default() -> Self {
        Self {
            choice: "match".into(),
            fade: 3.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SoundCfg {
    pub hand: bool,
    pub laser: bool,
    pub tap: String, // thock|click|pop|wood|boop|squeak
}

impl Default for SoundCfg {
    fn default() -> Self {
        Self {
            hand: true,
            laser: false,
            tap: "thock".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct InteractCfg {
    pub key: String, // alt|ctrl|super|off
    pub keeps_hand: bool,
}

impl Default for InteractCfg {
    fn default() -> Self {
        Self {
            key: "alt".into(),
            keeps_hand: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HotkeysCfg {
    pub toggle: String,
    pub clear: String,
    pub cycle: String,
}

impl Default for HotkeysCfg {
    fn default() -> Self {
        Self {
            toggle: "ctrl+alt+h".into(),
            clear: "ctrl+alt+x".into(),
            cycle: "ctrl+alt+p".into(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub enabled: Option<bool>,
    pub pointer: PointerCfg,
    pub ink: InkCfg,
    pub sound: SoundCfg,
    pub interact: InteractCfg,
    pub hotkeys: HotkeysCfg,
    pub seen_welcome: bool,
}

pub fn config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("tinyhand")
        .join("config.json")
}

pub fn data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("tinyhand")
}

pub fn cache_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("tinyhand")
}

pub fn load() -> Config {
    let path = config_path();
    if let Ok(text) = std::fs::read_to_string(&path) {
        match serde_json::from_str::<Config>(&text) {
            Ok(v) => return v,
            Err(e) => {
                eprintln!("tinyhand: config parse failed, using defaults: {e}");
            }
        }
    }
    Config::default()
}

/// Reload must not replace live settings with defaults during a partial write.
pub fn try_load() -> Result<Config, String> {
    let text = std::fs::read_to_string(config_path()).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

pub fn ensure_exists() -> std::io::Result<()> {
    ensure_at(&config_path())
}

fn ensure_at(path: &std::path::Path) -> std::io::Result<()> {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
    {
        Ok(mut file) => {
            let text = serde_json::to_string_pretty(&Config::default())?;
            file.write_all(text.as_bytes())
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(e) => Err(e),
    }
}

pub fn save(cfg: &Config) {
    let path = config_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string_pretty(cfg) {
        let _ = std::fs::write(&path, text);
    }
}

fn find_asset_dir(relative_path: &str) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    let mut dirs = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        let mut d = exe.parent().map(|p| p.to_path_buf());
        for _ in 0..6 {
            if let Some(p) = d {
                dirs.push(p.clone());
                d = p.parent().map(|q| q.to_path_buf());
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let mut d = Some(cwd);
        for _ in 0..6 {
            if let Some(p) = d {
                dirs.push(p.clone());
                d = p.parent().map(|q| q.to_path_buf());
            }
        }
    }
    // Data dir first (install layout), then exe/cwd ancestors (dev run + repo layout).
    if let Some(data) = dirs::data_dir() {
        candidates.push(data.join("tinyhand").join("assets"));
    }
    for d in dirs {
        candidates.push(d.join("assets"));
        candidates.push(d);
    }
    candidates.dedup();
    for dir in candidates {
        let f = dir.join(relative_path);
        if f.exists() {
            return Some(dir);
        }
    }
    None
}

/// Resolve an asset lookup: {data_dir}/assets/<name>.png, then any `assets/`
/// dir found walking up from the executable or CWD (dev runs from linux/ or repo root).
pub fn resolve_asset(name: &str) -> Option<PathBuf> {
    let relative_path = format!("{name}.png");
    find_asset_dir(&relative_path).map(|d| d.join(relative_path))
}

pub fn resolve_sound(tap: &str) -> Option<PathBuf> {
    [format!("sounds/tap_{tap}.wav"), format!("tap_{tap}.wav")]
        .into_iter()
        .find_map(|relative_path| find_asset_dir(&relative_path).map(|d| d.join(relative_path)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_tap_sounds_resolve_to_wav_files() {
        for tap in ["thock", "click", "pop", "wood", "boop", "squeak"] {
            let path = resolve_sound(tap).unwrap_or_else(|| panic!("Missing tap sound: {tap}"));
            assert_eq!(path.extension().unwrap(), "wav");
            assert!(path.is_file());
        }
        assert!(resolve_asset("hand_lavender").unwrap().is_file());
        assert!(resolve_sound("nonexistent").is_none());
    }

    #[test]
    fn defaults_are_created_only_when_absent() {
        let dir = std::env::temp_dir().join(format!("tinyhand-config-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        ensure_at(&path).unwrap();
        let cfg: Config = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(cfg.pointer.style, "lavender");
        // Even malformed existing user data must never be overwritten.
        std::fs::write(&path, b"user settings").unwrap();
        ensure_at(&path).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"user settings");
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
}
