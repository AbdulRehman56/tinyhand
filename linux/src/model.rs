// Public data model shared between modules.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Screen {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl Screen {
    pub fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }
    pub fn index_of(screens: &[Self], x: i32, y: i32) -> Option<usize> {
        screens.iter().position(|s| s.contains(x, y))
    }
}
