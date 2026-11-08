// Frame renderer: rotated hand blits, shadow, laser dot, ink strokes, simple text.
// All coordinates are y-down screen pixels of the overlay's monitor.

use crate::asset::HandAsset;
use crate::pose::{rotate, Pose};

pub struct Canvas<'a> {
    pub pix: &'a mut tiny_skia::Pixmap,
}

impl<'a> Canvas<'a> {
    pub fn rect_fill(&mut self, rect: tiny_skia::Rect, color: [f32; 4]) {
        let mut paint = tiny_skia::Paint::default();
        paint.set_color_rgba8(
            (color[0] * 255.0) as u8,
            (color[1] * 255.0) as u8,
            (color[2] * 255.0) as u8,
            (color[3] * 255.0) as u8,
        );
        paint.anti_alias = true;
        self.pix
            .fill_rect(rect, &paint, tiny_skia::Transform::default(), None);
    }
}

fn over(dst: &mut [u8], src: [f32; 4]) {
    let da = dst[3] as f32 / 255.0;
    let sa = src[3].clamp(0.0, 1.0);
    let oa = sa + da * (1.0 - sa);
    if oa <= 0.0001 {
        dst[0] = 0;
        dst[1] = 0;
        dst[2] = 0;
        dst[3] = 0;
        return;
    }
    for i in 0..3 {
        // Both the sampled source and tiny-skia destination are premultiplied.
        let s = src[i].clamp(0.0, sa);
        let d = dst[i] as f32 / 255.0;
        let v = s + d * (1.0 - sa);
        dst[i] = (v * 255.0).clamp(0.0, 255.0).round() as u8;
    }
    dst[3] = (oa * 255.0).clamp(0.0, 255.0).round() as u8;
}

#[inline]
fn sample_bilinear(pix: &tiny_skia::Pixmap, fx: f64, fy: f64) -> Option<[f32; 4]> {
    let w = pix.width() as i64;
    let h = pix.height() as i64;
    if w == 0 || h == 0 {
        return None;
    }
    let x0 = (fx.floor() as i64).clamp(0, w - 1);
    let y0 = (fy.floor() as i64).clamp(0, h - 1);
    let tx = (fx - x0 as f64).clamp(0.0, 1.0) as f32;
    let ty = (fy - y0 as f64).clamp(0.0, 1.0) as f32;
    let data = pix.data();
    let mut acc = [0f32; 4];
    for (dy, wy) in [(0i64, 1.0f32 - ty), (1i64, ty)] {
        for (dx, wx) in [(0i64, 1.0f32 - tx), (1i64, tx)] {
            let x = (x0 + dx).clamp(0, w - 1);
            let y = (y0 + dy).clamp(0, h - 1);
            let o = ((y * w + x) * 4) as usize;
            let weight = wy * wx;
            acc[0] += (data[o] as f32 / 255.0) * weight;
            acc[1] += (data[o + 1] as f32 / 255.0) * weight;
            acc[2] += (data[o + 2] as f32 / 255.0) * weight;
            acc[3] += (data[o + 3] as f32 / 255.0) * weight;
        }
    }
    Some(acc)
}

