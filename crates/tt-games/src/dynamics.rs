//! How the car is moving compared with where it points: the slip angle, and what that says about a slide.
//!
//! Worked out from the physics page. Checked against the running AC EVO (a Ferrari F40 at Spa, 2026-10-27):
//! driving straight, the car's heading equals `atan2(-vx, vz)` of its world velocity to within a degree, so
//! the slip angle is the heading minus that direction of travel.

use crate::acpmf::Physics;

/// Below this the direction of travel is too noisy to mean anything (and a stationary car has none).
pub const MIN_SLIP_SPEED_KMH: f32 = 15.0;
/// A slip angle at least this big, at speed, is the car sliding: noticeable, not yet a drift. Shown, never counted.
pub const SLIDE_SLIP_DEG: f32 = 4.0;
/// A slide is over once the slip is back under this (lower than the start, so it doesn't flicker at the line).
pub const SLIDE_EXIT_DEG: f32 = 3.0;
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
    /// A few degrees of slip: the car is moving about, not drifting.
    Light,
    Drift,
    Spin,
}

impl Slide {
    pub fn key(self) -> &'static str {
        match self {
            Slide::None => "none",
            Slide::Light => "slide",
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
        } else if slip >= SLIDE_SLIP_DEG {
            Slide::Light
        } else {
            Slide::None
        }
    }
}

/// Below this a drift is over (once it has stayed below for `DRIFT_HOLD_MS`).
pub const DRIFT_EXIT_DEG: f32 = 7.0;
/// A drift that goes through zero slip for less than this (switching direction, a quick correction) isn't over.
pub const DRIFT_HOLD_MS: u64 = 400;
/// Below this a spin is over.
pub const SPIN_EXIT_DEG: f32 = 60.0;
/// A gap longer than this between readings (a pause) isn't counted as time sliding.
const MAX_GAP_MS: u64 = 500;

/// What a driver has done sliding, over a lap.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct SlideStats {
    pub drifts: u32,
    pub spins: u32,
    /// Total time drifting, milliseconds.
    pub drift_ms: u64,
    /// The longest single drift, milliseconds.
    pub longest_ms: u64,
    /// The biggest slip angle reached while drifting, degrees.
    pub peak_slip_deg: f32,
}

/// Turns the flicker of instant slip readings into steady drifts and spins, and totals them up. A drift starts at
/// `DRIFT_SLIP_DEG`, and only ends once the slip has stayed under `DRIFT_EXIT_DEG` for `DRIFT_HOLD_MS`; a spin starts at
/// `SPIN_SLIP_DEG` and ends under `SPIN_EXIT_DEG`.
#[derive(Debug, Clone, Default)]
pub struct SlideTracker {
    state: Slide,
    last_ms: Option<u64>,
    below_since: Option<u64>,
    current_ms: u64,
    stats: SlideStats,
}

impl SlideTracker {
    pub fn state(&self) -> Slide {
        self.state
    }

    pub fn stats(&self) -> SlideStats {
        self.stats
    }

    /// Starts the totals again (a new lap) without ending a slide that is under way.
    pub fn reset_stats(&mut self) {
        self.stats = SlideStats::default();
        self.current_ms = 0;
    }

