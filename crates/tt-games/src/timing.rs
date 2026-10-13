//! Timing profiles: elapsed time at each 0.5% of a lap or stage.
//!
//! Every game reports *some* measure of progress (AC EVO's `npos`, a rally stage's
//! distance / length...). Recording time against progress gives one representation that
//! works for circuits and stages alike; sector times for any boundaries, live deltas and
//! re-splitting are all derived from it. See `docs/sectors.md`.

/// Number of points in a profile: 0%, 0.5%, ... 100%.
pub const PROFILE_POINTS: usize = 201;

/// Elapsed ms at each 0.5% of the distance (`PROFILE_POINTS` entries, from 0 to lap time).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimingProfile(pub Vec<u32>);

impl TimingProfile {
    /// Elapsed ms at `progress` (0..1), interpolated.
    pub fn at(&self, progress: f32) -> f32 {
        let pos = progress.clamp(0.0, 1.0) * (PROFILE_POINTS - 1) as f32;
        let i = (pos.floor() as usize).min(PROFILE_POINTS - 2);
        let frac = pos - i as f32;
        self.0[i] as f32 + (self.0[i + 1] as f32 - self.0[i] as f32) * frac
    }

    pub fn total_ms(&self) -> u32 {
        *self.0.last().unwrap_or(&0)
    }

    /// Sector times for boundaries like `[0.0, 0.33, 0.66, 1.0]`.
    pub fn split(&self, boundaries: &[f32]) -> Vec<u32> {
        boundaries
            .windows(2)
            .map(|w| (self.at(w[1]) - self.at(w[0])).round().max(0.0) as u32)
            .collect()
    }

    /// Little-endian bytes, for storage.
    pub fn to_bytes(&self) -> Vec<u8> {
        self.0.iter().flat_map(|v| v.to_le_bytes()).collect()
    }

    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.len() != PROFILE_POINTS * 4 {
            return None;
        }
        Some(Self(bytes.chunks_exact(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()))
    }
}

/// Collects (progress, elapsed) samples during one lap and turns them into a profile.
#[derive(Debug, Default, Clone)]
pub struct ProfileRecorder {
    samples: Vec<(f32, u32)>,
    /// What the driver was doing at each sample (same length as `samples`).
    inputs: Vec<Option<crate::Inputs>>,
}

/// Biggest progress jump between two samples we accept (anything larger is a teleport,
/// e.g. "back to pits", or a stale value from the previous lap).
const MAX_STEP: f32 = 0.25;
/// The lap must start being sampled within this much of the line...
const MAX_START: f32 = 0.08;
/// ...end within this much of it...
const MIN_END: f32 = 0.9;
/// ...and have no hole bigger than this.
const MAX_GAP: f32 = 0.12;
/// Elapsed time dropping by more than this near the line means the lap clock restarted.
const CLOCK_RESTART_MS: u32 = 1_000;
/// A sample whose clock is this far from where its neighbours put it is out of step (see `drop_out_of_step`)...
const OUT_OF_STEP_MS: f32 = 40.0;
/// ...and whose position is this far off too (0.4 m on a 4 km lap), so a car crawling along isn't thinned out.
const OUT_OF_STEP_PROGRESS: f32 = 0.0001;
/// Only judge a sample when its neighbours are this close in time: across a longer gap (a car stopped
/// and moving off again) the pace really does change, and nothing is wrong with the sample.
const OUT_OF_STEP_SPAN_MS: u32 = 500;

impl ProfileRecorder {
    pub fn reset(&mut self) {
        self.samples.clear();
        self.inputs.clear();
    }

    pub fn push(&mut self, progress: f32, elapsed_ms: u32) {
        self.push_with(progress, elapsed_ms, None);
    }