/// Rotated slice blit of the hand asset: draws rod + hand portions around the grip.
pub fn draw_hand(pix: &mut tiny_skia::Pixmap, asset: &HandAsset, pose: &Pose, extra_alpha: f64) {
    let src = &asset.pixmap;
    let g = &asset.geo;
    let iw = src.width() as f64;
    let ih = src.height() as f64;

    let hw = pose.width_pts;
    let rod_top_local = -(pose.rod_len + pose.hand_pts);
    // local y ranges: hand [rod_top_local, -rod_len), rod [-rod_len, 0)
    // local x: [-hw/2, hw/2]

    // corner local points of the whole group (hand top edge to grip bottom)
    let l = [
        (-hw / 2.0, rod_top_local),
        (hw / 2.0, rod_top_local),
        (hw / 2.0, 0.0),
        (-hw / 2.0, 0.0),
    ];
    let mut min_x = f64::MAX;
    let mut min_y = f64::MAX;
    let mut max_x = f64::MIN;
    let mut max_y = f64::MIN;
    for (lx, ly) in l {
        let (wx, wy) = rotate(lx, ly, pose.rotation);
        let wx = wx + pose.grip_x;
        let wy = wy + pose.grip_y;
        min_x = min_x.min(wx);
        max_x = max_x.max(wx);
        min_y = min_y.min(wy);
        max_y = max_y.max(wy);
    }

    let pad = 2.0;
    let x0 = (min_x - pad).floor().max(0.0) as i32;
    let y0 = (min_y - pad).floor().max(0.0) as i32;
    let x1 = (max_x + pad).ceil().min(pix.width() as f64 - 1.0) as i32;
    let y1 = (max_y + pad).ceil().min(pix.height() as f64 - 1.0) as i32;

    let cos = pose.rotation.cos();
    let sin = pose.rotation.sin();
    let alpha = extra_alpha.clamp(0.0, 1.0);

    let dst_w = pix.width() as i32;
    let data = pix.data_mut();
    for py in y0..=y1 {
        for px in x0..=x1 {
            // map world -> local (inverse rotate), relative to grip
            let dx = px as f64 + 0.5 - pose.grip_x;
            let dy = py as f64 + 0.5 - pose.grip_y;
            let lx = cos * dx + sin * dy;
            let ly = -sin * dx + cos * dy;
            if lx < -hw / 2.0 - 0.5 || lx > hw / 2.0 + 0.5 {
                continue;
            }
            let (in_hand, y_frac) = if ly < -pose.rod_len {
                if ly < rod_top_local {
                    continue;
                }
                (true, (ly - rod_top_local) / pose.hand_pts)
            } else {
                if ly >= 0.0 {
                    continue;
                }
                (false, (ly + pose.rod_len) / pose.rod_len)
            };
            let u = lx / hw + 0.5; // 0..1 across full image width
            let src_x_f = (g.rod_x + u - 0.5) * iw; // full image width maps to local width
            let src_y_f = if in_hand {
                (g.hand_top + y_frac * (g.wrist - g.hand_top)) * ih
            } else {
                (g.wrist + y_frac * (g.rod_end - g.wrist)) * ih
            };
            if let Some(s) = sample_bilinear(src, src_x_f, src_y_f) {
                let mul = alpha; // f64
                let sa = [
                    (s[0] as f64 * mul) as f32,
                    (s[1] as f64 * mul) as f32,
                    (s[2] as f64 * mul) as f32,
                    ((s[3] as f64) * mul) as f32,
                ];
                if sa[3] <= 0.0005 {
                    continue;
                }
                let o = ((py * dst_w + px) * 4) as usize;
                over(&mut data[o..o + 4], sa);
            }
        }
    }
}

