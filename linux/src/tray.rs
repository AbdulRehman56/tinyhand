// StatusNotifier tray via ksni (pure-Rust zbus; no C deps).

use crate::config::Config;
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy)]
pub enum Cmd {
    Toggle,
    NextHand,
    Clear,
    Quit,
}

pub struct Shared {
    pub cfg: Mutex<Config>,
    pub tx: Sender<Cmd>,
}

struct TinyTray {
    shared: Arc<Shared>,
}

impl ksni::Tray for TinyTray {
    fn id(&self) -> String {
        "tinyhand".into()
    }

    fn icon_name(&self) -> String {
        "tinyhand".into()
    }

    fn title(&self) -> String {
        "TinyHand".into()
    }

    fn menu(&self) -> Vec<ksni::MenuItem<Self>> {
        use ksni::menu::*;
        let enabled = self
            .shared
            .cfg
            .lock()
            .map(|c| c.enabled.unwrap_or(true))
            .unwrap_or(true);
        let mk = |send: Cmd| -> Box<dyn Fn(&mut Self) + Send> {
            let tx = self.shared.tx.clone();
            Box::new(move |_: &mut Self| {
                let _ = tx.send(send);
            })
        };
        vec![
            CheckmarkItem {
                label: "Show pointer".into(),
                checked: enabled,
                activate: mk(Cmd::Toggle),
                ..Default::default()
            }
            .into(),
            StandardItem {
                label: "Next hand".into(),
                activate: mk(Cmd::NextHand),
                ..Default::default()
            }
            .into(),
            StandardItem {
                label: "Clear drawing".into(),
                activate: mk(Cmd::Clear),
                ..Default::default()
            }
            .into(),
            MenuItem::Separator,
            StandardItem {
                label: "Quit".into(),
                activate: mk(Cmd::Quit),
                ..Default::default()
            }
            .into(),
        ]
    }
}

pub struct Tray {
    handle: Option<ksni::blocking::Handle<TinyTray>>,
    enabled: bool,
}

impl Tray {
    pub fn spawn(cfg: Config, tx: Sender<Cmd>) -> Self {
        let enabled = cfg.enabled.unwrap_or(true);
        let shared = Arc::new(Shared {
            cfg: Mutex::new(cfg),
            tx,
        });
        let svc = TinyTray { shared };
        use ksni::blocking::TrayMethods;
        let handle = match svc.spawn() {
            Ok(handle) => Some(handle),
            Err(error) => {
                eprintln!("tinyhand: tray unavailable (hotkeys still work): {error}");
                None
            }
        };
        Self { handle, enabled }
    }

    pub fn sync(&mut self, cfg: &Config) {
        let enabled = cfg.enabled.unwrap_or(true);
        if self.enabled == enabled {
            return;
        }
        self.enabled = enabled;
        if let Some(handle) = &self.handle {
            handle.update(move |tray| {
                if let Ok(mut cfg) = tray.shared.cfg.lock() {
                    cfg.enabled = Some(enabled);
                }
            });
        }
    }
}

impl Drop for Tray {
    fn drop(&mut self) {
        if let Some(handle) = &self.handle {
            handle.shutdown();
        }
    }
}