    /// Like `push`, also keeping the driver's inputs for the lap's trace.
    pub fn push_with(&mut self, progress: f32, elapsed_ms: u32, inputs: Option<crate::Inputs>) {
        if !progress.is_finite() || !(0.0..=1.0).contains(&progress) {
            return;
        }
        match self.samples.last() {
            // Right after the line some games still report ~1.0 for a frame: skip until
            // the car is genuinely near the start.
            None if progress > MAX_START => {}
            None => {
                self.samples.push((progress, elapsed_ms));
                self.inputs.push(inputs);
            }
            Some(&(last_p, last_t)) => {
                // The game's clock can restart at the line a frame or two after the progress
                // wrapped, so what we collected so far carried the previous lap's time. Start
                // again from here, otherwise every later sample looks like time running backwards
                // and the whole lap ends up without a profile.
                if elapsed_ms + CLOCK_RESTART_MS < last_t && progress <= MAX_START {
                    self.reset();
                    self.samples.push((progress, elapsed_ms));
                    self.inputs.push(inputs);
                    return;
                }
                if progress > last_p && progress - last_p <= MAX_STEP && elapsed_ms >= last_t {
                    self.drop_out_of_step(progress, elapsed_ms);
                    self.samples.push((progress, elapsed_ms));
                    self.inputs.push(inputs);
                }
            }
        }
    }

    /// Drops the latest sample if its clock and position don't belong together, judged against the
    /// sample before it and the one arriving now.
    ///
    /// AC EVO sometimes hitches for ~200 ms (seen every ~5 s on some sessions): when it resumes, one
    /// packet can carry the new position with the lap clock from before the hitch, so the car seems to
    /// cover 11 m in 13 ms and then crawl. Both values come from the same copy of the page, so the only
    /// cure is to notice the sample doesn't fit and leave it out.
    fn drop_out_of_step(&mut self, progress: f32, elapsed_ms: u32) {
        let [.., (p0, t0), (p1, t1)] = self.samples[..] else { return };
        let span = elapsed_ms - t0;
        if span == 0 || span > OUT_OF_STEP_SPAN_MS || progress <= p0 {
            return;
        }
        // Where the line from the sample before to this one puts the latest sample, in time and in distance.
        let expected_ms = t0 as f32 + span as f32 * (p1 - p0) / (progress - p0);
        let expected_progress = p0 + (progress - p0) * (t1 - t0) as f32 / span as f32;
        if (t1 as f32 - expected_ms).abs() > OUT_OF_STEP_MS && (p1 - expected_progress).abs() > OUT_OF_STEP_PROGRESS {
            self.samples.pop();
            self.inputs.pop();
        }
    }

    /// The samples that belong to the lap: the game's clock keeps running a frame or two past the
    /// official lap time before progress wraps, and those samples are over the line already.
    fn within(&self, lap_time_ms: u32) -> Vec<(f32, u32)> {
        self.samples.iter().copied().filter(|&(_, t)| t <= lap_time_ms).collect()
    }

    /// Why `finish` would refuse this lap (for logs), or `None` if it's fine.
    pub fn why_not(&self, lap_time_ms: u32) -> Option<String> {
        let samples = self.within(lap_time_ms);
        let (Some(first), Some(last)) = (samples.first(), samples.last()) else {
            return Some("no samples".into());
        };
        if first.0 > MAX_START {
            return Some(format!("first sample at {:.1}% of the lap", first.0 * 100.0));
        }
        if last.0 < MIN_END {
            return Some(format!("last sample at {:.1}% of the lap", last.0 * 100.0));
        }
        samples
            .windows(2)
            .find(|w| w[1].0 - w[0].0 > MAX_GAP)
            .map(|w| format!("no samples between {:.1}% and {:.1}%", w[0].0 * 100.0, w[1].0 * 100.0))
    }

    /// The finished profile, or `None` if the lap wasn't sampled well enough to trust.
    pub fn finish(&self, lap_time_ms: u32) -> Option<TimingProfile> {
        if self.why_not(lap_time_ms).is_some() {
            return None;
        }

        // Anchor the ends: 0 at the line, the official lap time at the finish.
        let mut pts = Vec::with_capacity(self.samples.len() + 2);
        pts.push((0.0f32, 0u32));
        pts.extend(self.within(lap_time_ms).into_iter().filter(|&(p, _)| p > 0.0 && p < 1.0));
        pts.push((1.0, lap_time_ms));

        let mut out = Vec::with_capacity(PROFILE_POINTS);
        let mut j = 0;
        for i in 0..PROFILE_POINTS {
            let p = i as f32 / (PROFILE_POINTS - 1) as f32;
            while j + 1 < pts.len() - 1 && pts[j + 1].0 < p {
                j += 1;
            }
            let (p0, t0) = pts[j];
            let (p1, t1) = pts[j + 1];
            let t = if p1 > p0 { t0 as f32 + (t1 as f32 - t0 as f32) * ((p - p0) / (p1 - p0)) } else { t0 as f32 };
            out.push(t.round() as u32);
        }
        // Guard against tiny non-monotonic rounding.
        for i in 1..out.len() {
            out[i] = out[i].max(out[i - 1]);
        }
        Some(TimingProfile(out))
    }
}

