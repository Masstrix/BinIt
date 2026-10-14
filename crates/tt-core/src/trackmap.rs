//! Track maps learned from telemetry: the car's world position sampled against lap
//! progress over one clean lap, resampled to a fixed number of points. Works for any
//! game that reports world position, so no map images are needed from the game files.

use serde::Serialize;

/// Points in a stored map (evenly spaced in lap progress).
pub const MAP_POINTS: usize = 400;

/// A track outline in world metres: `[x, z]` points in driving order.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackMap {
    pub game: String,
    pub track: String,
    pub layout: String,
    pub points: Vec<[f32; 2]>,
    /// Display orientation chosen by the user: degrees clockwise (0, 90, 180, 270), applied after `mirror`.
    pub rotate: u16,
    /// Mirror left/right before rotating.
    pub mirror: bool,
    /// A circuit comes back to its start; a rally stage runs from one place to another and must not be drawn closed.
    pub closed: bool,
}

/// A run is seen from its start if recording began with the lap or stage clock this close to zero (ms). Later
/// than that the recording joined a run already under way, and the stretch before it was never seen.
const START_CLOCK_MS: u32 = 3_000;

/// Collects positions for the lap in progress.
pub struct MapRecorder {
    bins: Vec<Option<[f32; 2]>>,
    /// Recording began part-way through the run (see [`START_CLOCK_MS`]): what it holds is not the whole path.
    joined_late: bool,
}

impl Default for MapRecorder {
    fn default() -> Self {
        Self { bins: vec![None; MAP_POINTS], joined_late: false }
    }
}

impl MapRecorder {
    pub fn reset(&mut self) {
        self.bins.iter_mut().for_each(|b| *b = None);
        self.joined_late = false;
    }

    /// A position with no clock to say how far into the run it is (taken as the start of one).
    pub fn record(&mut self, progress: f32, position: [f32; 2]) {
        self.record_at(progress, position, 0);
    }

    /// A position `clock_ms` into the lap or stage. The first one after a reset says whether the recording
    /// began with the run: one that began part-way can never become a map, however well the rest is sampled
    /// (the part before it is missing, and for a stage the game may have moved the car meanwhile).
    pub fn record_at(&mut self, progress: f32, position: [f32; 2], clock_ms: u32) {
        if (0.0..1.0).contains(&progress) {
            if self.bins.iter().all(Option::is_none) {
                self.joined_late = clock_ms > START_CLOCK_MS;
            }
            self.bins[(progress * MAP_POINTS as f32) as usize] = Some(position);
        }
    }

    /// Whether what has been recorded began with the run, and so may still become a map.
    pub fn is_from_the_start(&self) -> bool {
        !self.joined_late
    }

    /// What has been recorded so far, in driving order, for drawing a map while it is being learned.
    pub fn partial(&self) -> Vec<[f32; 2]> {
        self.bins.iter().flatten().copied().collect()
    }