/// Rotated blit of the precomputed blurred silhouette (drop shadow).
pub fn draw_shadow(pix: &mut tiny_skia::Pixmap, asset: &HandAsset, pose: &Pose) {
    let src = &asset.silhouette;
    let g = &asset.geo;
    let iw = src.width() as f64;
    let ih = src.height() as f64;

    let hw = pose.width_pts;
    let rod_top_local = -(pose.rod_len + pose.hand_pts);

    let l = [
        (-hw / 2.0, rod_top_local),
        (hw / 2.0, rod_top_local),
        (hw / 2.0, 0.0),
        (-hw / 2.0, 0.0),
    ];
    let mut min_x = f64::MAX;
    let mut min_y = f64::MAX;
    let mut max_x = f64::MIN;
    let mut max_y = f64::MIN;
    for (lx, ly) in l {
        let (wx, wy) = rotate(lx, ly, pose.rotation);
        let wx = wx + pose.grip_x + pose.shadow_dx;
        let wy = wy + pose.grip_y + pose.shadow_dy;
        min_x = min_x.min(wx);
        max_x = max_x.max(wx);
        min_y = min_y.min(wy);
        max_y = max_y.max(wy);
    }

    let pad = 2.0;
    let x0 = (min_x - pad).floor().max(0.0) as i32;
    let y0 = (min_y - pad).floor().max(0.0) as i32;
    let x1 = (max_x + pad).ceil().min(pix.width() as f64 - 1.0) as i32;
    let y1 = (max_y + pad).ceil().min(pix.height() as f64 - 1.0) as i32;
    let _ = y1;

    let cos = pose.rotation.cos();
    let sin = pose.rotation.sin();

    let dst_w = pix.width() as i32;
    let data = pix.data_mut();
    for py in y0..=y1 {
        for px in x0..=x1 {
            let dx = px as f64 + 0.5 - pose.grip_x - pose.shadow_dx;
            let dy = py as f64 + 0.5 - pose.grip_y - pose.shadow_dy;
            let lx = cos * dx + sin * dy;
            let ly = -sin * dx + cos * dy;
            if lx < -hw / 2.0 || lx > hw / 2.0 {
                continue;
            }
            if ly >= 0.0 || ly < rod_top_local {
                continue;
            }
            let src_x_f = (g.rod_x + lx / hw) * iw;
            // Match the hand's independently scaled hand and rod slices.
            let src_y_f = if ly < -pose.rod_len {
                let fraction = (ly - rod_top_local) / pose.hand_pts;
                (g.hand_top + fraction * (g.wrist - g.hand_top)) * ih
            } else {
                let fraction = (ly + pose.rod_len) / pose.rod_len;
                (g.wrist + fraction * (g.rod_end - g.wrist)) * ih
            };
            if let Some(s) = sample_bilinear(src, src_x_f, src_y_f) {
                let op = 0.26 + 0.02 * pose.press;
                let sa = [0.0, 0.0, 0.0, (((s[3] as f64) * op).min(1.0)) as f32];
                let o = ((py * dst_w + px) * 4) as usize;
                over(&mut data[o..o + 4], sa);
            }
        }
    }
}

/// Laser dot: red glow ring + bright core.
pub fn draw_laser(pix: &mut tiny_skia::Pixmap, cursor: (f64, f64), r: f64) {
    if r < 1.0 {
        return;
    }
    let (cx, cy) = (cursor.0 as f32, cursor.1 as f32);
    let r = r as f32;
    // glow
    let r_outer = (r * 3.2).max(2.0);
    let rect = tiny_skia::Rect::from_xywh(cx - r_outer, cy - r_outer, 2.0 * r_outer, 2.0 * r_outer)
        .unwrap();
    let stops = vec![
        tiny_skia::GradientStop::new(0.0, tiny_skia::Color::from_rgba8(255, 40, 30, 110)),
        tiny_skia::GradientStop::new(0.35, tiny_skia::Color::from_rgba8(255, 40, 30, 70)),
        tiny_skia::GradientStop::new(1.0, tiny_skia::Color::from_rgba8(255, 40, 30, 0)),
    ];
    if let Some(shader) = tiny_skia::RadialGradient::new(
        tiny_skia::Point::from_xy(cx, cy),
        tiny_skia::Point::from_xy(cx, cy),
        r_outer,
        stops,
        tiny_skia::SpreadMode::Pad,
        tiny_skia::Transform::default(),
    ) {
        let mut paint = tiny_skia::Paint::default();
        paint.anti_alias = true;
        paint.shader = shader;
        pix.fill_rect(rect, &paint, tiny_skia::Transform::default(), None);
    }

    // ring
    let mut path = tiny_skia::PathBuilder::new();
    path.push_circle(cx, cy, r);
    let path = path.finish().unwrap();
    let mut paint = tiny_skia::Paint::default();
    paint.anti_alias = true;
    paint.set_color_rgba8(255, 40, 30, 255);
    let stroke = tiny_skia::Stroke {
        width: (r * 0.12).max(1.0),
        line_cap: tiny_skia::LineCap::Round,
        line_join: tiny_skia::LineJoin::Round,
        ..tiny_skia::Stroke::default()
    };
    pix.stroke_path(
        &path,
        &paint,
        &stroke,
        tiny_skia::Transform::default(),
        None,
    );

    // core
    let core = r * 0.45;
    let mut core_path = tiny_skia::PathBuilder::new();
    core_path.push_circle(cx, cy, core);
    let core_path = core_path.finish().unwrap();
    let mut core_paint = tiny_skia::Paint::default();
    core_paint.anti_alias = true;
    core_paint.set_color_rgba8(255, 219, 209, 242);
    pix.fill_path(
        &core_path,
        &core_paint,
        tiny_skia::FillRule::Winding,
        tiny_skia::Transform::default(),
        None,
    );
}