impl ProfileRecorder {
    /// The lap's input trace, under the same rules as the profile (a lap that wasn't sampled well
    /// has neither). `None` too when the game reported no inputs.
    pub fn finish_trace(&self, lap_time_ms: u32) -> Option<LapTrace> {
        if self.why_not(lap_time_ms).is_some() {
            return None;
        }
        let points: Vec<TracePoint> = self
            .samples
            .iter()
            .zip(&self.inputs)
            .filter(|((_, t), _)| *t <= lap_time_ms)
            .filter_map(|(&(progress, elapsed_ms), inputs)| {
                let i = (*inputs)?;
                Some(TracePoint {
                    progress,
                    elapsed_ms,
                    speed_kmh: i.speed_kmh,
                    throttle: i.throttle.clamp(0.0, 1.0),
                    brake: i.brake.clamp(0.0, 1.0),
                    clutch: i.clutch.clamp(0.0, 1.0),
                    steering: i.steering.clamp(-1.0, 1.0),
                    gear: i.gear,
                })
            })
            .collect();
        (points.len() >= 50).then_some(LapTrace(points))
    }
}

/// One sample of a lap's driver inputs.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TracePoint {
    pub progress: f32,
    pub elapsed_ms: u32,
    pub speed_kmh: f32,
    pub throttle: f32,
    pub brake: f32,
    pub clutch: f32,
    pub steering: f32,
    pub gear: i16,
}

/// Throttle, brake, clutch, steering, gear and speed through one lap (about 20 samples a second),
/// for comparing laps. Stored compactly: 13 bytes a sample, around 25 KB for a 90 s lap.
#[derive(Debug, Clone, PartialEq)]
pub struct LapTrace(pub Vec<TracePoint>);

const TRACE_VERSION: u8 = 1;
const TRACE_POINT_BYTES: usize = 13;

impl LapTrace {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(1 + self.0.len() * TRACE_POINT_BYTES);
        out.push(TRACE_VERSION);
        for p in &self.0 {
            out.extend(((p.progress.clamp(0.0, 1.0) * 65535.0).round() as u16).to_le_bytes());
            out.extend(p.elapsed_ms.to_le_bytes());
            out.extend(((p.speed_kmh.clamp(0.0, 655.0) * 100.0).round() as u16).to_le_bytes());
            out.push((p.throttle.clamp(0.0, 1.0) * 255.0).round() as u8);
            out.push((p.brake.clamp(0.0, 1.0) * 255.0).round() as u8);
            out.push((p.clutch.clamp(0.0, 1.0) * 255.0).round() as u8);
            out.push(((p.steering.clamp(-1.0, 1.0) * 127.0).round() as i8) as u8);
            out.push((p.gear.clamp(-127, 127) as i8) as u8);
        }
        out
    }

    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        let (&version, rest) = bytes.split_first()?;
        if version != TRACE_VERSION || rest.len() % TRACE_POINT_BYTES != 0 {
            return None;
        }
        Some(Self(
            rest.chunks_exact(TRACE_POINT_BYTES)
                .map(|c| TracePoint {
                    progress: u16::from_le_bytes([c[0], c[1]]) as f32 / 65535.0,
                    elapsed_ms: u32::from_le_bytes([c[2], c[3], c[4], c[5]]),
                    speed_kmh: u16::from_le_bytes([c[6], c[7]]) as f32 / 100.0,
                    throttle: c[8] as f32 / 255.0,
                    brake: c[9] as f32 / 255.0,
                    clutch: c[10] as f32 / 255.0,
                    steering: (c[11] as i8) as f32 / 127.0,
                    gear: (c[12] as i8) as i16,
                })
                .collect(),
        ))
    }
}