    /// Feeds one reading. `dynamics` is `None` when the car isn't being driven (a pause, a game without the data).
    pub fn update(&mut self, dynamics: Option<&Dynamics>, speed_kmh: f32, now_ms: u64) -> Slide {
        let slip = match dynamics {
            Some(d) if speed_kmh >= MIN_SLIP_SPEED_KMH => d.slip_deg.abs(),
            _ => 0.0,
        };
        let dt = self.last_ms.map_or(0, |t| now_ms.saturating_sub(t)).min(MAX_GAP_MS);
        self.last_ms = Some(now_ms);
        if self.state == Slide::Drift {
            self.stats.drift_ms += dt;
            self.current_ms += dt;
            // A reading at spin angle belongs to the spin, not to the drift that led into it.
            if slip < SPIN_SLIP_DEG {
                self.stats.peak_slip_deg = self.stats.peak_slip_deg.max(slip);
            }
        }
        match self.state {
            Slide::None => {
                if slip >= SPIN_SLIP_DEG {
                    self.stats.spins += 1;
                    self.state = Slide::Spin;
                } else if slip >= DRIFT_SLIP_DEG {
                    self.start_drift(slip);
                } else if slip >= SLIDE_SLIP_DEG {
                    self.state = Slide::Light;
                }
            }
            Slide::Light => {
                if slip >= SPIN_SLIP_DEG {
                    self.stats.spins += 1;
                    self.state = Slide::Spin;
                } else if slip >= DRIFT_SLIP_DEG {
                    self.start_drift(slip);
                } else if slip < SLIDE_EXIT_DEG {
                    self.state = Slide::None;
                }
            }
            Slide::Drift => {
                if slip >= SPIN_SLIP_DEG {
                    self.end_drift(0);
                    self.stats.spins += 1;
                    self.state = Slide::Spin;
                } else if slip < DRIFT_EXIT_DEG {
                    let since = *self.below_since.get_or_insert(now_ms);
                    let held = now_ms - since;
                    if held >= DRIFT_HOLD_MS {
                        self.end_drift(held);
                    }
                } else {
                    self.below_since = None;
                }
            }
            Slide::Spin => {
                if slip < SPIN_EXIT_DEG {
                    self.state = Slide::None;
                    if slip >= DRIFT_SLIP_DEG {
                        self.start_drift(slip);
                    } else if slip >= SLIDE_SLIP_DEG {
                        self.state = Slide::Light;
                    }
                }
            }
        }
        self.state
    }

    fn start_drift(&mut self, slip: f32) {
        self.state = Slide::Drift;
        self.stats.drifts += 1;
        self.stats.peak_slip_deg = self.stats.peak_slip_deg.max(slip);
        self.current_ms = 0;
        self.below_since = None;
    }