/// Build a smoothed stroke path (midpoint quadratic technique, port of Ink.redraw()).
pub fn stroke_path(points: &[(f64, f64)]) -> Option<tiny_skia::Path> {
    if points.is_empty() {
        return None;
    }
    let mut pb = tiny_skia::PathBuilder::new();
    let first = points[0];
    pb.move_to(first.0 as f32, first.1 as f32);
    if points.len() == 1 {
        pb.line_to(first.0 as f32, first.1 as f32);
    }
    for i in 1..points.len() {
        let p = points[i];
        let prev = points[i - 1];
        let mid = ((prev.0 + p.0) / 2.0, (prev.1 + p.1) / 2.0);
        pb.quad_to(prev.0 as f32, prev.1 as f32, mid.0 as f32, mid.1 as f32);
    }
    if points.len() > 1 {
        let last = points[points.len() - 1];
        pb.line_to(last.0 as f32, last.1 as f32);
    }
    pb.finish()
}

pub fn draw_stroke(
    pix: &mut tiny_skia::Pixmap,
    points: &[(f64, f64)],
    color: [f32; 4],
    width: f64,
    alpha: f64,
) {
    let path = attach_stroke(points);
    if let Some(path) = path {
        let mut paint = tiny_skia::Paint::default();
        paint.anti_alias = true;
        let a = (color[3] as f64 * alpha).min(1.0) as f32;
        paint.set_color_rgba8(
            (color[0] * 255.0) as u8,
            (color[1] * 255.0) as u8,
            (color[2] * 255.0) as u8,
            (a * 255.0) as u8,
        );
        let stroke = tiny_skia::Stroke {
            width: width.max(1.0) as f32,
            line_cap: tiny_skia::LineCap::Round,
            line_join: tiny_skia::LineJoin::Round,
            ..tiny_skia::Stroke::default()
        };
        pix.stroke_path(
            &path,
            &paint,
            &stroke,
            tiny_skia::Transform::default(),
            None,
        );
    }
}

fn attach_stroke(points: &[(f64, f64)]) -> Option<tiny_skia::Path> {
    stroke_path(points)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_over_keeps_premultiplied_channels() {
        let mut dst = [0, 0, 128, 128];
        over(&mut dst, [0.5, 0.0, 0.0, 0.5]);
        assert_eq!(dst, [128, 0, 64, 192]);
        let mut transparent = [0; 4];
        over(&mut transparent, [0.25, 0.0, 0.0, 0.5]);
        assert_eq!(transparent, [64, 0, 0, 128]);
    }

    #[test]
    fn shadow_uses_hand_and_rod_slices_and_hand_opacity_is_premultiplied() {
        let mut src = tiny_skia::Pixmap::new(8, 100).unwrap();
        // Only the hand slice is opaque. A whole-image stretch would produce a
        // long shadow well into the rod instead of stopping at the wrist.
        for y in 10..30 {
            for x in 0..8 {
                let offset = (y * 8 + x) * 4;
                src.data_mut()[offset..offset + 4].copy_from_slice(&[128, 0, 0, 128]);
            }
        }
        let asset = HandAsset {
            name: "test".into(),
            geo: crate::pose::HandGeometry {
                hand_top: 0.1,
                wrist: 0.3,
                rod_end: 0.9,
                rod_x: 0.5,
                ..Default::default()
            },
            silhouette: src.clone(),
            pixmap: src,
        };
        let pose = Pose {
            rotation: 0.0,
            rod_len: 80.0,
            hand_pts: 20.0,
            width_pts: 8.0,
            grip_x: 10.0,
            grip_y: 110.0,
            lift: 0.0,
            press: 0.0,
            shadow_dx: 0.0,
            shadow_dy: 0.0,
        };
        let mut shadow = tiny_skia::Pixmap::new(24, 120).unwrap();
        draw_shadow(&mut shadow, &asset, &pose);
        assert!(shadow.pixel(10, 20).unwrap().alpha() > 0);
        assert_eq!(shadow.pixel(10, 45).unwrap().alpha(), 0);
        let mut hand = tiny_skia::Pixmap::new(24, 120).unwrap();
        draw_hand(&mut hand, &asset, &pose, 0.5);
        let pixel = hand.pixel(10, 20).unwrap();
        assert_eq!((pixel.red(), pixel.alpha()), (64, 64));
    }
}

