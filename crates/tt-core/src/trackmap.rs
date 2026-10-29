//! Track maps learned from telemetry: the car's world position sampled against lap
//! progress over one clean lap, resampled to a fixed number of points. Works for any
//! game that reports world position, so no map images are needed from the game files.

use serde::Serialize;

/// Points in a stored map for a short or unknown-length track (evenly spaced in lap progress).
pub const MAP_POINTS: usize = 400;
/// The most points a map gets, however long the track.
pub const MAX_MAP_POINTS: usize = 2500;

/// How many points a track's map should have: about one every 10 m, so a long circuit keeps its corners
/// (the 20.8 km Nordschleife gets 2,083 where 400 would be one every 52 m). Telemetry arrives every 50 ms, so even at
/// 300 km/h (4 m a sample) every 10 m bin gets a reading. Unknown length stays at the old 400.
pub fn points_for_length(length_m: Option<u32>) -> usize {
    match length_m {
        Some(m) if m > 0 => (m as usize / 10).clamp(MAP_POINTS, MAX_MAP_POINTS),
        _ => MAP_POINTS,
    }
}

/// Whether a freshly learned map should replace the one stored: only to improve on a coarse one (fewer than three
/// quarters of the points this track now gets), never to churn between equally good ones.
pub fn worth_replacing(stored_points: usize, new_points: usize) -> bool {
    new_points > stored_points && stored_points * 4 < new_points * 3
}

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

/// Collects positions for the lap in progress.
pub struct MapRecorder {
    bins: Vec<Option<[f32; 2]>>,
}

impl Default for MapRecorder {
    fn default() -> Self {
        Self { bins: vec![None; MAP_POINTS] }
    }
}

impl MapRecorder {
    /// Gives the recorder `points` bins (starting over if that is a change).
    pub fn fit(&mut self, points: usize) {
        let points = points.max(MAP_POINTS);
        if self.bins.len() != points {
            self.bins = vec![None; points];
        }
    }

    pub fn reset(&mut self) {
        self.bins.iter_mut().for_each(|b| *b = None);
    }

    pub fn record(&mut self, progress: f32, position: [f32; 2]) {
        if (0.0..1.0).contains(&progress) {
            let n = self.bins.len();
            self.bins[((progress * n as f32) as usize).min(n - 1)] = Some(position);
        }
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
        let n = self.bins.len();
        let bins = std::mem::replace(&mut self.bins, vec![None; n]);
        let filled: Vec<usize> = (0..n).filter(|&i| bins[i].is_some()).collect();
        let (&first, &last) = (filled.first()?, filled.last()?);
        let span = last - first;
        if span * 10 < n * 8 || filled.len() * 10 < (span + 1) * 9 {
            return None;
        }
        if filled.windows(2).any(|w| w[1] - w[0] > n / 20) {
            return None;
        }
        let mut out = vec![[0.0f32; 2]; n];
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
        let n = self.bins.len();
        let bins = std::mem::replace(&mut self.bins, vec![None; n]);
        let filled: Vec<usize> = (0..n).filter(|&i| bins[i].is_some()).collect();
        if filled.len() * 10 < n * 9 {
            return None;
        }
        // Longest run of empty bins, wrapping around the start line.
        let widest_gap = (0..filled.len())
            .map(|k| {
                let (a, b) = (filled[k], filled[(k + 1) % filled.len()]);
                (b + n - a) % n
            })
            .max()
            .unwrap_or(n);
        if widest_gap > n / 20 {
            return None;
        }
        let mut out = vec![[0.0f32; 2]; n];
        for (k, &a) in filled.iter().enumerate() {
            let b = filled[(k + 1) % filled.len()];
            let span = (b + n - a) % n;
            let (pa, pb) = (bins[a].unwrap(), bins[b].unwrap());
            for step in 0..span.max(1) {
                let t = step as f32 / span.max(1) as f32;
                out[(a + step) % n] = [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t];
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
    fn standing_still_is_not_a_track() {
        let mut r = MapRecorder::default();
        for i in 0..400 {
            r.record(i as f32 / 400.0, [10.0, 10.0]);
        }
        assert!(r.finish().is_none());
    }

    #[test]
    fn a_long_track_gets_more_points_and_the_recorder_keeps_up() {
        assert_eq!(points_for_length(None), MAP_POINTS);
        assert_eq!(points_for_length(Some(4909)), 490, "Imola: one point every 10 m");
        assert_eq!(points_for_length(Some(1500)), MAP_POINTS, "a very short track keeps at least the old 400");
        assert_eq!(points_for_length(Some(20_832)), 2083, "the Nordschleife: one point every 10 m");
        assert_eq!(points_for_length(Some(60_000)), MAX_MAP_POINTS);

        let mut r = MapRecorder::default();
        r.fit(points_for_length(Some(20_832)));
        // 20 samples a second at about 70 m/s: one every 3.5 m, so every 10 m bin is hit.
        let samples = 6000;
        for i in 0..samples {
            let p = i as f32 / samples as f32;
            r.record(p, circle(p));
        }
        let map = r.finish().expect("map");
        assert_eq!(map.len(), 2083);
        // The recorder is reusable for the next lap at the same resolution.
        for i in 0..samples {
            let p = i as f32 / samples as f32;
            r.record(p, circle(p));
        }
        assert_eq!(r.finish().expect("second lap").len(), 2083);
    }

    #[test]
    fn only_a_clearly_coarser_stored_map_is_replaced() {
        assert!(worth_replacing(400, 2083), "the old Nordschleife map");
        assert!(!worth_replacing(2083, 2083));
        assert!(!worth_replacing(400, 400));
        assert!(!worth_replacing(2000, 2083), "close enough");
        assert!(!worth_replacing(2083, 400), "never go back to fewer");
    }
}
