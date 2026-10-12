//! Turns a rally game's stage clock and distance driven into finished stage runs.
//!
//! The rally counterpart of [`crate::tracker::LapTracker`], shared by every rally game's adapter. A
//! stage has no lap counter: it starts when the clock starts, and it ends at a finish line that is
//! usually well short of the end of the stage's reference line (there is a stretch to roll out and stop
//! on). The game itself marks the finish by **stopping the stage clock** while the car is still moving,
//! so that is the signal used: the clock holds still, the game's data is still updating, and the car is
//! near the end. Everything after that (the roll-out) is ignored, and the time is the game's own final
//! clock reading.
//!
//! Progress along the stage is the distance driven over the stage length, so it tops out a little under
//! 1.0 at the line. Recorded profiles and live progress use the same measure, so deltas stay consistent
//! and the roll-out never distorts them.
//!
//! Kept free of any I/O so it can be tested with synthetic samples.

use crate::UntimedReason;
use crate::timing::{LapTrace, ProfileRecorder, TimingProfile};

/// One reading of the game's stage data.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StageSample {
    /// A monotonic clock in milliseconds (any origin), for timing how long the stage clock has held still.
    pub at_ms: u64,
    /// The stage clock in milliseconds, or `None` when the game shows none (menus, loading).
    pub clock_ms: Option<u32>,
    /// Distance driven in the stage so far, metres.
    pub distance_m: f32,
    /// The stage's length in metres, when the game reports it.
    pub length_m: Option<f32>,
    /// The game's data changed since the previous sample (a frozen page is a pause, a menu or the end).
    pub updating: bool,
    /// What the driver is doing, for the run's trace.
    pub inputs: Option<crate::Inputs>,
}

/// A stage run that reached the finish line.
#[derive(Debug, Clone, PartialEq)]
pub struct DetectedStage {
    /// Which run this was since the stage was loaded (1-based).
    pub attempt: u32,
    /// The game's own final clock reading.
    pub time_ms: u32,
    /// `None` = a proper timed run; `Partial` when we only joined it part-way.
    pub untimed: Option<UntimedReason>,
    /// How far the car had driven when the clock stopped: where the finish line is on this stage.
    pub finish_distance_m: f32,
    pub profile: Option<TimingProfile>,
    pub trace: Option<LapTrace>,
}

/// A run starts with the clock this close to zero and the car this close to the start line.
const START_CLOCK_MS: u32 = 3_000;
const START_DISTANCE_M: f32 = 60.0;
/// The clock must hold still this long (with the game still updating) to count as the finish.
const HOLD_MS: u64 = 700;
/// ...and the car must be this far along the stage, so a stalled clock at the start is not a finish.
const MIN_FINISH_PROGRESS: f32 = 0.9;
/// The clock jumping back by more than this, or the distance by more than this, is a restart.
const RESTART_CLOCK_MS: u32 = 1_000;
const RESTART_DISTANCE_M: f32 = 200.0;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
enum Phase {
    /// No stage in progress (menus, or between runs).
    #[default]
    Idle,
    Running,
    /// Past the finish line: the stage is done and the car is rolling out.
    Finished,
}

#[derive(Debug, Default)]
pub struct StageTracker {
    phase: Phase,
    /// Runs finished since the stage was loaded.
    finished: u32,
    /// We joined the run part-way, so can't vouch for it.
    partial: bool,
    recorder: ProfileRecorder,
    last_clock: u32,
    last_distance: f32,
    /// When the clock last changed value.
    clock_changed_at: u64,
}

impl StageTracker {
    pub fn reset(&mut self) {
        *self = Self::default();
    }

    /// Past the finish line: the run is over even though the game is still updating while the car rolls.
    pub fn is_finished(&self) -> bool {
        self.phase == Phase::Finished
    }

