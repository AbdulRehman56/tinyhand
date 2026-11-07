// Hand assets: PNG loading, alpha-geometry measurement (port of PointerStyle.swift
// measure()), thumbnails, and precomputed drop-shadow silhouettes.

use crate::config;
use crate::pose::HandGeometry;
use image::RgbaImage;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum InkChoice {
    Match,
    Red,
    Orange,
    Yellow,
    Green,
    Blue,
    Purple,
    White,
    Black,
}

impl InkChoice {
    pub fn parse(s: &str) -> InkChoice {
        match s {
            "red" => InkChoice::Red,
            "orange" => InkChoice::Orange,
            "yellow" => InkChoice::Yellow,
            "green" => InkChoice::Green,
            "blue" => InkChoice::Blue,
            "purple" => InkChoice::Purple,
            "white" => InkChoice::White,
            "black" => InkChoice::Black,
            _ => InkChoice::Match,
        }
    }
}

pub fn ink_rgb(choice: InkChoice) -> [f32; 4] {
    match choice {
        InkChoice::Red => [1.0, 0.16, 0.12, 1.0],
        InkChoice::Orange => [1.0, 0.54, 0.0, 1.0],
        InkChoice::Yellow => [1.0, 0.8, 0.0, 1.0],
        InkChoice::Green => [0.19, 0.76, 0.35, 1.0],
        InkChoice::Blue => [0.04, 0.52, 1.0, 1.0],
        InkChoice::Purple => [0.53, 0.33, 0.95, 1.0],
        InkChoice::White => [1.0, 1.0, 1.0, 1.0],
        InkChoice::Black => [0.11, 0.11, 0.13, 1.0],
        InkChoice::Match => [0.53, 0.33, 0.95, 1.0],
    }
}

pub struct StyleInfo {
    pub id: &'static str,
    pub title: &'static str,
    pub ink: InkChoice,
}

pub const BUILT_INS: &[StyleInfo] = &[
    StyleInfo {
        id: "lavender",
        title: "Lavender toy",
        ink: InkChoice::Purple,
    },
    StyleInfo {
        id: "glove",
        title: "Cursor glove",
        ink: InkChoice::Purple,
    },
    StyleInfo {
        id: "coral",
        title: "Coral vinyl",
        ink: InkChoice::Red,
    },
    StyleInfo {
        id: "plush",
        title: "Plush",
        ink: InkChoice::Blue,
    },
    StyleInfo {
        id: "robot",
        title: "Robot",
        ink: InkChoice::Green,
    },
    StyleInfo {
        id: "pink",
        title: "Bubblegum",
        ink: InkChoice::Purple,
    },
    StyleInfo {
        id: "blue",
        title: "Sky",
        ink: InkChoice::Blue,
    },
    StyleInfo {
        id: "mint",
        title: "Mint",
        ink: InkChoice::Green,
    },
    StyleInfo {
        id: "lemon",
        title: "Lemon",
        ink: InkChoice::Red,
    },
    StyleInfo {
        id: "black",
        title: "Midnight",
        ink: InkChoice::Black,
    },
    StyleInfo {
        id: "chrome",
        title: "Chrome",
        ink: InkChoice::White,
    },
    StyleInfo {
        id: "holo",
        title: "Holo",
        ink: InkChoice::Purple,
    },
    StyleInfo {
        id: "fuzzy",
        title: "Fuzzy",
        ink: InkChoice::Purple,
    },
    StyleInfo {
        id: "wood",
        title: "Wood",
        ink: InkChoice::Orange,
    },
    StyleInfo {
        id: "marble",
        title: "Marble",
        ink: InkChoice::White,
    },
    StyleInfo {
        id: "terrazzo",
        title: "Terrazzo",
        ink: InkChoice::Red,
    },
    StyleInfo {
        id: "glass",
        title: "Glass",
        ink: InkChoice::Blue,
    },
    StyleInfo {
        id: "jelly",
        title: "Jelly",
        ink: InkChoice::Purple,
    },
    StyleInfo {
        id: "pastel",
        title: "Pastel",
        ink: InkChoice::Purple,
    },
    StyleInfo {
        id: "pixel",
        title: "Pixel",
        ink: InkChoice::Black,
    },
    StyleInfo {
        id: "lowpoly",
        title: "Low poly",
        ink: InkChoice::Purple,
    },
    StyleInfo {
        id: "knit",
        title: "Knit",
        ink: InkChoice::Purple,
    },
    StyleInfo {
        id: "skeleton",
        title: "Skeleton",
        ink: InkChoice::Orange,
    },
    StyleInfo {
        id: "astro",
        title: "Astronaut",
        ink: InkChoice::Blue,
    },
    StyleInfo {
        id: "space",
        title: "Space",
        ink: InkChoice::Red,
    },
    StyleInfo {
        id: "monster",
        title: "Monster",
        ink: InkChoice::Green,
    },
    StyleInfo {
        id: "water",
        title: "Water",
        ink: InkChoice::Blue,
    },
    StyleInfo {
        id: "lava",
        title: "Lava",
        ink: InkChoice::Red,
    },
    StyleInfo {
        id: "grass",
        title: "Grass",
        ink: InkChoice::Green,
    },
    StyleInfo {
        id: "cactus",
        title: "Cactus",
        ink: InkChoice::Green,
    },
    StyleInfo {
        id: "choco",
        title: "Chocolate",
        ink: InkChoice::Orange,
    },
    StyleInfo {
        id: "cloud",
        title: "Cloud",
        ink: InkChoice::Blue,
    },
    StyleInfo {
        id: "mech",
        title: "Mech",
        ink: InkChoice::Red,
    },
    StyleInfo {
        id: "neon",
        title: "Neon",
        ink: InkChoice::Purple,
    },
    StyleInfo {
        id: "leaf",
        title: "Leaf",
        ink: InkChoice::Green,
    },
    StyleInfo {
        id: "cookie",
        title: "Gingerbread",
        ink: InkChoice::Orange,
    },
];

