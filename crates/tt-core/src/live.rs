//! Live timing: delta to a reference lap and per-sector status, from the stream of
//! (progress, elapsed) updates a game adapter publishes. Pure logic, no I/O.

use crate::model::DriverId;
use serde::{Deserialize, Serialize};
use tt_games::timing::TimingProfile;

/// Timing-screen colours: purple = fastest anyone has done, green = the driver's best,
/// yellow = slower than their best.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SectorStatus {
    Purple,
    Green,
    Yellow,
    /// The sector the car is in now.
    Current,
    /// Not reached yet (or not timed this lap).
    Pending,
}

/// Status of a finished sector time against the bests (which exclude this time).
pub fn sector_status(time_ms: u32, best_overall: Option<u32>, best_driver: Option<u32>) -> SectorStatus {
    if best_overall.is_none_or(|b| time_ms < b) {
        SectorStatus::Purple
    } else if best_driver.is_none_or(|b| time_ms < b) {
        SectorStatus::Green
    } else {
        SectorStatus::Yellow
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSector {
    pub time_ms: Option<u32>,
    /// Sector time minus the reference lap's time for the same sector (negative = faster).
    pub delta_ms: Option<i32>,
    pub status: SectorStatus,
}

/// How far ahead or behind one reference lap the car is, so the widget can switch between references
/// without asking again.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefDelta {
    /// "pb" (the driver's best) or "best" (the fastest lap anyone has set here).
    pub kind: String,
    /// What to call it: "PB", "Best", or the lap's time when it is not the fastest.
    pub label: String,
    pub delta_ms: Option<i32>,
}

/// Where one other driver's best lap has got to at the point the car is at: the time on their clock when they were
/// there. Lined up with the current lap's own clock it says who would be ahead right now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldGhost {
    pub driver_id: DriverId,
    pub ghost_ms: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveTimingView {
    /// Every other driver's best lap, at this point of the lap (empty when nobody else has a lap with a profile).
    /// Everything is level at the line and spreads out from there.
    pub field: Vec<FieldGhost>,
    /// Current time minus the reference lap's time at the same point (negative = faster).
    pub delta_ms: Option<i32>,
    /// What the delta is against: "PB" (the driver's best) or "Best" (anyone's).
    pub reference: Option<String>,
    /// Every reference there is, the one above first: the driver's best, then the fastest lap by anyone when it is
    /// a different lap. The widget chooses which to show.
    pub references: Vec<RefDelta>,
    /// 0-based index of the sector the car is in.
    pub current_sector: usize,
    pub sectors: Vec<LiveSector>,
}

/// What the live timing compares against, refreshed when the session, the seat or the
/// laps change.
#[derive(Debug, Clone, Default)]
pub struct TimingContext {
    /// Sector boundaries as fractions of the lap, `[0.0, ..., 1.0]`.
    pub boundaries: Vec<f32>,
    pub reference: Option<(TimingProfile, String)>,
    /// Further references (the fastest lap by anyone, when the driver's own best is not it).
    pub others: Vec<(TimingProfile, String)>,
    pub best_overall: Vec<Option<u32>>,
    pub best_driver: Vec<Option<u32>>,
    /// Each other driver's best lap on this track and car, to race the current lap against.
    pub field: Vec<(DriverId, TimingProfile)>,
}

#[derive(Debug, Default)]
pub struct LiveTiming {
    ctx: TimingContext,
    last: Option<(f32, u32)>,
    /// Elapsed ms at each sector boundary crossed this lap (index 0 = the line, 0 ms).
    crossings: Vec<Option<u32>>,
}

impl LiveTiming {
    pub fn configure(&mut self, ctx: TimingContext) {
        self.ctx = ctx;
        self.reset_lap();
    }

    /// Stop timing until the car next starts a lap at the line (e.g. on an out lap).
    pub fn pause(&mut self) {
        self.reset_lap();
    }

    fn reset_lap(&mut self) {
        self.last = None;
        self.crossings = vec![None; self.ctx.boundaries.len()];
        if let Some(first) = self.crossings.first_mut() {
            *first = Some(0);
        }
    }

    fn sector_count(&self) -> usize {
        self.ctx.boundaries.len().saturating_sub(1)
    }

    pub fn update(&mut self, progress: f32, elapsed_ms: u32) -> Option<LiveTimingView> {
        let sectors = self.sector_count();
        if sectors == 0 || !progress.is_finite() {
            return None;
        }
        let progress = progress.clamp(0.0, 1.0);

        // A new lap: the clock went back, or the car jumped back to near the line.
        if let Some((lp, lt)) = self.last
            && (elapsed_ms + 500 < lt || progress + 0.5 < lp)
        {
            self.reset_lap();
        }
        // Joining mid-lap: we can't time sectors we didn't see start.
        if self.last.is_none() && progress > 0.1 {
            self.crossings.iter_mut().for_each(|c| *c = None);
        }

        // Interpolate the time each boundary between the last sample and this one was crossed.
        if let Some((lp, lt)) = self.last
            && progress > lp
        {
            for (i, &b) in self.ctx.boundaries.iter().enumerate().skip(1) {
                if lp < b && b <= progress && self.crossings[i].is_none() && self.crossings[i - 1].is_some() {
                    let frac = (b - lp) / (progress - lp);
                    self.crossings[i] = Some(lt + ((elapsed_ms - lt) as f32 * frac).round() as u32);
                }
            }
        }
        self.last = Some((progress, elapsed_ms));

        let ref_sectors = self.ctx.reference.as_ref().map(|(prof, _)| prof.split(&self.ctx.boundaries));
        let current = self.ctx.boundaries.iter().skip(1).position(|&b| progress < b).unwrap_or(sectors - 1);
        let views = (0..sectors)
            .map(|i| match (self.crossings[i], self.crossings[i + 1]) {
                (Some(a), Some(b)) if i < current => {
                    let t = b.saturating_sub(a);
                    let best = |v: &Vec<Option<u32>>| v.get(i).copied().flatten();
                    let delta_ms = ref_sectors.as_ref().and_then(|r| r.get(i)).map(|&r| t as i32 - r as i32);
                    LiveSector { time_ms: Some(t), delta_ms, status: sector_status(t, best(&self.ctx.best_overall), best(&self.ctx.best_driver)) }
                }
                _ if i == current => LiveSector { time_ms: None, delta_ms: None, status: SectorStatus::Current },
                _ => LiveSector { time_ms: None, delta_ms: None, status: SectorStatus::Pending },
            })
            .collect();

        let delta_ms = self
            .ctx
            .reference
            .as_ref()
            .filter(|_| progress > 0.005)
            .map(|(prof, _)| (elapsed_ms as f32 - prof.at(progress)).round() as i32);

        let against = |prof: &TimingProfile| (progress > 0.005).then(|| (elapsed_ms as f32 - prof.at(progress)).round() as i32);
        let mut references = Vec::new();
        if let Some((prof, label)) = &self.ctx.reference {
            references.push(RefDelta { kind: if label == "PB" { "pb" } else { "best" }.into(), label: label.clone(), delta_ms: against(prof) });
        }
        for (prof, label) in &self.ctx.others {
            references.push(RefDelta { kind: "best".into(), label: label.clone(), delta_ms: against(prof) });
        }

        let field = self
            .ctx
            .field
            .iter()
            .map(|(driver_id, prof)| FieldGhost { driver_id: *driver_id, ghost_ms: prof.at(progress).round().max(0.0) as u32 })
            .collect();

        Some(LiveTimingView {
            field,
            references,
            delta_ms,
            reference: self.ctx.reference.as_ref().map(|(_, label)| label.to_string()),
            current_sector: current,
            sectors: views,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tt_games::timing::{PROFILE_POINTS, TimingProfile};

    /// A 90 s reference lap at constant speed.
    fn reference() -> TimingProfile {
        TimingProfile((0..PROFILE_POINTS).map(|i| (i as u32) * 450).collect())
    }

    fn ctx() -> TimingContext {
        TimingContext {
            boundaries: vec![0.0, 1.0 / 3.0, 2.0 / 3.0, 1.0],
            reference: Some((reference(), "PB".to_string())),
            others: vec![],
            best_overall: vec![Some(29_000), Some(30_000), Some(30_000)],
            best_driver: vec![Some(30_500), Some(30_500), Some(30_500)],
            field: vec![],
        }
    }

    #[test]
    fn the_field_is_level_at_the_line_and_spreads_out_from_there() {
        // Two other drivers: one on a 90 s lap, one 3 s quicker over the same line.
        let slower = TimingProfile((0..PROFILE_POINTS).map(|i| (i as u32) * 450).collect());
        let quicker = TimingProfile((0..PROFILE_POINTS).map(|i| (i as u32) * 435).collect());
        let mut lt = LiveTiming::default();
        lt.configure(TimingContext { field: vec![(7, slower), (8, quicker)], ..ctx() });
        let v = lt.update(0.0, 0).unwrap();
        assert!(v.field.iter().all(|g| g.ghost_ms == 0), "everyone starts level at the line");
        let v = lt.update(0.5, 44_000).unwrap();
        assert_eq!(v.field, vec![FieldGhost { driver_id: 7, ghost_ms: 45_000 }, FieldGhost { driver_id: 8, ghost_ms: 43_500 }]);
        // A new lap: the clock goes back and the field is level again.
        lt.update(0.99, 89_000);
        let v = lt.update(0.0, 0).unwrap();
        assert!(v.field.iter().all(|g| g.ghost_ms == 0));
    }

    #[test]
    fn delta_and_sector_colours() {
        let mut lt = LiveTiming::default();
        lt.configure(ctx());
        lt.update(0.0, 0);
        // A bit faster than the reference through S1 (30 s → 29.5 s).
        let v = lt.update(0.30, 26_550).unwrap();
        assert_eq!(v.current_sector, 0);
        assert_eq!(v.delta_ms, Some(-450));
        let v = lt.update(0.36, 31_860).unwrap();
        assert_eq!(v.current_sector, 1);
        // S1 crossed at ~29.5 s: beats the driver's 30.5 but not the overall 29.0 → green.
        assert_eq!(v.sectors[0].status, SectorStatus::Green);
        assert!((29_400..29_600).contains(&v.sectors[0].time_ms.unwrap()));
        // Reference S1 is 30.0 s.
        assert!((-600..-400).contains(&v.sectors[0].delta_ms.unwrap()));
        assert_eq!(v.sectors[1].status, SectorStatus::Current);
        assert_eq!(v.sectors[2].status, SectorStatus::Pending);
    }

    #[test]
    fn every_reference_gets_its_own_delta() {
        // The driver's best is 90 s; the fastest lap anyone has set is 3 s quicker over the same line.
        let quicker = TimingProfile((0..PROFILE_POINTS).map(|i| (i as u32) * 435).collect());
        let mut lt = LiveTiming::default();
        lt.configure(TimingContext { others: vec![(quicker, "Best".to_string())], ..ctx() });
        lt.update(0.0, 0);
        let v = lt.update(0.5, 44_000).unwrap();
        assert_eq!(v.references.iter().map(|r| r.kind.as_str()).collect::<Vec<_>>(), ["pb", "best"]);
        assert_eq!(v.references[0].delta_ms, v.delta_ms, "the first reference is the one the plain delta is against");
        assert_eq!(v.references[0].delta_ms, Some(-1_000));
        assert_eq!(v.references[1].delta_ms, Some(-1_000 + 1_500), "against a lap that is 1.5 s further ahead by halfway");
        assert_eq!(v.references[1].label, "Best");
    }

    #[test]
    fn new_lap_resets_and_mid_lap_join_is_untimed() {
        let mut lt = LiveTiming::default();
        lt.configure(ctx());
        // Joined at 50%: S2 can't be timed.
        lt.update(0.5, 45_000);
        let v = lt.update(0.7, 63_000).unwrap();
        assert_eq!(v.sectors[1].status, SectorStatus::Pending);
        // Crossing the line starts a fresh lap that is timed.
        lt.update(0.99, 89_000);
        lt.update(0.0, 0);
        lt.update(0.30, 27_000);
        let v = lt.update(0.40, 36_000).unwrap();
        assert_eq!(v.sectors[0].time_ms, Some(30_000));
        // 30.0 s: slower than overall (30.0 is not < 29.0) and beats driver 30.5 → green.
        assert_eq!(v.sectors[0].status, SectorStatus::Green);
    }

    #[test]
    fn first_ever_sector_is_purple() {
        assert_eq!(sector_status(40_000, None, None), SectorStatus::Purple);
        assert_eq!(sector_status(40_000, Some(39_000), None), SectorStatus::Green);
        assert_eq!(sector_status(40_000, Some(39_000), Some(39_500)), SectorStatus::Yellow);
    }
}
