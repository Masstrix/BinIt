//! Types shared with the UI. Serialized as camelCase JSON.

use serde::{Deserialize, Serialize};

pub type DriverId = i64;
pub type LapId = i64;
pub type ChallengeId = i64;
/// Milliseconds since the Unix epoch.
pub type Timestamp = i64;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: i64,
    pub driver_id: DriverId,
    /// What the phone calls itself, e.g. "iPhone" or "Android phone".
    pub label: String,
    pub created_at: Timestamp,
    pub last_seen: Timestamp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Driver {
    pub id: DriverId,
    pub name: String,
    /// Helmet colour, `#RRGGBB`.
    pub color: String,
    /// What the driver has equipped in the Garage (empty: the plain helmet in `color`).
    #[serde(default)]
    pub look: Look,
    pub created_at: Timestamp,
}

/// A helmet look: which shop items are equipped. Ids are those of `shop::CATALOGUE`; the app draws them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Look {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shell: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decal: Option<String>,
    /// `side`, `top` or `chin`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decal_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stripe: Option<String>,
    /// Race number, 1 to 99.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number: Option<u8>,
    /// The default eyes, shown when the driver is idle (`shop::FACE`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub face: Option<String>,
}

/// What the shop shows one driver: their balance, what they own and wear, and every item's price.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShopState {
    pub coins: i64,
    pub level: u32,
    /// Keys (`shell:aurora`) of items bought; free items are not listed, everyone has them.
    pub owned: Vec<String>,
    pub look: Look,
    pub items: Vec<ShopItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShopItem {
    pub id: String,
    pub slot: String,
    pub price: i64,
    pub min_level: u32,
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

/// One driver's best lap in a challenge, with enough to replay it against the others.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayEntry {
    pub position: u32,
    pub driver_id: Option<DriverId>,
    pub lap_id: LapId,
    pub time_ms: u32,
    /// Elapsed ms at each 0.5% of the lap; `None` for laps recorded before timing traces existed.
    pub profile: Option<Vec<u32>>,
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
    /// XP and coins this lap earned (nothing for guest laps and laps that did not count).
    #[serde(default)]
    pub awards: Awards,
}

/// What a lap earned the driver, and why, for the pop-up.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Awards {
    pub xp: i64,
    pub coins: i64,
    /// The new level, when this lap crossed a level.
    pub level_up: Option<u32>,
    /// Short reasons in order, e.g. "Clean lap", "Personal best".
    pub reasons: Vec<String>,
}

/// One row of the XP and coin ledger.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointEvent {
    pub id: i64,
    pub driver_id: DriverId,
    /// "lap", "first", "pb" or "record".
    pub kind: String,
    pub xp: i64,
    pub coins: i64,
    /// The lap that earned it.
    pub lap_id: Option<LapId>,
    pub at: Timestamp,
}

/// A driver's best on one track and car, and where it ranks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileBest {
    #[serde(flatten)]
    pub combo: Combo,
    pub time_ms: u32,
    pub position: u32,
    /// How many drivers have a valid lap on it.
    pub of: u32,
}

/// A badge worked out from the driver's laps (never stored).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sticker {
    pub id: String,
    pub name: String,
    pub hint: String,
    pub earned: bool,
}

/// Everything the You page shows.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub driver: Driver,
    pub level: u32,
    pub title: String,
    pub next_title: String,
    pub xp: i64,
    /// Total XP at which this level began, and the next one begins.
    pub level_start_xp: i64,
    pub next_level_xp: i64,
    pub coins: i64,
    /// Laps that counted or were cut (out and in laps are not attempts).
    pub attempts: u32,
    pub clean_laps: u32,
    pub clean_percent: u32,
    pub tracks: u32,
    /// Days in a row, up to today, with at least one clean lap.
    pub streak_days: u32,
    pub bests: Vec<ProfileBest>,
    pub stickers: Vec<Sticker>,
    pub recent: Vec<PointEvent>,
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