pub const DEFAULT_PINNED: [&str; 6] = ["lavender", "glove", "coral", "plush", "robot", "laser"];

pub struct HandAsset {
    pub name: String,
    pub geo: HandGeometry,
    /// Full-resolution premultiplied RGBA pixmap of the composed hand-on-a-stick PNG.
    pub pixmap: tiny_skia::Pixmap,
    /// Blurred black silhouette used as drop shadow.
    pub silhouette: tiny_skia::Pixmap,
}

fn decode_rgba(path: &PathBuf) -> Option<RgbaImage> {
    Some(image::open(path).ok()?.into_rgba8())
}

fn measure(img: &RgbaImage) -> Option<HandGeometry> {
    let w = img.width() as usize;
    let h = img.height() as usize;
    let alpha = |x: usize, y: usize| img.get_pixel(x as u32, y as u32)[3];

    let count_row = |y: usize| -> usize { (0..w).filter(|&x| alpha(x, y) > 128).count() };
    let center_row = |y: usize| -> f64 {
        let mut lo: Option<usize> = None;
        let mut hi = 0usize;
        for x in 0..w {
            if alpha(x, y) > 128 {
                if lo.is_none() {
                    lo = Some(x);
                }
                hi = x;
            }
        }
        match lo {
            Some(l) => (l + hi) as f64 / 2.0 / w as f64,
            None => 0.5,
        }
    };

    let fh = h as f64;
    let top = (0..h).find(|&y| count_row(y) > 0)?;
    let search_end = h.min(top + (0.45 * fh) as usize);
    let max_w = (top..search_end).map(count_row).max()?;
    let fist = (top..h).find(|&y| (count_row(y) as f64) > 0.6 * max_w as f64)?;
    let wrist = (fist..h).find(|&y| (count_row(y) as f64) < 0.35 * max_w as f64)?;
    let rod_w = count_row(h.min(wrist + h / 50));
    let last_row = (0..h).rev().find(|&y| count_row(y) > 0).unwrap_or(h - 1);
    let from = h.min(wrist + h / 33);
    let handle = (from..h).find(|&y| (count_row(y) as f64) > 1.8 * rod_w as f64);
    let rod_end = handle.unwrap_or(last_row);

    let mut min_x = w;
    let mut max_x = 0usize;
    for y in top..wrist {
        for x in 0..w {
            if alpha(x, y) > 128 {
                min_x = min_x.min(x);
                max_x = max_x.max(x);
            }
        }
    }
    if min_x > max_x {
        min_x = max_x;
    }

    let tip_x = center_row(h.min(top + h / 200));
    let rod_x = center_row((wrist + rod_end) / 2);

    Some(HandGeometry {
        aspect: w as f64 / fh,
        hand_top: ((top as f64) - 0.004 * fh).max(0.0) / fh,
        tip: top as f64 / fh,
        wrist: wrist as f64 / fh,
        rod_end: rod_end as f64 / fh,
        tip_x,
        rod_x,
        hand_min_x: min_x as f64 / w as f64,
        hand_max_x: max_x as f64 / w as f64,
    })
}

