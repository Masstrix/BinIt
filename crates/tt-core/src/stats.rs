//! A driver's driving stats: how far, how long, how sideways and where they stand. Worked out from their laps and the
//! slide stats each lap kept; nothing here is stored except each lap's distance (`laps.distance_m`).

use std::collections::HashSet;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tt_games::timing::LapTrace;

use crate::store::Store;
use crate::{DriverId, Timestamp};

/// Everything the stats page shows for one driver.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverStats {
    /// Metres driven over laps that have a distance.
    pub distance_m: u64,
    /// How many laps have a distance, out of how many count: laps from before distance was measured that have no
    /// trace to work it out from are missing, so the total can be short.
    pub laps_with_distance: u32,
    pub laps_counted: u32,
    pub timed_laps: u32,
    pub clean_percent: u32,
    /// Time on track over timed and cut laps, milliseconds.
    pub time_on_track_ms: u64,
    pub tracks: u32,
    pub cars: u32,
    pub longest_streak_days: u32,
    /// Metres drifted, over laps recorded since that was measured.
    pub drift_m: f64,
    pub drift_since: Option<Timestamp>,
    pub longest_drift_ms: u64,
    pub drifts: u32,
    pub spins: u32,
    pub handbrake_drifts: u32,
    pub peak_slip_deg: f32,
    pub records_held: u32,
    pub challenges_entered: u32,
    pub podiums: u32,
    pub wins: u32,
}

/// How far a lap went, from the car's positions in its trace. A jump of over 200 m between samples is a reset or a
/// teleport, not driving. `None` when most samples have no position.
pub fn trace_distance_m(trace: &LapTrace) -> Option<u32> {
    let pts: Vec<[f32; 2]> = trace.0.iter().filter_map(|p| p.position).collect();
    if pts.len() < 20 || pts.len() * 2 < trace.0.len() {
        return None;
    }
    let metres: f32 = pts.windows(2).map(|w| ((w[1][0] - w[0][0]).powi(2) + (w[1][1] - w[0][1]).powi(2)).sqrt()).filter(|d| *d < 200.0).sum();
    (metres >= 50.0).then_some(metres.round() as u32)
}

/// A lap's top speed from its trace, km/h. A single sample far above its neighbours is a glitch (a reset, a teleport),
/// so the top is the fastest speed held across two samples in a row. `None` for a trace too short to say.
pub fn trace_top_kmh(trace: &LapTrace) -> Option<f32> {
    if trace.0.len() < 20 {
        return None;
    }
    let top = trace.0.windows(2).map(|w| w[0].speed_kmh.min(w[1].speed_kmh)).filter(|v| v.is_finite() && *v < 600.0).fold(0.0f32, f32::max);
    (top >= 1.0).then_some((top * 10.0).round() / 10.0)
}

/// One lap, as the driver breakdown page needs it: how it went, how far, how fast and how sideways.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LapSummary {
    pub id: crate::LapId,
    pub game: String,
    pub track: String,
    pub layout: String,
    pub car: String,
    pub time_ms: u32,
    pub valid: bool,
    pub untimed_reason: Option<String>,
    pub recorded_at: Timestamp,
    /// Metres, when the lap has a distance.
    pub distance_m: Option<u32>,
    /// km/h, when the lap has a trace.
    pub top_kmh: Option<f32>,
    /// Slide stats, when the game reports physics: `None` means unknown, not zero.
    pub spins: Option<u32>,
    pub drifts: Option<u32>,
    pub drift_ms: Option<u64>,
    pub peak_slip_deg: Option<f32>,
}

/// Every lap a driver has driven, oldest first, with what the breakdown page charts. Out and in laps are included
/// (the page leaves them out of lap counts but they still add time and distance where recorded).
pub fn driver_breakdown(store: &Store, driver: DriverId) -> Result<Vec<LapSummary>> {
    // Slide stats are only stored for laps with a drift or spin; laps from a game that reports physics, recorded
    // since slides were measured, with nothing stored, had none.
    let rows = store.driver_lap_extras(driver)?;
    let physics_since = rows.iter().filter(|r| r.3.is_some()).map(|r| r.0.recorded_at).min();
    let physics_games: HashSet<String> = rows.iter().filter(|r| r.3.is_some()).map(|r| r.0.combo.game.clone()).collect();
    Ok(rows
        .into_iter()
        .map(|(lap, distance_m, top_kmh, slides)| {
            let st = slides.as_deref().and_then(|j| serde_json::from_str::<crate::LiveSlideStats>(j).ok());
            let measured = st.is_some() || (physics_games.contains(&lap.combo.game) && physics_since.is_some_and(|t| lap.recorded_at >= t));
            let st = st.unwrap_or_default();
            LapSummary {
                id: lap.id,
                game: lap.combo.game,
                track: lap.combo.track,
                layout: lap.combo.layout,
                car: lap.combo.car,
                time_ms: lap.time_ms,
                valid: lap.valid,
                untimed_reason: lap.untimed_reason,
                recorded_at: lap.recorded_at,
                distance_m,
                top_kmh,
                spins: measured.then_some(st.spins),
                drifts: measured.then_some(st.drifts),
                drift_ms: measured.then_some(st.drift_ms),
                peak_slip_deg: measured.then_some(st.peak_slip_deg),
            }
        })
        .collect())
}

/// One driver's laps for the all-drivers overview.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverLaps {
    pub driver_id: DriverId,
    pub laps: Vec<LapSummary>,
}

/// Every driver who has a lap, with all their laps: the page that compares everyone.
pub fn all_breakdowns(store: &Store) -> Result<Vec<DriverLaps>> {
    let mut out = Vec::new();
    for d in store.drivers()? {
        let laps = driver_breakdown(store, d.id)?;
        if !laps.is_empty() {
            out.push(DriverLaps { driver_id: d.id, laps });
        }
    }
    Ok(out)
}

