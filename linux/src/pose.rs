// Port of TinyHand/ArmView.swift aiming math to top-left-origin (y-down) screen space.
//
// Original AppKit math uses y-up coordinates with the grip anchored below the screen
// bottom edge. Here everything is y-down: the grip is anchored BELOW the visible
// screen (screen_h * 1.12), and the rod points "up" toward the cursor.

#[derive(Debug, Clone, Copy, Default)]
pub struct HandGeometry {
    pub aspect: f64,   // image w / image h
    pub hand_top: f64, // y fraction: top of the hand (finger)
    pub tip: f64,      // y fraction: exact tip of pointing finger
    pub wrist: f64,    // y fraction: bottom of fist
    pub rod_end: f64,  // y fraction: bottom of the rod
    pub tip_x: f64,    // x fraction: tip x center
    pub rod_x: f64,    // x fraction: rod x center
    pub hand_min_x: f64,
    pub hand_max_x: f64,
}

pub struct PoseState {
    pub hand_len_frac: f64,
    press_amount: f64,
    grip_x: Option<f64>,
    grip_target: Option<f64>,
}

pub const MIN_ROD_FRAC: f64 = 0.05;
pub const GRIP_LEAN_FRAC: f64 = 0.30;
pub const GRIP_DEPTH_FRAC: f64 = 0.12;
pub const GRIP_FOLLOW: f64 = 0.08;
pub const LIFT_FRAC: f64 = 0.06;
pub const PRESS_SHRINK: f64 = 0.06;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Pose {
    pub rotation: f64,
    pub rod_len: f64,
    pub hand_pts: f64,
    pub width_pts: f64,
    pub grip_x: f64,
    pub grip_y: f64,
    pub lift: f64,
    pub press: f64,
    pub shadow_dx: f64,
    pub shadow_dy: f64,
}

impl Pose {
    /// World position of the fingertip given the pose (y-down coords).
    /// Tip fractions are normalized by the hand span exactly like `aim` does.
    pub fn tip_point(&self, g: &HandGeometry) -> (f64, f64) {
        // hand_pts is the scaled span length (span * s); recover per-fraction pts.
        let hand_tip_pts = (g.wrist - g.tip) / (g.wrist - g.hand_top) * self.hand_pts;
        let tip_off_x = (g.tip_x - g.rod_x) * self.width_pts;
        // Vector from grip along rod axis to the tip in y-down space.
        // Local space: rod points up = (tipOffX, -(rodLen + handTipPts)).
        let (vx, vy) = rotate(tip_off_x, -(self.rod_len + hand_tip_pts), self.rotation);
        (self.grip_x + vx, self.grip_y + vy)
    }
}

pub fn rotate(x: f64, y: f64, r: f64) -> (f64, f64) {
    let (s, c) = r.sin_cos();
    (x * c - y * s, x * s + y * c)
}

impl PoseState {
    pub fn new(size_frac: f64) -> Self {
        Self {
            hand_len_frac: size_frac,
            press_amount: 0.0,
            grip_x: None,
            grip_target: None,
        }
    }

    pub fn press(&mut self) {
        self.press_amount = 1.0;
    }

    pub fn release(&mut self) {
        self.press_amount = 0.0;
    }

    fn current_lift(&self, screen_h: f64) -> f64 {
        LIFT_FRAC * screen_h * (1.0 - 0.8 * self.press_amount)
    }

    pub fn press_amount(&self) -> f64 {
        self.press_amount
    }

    pub fn is_settling(&self) -> bool {
        if self.press_amount > 0.002 {
            return true;
        }
        match (self.grip_x, self.grip_target) {
            (Some(gx), Some(t)) => (t - gx).abs() > 0.5,
            _ => false,
        }
    }