/// Two-round separable box blur of the alpha plane; output silhouette is black + smoothed alpha.
fn box_blur_alpha(src: RgbaImage, radius: usize) -> tiny_skia::Pixmap {
    let w = src.width() as usize;
    let h = src.height() as usize;
    let r = radius.max(1);

    let mut a: Vec<f32> = src.pixels().map(|p| p[3] as f32).collect();
    let mut tmp = vec![0f32; w * h];

    // One round = horizontal pass a->tmp + vertical pass tmp->a. Repeat twice.
    for _ in 0..2 {
        for y in 0..h {
            for x in 0..w {
                let lo = x.saturating_sub(r);
                let hi = (x + r).min(w - 1);
                let mut acc = 0f32;
                for xx in lo..=hi {
                    acc += a[y * w + xx];
                }
                tmp[y * w + x] = acc / (hi - lo + 1) as f32;
            }
        }
        for y in 0..h {
            for x in 0..w {
                let lo = y.saturating_sub(r);
                let hi = (y + r).min(h - 1);
                let mut acc = 0f32;
                for yy in lo..=hi {
                    acc += tmp[yy * w + x];
                }
                a[y * w + x] = acc / (hi - lo + 1) as f32;
            }
        }
    }

    let mut pix = tiny_skia::Pixmap::new(w as u32, h as u32).unwrap();
    {
        let data = pix.data_mut();
        for (i, v) in a.iter().enumerate() {
            let o = i * 4;
            data[o] = 0;
            data[o + 1] = 0;
            data[o + 2] = 0;
            data[o + 3] = *v as u8;
        }
    }
    pix
}

fn make_silhouette(src: &RgbaImage) -> tiny_skia::Pixmap {
    box_blur_alpha(src.clone(), (src.height() as f32 * 0.02) as usize)
}

pub struct Assets {
    cache: Mutex<HashMap<String, Arc<HandAsset>>>,
}

impl Assets {
    pub fn new() -> Self {
        Self {
            cache: Mutex::new(HashMap::new()),
        }
    }

    pub fn get(&self, style: &str) -> Option<Arc<HandAsset>> {
        if style == "laser" {
            return None;
        }
        if let Some(hit) = self.cache.lock().unwrap().get(style) {
            return Some(hit.clone());
        }
        let slug = format!("hand_{style}");
        let path = config::resolve_asset(&slug)?;
        let img = decode_rgba(&path)?;
        let geo = measure(&img)?;
        let mut pixmap = tiny_skia::Pixmap::new(img.width(), img.height())?;
        {
            let data = pixmap.data_mut();
            for (i, p) in img.pixels().enumerate() {
                let o = i * 4;
                let (r, g, b, a) = (p[0] as u32, p[1] as u32, p[2] as u32, p[3] as u32);
                data[o] = ((r * a / 255) as u8).max(if a > 0 { 1 } else { 0 });
                data[o + 1] = (g * a / 255) as u8;
                data[o + 2] = (b * a / 255) as u8;
                data[o + 3] = a as u8;
            }
        }
        let silhouette = make_silhouette(&img);
        let asset = Arc::new(HandAsset {
            name: slug,
            geo,
            pixmap,
            silhouette,
        });
        let mut cache = self.cache.lock().unwrap();
        if cache.len() > 4 {
            let keys: Vec<String> = cache.keys().take(1).cloned().collect();
            for k in keys {
                cache.remove(&k);
            }
        }
        cache.insert(style.to_string(), asset.clone());
        Some(asset)
    }
}

/// Crop a square region around the hand and scale it to a size×size thumbnail.
pub fn thumbnail(asset: &HandAsset, size: u32) -> tiny_skia::Pixmap {
    let img = &asset.pixmap;
    let (iw, ih) = (img.width() as f64, img.height() as f64);
    let g = &asset.geo;
    let hand_w = (g.hand_max_x - g.hand_min_x) * iw;
    let hand_h = (g.wrist - g.hand_top) * ih;
    let mut side = hand_w.max(hand_h) * 1.06;
    let cx = (g.hand_min_x + g.hand_max_x) / 2.0 * iw;
    let cy = (g.hand_top + g.wrist) / 2.0 * ih;
    let mut x0 = (cx - side / 2.0).max(0.0);
    let mut y0 = (cy - side / 2.0).max(0.0);
    if x0 + side > iw {
        x0 = (iw - side).max(0.0);
    }
    if y0 + side > ih {
        y0 = (ih - side).max(0.0);
    }
    side = side.min(
        iw.min(ih) as f64
            - if iw.min(ih) as f64 - x0.max(y0) < side {
                (x0 - y0).abs()
            } else {
                0.0
            },
    );
    let side = side.max(1.0);

    let mut thumb = tiny_skia::Pixmap::new(size, size).unwrap();
    let dst = thumb.data_mut();
    let scale = size as f64 / side;
    for iy in 0..size {
        for ix in 0..size {
            let sx = (x0 + ix as f64 / scale) as usize;
            let sy = (y0 + iy as f64 / scale) as usize;
            let s = img.pixel(
                (sx.min(iw as usize - 1)) as u32,
                (sy.min(ih as usize - 1)) as u32,
            );
            if let Some(c) = s {
                let o = ((iy * size + ix) * 4) as usize;
                dst[o] = c.red();
                dst[o + 1] = c.green();
                dst[o + 2] = c.blue();
                dst[o + 3] = c.alpha();
            }
        }
    }
    thumb
}