/// Default sector boundaries when the game gives none: 3 equal sectors on a circuit; on a
/// rally stage one per ~2 km, between 4 and 8.
pub fn even_boundaries(rally: bool, length_m: Option<f32>) -> Vec<f32> {
    let count = if rally {
        length_m.map_or(4, |m| ((m / 2000.0).round() as usize).clamp(4, 8))
    } else {
        3
    };
    (0..=count).map(|i| i as f32 / count as f32).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A lap at constant speed with a slow middle third.
    fn recorder(lap_ms: u32) -> ProfileRecorder {
        let mut r = ProfileRecorder::default();
        r.push(0.999, 5); // stale value from the previous lap: ignored
        let mut t = 0f32;
        let mut p = 0.002f32;
        while p < 0.998 {
            r.push(p, t as u32);
            let speed = if (0.33..0.66).contains(&p) { 0.5 } else { 1.0 };
            p += 0.004 * speed;
            t += lap_ms as f32 * 0.004 / 1.333;
        }
        r
    }

    #[test]
    fn profile_spans_the_lap_and_splits_into_sectors() {
        let r = recorder(100_000);
        let prof = r.finish(100_000).unwrap();
        assert_eq!(prof.0.len(), PROFILE_POINTS);
        assert_eq!(prof.0[0], 0);
        assert_eq!(prof.total_ms(), 100_000);
        let sectors = prof.split(&even_boundaries(false, None));
        assert_eq!(sectors.iter().sum::<u32>(), 100_000);
        // The slow middle sector takes roughly twice as long as the others.
        assert!(sectors[1] > sectors[0] * 18 / 10, "{sectors:?}");
    }

    #[test]
    fn incomplete_laps_have_no_profile() {
        let mut r = ProfileRecorder::default();
        for i in 30..100 {
            r.push(i as f32 / 100.0, i * 1000);
        }
        assert!(r.finish(100_000).is_none(), "started mid-lap");

        let mut r = ProfileRecorder::default();
        for i in 0..50 {
            r.push(i as f32 / 100.0, i * 1000);
        }
        assert!(r.finish(100_000).is_none(), "never got near the end");
    }

    #[test]
    fn a_clock_that_restarts_after_the_line_does_not_spoil_the_lap() {
        let mut r = ProfileRecorder::default();
        // Progress has wrapped but the clock still shows the previous lap for two frames.
        r.push(0.001, 99_950);
        r.push(0.003, 99_990);
        for i in 1..1000u32 {
            r.push(0.003 + i as f32 * 0.001, i * 100);
        }
        let prof = r.finish(100_000).expect("profile despite the stale start");
        assert!(prof.at(0.5) > 49_000.0 && prof.at(0.5) < 51_500.0, "{}", prof.at(0.5));
        assert!(ProfileRecorder::default().why_not(1).is_some());
    }

    #[test]
    fn samples_taken_just_past_the_official_lap_time_are_ignored_not_fatal() {
        // The real case from a Suzuka lap: last sample 32 ms after the official time (54 597 ms).
        let mut r = ProfileRecorder::default();
        for i in 0..=100u32 {
            r.push(i as f32 * 0.00995, i * 540);
        }
        r.push(0.9995, 54_629);
        let prof = r.finish(54_597).expect("profile despite the late last sample");
        assert_eq!(prof.total_ms(), 54_597);
        assert!(r.why_not(54_597).is_none());
        // A lap that really stopped early is still refused.
        assert!(r.why_not(20_000).is_some());
    }

    #[test]
    fn traces_keep_the_drivers_inputs_and_survive_storage() {
        let mut r = ProfileRecorder::default();
        for i in 0..=400u32 {
            let p = i as f32 / 400.0 * 0.999;
            let braking = (150..190).contains(&i);
            r.push_with(
                p,
                i * 250,
                Some(crate::Inputs { throttle: if braking { 0.0 } else { 1.0 }, brake: if braking { 0.8 } else { 0.0 }, steering: -0.5, gear: 3, speed_kmh: 180.5, ..Default::default() }),
            );
        }
        let trace = r.finish_trace(100_100).expect("trace");
        assert_eq!(trace.0.len(), 401);
        let braking = trace.0.iter().find(|p| p.brake > 0.5).unwrap();
        assert_eq!((braking.throttle, braking.gear), (0.0, 3));
        // Stored form: 13 bytes a sample, quantised but close.
        let bytes = trace.to_bytes();
        assert_eq!(bytes.len(), 1 + 401 * 13);
        let back = LapTrace::from_bytes(&bytes).unwrap();
        assert_eq!(back.0.len(), 401);
        let (a, b) = (&trace.0[170], &back.0[170]);
        assert!((a.brake - b.brake).abs() < 0.01 && (a.steering - b.steering).abs() < 0.01 && (a.speed_kmh - b.speed_kmh).abs() < 0.01);
        assert_eq!((a.elapsed_ms, a.gear), (b.elapsed_ms, b.gear));
        // No inputs reported (or too few samples): no trace.
        let mut bare = ProfileRecorder::default();
        for i in 0..=400u32 {
            bare.push(i as f32 / 400.0 * 0.999, i * 250);
        }
        assert!(bare.finish_trace(100_100).is_none());
        assert!(LapTrace::from_bytes(&[9, 1, 2]).is_none());
    }

    #[test]
    fn sitting_still_adds_nothing_to_a_trace() {
        let input = Some(crate::Inputs { throttle: 0.0, gear: 1, ..Default::default() });
        let mut r = ProfileRecorder::default();
        // Ten minutes parked in the pit box at 20 samples a second: progress never moves.
        for i in 0..12_000u32 {
            r.push_with(0.02, i * 50, input);
        }
        assert_eq!(r.samples.len(), 1, "a parked car must not grow the recording");
        // Then it drives off: only samples where the car actually advanced are kept.
        for i in 1..=200u32 {
            r.push_with(0.02 + i as f32 * 0.0049, 600_000 + i * 450, input);
        }
        assert_eq!(r.samples.len(), 201);
    }

    #[test]
    fn a_sample_whose_clock_lags_its_position_is_left_out() {
        // Suzuka lap 31 at 255 km/h: the 7 753 ms sample is ~150 ms further on than its clock says
        // (the game hitched and resumed with the old lap time), then nothing for 200 ms.
        let real = [(0.2161, 7655), (0.2174, 7697), (0.2188, 7740), (0.2238, 7753), (0.2257, 7955), (0.2274, 8008), (0.2290, 8058)];
        let mut r = ProfileRecorder::default();
        r.push(0.0, 0);
        for i in 1..150u32 {
            r.push(0.2161 * i as f32 / 150.0, 7655 * i / 150);
        }
        for (p, t) in real {
            r.push(p, t);
        }
        let kept: Vec<u32> = r.samples.iter().map(|s| s.1).filter(|&t| t >= 7655).collect();
        assert_eq!(kept, [7655, 7697, 7740, 7955, 8008, 8058]);

        // Ordinary driving, braking hard and a long stop keep every sample.
        let mut r = ProfileRecorder::default();
        let mut p = 0.0f32;
        let mut t = 0u32;
        for i in 0..400u32 {
            // Progress per ms: steady, then braking almost to a standstill, parked 8 s, and off again.
            let speed = if i < 200 { 0.00004 } else { (0.00004 - (i - 200) as f32 * 0.0000002).max(0.000001) };
            let dt = [43, 57, 50, 46, 61][i as usize % 5];
            p += speed * dt as f32;
            t += dt + if i == 300 { 8_000 } else { 0 };
            r.push(p, t);
        }
        assert!(p < 1.0);
        assert_eq!(r.samples.len(), 400);
    }

    #[test]
    fn teleports_are_ignored() {
        let mut r = ProfileRecorder::default();
        for i in 0..40 {
            r.push(i as f32 / 100.0, i * 1000);
        }
        r.push(0.95, 41_000); // jump: ignored
        for i in 40..100 {
            r.push(i as f32 / 100.0, i * 1000 + 1000);
        }
        let prof = r.finish(101_000).unwrap();
        assert!((prof.at(0.5) - 51_000.0).abs() < 600.0);
    }

    #[test]
    fn rally_stages_get_more_sectors() {
        assert_eq!(even_boundaries(true, Some(12_500.0)).len(), 7); // 6 sectors
        assert_eq!(even_boundaries(true, Some(3_000.0)).len(), 5); // min 4
        assert_eq!(even_boundaries(true, Some(30_000.0)).len(), 9); // max 8
        assert_eq!(even_boundaries(false, Some(30_000.0)).len(), 4); // circuits: 3
    }

    #[test]
    fn bytes_roundtrip() {
        let prof = recorder(90_000).finish(90_000).unwrap();
        assert_eq!(TimingProfile::from_bytes(&prof.to_bytes()), Some(prof));
    }
}
