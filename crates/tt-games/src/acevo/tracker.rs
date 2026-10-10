//! Turns a stream of telemetry samples into completed laps.
//!
//! Kept free of any I/O so it can be unit-tested with synthetic samples.

use super::layout::{STATUS_LIVE, STATUS_PAUSE};
use crate::UntimedReason;

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
    /// `None` = a proper timed lap.
    pub untimed: Option<UntimedReason>,
}

/// How many samples to wait for `last_lap_ms` to update after the lap counter ticks.
/// The game may update the two fields on different frames.
const MAX_PENDING_SAMPLES: u32 = 10;

/// What happened during the lap in progress.
#[derive(Debug, Default, Clone, Copy)]
struct LapState {
    /// The game flagged the lap (track limits etc.).
    invalidated: bool,
    /// We started watching part-way through the lap.
    partial: bool,
    /// The car was in the pit lane at some point.
    in_pits_seen: bool,
    /// The car drove out of the pit lane during the lap (an out lap).
    left_pits: bool,
    /// Pit-lane state on the previous sample.
    was_in_pits: bool,
}

impl LapState {
    fn starting(s: &Sample, partial: bool) -> Self {
        Self { partial, in_pits_seen: s.in_pit_lane, was_in_pits: s.in_pit_lane, ..Self::default() }
    }

    fn observe(&mut self, s: &Sample) {
        if !s.lap_valid {
            self.invalidated = true;
        }
        if self.was_in_pits && !s.in_pit_lane {
            self.left_pits = true;
        }
        self.in_pits_seen |= s.in_pit_lane;
        self.was_in_pits = s.in_pit_lane;
    }

    /// Out/in laps and partial laps aren't attempts at all; a cut is a failed attempt.
    fn untimed(&self) -> Option<UntimedReason> {
        if self.left_pits {
            Some(UntimedReason::OutLap)
        } else if self.in_pits_seen {
            Some(UntimedReason::InLap)
        } else if self.partial {
            Some(UntimedReason::Partial)
        } else if self.invalidated {
            Some(UntimedReason::Cut)
        } else {
            None
        }
    }
}

#[derive(Debug, Default)]
pub struct LapTracker {
    lap_count: Option<i32>,
    last_lap_ms_before: i32,
    lap: LapState,
    pending: Option<Pending>,
}

#[derive(Debug, Clone, Copy)]
struct Pending {
    lap_number: u32,
    untimed: Option<UntimedReason>,
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
                // This frame still belongs to the lap that just ended (e.g. crossing the
                // line in the pit lane makes it an in lap).
                self.lap.observe(&s);
                self.pending = Some(Pending { lap_number: s.lap_count as u32, untimed: self.lap.untimed(), waited: 0 });
                self.lap_count = Some(s.lap_count);
                self.lap = LapState::starting(&s, false);
                // Usually the lap time is already published on the same frame.
                if detected.is_none() {
                    detected = self.resolve_pending(s);
                }
                return detected;
            }
            Some(prev) if s.lap_count != prev => {
                // Session restarted or we missed laps: resync without emitting.
                self.start_tracking(s);
            }
            Some(_) => {}
        }

        self.lap.observe(&s);
        detected
    }

    fn start_tracking(&mut self, s: Sample) {
        self.lap_count = Some(s.lap_count);
        self.last_lap_ms_before = s.last_lap_ms;
        // We didn't see this lap from its start, so we can't vouch for it.
        self.lap = LapState::starting(&s, s.current_lap_ms > 0);
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
        Some(DetectedLap { lap_number: pending.lap_number, time_ms: s.last_lap_ms as u32, untimed: pending.untimed })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acevo::layout::STATUS_REPLAY;

    fn live(lap_count: i32, last: i32, current: i32, valid: bool) -> Sample {
        Sample { status: STATUS_LIVE, lap_count, last_lap_ms: last, current_lap_ms: current, lap_valid: valid, in_pit_lane: false }
    }

    fn in_pits(mut s: Sample) -> Sample {
        s.in_pit_lane = true;
        s
    }

    #[test]
    fn first_partial_lap_is_not_trusted() {
        let mut t = LapTracker::default();
        assert_eq!(t.update(live(0, 0, 30_000, true)), None);
        let lap = t.update(live(1, 102_318, 50, true)).unwrap();
        assert_eq!(lap, DetectedLap { lap_number: 1, time_ms: 102_318, untimed: Some(UntimedReason::Partial) });
    }

    #[test]
    fn clean_flying_lap_is_timed() {
        let mut t = LapTracker::default();
        t.update(live(1, 0, 0, true));
        t.update(live(1, 0, 60_000, true));
        let lap = t.update(live(2, 102_318, 20, true)).unwrap();
        assert_eq!(lap.untimed, None);
        assert_eq!(lap.time_ms, 102_318);
    }

    #[test]
    fn cut_anywhere_in_lap_invalidates_it() {
        let mut t = LapTracker::default();
        t.update(live(1, 0, 0, true));
        t.update(live(1, 0, 30_000, false));
        t.update(live(1, 0, 60_000, true));
        assert_eq!(t.update(live(2, 101_990, 20, true)).unwrap().untimed, Some(UntimedReason::Cut));
        // ...but the next lap starts clean.
        t.update(live(2, 101_990, 60_000, true));
        assert_eq!(t.update(live(3, 103_102, 20, true)).unwrap().untimed, None);
    }

    #[test]
    fn leaving_the_pits_is_an_out_lap_not_a_cut() {
        let mut t = LapTracker::default();
        // Sitting in the pit box: the game also flags the lap invalid there.
        t.update(in_pits(live(0, 0, 0, false)));
        t.update(in_pits(live(0, 0, 8_000, false)));
        t.update(live(0, 0, 20_000, false));
        let lap = t.update(live(1, 132_270, 20, true)).unwrap();
        assert_eq!(lap.untimed, Some(UntimedReason::OutLap));
        // The first flying lap after it counts.
        t.update(live(1, 132_270, 60_000, true));
        assert_eq!(t.update(live(2, 131_013, 20, true)).unwrap().untimed, None);
    }

    #[test]
    fn driving_into_the_pits_is_an_in_lap() {
        let mut t = LapTracker::default();
        t.update(live(3, 100_000, 0, true));
        t.update(live(3, 100_000, 90_000, true));
        t.update(in_pits(live(3, 100_000, 110_000, true)));
        let lap = t.update(in_pits(live(4, 125_000, 20, true))).unwrap();
        assert_eq!(lap.untimed, Some(UntimedReason::InLap));
    }

    #[test]
    fn waits_for_lap_time_to_be_published() {
        let mut t = LapTracker::default();
        t.update(live(1, 100_000, 0, true));
        t.update(live(1, 100_000, 60_000, true));
        assert_eq!(t.update(live(2, 100_000, 20, true)), None);
        let lap = t.update(live(2, 99_500, 70, true)).unwrap();
        assert_eq!(lap.time_ms, 99_500);
        assert_eq!(lap.untimed, None);
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
        assert_eq!(t.update(live(1, 101_000, 20, true)).unwrap().untimed, None);
    }
}