    pub fn update(&mut self, s: StageSample) -> Option<DetectedStage> {
        let Some(clock) = s.clock_ms else {
            // No clock at all: back in the menus.
            self.phase = Phase::Idle;
            self.recorder.reset();
            return None;
        };
        if !s.updating {
            return None;
        }
        match self.phase {
            Phase::Idle => {
                self.begin(&s, clock);
                None
            }
            Phase::Finished => {
                if self.restarted(&s, clock) {
                    self.begin(&s, clock);
                }
                None
            }
            Phase::Running => {
                if self.restarted(&s, clock) {
                    // Restarted before the finish: that run is abandoned.
                    self.begin(&s, clock);
                    return None;
                }
                let progress = self.progress(&s);
                if clock != self.last_clock {
                    self.last_clock = clock;
                    self.clock_changed_at = s.at_ms;
                    if let Some(p) = progress {
                        self.recorder.push_with(p, clock, s.inputs);
                    }
                }
                self.last_distance = s.distance_m;

                let held = s.at_ms.saturating_sub(self.clock_changed_at) >= HOLD_MS;
                if held && clock > 0 && progress.is_some_and(|p| p >= MIN_FINISH_PROGRESS) {
                    return Some(self.finish(clock, s.distance_m));
                }
                None
            }
        }
    }

    fn progress(&self, s: &StageSample) -> Option<f32> {
        s.length_m.filter(|l| *l > 0.0).map(|l| (s.distance_m / l).clamp(0.0, 1.0))
    }

    fn restarted(&self, s: &StageSample, clock: u32) -> bool {
        clock + RESTART_CLOCK_MS < self.last_clock || s.distance_m + RESTART_DISTANCE_M < self.last_distance
    }

    fn begin(&mut self, s: &StageSample, clock: u32) {
        self.phase = Phase::Running;
        // Joining a run that is already under way can't be vouched for.
        self.partial = !(clock <= START_CLOCK_MS && s.distance_m <= START_DISTANCE_M);
        self.recorder.reset();
        self.last_clock = clock;
        self.last_distance = s.distance_m;
        self.clock_changed_at = s.at_ms;
        if let Some(p) = self.progress(s) {
            self.recorder.push_with(p, clock, s.inputs);
        }
    }

