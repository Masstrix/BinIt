//! Types shared with the UI. Serialized as camelCase JSON.

use serde::{Deserialize, Serialize};

pub type DriverId = i64;
pub type LapId = i64;
pub type ChallengeId = i64;
/// Milliseconds since the Unix epoch.
pub type Timestamp = i64;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Driver {
    pub id: DriverId,
    pub name: String,
    /// Helmet colour, `#RRGGBB`.
    pub color: String,
    pub created_at: Timestamp,
}

/// Game, track, layout and car: what a lap time is comparable against.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Combo {
    pub game: String,
    pub track: String,
    /// Empty string for the default layout.
    pub layout: String,
    pub car: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lap {
    pub id: LapId,
    /// `None` when nobody was in the seat. Such laps can be claimed later.
    pub driver_id: Option<DriverId>,
    #[serde(flatten)]
    pub combo: Combo,
    pub session_kind: String,
    pub lap_number: u32,
    pub time_ms: u32,
    pub valid: bool,
    /// Why it isn't a timed lap: "cut", "outLap", "inLap" or "partial". `None` for timed laps
    /// (and for cut laps recorded before reasons existed).
    pub untimed_reason: Option<String>,
    pub sectors_ms: Vec<u32>,
    pub recorded_at: Timestamp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Prize {
    /// "1st", "2nd", "Last", ...
    pub place: String,
    pub prize: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Challenge {
    pub id: ChallengeId,
    pub name: String,
    pub game: String,
    pub track: String,
    pub layout: String,
    /// `None` means any car.
    pub car: Option<String>,
    pub starts_at: Timestamp,
    pub ends_at: Option<Timestamp>,
    pub valid_only: bool,
    /// Only a driver's first N laps count.
    pub max_laps: Option<u32>,
    pub prizes: Vec<Prize>,
    pub created_at: Timestamp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewChallenge {
    pub name: String,
    pub game: String,
    pub track: String,
    #[serde(default)]
    pub layout: String,
    pub car: Option<String>,
    pub starts_at: Option<Timestamp>,
    pub ends_at: Option<Timestamp>,
    #[serde(default = "default_true")]
    pub valid_only: bool,
    pub max_laps: Option<u32>,
    #[serde(default)]
    pub prizes: Vec<Prize>,
}

fn default_true() -> bool {
    true
}

/// Which laps a leaderboard ranks.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaderboardQuery {
    pub game: String,
    pub track: String,
    #[serde(default)]
    pub layout: String,
    /// `None` = any car.
    pub car: Option<String>,
    pub from: Option<Timestamp>,
    pub to: Option<Timestamp>,
    #[serde(default)]
    pub include_invalid: bool,
    /// Only each driver's first N laps in the window count.
    pub max_laps: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaderboardEntry {
    pub position: u32,
    /// `None` for unclaimed guest laps (each guest lap is its own entry).
    pub driver_id: Option<DriverId>,
    pub lap_id: LapId,
    pub time_ms: u32,
    pub gap_ms: u32,
    pub car: String,
    pub lap_count: u32,
    pub set_at: Timestamp,
    /// Sector times of that best lap (empty if unknown).
    pub sectors_ms: Vec<u32>,
    /// The driver's best time in each sector over all their valid laps on this board.
    pub best_sectors_ms: Vec<Option<u32>>,
}

/// A name recorded in this install for a stage or car a game doesn't name (see associations.rs).
#[derive(Debug, Clone, PartialEq)]
pub struct StoredAssociation {
    pub kind: String,
    pub id: String,
    pub name: String,
    /// What it was recorded from, as JSON.
    pub detail: String,
    pub has_image: bool,
}

/// A time penalty to pin on a map: where the car was when the game added it, and how much it added.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PenaltyPin {
    /// The stage clock just before it landed, ms.
    pub at_ms: u32,
    /// How much time it added, ms.
    pub added_ms: u32,
    /// How far along the stage the car was, 0..1.
    pub progress: f32,
    /// World position (x, z) in the same space as the track map; `None` if the game didn't report one.
    pub position: Option<[f32; 2]>,
}

impl From<&tt_games::Penalty> for PenaltyPin {
    fn from(p: &tt_games::Penalty) -> Self {
        Self { at_ms: p.at_ms, added_ms: p.added_ms, progress: p.progress, position: p.position }
    }
}

/// One driver's best lap in a challenge, with enough to replay it against the others.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayEntry {
    pub position: u32,
    pub driver_id: Option<DriverId>,
    pub lap_id: LapId,
    pub time_ms: u32,
    /// Elapsed ms at each 0.5% of the lap; `None` for laps recorded before timing traces existed.
    pub profile: Option<Vec<u32>>,
    /// Time penalties taken in that run, for pinning on the map.
    #[serde(default)]
    pub penalties: Vec<PenaltyPin>,
}

/// Everything the overlay and home screen need about the person driving.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LapResult {
    pub lap: Lap,
    pub personal_best: bool,
    /// Fastest valid lap anyone has set on this combo.
    pub combo_record: bool,
    /// Purple / green / yellow for each of the lap's sectors (empty when untimed).
    pub sector_status: Vec<crate::live::SectorStatus>,
    pub challenges: Vec<ChallengeStanding>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChallengeStanding {
    pub challenge_id: ChallengeId,
    pub challenge_name: String,
    pub position: Option<u32>,
    pub previous_position: Option<u32>,
    /// Gap to P1 in ms (0 when leading).
    pub gap_to_leader_ms: Option<u32>,
}

/// What [`crate::BinIt::merge_from`] added from another database.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeReport {
    pub drivers: usize,
    pub laps: usize,
    pub challenges: usize,
}

/// What's in the database, for the About page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AboutCounts {
    pub drivers: u32,
    pub laps: u32,
    /// Laps that count (valid, not out/in/partial/driver-change).
    pub timed_laps: u32,
    /// Laps that have a saved input trace.
    pub traced_laps: u32,
    pub challenges: u32,
    pub schema_version: i32,
    /// The Bin It version that first created this database.
    pub created_with: Option<String>,
    /// The version that had this database open before this run (`None` the first time).
    pub previous_version: Option<String>,
}

/// How quick a driver is compared with the others, from the track and car combinations they share.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverRating {
    pub driver_id: DriverId,
    /// 100 minus the average percentage gap to the fastest driver on each shared track and car
    /// (so 100 = quickest everywhere). `None` until they share at least one combination with someone.
    pub score: Option<f64>,
    /// How many track + car combinations the score is based on.
    pub combos: u32,
    /// How many of those they hold the fastest time on.
    pub fastest_on: u32,
}

/// Which laps a cleanup touches: everything on a track, optionally narrowed to one layout and/or car.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LapFilter {
    pub game: String,
    pub track: String,
    /// `None` = every layout of the track.
    #[serde(default)]
    pub layout: Option<String>,
    /// `None` = every car.
    #[serde(default)]
    pub car: Option<String>,
    /// Also forget the learned map and sector layout (only when the whole track or that layout goes).
    #[serde(default)]
    pub forget_map: bool,
}
