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
    pub fn reset(&mut self) {
        self.bins.iter_mut().for_each(|b| *b = None);
    }

    pub fn record(&mut self, progress: f32, position: [f32; 2]) {
        if (0.0..1.0).contains(&progress) {
            self.bins[(progress * MAP_POINTS as f32) as usize] = Some(position);
        }
    }

    /// The finished outline, if the lap was sampled well enough (at least 90% of bins and no
    /// long blind stretch). Gaps are filled by straight lines. The recorder is reset.
    pub fn finish(&mut self) -> Option<Vec<[f32; 2]>> {
        let bins = std::mem::replace(&mut self.bins, vec![None; MAP_POINTS]);
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
    fn standing_still_is_not_a_track() {
        let mut r = MapRecorder::default();
        for i in 0..400 {
            r.record(i as f32 / 400.0, [10.0, 10.0]);
        }
        assert!(r.finish().is_none());
    }
}