    fn finish(&mut self, time_ms: u32, finish_distance_m: f32) -> DetectedStage {
        self.phase = Phase::Finished;
        self.finished += 1;
        let untimed = self.partial.then_some(UntimedReason::Partial);
        let profile = if self.partial { None } else { self.recorder.finish(time_ms) };
        let trace = if untimed.is_none() { self.recorder.finish_trace(time_ms) } else { None };
        self.recorder.reset();
        DetectedStage { attempt: self.finished, time_ms, untimed, finish_distance_m, profile, trace }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LENGTH: f32 = 1_000.0;
    /// The finish line, short of the end of the stage's reference line (as in the real game).
    const FINISH: f32 = 984.0;
    const SPEED: f32 = 30.0; // m/s

    /// Speed once past the finish line, while the car rolls out and stops (m/s).
    const ROLL: f32 = 5.0;

    /// A run sampled at 20 Hz: the clock runs until the car reaches `finish`, then holds while the car rolls
    /// on for a few seconds, as in the real game. `until_m` cuts the run short (a restart, a retirement).
    fn run(from_ms: u32, until_m: f32, finish: f32, t0: u64) -> Vec<StageSample> {
        let t_finish = (finish / SPEED * 1000.0) as u32;
        let mut out = Vec::new();
        let mut t = from_ms;
        loop {
            let distance = if t < t_finish { SPEED * t as f32 / 1000.0 } else { finish + ROLL * (t - t_finish) as f32 / 1000.0 };
            if distance > until_m || t > t_finish + 3_000 {
                break;
            }
            out.push(StageSample {
                at_ms: t0 + (t - from_ms) as u64,
                clock_ms: Some(t.min(t_finish)),
                distance_m: distance,
                length_m: Some(LENGTH),
                updating: true,
                inputs: None,
            });
            t += 50;
        }
        out
    }

    fn feed(tracker: &mut StageTracker, samples: &[StageSample]) -> Vec<DetectedStage> {
        samples.iter().filter_map(|s| tracker.update(*s)).collect()
    }

    #[test]
    fn a_run_from_the_start_finishes_when_the_clock_stops_short_of_the_end() {
        let mut t = StageTracker::default();
        let done = feed(&mut t, &run(0, LENGTH, FINISH, 0));
        assert_eq!(done.len(), 1, "exactly one finish, however long the roll-out");
        let d = &done[0];
        assert_eq!((d.attempt, d.untimed), (1, None));
        assert_eq!(d.time_ms, (FINISH / SPEED * 1000.0) as u32, "the game's own final clock reading");
        assert!(d.finish_distance_m >= FINISH && d.finish_distance_m < LENGTH);
        assert!(d.profile.is_some(), "a full run has a timing profile even though it ends at ~98%");
        assert!(t.is_finished());
    }

    #[test]
    fn joining_a_run_part_way_is_not_trusted() {
        let mut t = StageTracker::default();
        let done = feed(&mut t, &run(10_000, LENGTH, FINISH, 0));
        assert_eq!(done.len(), 1);
        assert_eq!(done[0].untimed, Some(UntimedReason::Partial));
        assert!(done[0].profile.is_none() && done[0].trace.is_none());
    }

    #[test]
    fn restarting_before_the_finish_abandons_the_run_and_the_next_one_is_clean() {
        let mut t = StageTracker::default();
        assert!(feed(&mut t, &run(0, 600.0, FINISH, 0)).is_empty(), "stopped well short of the line");
        // Restart: the clock and distance go back to the start.
        let done = feed(&mut t, &run(0, LENGTH, FINISH, 100_000));
        assert_eq!(done.len(), 1);
        assert_eq!((done[0].attempt, done[0].untimed), (1, None), "the abandoned run does not count");
    }

    #[test]
    fn a_second_run_after_a_finish_is_the_next_attempt() {
        let mut t = StageTracker::default();
        assert_eq!(feed(&mut t, &run(0, LENGTH, FINISH, 0)).len(), 1);
        let second = feed(&mut t, &run(0, LENGTH, FINISH, 200_000));
        assert_eq!(second.len(), 1);
        assert_eq!((second[0].attempt, second[0].untimed), (2, None));
    }

    #[test]
    fn a_clock_that_holds_at_the_start_is_not_a_finish() {
        // The countdown before the start: clock at zero, car stationary.
        let mut t = StageTracker::default();
        let waiting: Vec<_> = (0..200)
            .map(|i| StageSample { at_ms: i * 50, clock_ms: Some(0), distance_m: 0.0, length_m: Some(LENGTH), updating: true, inputs: None })
            .collect();
        assert!(feed(&mut t, &waiting).is_empty());
        assert!(!t.is_finished());
    }

    #[test]
    fn frozen_data_is_a_pause_not_a_finish() {
        let mut t = StageTracker::default();
        let mut samples = run(0, 700.0, FINISH, 0);
        // The game stops updating (paused): the same reading repeats for a long time.
        let last = *samples.last().unwrap();
        for i in 1..400 {
            samples.push(StageSample { at_ms: last.at_ms + i * 50, updating: false, ..last });
        }
        assert!(feed(&mut t, &samples).is_empty());
        assert!(!t.is_finished());
    }

    #[test]
    fn going_back_to_the_menus_ends_the_run_without_a_result() {
        let mut t = StageTracker::default();
        feed(&mut t, &run(0, 500.0, FINISH, 0));
        assert_eq!(t.update(StageSample { at_ms: 99_999, clock_ms: None, distance_m: 0.0, length_m: None, updating: true, inputs: None }), None);
        // A fresh run afterwards starts cleanly.
        let done = feed(&mut t, &run(0, LENGTH, FINISH, 200_000));
        assert_eq!((done.len(), done[0].untimed), (1, None));
    }

    #[test]
    fn without_a_stage_length_there_is_no_finish_to_detect() {
        let mut t = StageTracker::default();
        let samples: Vec<_> = run(0, LENGTH, FINISH, 0).into_iter().map(|s| StageSample { length_m: None, ..s }).collect();
        assert!(feed(&mut t, &samples).is_empty());
    }
}
