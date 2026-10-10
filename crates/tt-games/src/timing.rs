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

impl ProfileRecorder {
    pub fn reset(&mut self) {
        self.samples.clear();
    }

    pub fn push(&mut self, progress: f32, elapsed_ms: u32) {
        if !progress.is_finite() || !(0.0..=1.0).contains(&progress) {
            return;
        }
        match self.samples.last() {
            // Right after the line some games still report ~1.0 for a frame: skip until
            // the car is genuinely near the start.
            None if progress > MAX_START => {}
            None => self.samples.push((progress, elapsed_ms)),
            Some(&(last_p, last_t)) => {
                if progress > last_p && progress - last_p <= MAX_STEP && elapsed_ms >= last_t {
                    self.samples.push((progress, elapsed_ms));
                }
            }
        }
    }

    /// The finished profile, or `None` if the lap wasn't sampled well enough to trust.
    pub fn finish(&self, lap_time_ms: u32) -> Option<TimingProfile> {
        let first = self.samples.first()?;
        let last = self.samples.last()?;
        if first.0 > MAX_START || last.0 < MIN_END || lap_time_ms < last.1 {
            return None;
        }
        if self.samples.windows(2).any(|w| w[1].0 - w[0].0 > MAX_GAP) {
            return None;
        }

        // Anchor the ends: 0 at the line, the official lap time at the finish.
        let mut pts = Vec::with_capacity(self.samples.len() + 2);
        pts.push((0.0f32, 0u32));
        pts.extend(self.samples.iter().copied().filter(|&(p, _)| p > 0.0 && p < 1.0));
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