    /// Ends the drift, not counting the `trailing_ms` spent waiting to be sure it was over.
    fn end_drift(&mut self, trailing_ms: u64) {
        let length = self.current_ms.saturating_sub(trailing_ms);
        self.stats.drift_ms = self.stats.drift_ms.saturating_sub(trailing_ms);
        self.stats.longest_ms = self.stats.longest_ms.max(length);
        self.state = Slide::None;
        self.current_ms = 0;
        self.below_since = None;
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

    fn slipping(deg: f32) -> Dynamics {
        Dynamics { slip_deg: deg, ..Dynamics::default() }
    }

    /// Feeds one reading every 100 ms, the rate the live readings arrive at.
    fn feed(t: &mut SlideTracker, readings: &[f32], start_ms: u64) -> Vec<Slide> {
        readings.iter().enumerate().map(|(i, &deg)| t.update(Some(&slipping(deg)), 90.0, start_ms + i as u64 * 100)).collect()
    }

    #[test]
    fn a_drift_that_flips_direction_through_zero_stays_one_drift() {
        let mut t = SlideTracker::default();
        // 20 deg one way, a 200 ms pass through zero, 20 deg the other way.
        let states = feed(&mut t, &[20.0, 20.0, 20.0, 3.0, 2.0, -20.0, -20.0, -20.0], 0);
        assert!(states.iter().all(|s| *s == Slide::Drift), "{states:?}");
        assert_eq!(t.stats().drifts, 1);
    }

    #[test]
    fn a_drift_ends_after_a_clear_gap_and_its_time_excludes_the_wait() {
        let mut t = SlideTracker::default();
        let states = feed(&mut t, &[0.0, 20.0, 20.0, 20.0, 20.0, 20.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0], 0);
        assert_eq!(states[5], Slide::Drift);
        assert_eq!(*states.last().unwrap(), Slide::None);
        let s = t.stats();
        assert_eq!(s.drifts, 1);
        // Five readings at 20 degrees, 100 ms apart: about half a second of drift, without the wait on top.
        assert!((400..=600).contains(&s.drift_ms), "{s:?}");
        assert_eq!(s.longest_ms, s.drift_ms);
        assert_eq!(s.peak_slip_deg, 20.0);
    }

    #[test]
    fn wobbling_around_the_drift_line_does_not_flicker() {
        let mut t = SlideTracker::default();
        let states = feed(&mut t, &[13.0, 11.0, 13.0, 10.0, 12.5, 9.0, 13.0], 0);
        assert!(states.iter().all(|s| *s == Slide::Drift));
        assert_eq!(t.stats().drifts, 1);
    }

    #[test]
    fn a_spin_holds_until_the_car_is_well_back_under_control() {
        let mut t = SlideTracker::default();
        let states = feed(&mut t, &[30.0, 95.0, 80.0, 70.0, 59.0, 5.0], 0);
        assert_eq!(&states[1..4], &[Slide::Spin; 3], "{states:?}");
        // Below 60 degrees the spin is over, but 59 is still a hard slide, so it carries on as a drift.
        assert_eq!(states[4], Slide::Drift, "a spin ends below {SPIN_EXIT_DEG} degrees");
        assert_eq!(t.stats().spins, 1);
        assert_eq!(t.stats().peak_slip_deg, 59.0, "a drift's peak stops short of the spin angle (95, 80 and 70 were the spin)");
        // The 30 degrees before the spin was one drift (the spin ended it); the slide after the spin is another.
        assert_eq!(t.stats().drifts, 2);
        // Held under the exit angle long enough, it is over.
        let after = feed(&mut t, &[2.0, 2.0, 2.0, 2.0, 2.0, 2.0], 600);
        assert_eq!(*after.last().unwrap(), Slide::None);
    }

    #[test]
    fn a_pause_is_not_drift_time() {
        let mut t = SlideTracker::default();
        t.update(Some(&slipping(20.0)), 90.0, 0);
        t.update(Some(&slipping(20.0)), 90.0, 100);
        // Ten seconds later (a pause); the reading is still a drift, but the gap isn't time sliding.
        t.update(Some(&slipping(20.0)), 90.0, 10_100);
        assert!(t.stats().drift_ms <= 600, "{:?}", t.stats());
    }

    #[test]
    fn slow_or_missing_data_ends_a_drift_after_the_hold() {
        let mut t = SlideTracker::default();
        feed(&mut t, &[20.0, 20.0], 0);
        for i in 0..6 {
            t.update(None, 0.0, 200 + i * 100);
        }
        assert_eq!(t.state(), Slide::None);
    }

    #[test]
    fn totals_can_be_started_again_for_a_new_lap_mid_drift() {
        let mut t = SlideTracker::default();
        feed(&mut t, &[20.0, 20.0, 20.0], 0);
        t.reset_stats();
        assert_eq!(t.stats(), SlideStats::default());
        assert_eq!(t.state(), Slide::Drift, "the slide itself carries on");
    }

    #[test]
    fn a_few_degrees_is_a_slide_that_is_shown_but_never_counted() {
        let mut t = SlideTracker::default();
        // Gentle slip: nothing under 4, a slide from 4, and it holds until it is back under 3.
        let states = feed(&mut t, &[1.0, 3.9, 4.0, 5.0, 3.5, 3.1, 2.9, 1.0], 0);
        assert_eq!(states, [Slide::None, Slide::None, Slide::Light, Slide::Light, Slide::Light, Slide::Light, Slide::None, Slide::None]);
        assert_eq!(t.stats(), SlideStats::default(), "a slide is not a drift");
    }

    #[test]
    fn a_slide_that_grows_becomes_a_drift_and_a_drift_that_fades_goes_back_to_none() {
        let mut t = SlideTracker::default();
        let states = feed(&mut t, &[5.0, 8.0, 12.0, 15.0, 9.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0], 0);
        assert_eq!(&states[..2], &[Slide::Light, Slide::Light]);
        assert_eq!(states[2], Slide::Drift, "12 degrees is the drift line");
        assert_eq!(t.stats().drifts, 1);
        assert_eq!(*states.last().unwrap(), Slide::None);
    }

    #[test]
    fn the_instant_reading_has_the_same_three_tiers() {
        let at = |deg: f32| slipping(deg).slide(90.0);
        assert_eq!((at(3.0), at(4.0), at(11.9), at(12.0), at(89.9), at(90.0)), (Slide::None, Slide::Light, Slide::Light, Slide::Drift, Slide::Drift, Slide::Spin));
        assert_eq!(Slide::Light.key(), "slide");
    }
}