    /// One animation tick. `held` = button currently pressed (or pen drag).
    /// Returns None for laser (caller draws the dot itself).
    pub fn aim(
        &mut self,
        cursor: (f64, f64),
        screen_w: f64,
        screen_h: f64,
        g: &HandGeometry,
        held: bool,
    ) -> Pose {
        let target_x =
            (cursor.0 + GRIP_LEAN_FRAC * screen_w).clamp(screen_w * 0.15, screen_w * 1.05);
        let gx = match self.grip_x {
            None => target_x,
            Some(px) => px + (target_x - px) * GRIP_FOLLOW,
        };
        self.grip_x = Some(gx);
        self.grip_target = Some(target_x);

        if !held {
            self.press_amount += (0.0 - self.press_amount) * 0.18;
        }

        // y-down: grip anchored below screen bottom.
        let grip = (gx, (1.0 + GRIP_DEPTH_FRAC) * screen_h);

        let dx = cursor.0 - grip.0;
        let dy = cursor.1 - grip.1;
        let reach = (dx * dx + dy * dy).sqrt();
        let aim_angle = dy.atan2(dx);

        let hand_pts = self.hand_len_frac * screen_h * (1.0 - PRESS_SHRINK * self.press_amount);
        let s = hand_pts / (g.wrist - g.hand_top);
        let width_pts = s * g.aspect;
        let hand_tip_pts = (g.wrist - g.tip) * s;
        let tip_off_x = (g.tip_x - g.rod_x) * width_pts;

        // Along-rod distance from grip to the tip's orthogonal foot.
        let along = (0.0f64).max(reach * reach - tip_off_x * tip_off_x).sqrt();
        let mut rod_len = along - hand_tip_pts;
        rod_len = rod_len.max(MIN_ROD_FRAC * screen_h);
        // Angle of the rod axis in y-down space: rod points "up" (negative y).
        let tip_angle = (-(rod_len + hand_tip_pts)).atan2(tip_off_x);
        let rotation = aim_angle - tip_angle;

        let lift = self.current_lift(screen_h);
        let sx = lift * 0.6;
        let sy = lift; // shadow falls downward in y-down space
                       // Rotate with -rotation (same as AppKit's use of -rotation in y-up space).
        let (sdx, sdy) = rotate(sx, sy, -rotation);

        Pose {
            rotation,
            rod_len,
            hand_pts,
            width_pts,
            grip_x: grip.0,
            grip_y: grip.1,
            lift,
            press: self.press_amount,
            shadow_dx: sdx,
            shadow_dy: sdy,
        }
    }

    /// Laser dot radius (y-down space), in pixels.
    pub fn laser_radius(&self, screen_h: f64, press: f64) -> f64 {
        let r = 4.0f64.max(screen_h * 0.0038 * self.hand_len_frac / 0.13) * (1.0 + 0.2 * press);
        r
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn geo() -> HandGeometry {
        HandGeometry {
            aspect: 1024.0 / 1536.0,
            hand_top: 0.02,
            tip: 0.023,
            wrist: 0.52,
            rod_end: 1.0,
            tip_x: 0.50,
            rod_x: 0.52,
            hand_min_x: 0.1,
            hand_max_x: 0.9,
        }
    }

    #[test]
    fn tip_lands_on_cursor() {
        let mut st = PoseState::new(0.13);
        let g = geo();
        let cursor = (900.0, 500.0);
        let pose = st.aim(cursor, 1920.0, 1080.0, &g, false);
        let (tx, ty) = pose.tip_point(&g);
        assert!(
            (tx - cursor.0).abs() < 0.5 && (ty - cursor.1).abs() < 0.5,
            "tip=({tx:.2},{ty:.2}) cursor={cursor:?} pose={pose:?}"
        );
    }

    #[test]
    fn tip_lands_on_cursor_second_click() {
        let mut st = PoseState::new(0.13);
        let g = geo();
        for cursor in [
            (100.0, 100.0),
            (1800.0, 900.0),
            (960.0, 540.0),
            (50.0, 1000.0),
        ] {
            let pose = st.aim(cursor, 1920.0, 1080.0, &g, false);
            let (tx, ty) = pose.tip_point(&g);
            assert!(
                (tx - cursor.0).abs() < 0.5 && (ty - cursor.1).abs() < 0.5,
                "tip=({tx:.2},{ty:.2}) cursor={cursor:?}"
            );
            st.press();
            let _ = st.aim(cursor, 1920.0, 1080.0, &g, true);
        }
    }

    #[test]
    fn tip_left_of_rod_axis() {
        // Asymmetric tip (tipX != rodX) must still land on the cursor.
        let mut st = PoseState::new(0.15);
        let mut g = geo();
        g.tip_x = 0.60;
        let cursor = (400.0, 300.0);
        let pose = st.aim(cursor, 1920.0, 1080.0, &g, false);
        let (tx, ty) = pose.tip_point(&g);
        assert!((tx - cursor.0).abs() < 0.5 && (ty - cursor.1).abs() < 0.5);
    }

    #[test]
    fn press_squeezes_hand() {
        let mut st = PoseState::new(0.13);
        let g = geo();
        let a = st.aim((500.0, 500.0), 1920.0, 1080.0, &g, false);
        st.press();
        let b = st.aim((500.0, 500.0), 1920.0, 1080.0, &g, true);
        assert!(b.hand_pts < a.hand_pts);
    }
}
