//! Turns a stream of telemetry samples into completed laps.
//!
//! Kept free of any I/O so it can be unit-tested with synthetic samples.

use super::layout::{STATUS_LIVE, STATUS_PAUSE};

/// The handful of values lap detection needs, copied out of the graphics page.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sample {
    pub status: i32,
    pub lap_count: i32,
    pub last_lap_ms: i32,
    pub current_lap_ms: i32,
    /// The game's "this lap still counts" flags, already combined.
    pub lap_valid: bool,
    pub in_pit_lane: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DetectedLap {
    pub lap_number: u32,
    pub time_ms: u32,
    pub valid: bool,
}

/// How many samples to wait for `last_lap_ms` to update after the lap counter ticks.
/// The game may update the two fields on different frames.
const MAX_PENDING_SAMPLES: u32 = 10;

#[derive(Debug, Default)]
pub struct LapTracker {
    lap_count: Option<i32>,
    last_lap_ms_before: i32,
    invalidated: bool,
    touched_pits: bool,
    pending: Option<Pending>,
}

#[derive(Debug, Clone, Copy)]
struct Pending {
    lap_number: u32,
    valid: bool,
    waited: u32,
}

impl LapTracker {
    pub fn reset(&mut self) {
        *self = Self::default();
    }

    pub fn update(&mut self, s: Sample) -> Option<DetectedLap> {
        match s.status {
            STATUS_LIVE => {}
            // Paused: keep all state, the lap simply hasn't progressed.
            STATUS_PAUSE => return None,
            // Replay / off: anything we see isn't the player driving now.
            _ => {
                self.reset();
                return None;
            }
        }

        let mut detected = self.resolve_pending(s);

        match self.lap_count {
            None => self.start_tracking(s),
            Some(prev) if s.lap_count == prev + 1 => {
                // A lap counts only if it was never flagged and never touched the pit lane
                // (out-laps and in-laps aren't timed laps).
                let valid = !self.invalidated && !self.touched_pits;
                let pending = Pending { lap_number: s.lap_count as u32, valid, waited: 0 };
                self.lap_count = Some(s.lap_count);
                self.invalidated = false;
                self.touched_pits = false;
                // Usually the lap time is already published on the same frame.
                self.pending = Some(pending);
                if detected.is_none() {
                    detected = self.resolve_pending(s);
                }
            }
            Some(prev) if s.lap_count != prev => {
                // Session restarted or we missed laps: resync without emitting.
                self.start_tracking(s);
            }
            Some(_) => {}
        }

        if !s.lap_valid {
            self.invalidated = true;
        }
        if s.in_pit_lane {
            self.touched_pits = true;
        }

        detected
    }

    fn start_tracking(&mut self, s: Sample) {
        self.lap_count = Some(s.lap_count);
        self.last_lap_ms_before = s.last_lap_ms;
        // We didn't see this lap from its start, so we can't vouch for it.
        self.invalidated = s.current_lap_ms > 0;
        self.touched_pits = s.in_pit_lane;
        self.pending = None;
    }

    fn resolve_pending(&mut self, s: Sample) -> Option<DetectedLap> {
        let mut pending = self.pending?;
        let updated = s.last_lap_ms > 0 && s.last_lap_ms != self.last_lap_ms_before;
        if !updated && pending.waited < MAX_PENDING_SAMPLES {
            pending.waited += 1;
            self.pending = Some(pending);
            return None;
        }

        self.pending = None;
        self.last_lap_ms_before = s.last_lap_ms;
        if s.last_lap_ms <= 0 {
            return None;
        }
        Some(DetectedLap { lap_number: pending.lap_number, time_ms: s.last_lap_ms as u32, valid: pending.valid })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acevo::layout::STATUS_REPLAY;

    fn live(lap_count: i32, last: i32, current: i32, valid: bool) -> Sample {
        Sample { status: STATUS_LIVE, lap_count, last_lap_ms: last, current_lap_ms: current, lap_valid: valid, in_pit_lane: false }
    }

    #[test]
    fn first_partial_lap_is_not_trusted() {
        let mut t = LapTracker::default();
        assert_eq!(t.update(live(0, 0, 30_000, true)), None);
        let lap = t.update(live(1, 102_318, 50, true)).unwrap();
        assert_eq!(lap, DetectedLap { lap_number: 1, time_ms: 102_318, valid: false });
    }

    #[test]
    fn clean_flying_lap_is_valid() {
        let mut t = LapTracker::default();
        t.update(live(1, 0, 0, true));
        t.update(live(1, 0, 60_000, true));
        let lap = t.update(live(2, 102_318, 20, true)).unwrap();
        assert!(lap.valid);
        assert_eq!(lap.time_ms, 102_318);
    }

    #[test]
    fn cut_anywhere_in_lap_invalidates_it() {
        let mut t = LapTracker::default();
        t.update(live(1, 0, 0, true));
        t.update(live(1, 0, 30_000, false));
        t.update(live(1, 0, 60_000, true));
        assert!(!t.update(live(2, 101_990, 20, true)).unwrap().valid);
        // ...but the next lap starts clean.
        t.update(live(2, 101_990, 60_000, true));
        assert!(t.update(live(3, 103_102, 20, true)).unwrap().valid);
    }

    #[test]
    fn pit_lane_marks_out_lap() {
        let mut t = LapTracker::default();
        let mut s = live(1, 0, 0, true);
        s.in_pit_lane = true;
        t.update(s);
        assert!(!t.update(live(2, 140_000, 20, true)).unwrap().valid);
    }

    #[test]
    fn waits_for_lap_time_to_be_published() {
        let mut t = LapTracker::default();
        t.update(live(1, 100_000, 0, true));
        t.update(live(1, 100_000, 60_000, true));
        assert_eq!(t.update(live(2, 100_000, 20, true)), None);
        let lap = t.update(live(2, 99_500, 70, true)).unwrap();
        assert_eq!(lap.time_ms, 99_500);
        assert!(lap.valid);
    }

    #[test]
    fn identical_lap_time_still_emitted_after_timeout() {
        let mut t = LapTracker::default();
        t.update(live(1, 100_000, 0, true));
        assert_eq!(t.update(live(2, 100_000, 20, true)), None);
        let mut out = None;
        for i in 0..MAX_PENDING_SAMPLES {
            out = out.or(t.update(live(2, 100_000, 40 + i as i32, true)));
        }
        assert_eq!(out.unwrap().time_ms, 100_000);
    }

    #[test]
    fn replay_laps_are_ignored() {
        let mut t = LapTracker::default();
        let mut s = live(1, 0, 0, true);
        s.status = STATUS_REPLAY;
        t.update(s);
        s.lap_count = 2;
        s.last_lap_ms = 100_000;
        assert_eq!(t.update(s), None);
    }

    #[test]
    fn session_restart_resyncs() {
        let mut t = LapTracker::default();
        t.update(live(5, 100_000, 10_000, true));
        assert_eq!(t.update(live(0, 0, 0, true)), None);
        t.update(live(0, 0, 50_000, true));
        assert!(t.update(live(1, 101_000, 20, true)).unwrap().valid);
    }
}
