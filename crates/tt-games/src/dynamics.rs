//! How the car is moving compared with where it points: the slip angle, and what that says about a slide.
//!
//! Worked out from the physics page. Checked against the running AC EVO (a Ferrari F40 at Spa, 2026-10-27):
//! driving straight, the car's heading equals `atan2(-vx, vz)` of its world velocity to within a degree, so
//! the slip angle is the heading minus that direction of travel.

use crate::acpmf::Physics;

/// Below this the direction of travel is too noisy to mean anything (and a stationary car has none).
pub const MIN_SLIP_SPEED_KMH: f32 = 15.0;
/// A slip angle at least this big, at speed, is a drift.
pub const DRIFT_SLIP_DEG: f32 = 12.0;
/// At least this much and the car has spun: it is pointing well away from where it is going.
pub const SPIN_SLIP_DEG: f32 = 90.0;

/// The car's attitude and motion, in the units a person thinks in.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Dynamics {
    /// Which way the nose points, degrees (-180..180).
    pub heading_deg: f32,
    /// Heading minus the direction of travel, degrees (-180..180). Zero when the car goes where it points; 0 below
    /// `MIN_SLIP_SPEED_KMH`.
    pub slip_deg: f32,
    /// How fast the car is turning about its vertical axis, degrees per second.
    pub yaw_rate_dps: f32,
    pub pitch_deg: f32,
    pub roll_deg: f32,
    /// G-forces on the car's X and Z axes, as the game's header lists them.
    pub g_x: f32,
    pub g_z: f32,
    /// Turbo boost in bar; 0 for a car without a turbo.
    pub turbo_boost: f32,
}

/// What the car is doing, as far as sliding goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Slide {
    #[default]
    None,
    Drift,
    Spin,
}

impl Slide {
    pub fn key(self) -> &'static str {
        match self {
            Slide::None => "none",
            Slide::Drift => "drift",
            Slide::Spin => "spin",
        }
    }
}

/// Wraps an angle in degrees into -180..180.
pub fn wrap_deg(a: f32) -> f32 {
    (a + 180.0).rem_euclid(360.0) - 180.0
}

impl Dynamics {
    pub fn from_physics(p: &Physics) -> Self {
        let [vx, _, vz] = p.velocity;
        let heading_deg = p.heading.to_degrees();
        let slip_deg = if p.speed_kmh >= MIN_SLIP_SPEED_KMH {
            let travel_deg = (-vx).atan2(vz).to_degrees();
            wrap_deg(heading_deg - travel_deg)
        } else {
            0.0
        };
        Self {
            heading_deg,
            slip_deg,
            yaw_rate_dps: p.local_angular_velocity[1].to_degrees(),
            pitch_deg: p.pitch.to_degrees(),
            roll_deg: p.roll.to_degrees(),
            g_x: p.acc_g[0],
            g_z: p.acc_g[2],
            turbo_boost: p.turbo_boost,
        }
    }

    /// An instantaneous reading; deciding that a slide has lasted long enough to count is up to the caller.
    pub fn slide(&self, speed_kmh: f32) -> Slide {
        if speed_kmh < MIN_SLIP_SPEED_KMH {
            return Slide::None;
        }
        let slip = self.slip_deg.abs();
        if slip >= SPIN_SLIP_DEG {
            Slide::Spin
        } else if slip >= DRIFT_SLIP_DEG {
            Slide::Drift
        } else {
            Slide::None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn physics(heading_deg: f32, velocity: [f32; 3], speed_kmh: f32) -> Physics {
        Physics { heading: heading_deg.to_radians(), velocity, speed_kmh, ..Physics::default() }
    }

    /// Heading and velocity as read from the running game: the car pointed -0.5 rad and moved along it.
    #[test]
    fn driving_straight_has_no_slip() {
        let travel = -0.5f32; // radians; heading = atan2(-vx, vz), so vx = -sin, vz = cos
        let p = Physics { heading: travel, velocity: [-travel.sin() * 40.0, 0.0, travel.cos() * 40.0], speed_kmh: 144.0, ..Physics::default() };
        let d = Dynamics::from_physics(&p);
        assert!(d.slip_deg.abs() < 0.01, "slip {}", d.slip_deg);
        assert_eq!(d.slide(144.0), Slide::None);
    }

    #[test]
    fn a_car_pointing_20_degrees_off_its_path_is_drifting() {
        // Moving straight down +z (travel 0 deg), nose turned 20 degrees.
        let d = Dynamics::from_physics(&physics(20.0, [0.0, 0.0, 30.0], 108.0));
        assert!((d.slip_deg - 20.0).abs() < 0.01);
        assert_eq!(d.slide(108.0), Slide::Drift);
        let other_way = Dynamics::from_physics(&physics(-20.0, [0.0, 0.0, 30.0], 108.0));
        assert_eq!(other_way.slide(108.0), Slide::Drift, "either direction");
    }

    #[test]
    fn a_car_going_backwards_is_spinning() {
        // Nose pointing back along the way it is travelling: 180 degrees round.
        let d = Dynamics::from_physics(&physics(180.0, [0.0, 0.0, 20.0], 72.0));
        assert!(d.slip_deg.abs() > 179.0);
        assert_eq!(d.slide(72.0), Slide::Spin);
    }

    #[test]
    fn the_angle_wraps_the_short_way_round() {
        // Heading 170, travelling towards -170: they are 20 degrees apart, not 340.
        let travel: f32 = -170.0;
        let v = [-travel.to_radians().sin() * 25.0, 0.0, travel.to_radians().cos() * 25.0];
        let d = Dynamics::from_physics(&physics(170.0, v, 90.0));
        assert!((d.slip_deg + 20.0).abs() < 0.01, "slip {}", d.slip_deg);
    }

    #[test]
    fn a_slow_or_stopped_car_has_no_slip() {
        let d = Dynamics::from_physics(&physics(90.0, [3.0, 0.0, 0.0], 10.8));
        assert_eq!(d.slip_deg, 0.0);
        assert_eq!(d.slide(10.8), Slide::None);
    }

    #[test]
    fn yaw_rate_and_turbo_come_through() {
        let p = Physics { local_angular_velocity: [0.0, 1.0, 0.0], turbo_boost: 1.3, ..Physics::default() };
        let d = Dynamics::from_physics(&p);
        assert!((d.yaw_rate_dps - 57.2958).abs() < 0.01);
        assert_eq!(d.turbo_boost, 1.3);
    }
}