    /// The finished path of a point-to-point stage, if it was sampled well enough. The same bins as a lap
    /// (so a progress still finds its place on the path), but not joined end to start: the stage may start
    /// after bin 0 (a drive-up) and end before the last bin (the stretch past the finish), and the bins
    /// outside that repeat the end points, so the path starts and ends where the stage does.
    pub fn finish_open(&mut self) -> Option<Vec<[f32; 2]>> {
        let late = std::mem::take(&mut self.joined_late);
        let bins = std::mem::replace(&mut self.bins, vec![None; MAP_POINTS]);
        if late {
            return None;
        }
        let filled: Vec<usize> = (0..MAP_POINTS).filter(|&i| bins[i].is_some()).collect();
        let (&first, &last) = (filled.first()?, filled.last()?);
        let span = last - first;
        if span * 10 < MAP_POINTS * 8 || filled.len() * 10 < (span + 1) * 9 {
            return None;
        }
        if filled.windows(2).any(|w| w[1] - w[0] > MAP_POINTS / 20) {
            return None;
        }
        let mut out = vec![[0.0f32; 2]; MAP_POINTS];
        for w in filled.windows(2) {
            let (a, b) = (w[0], w[1]);
            let (pa, pb) = (bins[a].unwrap(), bins[b].unwrap());
            for i in a..b {
                let t = (i - a) as f32 / (b - a) as f32;
                out[i] = [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t];
            }
        }
        for (i, slot) in out.iter_mut().enumerate() {
            if i < first {
                *slot = bins[first].unwrap();
            } else if i >= last {
                *slot = bins[last].unwrap();
            }
        }
        let round = |v: f32| (v * 10.0).round() / 10.0;
        let out: Vec<[f32; 2]> = out.into_iter().map(|[x, z]| [round(x), round(z)]).collect();
        let (min_x, max_x) = out.iter().fold((f32::MAX, f32::MIN), |(lo, hi), p| (lo.min(p[0]), hi.max(p[0])));
        let (min_z, max_z) = out.iter().fold((f32::MAX, f32::MIN), |(lo, hi), p| (lo.min(p[1]), hi.max(p[1])));
        ((max_x - min_x).max(max_z - min_z) > 100.0).then_some(out)
    }