// ---------------------------------------------------------------------------
// Text: ab_glyph rasterization straight into pixels. Decoration only; falls
// back to no-op when no system font exists.
// ---------------------------------------------------------------------------

pub struct Text {
    font: Option<ab_glyph::FontRef<'static>>,
}

impl Text {
    pub fn new() -> Self {
        let font_path = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
            "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
        ]
        .iter()
        .find_map(|p| std::fs::read(p).ok());
        let font = font_path.and_then(|bytes| {
            let leaked: &'static [u8] = Box::leak(bytes.into_boxed_slice());
            ab_glyph::FontRef::try_from_slice(leaked).ok()
        });
        Self { font }
    }

    pub fn width(&self, text: &str, px: f32) -> f32 {
        use ab_glyph::{Font as _, ScaleFont as _};
        match &self.font {
            None => text.chars().count() as f32 * px * 0.6,
            Some(f) => {
                let scaled = f.clone().into_scaled(ab_glyph::PxScale::from(px));
                let mut w = 0f32;
                for ch in text.chars() {
                    let id = f.glyph_id(ch);
                    w += scaled.h_advance(id);
                }
                w
            }
        }
    }

    pub fn draw(
        &self,
        pix: &mut tiny_skia::Pixmap,
        text: &str,
        px: f32,
        x: f64,
        y: f64,
        color: [f32; 4],
        center: bool,
    ) {
        use ab_glyph::{Font as _, ScaleFont as _};
        let font = match &self.font {
            Some(f) => f.clone(),
            None => return,
        };
        let scaled = font.clone().into_scaled(ab_glyph::PxScale::from(px));
        let mut sx = x as f32
            - if center {
                self.width(text, px) / 2.0
            } else {
                0.0
            };
        let baseline = y as f32 + px * 0.8;
        for ch in text.chars() {
            let id = font.glyph_id(ch);
            let glyph = id.with_scale_and_position(px, ab_glyph::Point { x: sx, y: baseline });
            if let Some(outlined) = scaled.outline_glyph(glyph) {
                let (r, g, b) = (
                    (color[0] * 255.0) as u8,
                    (color[1] * 255.0) as u8,
                    (color[2] * 255.0) as u8,
                );
                let base = color[3].clamp(0.0, 1.0);
                let bounds = outlined.px_bounds();
                let ox = bounds.min.x;
                let oy = bounds.min.y;
                outlined.draw(|gx, gy, v| {
                    if v <= 0.003 {
                        return;
                    }
                    let xd = (ox + gx as f32).floor() as i32;
                    let yd = (oy + gy as f32).floor() as i32;
                    if xd < 0 || yd < 0 {
                        return;
                    }
                    let xd = xd as u32;
                    let yd = yd as u32;
                    if yd >= pix.height() || xd >= pix.width() {
                        return;
                    }
                    let o = ((yd * pix.width() + xd) * 4) as usize;
                    // alpha blend v over existing pixel
                    let data = pix.data_mut();
                    let sa = base * v;
                    over(
                        &mut data[o..o + 4],
                        [
                            r as f32 / 255.0 * sa,
                            g as f32 / 255.0 * sa,
                            b as f32 / 255.0 * sa,
                            sa,
                        ],
                    );
                });
            }
            sx += scaled.h_advance(id);
        }
    }
}