/// The longest run of days in a row with a timed lap, by UTC day.
fn longest_streak(times: impl Iterator<Item = Timestamp>) -> u32 {
    let mut days: Vec<i64> = times.map(|t| t.div_euclid(crate::progress::DAY_MS)).collect();
    days.sort_unstable();
    days.dedup();
    let (mut best, mut run, mut prev) = (0u32, 0u32, None::<i64>);
    for d in days {
        run = if prev.is_some_and(|p| d - p == 1) { run + 1 } else { 1 };
        best = best.max(run);
        prev = Some(d);
    }
    best
}

pub fn driver_stats(store: &Store, driver: DriverId, now: Timestamp) -> Result<DriverStats> {
    let laps = store.driver_laps(driver)?;
    let timed: Vec<&crate::Lap> = laps.iter().filter(|l| l.valid).collect();
    let attempts = laps.iter().filter(|l| l.valid || matches!(l.untimed_reason.as_deref(), None | Some("cut"))).count() as u32;
    let (distance_m, laps_with_distance, laps_counted, time_on_track_ms) = store.driver_distance_totals(driver)?;

    let mut drift_m = 0.0f64;
    let (mut longest, mut drifts, mut spins, mut handbrake, mut peak) = (0u64, 0u32, 0u32, 0u32, 0.0f32);
    let mut drift_since: Option<Timestamp> = None;
    for lap in &laps {
        let Some(json) = store.lap_slides(lap.id)? else { continue };
        let Ok(st) = serde_json::from_str::<crate::LiveSlideStats>(&json) else { continue };
        if st.drift_m > 0.0 {
            drift_since = Some(drift_since.map_or(lap.recorded_at, |t| t.min(lap.recorded_at)));
        }
        drift_m += f64::from(st.drift_m);
        longest = longest.max(st.longest_ms);
        drifts += st.drifts;
        spins += st.spins;
        handbrake += st.handbrake_drifts;
        peak = peak.max(st.peak_slip_deg);
    }

    let results = store.driver_challenge_results(driver)?;
    Ok(DriverStats {
        distance_m,
        laps_with_distance,
        laps_counted,
        timed_laps: timed.len() as u32,
        clean_percent: if attempts == 0 { 100 } else { (f64::from(timed.len() as u32) * 100.0 / f64::from(attempts)).round() as u32 },
        time_on_track_ms,
        tracks: timed.iter().map(|l| (&l.combo.game, &l.combo.track, &l.combo.layout)).collect::<HashSet<_>>().len() as u32,
        cars: timed.iter().map(|l| (&l.combo.game, &l.combo.car)).collect::<HashSet<_>>().len() as u32,
        longest_streak_days: longest_streak(timed.iter().map(|l| l.recorded_at)),
        drift_m,
        drift_since,
        longest_drift_ms: longest,
        drifts,
        spins,
        handbrake_drifts: handbrake,
        peak_slip_deg: peak,
        records_held: crate::stickers::records_held(store, driver, &laps, now)?,
        challenges_entered: results.len() as u32,
        podiums: results.iter().filter(|(position, entrants)| *entrants >= 3 && *position <= 3).count() as u32,
        wins: results.iter().filter(|(position, entrants)| *entrants >= 3 && *position == 1).count() as u32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tt_games::timing::TracePoint;

    fn point(i: u32, x: f32) -> TracePoint {
        TracePoint {
            progress: i as f32 / 100.0, elapsed_ms: i * 100, speed_kmh: 100.0, throttle: 1.0, brake: 0.0, clutch: 0.0, steering: 0.0, gear: 3,
            position: Some([x, 0.0]), heading_deg: None, slip_deg: None, aids: None, boost: None,
        }
    }

    #[test]
    fn a_trace_is_measured_along_the_path_and_a_teleport_is_not_driving() {
        let straight = LapTrace((0..100).map(|i| point(i, i as f32 * 10.0)).collect());
        assert_eq!(trace_distance_m(&straight), Some(990));
        // A 5 km jump in the middle (a reset) is left out.
        let reset = LapTrace((0..100).map(|i| point(i, i as f32 * 10.0 + if i >= 50 { 5_000.0 } else { 0.0 })).collect());
        assert_eq!(trace_distance_m(&reset), Some(980));
        // No positions, or too few, is nothing rather than zero.
        let blind = LapTrace((0..100).map(|i| TracePoint { position: None, ..point(i, 0.0) }).collect());
        assert_eq!(trace_distance_m(&blind), None);
        assert_eq!(trace_distance_m(&LapTrace((0..5).map(|i| point(i, i as f32 * 10.0)).collect())), None);
    }

    #[test]
    fn top_speed_is_held_for_two_samples_so_a_glitch_is_not_it() {
        let mut pts: Vec<TracePoint> = (0..50).map(|i| TracePoint { speed_kmh: 100.0 + i as f32, ..point(i, 0.0) }).collect();
        pts[10].speed_kmh = 450.0;
        assert_eq!(trace_top_kmh(&LapTrace(pts)), Some(148.0));
        assert_eq!(trace_top_kmh(&LapTrace((0..5).map(|i| point(i, 0.0)).collect())), None);
    }

    #[test]
    fn the_longest_run_of_days_in_a_row() {
        let day = crate::progress::DAY_MS;
        assert_eq!(longest_streak([0, day, 2 * day, 4 * day, 5 * day].into_iter()), 3);
        assert_eq!(longest_streak(std::iter::empty()), 0);
        assert_eq!(longest_streak([10 * day, 10 * day + 5].into_iter()), 1);
    }
}