    /// The finished outline, if the lap was sampled well enough (at least 90% of bins and no
    /// long blind stretch). Gaps are filled by straight lines. The recorder is reset.
    pub fn finish(&mut self) -> Option<Vec<[f32; 2]>> {
        let late = std::mem::take(&mut self.joined_late);
        let bins = std::mem::replace(&mut self.bins, vec![None; MAP_POINTS]);
        if late {
            return None;
        }
        let filled: Vec<usize> = (0..MAP_POINTS).filter(|&i| bins[i].is_some()).collect();
        if filled.len() * 10 < MAP_POINTS * 9 {
            return None;
        }
        // Longest run of empty bins, wrapping around the start line.
        let widest_gap = (0..filled.len())
            .map(|k| {
                let (a, b) = (filled[k], filled[(k + 1) % filled.len()]);
                (b + MAP_POINTS - a) % MAP_POINTS
            })
            .max()
            .unwrap_or(MAP_POINTS);
        if widest_gap > MAP_POINTS / 20 {
            return None;
        }
        let mut out = vec![[0.0f32; 2]; MAP_POINTS];
        for (k, &a) in filled.iter().enumerate() {
            let b = filled[(k + 1) % filled.len()];
            let span = (b + MAP_POINTS - a) % MAP_POINTS;
            let (pa, pb) = (bins[a].unwrap(), bins[b].unwrap());
            for step in 0..span.max(1) {
                let t = step as f32 / span.max(1) as f32;
                out[(a + step) % MAP_POINTS] = [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t];
            }
        }
        let round = |v: f32| (v * 10.0).round() / 10.0;
        let out: Vec<[f32; 2]> = out.into_iter().map(|[x, z]| [round(x), round(z)]).collect();
        // A car sat still (or a bad read) isn't a track.
        let (min_x, max_x) = out.iter().fold((f32::MAX, f32::MIN), |(lo, hi), p| (lo.min(p[0]), hi.max(p[0])));
        let (min_z, max_z) = out.iter().fold((f32::MAX, f32::MIN), |(lo, hi), p| (lo.min(p[1]), hi.max(p[1])));
        ((max_x - min_x).max(max_z - min_z) > 100.0).then_some(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn circle(p: f32) -> [f32; 2] {
        let a = p * std::f32::consts::TAU;
        [a.cos() * 500.0, a.sin() * 300.0]
    }

    #[test]
    fn a_full_lap_becomes_a_closed_outline() {
        let mut r = MapRecorder::default();
        for i in 0..1200 {
            let p = i as f32 / 1200.0;
            r.record(p, circle(p));
        }
        let map = r.finish().expect("map");
        assert_eq!(map.len(), MAP_POINTS);
        assert!(map[0][0] > 499.0 && map[0][1].abs() < 5.0);
    }

    #[test]
    fn gaps_are_filled_but_big_holes_are_rejected() {
        let mut r = MapRecorder::default();
        for i in (0..400).filter(|i| i % 20 != 1) {
            let p = i as f32 / 400.0;
            r.record(p, circle(p));
        }
        assert!(r.finish().is_some());

        for i in (0..400).filter(|i| !(100..150).contains(i)) {
            let p = i as f32 / 400.0;
            r.record(p, circle(p));
        }
        assert!(r.finish().is_none());
    }

    #[test]
    fn a_stage_is_an_open_path_that_starts_and_ends_where_the_stage_does() {
        let mut r = MapRecorder::default();
        // A drive-up before the start (bins 0..17 never recorded) and the stage ending short of the last bin.
        for i in 17..394 {
            let p = i as f32 / 400.0;
            r.record(p, [p * 5000.0, (p * 12.0).sin() * 300.0]);
        }
        let map = r.finish_open().expect("map");
        assert_eq!(map.len(), MAP_POINTS);
        assert_eq!(map[0], map[17], "the bins before the start repeat the start");
        assert_eq!(map[399], map[393], "and those past the finish repeat the end");
        assert!(map[0][0] < 400.0 && map[399][0] > 4500.0, "start and end are far apart: not joined");
    }

    #[test]
    fn a_stage_with_a_hole_or_only_a_stretch_is_not_a_map() {
        let mut r = MapRecorder::default();
        for i in (17..394).filter(|i| !(100..140).contains(i)) {
            r.record(i as f32 / 400.0, [i as f32 * 10.0, 0.0]);
        }
        assert!(r.finish_open().is_none());
        for i in 17..200 {
            r.record(i as f32 / 400.0, [i as f32 * 10.0, 0.0]);
        }
        assert!(r.finish_open().is_none());
    }

    #[test]
    fn a_recording_that_began_part_way_through_the_run_is_never_a_map() {
        // Joined 40 s in, then every bin from there to the end sampled perfectly: still not the whole path.
        let mut r = MapRecorder::default();
        for i in 20..394 {
            let p = i as f32 / 400.0;
            r.record_at(p, [p * 5000.0, (p * 12.0).sin() * 300.0], 40_000 + i * 100);
        }
        assert!(!r.is_from_the_start());
        assert!(r.finish_open().is_none());

        // The same path recorded from the start (clock near zero at the first sample) is fine, and the next
        // recording is judged on its own.
        for i in 17..394 {
            let p = i as f32 / 400.0;
            r.record_at(p, [p * 5000.0, (p * 12.0).sin() * 300.0], 500 + i * 100);
        }
        assert!(r.is_from_the_start());
        assert!(r.finish_open().is_some());
    }

    #[test]
    fn a_lap_joined_part_way_is_not_a_map_either() {
        let mut r = MapRecorder::default();
        for i in 0..1200 {
            let p = i as f32 / 1200.0;
            r.record_at(p, circle(p), if i < 600 { 90_000 } else { 0 });
        }
        // It began at 90 s on the clock (the first sample), so it began late.
        assert!(r.finish().is_none());
        for i in 0..1200 {
            let p = i as f32 / 1200.0;
            r.record_at(p, circle(p), i * 80);
        }
        assert!(r.finish().is_some());
    }

    #[test]
    fn resetting_forgets_that_the_recording_joined_late() {
        let mut r = MapRecorder::default();
        r.record_at(0.5, [0.0, 0.0], 60_000);
        assert!(!r.is_from_the_start());
        r.reset();
        assert!(r.is_from_the_start());
    }

    #[test]
    fn standing_still_is_not_a_track() {
        let mut r = MapRecorder::default();
        for i in 0..400 {
            r.record(i as f32 / 400.0, [10.0, 10.0]);
        }
        assert!(r.finish().is_none());
    }
}
