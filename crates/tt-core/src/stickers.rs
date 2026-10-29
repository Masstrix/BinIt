//! Achievement stickers: things a driver earns by driving, each with a name, a rule, a rarity and a pay.
//!
//! What exists, and what each pays, is data: `crates/tt-core/stickers.json` (see `docs/stickers.md`). A sticker
//! pays its rarity's XP and coins from `rarityPay` unless it sets its own `xp` / `coins`. A sticker whose `rule` is
//! `null` is designed but cannot be detected yet (it needs telemetry or a time zone we do not track), so it shows in
//! the book as locked and never unlocks.
//!
//! Unlocks are stored (`driver_stickers`) and paid once through the points ledger (`sticker:<id>`), so a sticker is
//! never taken away and never pays twice. Everything is decided server side when a lap is recorded.

use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::progress::Pay;
use crate::store::Store;
use crate::{DriverId, Lap, Timestamp};

/// How a sticker is earned. Add a variant here (and in `measure`) to make a new kind of sticker possible; then any
/// number of stickers in `stickers.json` can use it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Rule {
    /// `n` timed laps in total (a timed lap is one that counts: not a cut, out or in lap).
    TimedLaps { n: u32 },
    /// `n` timed laps on one track (any car).
    TimedLapsOnOneTrack { n: u32 },
    /// Timed laps on `n` different tracks (a track and layout count once).
    TracksDriven { n: u32 },
    /// Timed laps in `n` different cars driven.
    CarsDriven { n: u32 },
    /// Timed laps in `n` different games played.
    GamesDriven { n: u32 },
    /// Laps on `n` days in a row, counting back from the latest.
    DaysInARow { n: u32 },
    /// The last `n` attempts (timed or cut) were all timed: no cuts.
    CleanLapsInARow { n: u32 },
    /// The last `n` timed laps on this track and car were all within `within_ms` of each other.
    SteadyLapsInARow { n: u32, within_ms: u32 },
    /// This lap beat the driver's own best on this track and car.
    ThisLapIsPersonalBest,
    /// This lap beat everyone else's best on this track and car.
    ThisLapIsTrackRecord,
    /// This lap counted in a running challenge.
    ThisLapInChallenge,
    /// This lap's time ends in these milliseconds (777 = x:xx.777).
    ThisLapTimeEndsIn { ms: u32 },
    /// This lap's time reads the same backwards (1:42.241).
    ThisLapTimeIsPalindrome,
    /// `n` timed laps on one of these tracks.
    TimedLapsOnTrack { n: u32, on: Vec<TrackRef> },
    /// This lap was quicker than `ms`, on one of these tracks (empty = any track), in a car that is allowed.
    /// `except_car_classes` rules cars out by class (open-wheel cars, say) so a car far quicker than the sticker is
    /// about cannot earn it. `only_car_classes`, when not empty, rules out every class not listed, including cars the
    /// catalogue has no class for. Classes are the catalogue's (`Road`, `GT3`, `Open wheel`, `Formula`, `LMP1`...).
    ThisLapFasterThan {
        ms: u32,
        on: Vec<TrackRef>,
        #[serde(default)]
        except_car_classes: Vec<String>,
        #[serde(default)]
        only_car_classes: Vec<String>,
    },
    /// This lap's time ends in these seconds and milliseconds, on one of these tracks (7:20.832 ends in 20 s 832 ms).
    ThisLapTimeEndsInSecondsAndMs { seconds: u32, ms: u32, on: Vec<TrackRef> },
    /// This lap's longest drift lasted `ms` or more (a drift is the game's: 12 degrees of slip or more at speed); with
    /// `no_spins` the lap must also have no spin. Needs a game that reports physics.
    ThisLapLongestDriftAtLeast {
        ms: u32,
        #[serde(default)]
        no_spins: bool,
    },
    /// Drifting added up to `percent` of this lap's time or more.
    ThisLapDriftTimeShareAtLeast { percent: u32 },
    /// This lap had `n` spins or more (90 degrees of slip or more).
    ThisLapSpinsAtLeast { n: u32 },
    /// This lap was `percent` slower than the driver's own best on that track and car, or more.
    ThisLapSlowerThanYourBestBy { percent: u32 },
    /// `n` timed laps on one track and car, all within `within_percent` of the driver's own best there.
    LapsWithinPercentOfYourBest { n: u32, within_percent: f32 },
    /// A sector in this lap was faster than every other driver's on that track and car (needs one other driver).
    ThisLapSectorFasterThanEveryoneElse,
    /// This lap was within `percent` of another driver's best on that track and car (needs one other driver).
    ThisLapWithinPercentOfAnotherDriversBest { percent: f32 },
    /// The driver holds the best time, with another driver on the board, on `n` different tracks (track and layout,
    /// any car).
    RecordsHeldOnDifferentTracks { n: u32 },
    /// This lap took the best time on a board with at least `min_drivers` drivers, while the driver's previous best
    /// was in the bottom half of it.
    ThisLapWinsFromBottomHalf { min_drivers: u32 },
    /// This lap was faster than another driver's best that had beaten the driver's previous best there.
    ThisLapPassesAnotherDriver,
    /// This lap was within `ms` of another driver's best, but not the same.
    ThisLapWithinOfAnotherDriversTime { ms: u32 },
    /// This lap was exactly another driver's best time on that track and car.
    ThisLapEqualsAnotherDriversTime,
    /// The driver has held the best time on a track and car for `days` days, with another driver on the board.
    RecordHeldForDays { days: u32 },
    /// This lap had no spin. A game that reports no physics counts as having none.
    ThisLapHasNoSpin,
    /// This lap was set between two local times of day on the rig's PC (`from` up to but not including `to`, as
    /// "12:00" and "14:00"; "24:00" is the end of the day), on one of `days` ("mon" to "sun"; empty = every day).
    /// The local time and daylight saving are the PC's at the moment the lap was recorded.
    ThisLapSetBetweenLocalTimes {
        from: String,
        to: String,
        #[serde(default)]
        days: Vec<String>,
    },
    /// This lap is a new personal best after at least `n` laps in a row on that track and car that did not beat the
    /// best before them.
    ThisLapIsPersonalBestAfterLapsWithoutOne { n: u32 },
    /// This is a cut lap, and it ends a run of `n` cut laps in a row on that track and car, each within `percent` of
    /// another driver's best there (needs one other driver).
    ThisCutLapEndsARunWithinPercentOfAnotherDriversBest { n: u32, percent: f32 },
    /// The driver has drifted `metres` in total across all their laps (laps recorded before distance was measured count
    /// for nothing).
    DriftDistanceInTotalAtLeast { metres: u32 },
    /// This lap had `n` drifts that began with the handbrake pulled.
    ThisLapHandbrakeDriftsAtLeast { n: u32 },
    /// This lap crossed the line with the car facing backwards: slip of `slip_deg` or more (heading minus direction of
    /// travel) at `min_speed_kmh` or more. Reads the lap's trace.
    ThisLapFinishesFacingBackwards { slip_deg: f32, min_speed_kmh: f32 },
    /// During this lap the car stopped (under `below_kmh`) pointing at least `degrees` away from the direction the
    /// track runs there, and the lap was still finished. The way the track runs is its learned map's.
    ThisLapStoppedFacingTheWrongWay { below_kmh: f32, degrees: f32 },
    /// A challenge ended and the driver finished in its top `places`, with at least `min_entrants` drivers.
    ChallengeFinishedInTopPlaces { places: u32, min_entrants: u32 },
    /// A challenge ended and the driver finished outside its top `places` (with at least `min_entrants` drivers).
    ChallengeFinishedOutsideTopPlaces { places: u32, min_entrants: u32 },
    /// The driver won their last `n` challenges in a row (only challenges with at least `min_entrants` drivers count).
    ChallengesWonInARow { n: u32, min_entrants: u32 },
    /// A challenge ended and the driver had at least `min_laps` timed laps in it and not one cut lap.
    ChallengeFinishedWithEveryLapClean { min_laps: u32 },
    /// Every other sticker in the book.
    AllOtherStickers,
}

/// A time of day as minutes since midnight: "08:30" is 510, "24:00" is 1440.
fn parse_clock(s: &str) -> Option<u32> {
    let (h, m) = s.split_once(':')?;
    let (h, m): (u32, u32) = (h.trim().parse().ok()?, m.trim().parse().ok()?);
    ((h < 24 && m < 60) || (h == 24 && m == 0)).then_some(h * 60 + m)
}

/// Monday is 0.
fn day_index(s: &str) -> Option<u32> {
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].iter().position(|d| s.trim().to_lowercase().starts_with(d)).map(|i| i as u32)
}

/// The rig's local minute of the day and weekday (Monday is 0) at a moment, daylight saving included.
fn local_clock(ms: Timestamp) -> Option<(u32, u32)> {
    use chrono::{Datelike, TimeZone, Timelike};
    let t = chrono::Local.timestamp_millis_opt(ms).single()?;
    Some((t.hour() * 60 + t.minute(), t.weekday().num_days_from_monday()))
}

/// A track, by the name the app stores laps under, and optionally one layout of it. Spelling, case and punctuation do
/// not matter (`Nurburgring`, `ks_nordschleife`). List every name a game uses for the same circuit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackRef {
    pub track: String,
    #[serde(default)]
    pub layout: Option<String>,
}

fn squash(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// The class of a car (`GT3`, `Open wheel`...) from the game's bundled catalogue, by its name or any alias.
fn car_class(game: &str, car: &str) -> Option<String> {
    static SEEDS: LazyLock<Mutex<HashMap<String, std::sync::Arc<crate::catalogue::Seed>>>> = LazyLock::new(Default::default);
    let seed = {
        let mut cache = SEEDS.lock().ok()?;
        cache.entry(game.to_string()).or_insert_with(|| std::sync::Arc::new(crate::catalogue::bundled(game))).clone()
    };
    let wanted = crate::catalogue::norm(car);
    seed.cars
        .iter()
        .find(|c| crate::catalogue::norm(&c.name) == wanted || c.aliases.iter().any(|a| crate::catalogue::norm(a) == wanted))
        .and_then(|c| c.class.clone())
}

/// Whether a lap's car may earn a sticker that rules some classes out (see `Rule::ThisLapFasterThan`).
fn car_allowed(lap: &Lap, only: &[String], except: &[String]) -> bool {
    if only.is_empty() && except.is_empty() {
        return true;
    }
    let class = car_class(&lap.combo.game, &lap.combo.car);
    let is = |list: &[String]| class.as_deref().is_some_and(|c| list.iter().any(|x| crate::catalogue::norm(x) == crate::catalogue::norm(c)));
    (only.is_empty() || is(only)) && !is(except)
}

/// Whether a lap was driven on one of these tracks (and layouts). An empty list matches every track.
fn on_track(lap: &Lap, on: &[TrackRef]) -> bool {
    on.is_empty()
        || on.iter().any(|t| squash(&t.track) == squash(&lap.combo.track) && t.layout.as_deref().is_none_or(|l| squash(l) == squash(&lap.combo.layout)))
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StickerDef {
    pub id: String,
    pub name: String,
    pub group: String,
    /// "common", "rare", "epic" or "legendary" (a key of `rarity_pay`).
    pub rarity: String,
    /// The rule in plain words, shown to the driver.
    pub how: String,
    /// Hidden stickers show only `hint` (and no name) until they are earned.
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub hint: Option<String>,
    /// A custom reward. Anything it leaves out comes from the rarity.
    #[serde(default)]
    pub reward: Option<Reward>,
    /// `None` = designed but not detectable yet.
    pub rule: Option<Rule>,
}

/// What one sticker gives beyond (or instead of) its rarity's pay.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reward {
    /// Replaces the rarity's XP.
    #[serde(default)]
    pub xp: Option<i64>,
    /// Replaces the rarity's coins.
    #[serde(default)]
    pub coins: Option<i64>,
    /// A shop item given free, as `slot:id` (`decal:crown`). The driver owns it and can wear it.
    #[serde(default)]
    pub item: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Group {
    pub id: String,
    pub name: String,
    pub blurb: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalogue {
    pub rarity_pay: HashMap<String, Pay>,
    pub groups: Vec<Group>,
    pub stickers: Vec<StickerDef>,
}

/// The most one sticker may pay, so a typo in the file cannot mint a level.
const MAX_PAY: i64 = 10_000;

impl Catalogue {
    pub fn from_json(text: &str) -> Result<Self, String> {
        let c: Self = serde_json::from_str(text).map_err(|e| e.to_string())?;
        let mut ids = HashSet::new();
        for s in &c.stickers {
            if !ids.insert(s.id.as_str()) {
                return Err(format!("sticker {} is listed twice", s.id));
            }
            if !c.rarity_pay.contains_key(&s.rarity) {
                return Err(format!("sticker {} has rarity {:?}, which has no pay in rarityPay", s.id, s.rarity));
            }
            if !c.groups.iter().any(|g| g.id == s.group) {
                return Err(format!("sticker {} is in group {:?}, which is not listed in groups", s.id, s.group));
            }
            if s.hidden && s.hint.is_none() {
                return Err(format!("hidden sticker {} needs a hint", s.id));
            }
            if let Some(Rule::ThisLapSetBetweenLocalTimes { from, to, days }) = &s.rule {
                if parse_clock(from).is_none() || parse_clock(to).is_none() {
                    return Err(format!("sticker {} needs times like \"12:00\", not {from:?} to {to:?}", s.id));
                }
                if let Some(bad) = days.iter().find(|d| day_index(d).is_none()) {
                    return Err(format!("sticker {} has day {bad:?}; use mon, tue, wed, thu, fri, sat or sun", s.id));
                }
            }
            if let Some(item) = s.reward.as_ref().and_then(|r| r.item.as_deref())
                && crate::shop::parse_key(item).is_none()
            {
                return Err(format!("sticker {} rewards {item:?}, which is not in the shop (slot:id, like decal:crown)", s.id));
            }
        }
        if c.stickers.iter().filter(|s| s.rule == Some(Rule::AllOtherStickers)).count() > 1 {
            return Err("only one sticker can be the Completionist".into());
        }
        Ok(c)
    }

    /// What a sticker pays: its own numbers, else its rarity's.
    pub fn pay(&self, s: &StickerDef) -> Pay {
        let base = self.rarity_pay.get(&s.rarity).copied().unwrap_or(Pay { xp: 0, coins: 0 });
        let r = s.reward.clone().unwrap_or_default();
        Pay { xp: r.xp.unwrap_or(base.xp).clamp(0, MAX_PAY), coins: r.coins.unwrap_or(base.coins).clamp(0, MAX_PAY) }
    }

    /// The free shop item a sticker gives, if any.
    pub fn item<'a>(&self, s: &'a StickerDef) -> Option<&'a str> {
        s.reward.as_ref().and_then(|r| r.item.as_deref())
    }
}

static CATALOGUE: LazyLock<Catalogue> =
    LazyLock::new(|| Catalogue::from_json(include_str!("../stickers.json")).expect("crates/tt-core/stickers.json is not valid"));

/// Every sticker, as it was in `crates/tt-core/stickers.json` when the app was built.
pub fn catalogue() -> &'static Catalogue {
    &CATALOGUE
}

/// What a lap tells us beyond the driver's history.
#[derive(Debug, Clone, Copy, Default)]
pub struct LapFlags {
    pub personal_best: bool,
    pub track_record: bool,
    pub in_challenge: bool,
    /// A sector was faster than any other driver's on this track and car.
    pub purple_sector: bool,
}

/// What the board looks like around a driver, for stickers that compare drivers.
#[derive(Debug, Clone, Default)]
struct Board {
    /// Other drivers' bests on this lap's track and car (empty when there is no lap).
    others: Vec<u32>,
    /// This driver's best there before this lap.
    prev_best: Option<u32>,
    /// Tracks (track and layout) where the driver holds the best, with another driver on the board.
    records_held: u32,
    /// How many days the longest-standing of those records has stood.
    longest_held_days: u32,
    /// Metres drifted across all this driver's laps.
    drift_m_total: f32,
}

fn board_for(store: &Store, driver: DriverId, lap: Option<&Lap>, laps: &[Lap], now: Timestamp) -> Result<Board> {
    let bests = store.profile_best_times()?;
    let mut board = Board::default();
    if let Some(lap) = lap {
        board.others = bests.iter().filter(|(c, d, _)| c == &lap.combo && *d != driver).map(|(_, _, t)| *t).collect();
        board.prev_best = store.best_valid_time(&lap.combo, Some(driver), lap.id)?;
    }
    // Where the driver is the outright best, and nobody else has matched it.
    let mut tracks: HashSet<(&str, &str, &str)> = HashSet::new();
    let mut combos: Vec<&crate::Combo> = Vec::new();
    for (combo, who, time) in bests.iter().filter(|(_, who, _)| *who == driver) {
        let rivals: Vec<u32> = bests.iter().filter(|(c, d, _)| c == combo && d != who).map(|(_, _, t)| *t).collect();
        if rivals.iter().min().is_some_and(|m| m > time) {
            tracks.insert((&combo.game, &combo.track, &combo.layout));
            combos.push(combo);
        }
    }
    board.records_held = tracks.len() as u32;
    board.drift_m_total = store.driver_slides(driver)?.iter().filter_map(|j| serde_json::from_str::<crate::LiveSlideStats>(j).ok()).map(|st| st.drift_m).sum();
    for combo in combos {
        let best = bests.iter().filter(|(c, d, _)| c == combo && *d == driver).map(|(_, _, t)| *t).min();
        // The lap that set it: the earliest valid lap with that time (nobody has beaten it since).
        let set = laps.iter().filter(|l| l.valid && &l.combo == combo && Some(l.time_ms) == best).map(|l| l.recorded_at).min();
        if let Some(at) = set {
            board.longest_held_days = board.longest_held_days.max(((now - at).max(0) / crate::progress::DAY_MS) as u32);
        }
    }
    Ok(board)
}

struct Ctx<'a> {
    /// The driver's laps, oldest first, including `lap`.
    laps: &'a [Lap],
    /// The lap that was just recorded; `None` when we are only looking at the history.
    lap: Option<&'a Lap>,
    flags: LapFlags,
    now: Timestamp,
    others_earned: u32,
    others_total: u32,
    board: &'a Board,
    /// The slides and spins this lap recorded, when the game reports them.
    slides: crate::LiveSlideStats,
    /// What this lap's trace and its track's learned map say about how the car sat on the road.
    road: Road,
    /// How a challenge that has just ended went for the driver (only when a challenge is being settled).
    challenge: Option<&'a ChallengeCtx>,
}

/// How one driver got on in a challenge that has just ended.
#[derive(Debug, Clone)]
struct ChallengeCtx {
    position: u32,
    entrants: u32,
    /// Timed laps and cut laps they set in it.
    timed_laps: u32,
    cut_laps: u32,
    /// `(position, entrants)` of the challenges they finished, the one just ended first.
    recent: Vec<(u32, u32)>,
}

/// Facts read from a lap's trace and its track's map, worked out once per lap (only when a sticker needs them).
#[derive(Debug, Clone, Copy, Default)]
struct Road {
    /// Slip angle and speed of the last sample before the line.
    finish_slip_deg: Option<f32>,
    finish_speed_kmh: f32,
    /// The most the car's heading pointed away from the track's direction while stopped (under 5 km/h), degrees.
    stopped_worst_off_deg: f32,
    /// The slowest the car was going while that happened (for the rule's own speed limit).
    stopped_at_kmh: f32,
}

/// The smallest angle between two headings, 0 to 180.
fn angle_between(a: f32, b: f32) -> f32 {
    (((a - b) % 360.0 + 540.0) % 360.0 - 180.0).abs()
}

/// What the lap's trace and the track's map say, when a sticker is about to ask.
fn road_for(store: &Store, lap: &Lap) -> Result<Road> {
    let mut road = Road::default();
    let Some(trace) = store.lap_trace(lap.id)? else { return Ok(road) };
    if let Some(last) = trace.0.last() {
        road.finish_slip_deg = last.slip_deg;
        road.finish_speed_kmh = last.speed_kmh;
    }
    if let Some(map) = store.track_map(&lap.combo.game, &lap.combo.track, &lap.combo.layout)? {
        let n = map.len();
        if n >= 4 {
            road.stopped_at_kmh = f32::MAX;
            for p in trace.0.iter().filter(|p| p.speed_kmh < 5.0) {
                let Some(heading) = p.heading_deg else { continue };
                let i = ((p.progress.clamp(0.0, 0.9999) * n as f32) as usize).min(n - 1);
                let (a, b) = (map[i], map[(i + 2) % n]);
                let (dx, dz) = (b[0] - a[0], b[1] - a[1]);
                if dx.abs() + dz.abs() < 0.01 {
                    continue;
                }
                // The same convention the slip angle uses: heading = atan2(-vx, vz).
                let along = (-dx).atan2(dz).to_degrees();
                let off = angle_between(heading, along);
                if off > road.stopped_worst_off_deg {
                    road.stopped_worst_off_deg = off;
                    road.stopped_at_kmh = p.speed_kmh;
                }
            }
        }
    }
    Ok(road)
}

/// How far a driver is through a rule: `(so far, needed)`. Earned when so far reaches needed.
fn measure(rule: &Rule, c: &Ctx) -> (u32, u32) {
    let timed = || c.laps.iter().filter(|l| l.valid);
    let on_lap = |f: &dyn Fn(&Lap) -> bool| u32::from(c.lap.is_some_and(|l| l.valid && f(l)));
    match rule {
        Rule::TimedLaps { n } => (timed().count() as u32, *n),
        Rule::TimedLapsOnOneTrack { n } => {
            let mut per: HashMap<(&str, &str, &str), u32> = HashMap::new();
            for l in timed() {
                *per.entry((&l.combo.game, &l.combo.track, &l.combo.layout)).or_default() += 1;
            }
            (per.values().copied().max().unwrap_or(0), *n)
        }
        Rule::TracksDriven { n } => (timed().map(|l| (&l.combo.game, &l.combo.track, &l.combo.layout)).collect::<HashSet<_>>().len() as u32, *n),
        Rule::CarsDriven { n } => (timed().map(|l| (&l.combo.game, &l.combo.car)).collect::<HashSet<_>>().len() as u32, *n),
        Rule::GamesDriven { n } => (timed().map(|l| &l.combo.game).collect::<HashSet<_>>().len() as u32, *n),
        Rule::DaysInARow { n } => (crate::streak_days(timed().map(|l| l.recorded_at), c.now), *n),
        Rule::CleanLapsInARow { n } => {
            let attempts = c.laps.iter().filter(|l| l.valid || matches!(l.untimed_reason.as_deref(), None | Some("cut")));
            (attempts.rev().take_while(|l| l.valid).count() as u32, *n)
        }
        Rule::SteadyLapsInARow { n, within_ms } => {
            let Some(last) = c.laps.last() else { return (0, *n) };
            let (mut lo, mut hi, mut run) = (u32::MAX, 0, 0);
            for l in c.laps.iter().rev().take_while(|l| l.valid && l.combo == last.combo) {
                lo = lo.min(l.time_ms);
                hi = hi.max(l.time_ms);
                if hi - lo > *within_ms {
                    break;
                }
                run += 1;
            }
            (run, *n)
        }
        Rule::ThisLapIsPersonalBest => (u32::from(c.lap.is_some() && c.flags.personal_best), 1),
        Rule::ThisLapIsTrackRecord => (u32::from(c.lap.is_some() && c.flags.track_record), 1),
        Rule::ThisLapInChallenge => (u32::from(c.lap.is_some() && c.flags.in_challenge), 1),
        Rule::ThisLapTimeEndsIn { ms } => (on_lap(&|l| l.time_ms % 1000 == *ms), 1),
        Rule::ThisLapTimeIsPalindrome => (on_lap(&|l| is_palindrome(l.time_ms)), 1),
        Rule::TimedLapsOnTrack { n, on } => (timed().filter(|l| on_track(l, on)).count() as u32, *n),
        Rule::ThisLapFasterThan { ms, on, except_car_classes, only_car_classes } => {
            (on_lap(&|l| l.time_ms < *ms && on_track(l, on) && car_allowed(l, only_car_classes, except_car_classes)), 1)
        }
        Rule::ThisLapTimeEndsInSecondsAndMs { seconds, ms, on } => (on_lap(&|l| l.time_ms % 60_000 == seconds * 1000 + ms && on_track(l, on)), 1),
        Rule::ThisLapLongestDriftAtLeast { ms, no_spins } => (on_lap(&|_| c.slides.longest_ms >= u64::from(*ms) && (!*no_spins || c.slides.spins == 0)), 1),
        Rule::ThisLapDriftTimeShareAtLeast { percent } => (on_lap(&|l| c.slides.drift_ms * 100 >= u64::from(l.time_ms) * u64::from(*percent)), 1),
        Rule::ThisLapSpinsAtLeast { n } => (on_lap(&|_| c.slides.spins >= *n), 1),
        Rule::ThisLapSlowerThanYourBestBy { percent } => {
            (on_lap(&|l| c.board.prev_best.is_some_and(|b| f64::from(l.time_ms) >= f64::from(b) * (1.0 + f64::from(*percent) / 100.0))), 1)
        }
        Rule::LapsWithinPercentOfYourBest { n, within_percent } => {
            let mut per: HashMap<&crate::Combo, Vec<u32>> = HashMap::new();
            for l in timed() {
                per.entry(&l.combo).or_default().push(l.time_ms);
            }
            let most = per
                .values()
                .map(|times| {
                    let best = f64::from(*times.iter().min().unwrap_or(&0));
                    times.iter().filter(|&&t| f64::from(t) <= best * (1.0 + f64::from(*within_percent) / 100.0)).count() as u32
                })
                .max()
                .unwrap_or(0);
            (most, *n)
        }
        Rule::ThisLapSectorFasterThanEveryoneElse => (u32::from(c.lap.is_some() && c.flags.purple_sector), 1),
        Rule::ThisLapWithinPercentOfAnotherDriversBest { percent } => {
            (on_lap(&|l| c.board.others.iter().min().is_some_and(|&m| f64::from(l.time_ms) <= f64::from(m) * (1.0 + f64::from(*percent) / 100.0))), 1)
        }
        Rule::RecordsHeldOnDifferentTracks { n } => (c.board.records_held, *n),
        Rule::ThisLapWinsFromBottomHalf { min_drivers } => (
            on_lap(&|l| {
                let (others, Some(before)) = (&c.board.others, c.board.prev_best) else { return false };
                let drivers = others.len() as u32 + 1;
                let rank_before = 1 + others.iter().filter(|&&t| t < before).count() as u32;
                drivers >= *min_drivers && others.iter().all(|&t| l.time_ms < t) && rank_before * 2 > drivers
            }),
            1,
        ),
        Rule::ThisLapPassesAnotherDriver => (on_lap(&|l| c.board.prev_best.is_some_and(|before| c.board.others.iter().any(|&t| l.time_ms < t && t < before))), 1),
        Rule::ThisLapWithinOfAnotherDriversTime { ms } => (on_lap(&|l| c.board.others.iter().any(|&t| t != l.time_ms && t.abs_diff(l.time_ms) <= *ms)), 1),
        Rule::ThisLapEqualsAnotherDriversTime => (on_lap(&|l| c.board.others.contains(&l.time_ms)), 1),
        Rule::RecordHeldForDays { days } => (c.board.longest_held_days.min(*days), *days),
        Rule::ThisLapHasNoSpin => (on_lap(&|_| c.slides.spins == 0), 1),
        Rule::ThisLapSetBetweenLocalTimes { from, to, days } => {
            let (Some(from), Some(to)) = (parse_clock(from), parse_clock(to)) else { return (0, 1) };
            let days: Vec<u32> = days.iter().filter_map(|d| day_index(d)).collect();
            (on_lap(&|l| local_clock(l.recorded_at).is_some_and(|(minute, day)| minute >= from && minute < to && (days.is_empty() || days.contains(&day)))), 1)
        }
        Rule::ThisLapIsPersonalBestAfterLapsWithoutOne { n } => {
            let Some(cur) = c.lap.filter(|_| c.flags.personal_best) else { return (0, 1) };
            let (mut best, mut run): (Option<u32>, u32) = (None, 0);
            for l in c.laps.iter().filter(|l| l.valid && l.combo == cur.combo && l.id != cur.id) {
                match best {
                    Some(b) if l.time_ms >= b => run += 1,
                    _ => run = 0,
                }
                best = Some(best.map_or(l.time_ms, |b| b.min(l.time_ms)));
            }
            (u32::from(run >= *n), 1)
        }
        Rule::ThisCutLapEndsARunWithinPercentOfAnotherDriversBest { n, percent } => {
            let Some(cur) = c.lap.filter(|l| l.untimed_reason.as_deref() == Some("cut")) else { return (0, *n) };
            let Some(&record) = c.board.others.iter().min() else { return (0, *n) };
            let limit = f64::from(record) * (1.0 + f64::from(*percent) / 100.0);
            let run = c.laps.iter().rev().take_while(|l| l.untimed_reason.as_deref() == Some("cut") && l.combo == cur.combo && l.time_ms > 0 && f64::from(l.time_ms) <= limit);
            (run.count() as u32, *n)
        }
        Rule::DriftDistanceInTotalAtLeast { metres } => (c.board.drift_m_total.round() as u32, *metres),
        Rule::ThisLapHandbrakeDriftsAtLeast { n } => (on_lap(&|_| c.slides.handbrake_drifts >= *n), 1),
        Rule::ThisLapFinishesFacingBackwards { slip_deg, min_speed_kmh } => {
            (on_lap(&|_| c.road.finish_slip_deg.is_some_and(|s| s.abs() >= *slip_deg) && c.road.finish_speed_kmh >= *min_speed_kmh), 1)
        }
        Rule::ThisLapStoppedFacingTheWrongWay { below_kmh, degrees } => (on_lap(&|_| c.road.stopped_worst_off_deg >= *degrees && c.road.stopped_at_kmh < *below_kmh), 1),
        Rule::ChallengeFinishedInTopPlaces { places, min_entrants } => {
            (u32::from(c.challenge.is_some_and(|x| x.entrants >= *min_entrants && (1..=*places).contains(&x.position))), 1)
        }
        Rule::ChallengeFinishedOutsideTopPlaces { places, min_entrants } => (u32::from(c.challenge.is_some_and(|x| x.entrants >= *min_entrants && x.position > *places)), 1),
        Rule::ChallengesWonInARow { n, min_entrants } => {
            let Some(x) = c.challenge else { return (0, *n) };
            let wins = x.recent.iter().filter(|(_, entrants)| entrants >= min_entrants).take_while(|(position, _)| *position == 1).count() as u32;
            (wins.min(*n), *n)
        }
        Rule::ChallengeFinishedWithEveryLapClean { min_laps } => (u32::from(c.challenge.is_some_and(|x| x.timed_laps >= *min_laps && x.cut_laps == 0)), 1),
        Rule::AllOtherStickers => (c.others_earned, c.others_total),
    }
}

/// 1:42.241 is 142241 backwards; a time under a minute never counts.
fn is_palindrome(time_ms: u32) -> bool {
    if time_ms < 60_000 {
        return false;
    }
    let digits = format!("{}{:02}{:03}", time_ms / 60_000, time_ms / 1000 % 60, time_ms % 1000);
    digits.chars().eq(digits.chars().rev())
}

// ---- what a driver sees -----------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Progress {
    pub cur: u32,
    pub max: u32,
}

/// One sticker in a driver's book. A hidden sticker that has not been earned carries no name and only its hint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StickerView {
    pub id: String,
    pub name: String,
    pub group: String,
    pub rarity: String,
    pub how: String,
    pub hidden: bool,
    pub earned: bool,
    pub earned_at: Option<Timestamp>,
    /// How far along a counting sticker is; `None` for one-off moments and for stickers we cannot detect yet.
    pub progress: Option<Progress>,
    pub xp: i64,
    pub coins: i64,
    /// The free shop item it also gives (`decal:crown`).
    pub item: Option<String>,
    /// False while the sticker is designed but has no rule.
    pub detectable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StickerBook {
    pub groups: Vec<Group>,
    pub stickers: Vec<StickerView>,
    pub earned: u32,
    pub total: u32,
    /// Ids the driver shows on their profile, in order (at most `MAX_PINNED`). Empty = they have not chosen.
    pub pinned: Vec<String>,
}

/// How many stickers a driver can show on their profile.
pub const MAX_PINNED: usize = 3;

/// A sticker earned by a lap, for the pop-up.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StickerUnlock {
    pub id: String,
    pub name: String,
    pub rarity: String,
    pub xp: i64,
    pub coins: i64,
    /// A free shop item it also gave (`decal:crown`).
    pub item: Option<String>,
}

/// One sticker in a parcel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParcelSticker {
    pub id: String,
    pub name: String,
    pub rarity: String,
    pub how: String,
    pub xp: i64,
    pub coins: i64,
    /// A free shop item it also gave (`decal:crown`).
    pub item: Option<String>,
}

/// What a driver has earned since they last looked: the stickers (rarest first), what they came with, and whether
/// they crossed a level. They are paid when they unlock; the parcel is how they are shown, once, next time the driver
/// is on the app.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Parcel {
    pub stickers: Vec<ParcelSticker>,
    pub coins: i64,
    pub xp: i64,
    pub items: Vec<String>,
    pub level_before: u32,
    pub level_after: u32,
    pub title_after: String,
}

/// The driver's waiting parcel, or `None` when there is nothing they have not seen.
pub fn parcel(store: &Store, driver: DriverId) -> Result<Option<Parcel>> {
    let cat = catalogue();
    let mut stickers: Vec<(usize, ParcelSticker)> = Vec::new();
    for (id, _) in store.unseen_stickers(driver)? {
        let Some(def) = cat.stickers.iter().find(|s| s.id == id) else { continue };
        let pay = cat.pay(def);
        let rank = ["legendary", "epic", "rare", "common"].iter().position(|r| *r == def.rarity).unwrap_or(4);
        stickers.push((rank, ParcelSticker { id, name: def.name.clone(), rarity: def.rarity.clone(), how: def.how.clone(), xp: pay.xp, coins: pay.coins, item: cat.item(def).map(str::to_string) }));
    }
    if stickers.is_empty() {
        return Ok(None);
    }
    // Rarest first; ties keep the order they unlocked in.
    stickers.sort_by_key(|(rank, _)| *rank);
    let stickers: Vec<ParcelSticker> = stickers.into_iter().map(|(_, s)| s).collect();
    let xp: i64 = stickers.iter().map(|s| s.xp).sum();
    let total_xp = store.point_totals(driver)?.0;
    let level_after = crate::progress::level_of(total_xp);
    Ok(Some(Parcel {
        coins: stickers.iter().map(|s| s.coins).sum(),
        items: stickers.iter().filter_map(|s| s.item.clone()).collect(),
        xp,
        level_before: crate::progress::level_of((total_xp - xp).max(0)),
        level_after,
        title_after: crate::progress::title_for(level_after).to_string(),
        stickers,
    }))
}

/// A driver's whole book: every sticker, what they have and how far along the rest are.
pub fn book(store: &Store, driver: DriverId, now: Timestamp) -> Result<StickerBook> {
    let cat = catalogue();
    let laps = store.driver_laps(driver)?;
    let earned: HashMap<String, Timestamp> = store.driver_stickers(driver)?.into_iter().collect();
    let total = cat.stickers.len() as u32;
    let board = board_for(store, driver, None, &laps, now)?;
    let ctx = Ctx { laps: &laps, lap: None, flags: LapFlags::default(), now, others_earned: earned.len() as u32, others_total: total.saturating_sub(1), board: &board, slides: Default::default(), road: Road::default(), challenge: None };
    let stickers: Vec<StickerView> = cat
        .stickers
        .iter()
        .map(|s| {
            let at = earned.get(&s.id).copied();
            let shown = at.is_some() || !s.hidden;
            let pay = cat.pay(s);
            let one_off = matches!(s.rule, Some(Rule::ThisLapIsPersonalBest | Rule::ThisLapIsTrackRecord | Rule::ThisLapInChallenge | Rule::ThisLapTimeEndsIn { .. } | Rule::ThisLapTimeIsPalindrome | Rule::ThisLapFasterThan { .. } | Rule::ThisLapTimeEndsInSecondsAndMs { .. } | Rule::ThisLapLongestDriftAtLeast { .. } | Rule::ThisLapDriftTimeShareAtLeast { .. } | Rule::ThisLapSpinsAtLeast { .. } | Rule::ThisLapSlowerThanYourBestBy { .. } | Rule::ThisLapSectorFasterThanEveryoneElse | Rule::ThisLapWithinPercentOfAnotherDriversBest { .. } | Rule::ThisLapWinsFromBottomHalf { .. } | Rule::ThisLapPassesAnotherDriver | Rule::ThisLapWithinOfAnotherDriversTime { .. } | Rule::ThisLapEqualsAnotherDriversTime | Rule::ThisLapHasNoSpin | Rule::ThisLapSetBetweenLocalTimes { .. } | Rule::ThisLapIsPersonalBestAfterLapsWithoutOne { .. } | Rule::ThisLapHandbrakeDriftsAtLeast { .. } | Rule::ThisLapFinishesFacingBackwards { .. } | Rule::ThisLapStoppedFacingTheWrongWay { .. } | Rule::ChallengeFinishedInTopPlaces { .. } | Rule::ChallengeFinishedOutsideTopPlaces { .. } | Rule::ChallengesWonInARow { .. } | Rule::ChallengeFinishedWithEveryLapClean { .. }));
            let progress = match &s.rule {
                Some(rule) if at.is_none() && !one_off && shown => {
                    let (cur, max) = measure(rule, &ctx);
                    Some(Progress { cur: cur.min(max), max })
                }
                _ => None,
            };
            StickerView {
                id: s.id.clone(),
                name: if shown { s.name.clone() } else { "Hidden sticker".into() },
                group: s.group.clone(),
                rarity: s.rarity.clone(),
                how: if shown { s.how.clone() } else { s.hint.clone().unwrap_or_default() },
                hidden: s.hidden,
                earned: at.is_some(),
                earned_at: at,
                progress,
                xp: pay.xp,
                coins: pay.coins,
                item: cat.item(s).map(str::to_string),
                detectable: s.rule.is_some(),
            }
        })
        .collect();
    Ok(StickerBook { groups: cat.groups.clone(), earned: earned.len() as u32, total, stickers, pinned: store.pinned_stickers(driver)? })
}

/// Chooses the stickers a driver shows on their profile. Only earned ones, no repeats, at most `MAX_PINNED`.
pub fn pin(store: &Store, driver: DriverId, ids: &[String]) -> Result<()> {
    if ids.len() > MAX_PINNED {
        anyhow::bail!("you can show {MAX_PINNED} stickers on your profile");
    }
    let earned: HashSet<String> = store.driver_stickers(driver)?.into_iter().map(|(id, _)| id).collect();
    let mut seen = HashSet::new();
    for id in ids {
        if !seen.insert(id) {
            anyhow::bail!("{id} is listed twice");
        }
        if !earned.contains(id) {
            anyhow::bail!("you have not earned {id} yet");
        }
    }
    store.set_pinned_stickers(driver, ids)
}

/// Checks a driver's stickers after a timed lap and unlocks (and pays for) any it completed.
pub fn award_lap(store: &Store, driver: DriverId, lap: &Lap, flags: LapFlags, now: Timestamp) -> Result<Vec<StickerUnlock>> {
    let laps = store.driver_laps(driver)?;
    let mut out = Vec::new();
    unlock_pass(store, driver, &laps, Some(lap), flags, now, Some(lap), &mut out)?;
    Ok(out)
}

/// Records how everyone on a finished challenge's board finished and unlocks (and pays for) the challenge stickers.
/// Returns how many stickers were unlocked. Guest entries (no driver) are ignored.
pub fn award_challenge(store: &Store, challenge: &crate::Challenge, board: &[crate::LeaderboardEntry], now: Timestamp) -> Result<usize> {
    let cat = catalogue();
    let ended_at = challenge.ends_at.unwrap_or(now);
    let drivers: Vec<(DriverId, u32)> = board.iter().filter_map(|e| e.driver_id.map(|d| (d, e.position))).collect();
    let entrants = drivers.len() as u32;
    for (driver, position) in &drivers {
        store.insert_challenge_result(challenge.id, *driver, *position, entrants, ended_at)?;
    }
    let mut unlocked = 0;
    for (driver, position) in drivers {
        // Their laps in it: timed, and cut (a cut lap is one the game flagged; anything else was not a try).
        let mut laps: Vec<Lap> = store
            .driver_laps(driver)?
            .into_iter()
            .filter(|l| {
                l.combo.game == challenge.game
                    && l.combo.track == challenge.track
                    && l.combo.layout == challenge.layout
                    && challenge.car.as_ref().is_none_or(|car| car == &l.combo.car)
                    && l.recorded_at >= challenge.starts_at
                    && challenge.ends_at.is_none_or(|end| l.recorded_at <= end)
            })
            .collect();
        if let Some(max) = challenge.max_laps {
            laps.truncate(max as usize);
        }
        let ctx_challenge = ChallengeCtx {
            position,
            entrants,
            timed_laps: laps.iter().filter(|l| l.valid).count() as u32,
            cut_laps: laps.iter().filter(|l| l.untimed_reason.as_deref() == Some("cut")).count() as u32,
            recent: store.driver_challenge_results(driver)?,
        };
        let earned: HashSet<String> = store.driver_stickers(driver)?.into_iter().map(|(id, _)| id).collect();
        let board_ctx = Board::default();
        for s in &cat.stickers {
            let Some(rule) = &s.rule else { continue };
            if earned.contains(&s.id) {
                continue;
            }
            let ctx = Ctx {
                laps: &laps,
                lap: None,
                flags: LapFlags::default(),
                now,
                others_earned: 0,
                others_total: 0,
                board: &board_ctx,
                slides: Default::default(),
                road: Road::default(),
                challenge: Some(&ctx_challenge),
            };
            let (cur, max) = measure(rule, &ctx);
            if cur < max || max == 0 || !store.insert_sticker(driver, &s.id, None, now)? {
                continue;
            }
            let pay = cat.pay(s);
            store.insert_point_event(driver, &format!("sticker:{}", s.id), pay.xp, pay.coins, None, now)?;
            if let Some(item) = cat.item(s) {
                store.grant_item(driver, item, now)?;
            }
            unlocked += 1;
        }
    }
    Ok(unlocked)
}

/// One-off pass over everyone's history so nobody starts at zero: unlocks what the laps already prove, and pays for it
/// (the driver would have had the reward anyway had the stickers existed).
pub fn backfill(store: &Store) -> Result<()> {
    const FLAG: &str = "stickers_backfilled_v1";
    if store.setting(FLAG)?.is_some() {
        return Ok(());
    }
    let now = crate::now_ms();
    for d in store.drivers()? {
        let laps = store.driver_laps(d.id)?;
        if laps.is_empty() {
            continue;
        }
        let mut sink = Vec::new();
        unlock_pass(store, d.id, &laps, None, LapFlags::default(), now, laps.last(), &mut sink)?;
    }
    store.set_setting(FLAG, Some("1"))?;
    Ok(())
}

/// Unlocks every sticker whose rule is now met. With `pay_for` it also pays; without, it only records.
#[allow(clippy::too_many_arguments)]
fn unlock_pass(store: &Store, driver: DriverId, laps: &[Lap], lap: Option<&Lap>, flags: LapFlags, now: Timestamp, pay_for: Option<&Lap>, out: &mut Vec<StickerUnlock>) -> Result<()> {
    let cat = catalogue();
    let mut earned: HashSet<String> = store.driver_stickers(driver)?.into_iter().map(|(id, _)| id).collect();
    let total = cat.stickers.len() as u32;
    let at = laps.last().map_or(now, |l| l.recorded_at.min(now));
    let board = board_for(store, driver, lap, laps, now)?;
    // What this lap's drifting and spinning added up to (nothing when the game does not report it).
    let slides: crate::LiveSlideStats = match lap {
        Some(l) => store.lap_slides(l.id)?.and_then(|json| serde_json::from_str(&json).ok()).unwrap_or_default(),
        None => Default::default(),
    };
    // Only read the trace and the map when a sticker still to earn is about them.
    let needs_road = lap.is_some()
        && cat.stickers.iter().any(|st| !earned.contains(&st.id) && matches!(st.rule, Some(Rule::ThisLapFinishesFacingBackwards { .. } | Rule::ThisLapStoppedFacingTheWrongWay { .. })));
    let road = match lap {
        Some(l) if needs_road => road_for(store, l)?,
        _ => Road::default(),
    };
    // The Completionist goes last, so it sees what this very lap unlocked.
    for completionist in [false, true] {
        for s in &cat.stickers {
            let Some(rule) = &s.rule else { continue };
            if earned.contains(&s.id) || (*rule == Rule::AllOtherStickers) != completionist {
                continue;
            }
            let ctx = Ctx { laps, lap, flags, now, others_earned: earned.len() as u32, others_total: total.saturating_sub(1), board: &board, slides, road, challenge: None };
            let (cur, max) = measure(rule, &ctx);
            if cur < max || max == 0 {
                continue;
            }
            if !store.insert_sticker(driver, &s.id, pay_for.map(|l| l.id), at)? {
                continue;
            }
            earned.insert(s.id.clone());
            if let Some(l) = pay_for {
                let pay = cat.pay(s);
                store.insert_point_event(driver, &format!("sticker:{}", s.id), pay.xp, pay.coins, Some(l.id), now)?;
                let item = cat.item(s).map(str::to_string);
                if let Some(item) = &item {
                    store.grant_item(driver, item, now)?;
                }
                out.push(StickerUnlock { id: s.id.clone(), name: s.name.clone(), rarity: s.rarity.clone(), xp: pay.xp, coins: pay.coins, item });
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bundled_stickers_parse_and_every_rarity_pays() {
        let c = catalogue();
        assert!(c.stickers.len() >= 40, "{}", c.stickers.len());
        for s in &c.stickers {
            let p = c.pay(s);
            assert!(p.xp > 0 && p.coins > 0, "{} pays nothing", s.id);
        }
        // Harder tiers pay more.
        let pay = |r: &str| c.rarity_pay[r];
        assert!(pay("common").coins < pay("rare").coins && pay("rare").coins < pay("epic").coins && pay("epic").coins < pay("legendary").coins);
    }

    #[test]
    fn a_stickers_own_numbers_beat_its_rarity() {
        let mut c = Catalogue::from_json(include_str!("../stickers.json")).unwrap();
        let base = c.rarity_pay[&c.stickers[0].rarity];
        assert_eq!(c.pay(&c.stickers[0]), base);
        c.stickers[0].reward = Some(Reward { coins: Some(7), ..Reward::default() });
        assert_eq!(c.pay(&c.stickers[0]), Pay { xp: base.xp, coins: 7 });
        c.stickers[0].reward = Some(Reward { xp: Some(1_000_000), ..Reward::default() });
        assert_eq!(c.pay(&c.stickers[0]).xp, MAX_PAY);
    }

    /// The bundled file with one sticker (by index) changed, as JSON text, whatever the file's own formatting.
    fn with(index: usize, change: impl FnOnce(&mut serde_json::Value)) -> String {
        let mut v: serde_json::Value = serde_json::from_str(include_str!("../stickers.json")).unwrap();
        change(&mut v["stickers"][index]);
        v.to_string()
    }

    #[test]
    fn a_broken_file_is_refused_with_a_reason() {
        let crown = catalogue().stickers.iter().position(|s| s.id == "crown").unwrap();
        assert!(Catalogue::from_json(&with(1, |s| s["rarity"] = "mythic".into())).unwrap_err().contains("mythic"));
        assert!(Catalogue::from_json(&with(1, |s| s["id"] = "first-lap".into())).unwrap_err().contains("twice"));
        assert!(Catalogue::from_json(&with(1, |s| s["group"] = "nowhere".into())).unwrap_err().contains("nowhere"));
        assert!(Catalogue::from_json(&with(1, |s| s["hidden"] = true.into())).unwrap_err().contains("needs a hint"));
        assert!(Catalogue::from_json(&with(crown, |s| s["reward"]["item"] = "decal:nothing".into())).unwrap_err().contains("not in the shop"));
        assert!(Catalogue::from_json("{}").is_err());
    }

    #[test]
    fn times_that_read_the_same_backwards() {
        assert!(is_palindrome(102_241)); // 1:42.241
        assert!(!is_palindrome(102_242));
        assert!(!is_palindrome(45_054), "under a minute never counts");
    }

    fn timed_lap(time_ms: u32) -> Lap {
        Lap {
            id: 1,
            driver_id: Some(1),
            combo: crate::Combo { game: "acevo".into(), track: "Imola".into(), layout: String::new(), car: "Porsche 992 GT3 R".into() },
            session_kind: "Hot Stint".into(),
            lap_number: 1,
            time_ms,
            valid: true,
            untimed_reason: None,
            sectors_ms: vec![],
            recorded_at: 0,
        }
    }

    fn slid(drift_ms: u64, longest_ms: u64, spins: u32) -> crate::LiveSlideStats {
        crate::LiveSlideStats { drifts: u32::from(drift_ms > 0), spins, drift_ms, longest_ms, peak_slip_deg: 30.0, drift_m: 0.0, handbrake_drifts: 0 }
    }

    /// Whether a rule is met by one lap that carried these slides.
    fn met(rule: &Rule, time_ms: u32, slides: crate::LiveSlideStats) -> bool {
        let lap = timed_lap(time_ms);
        let laps = [lap.clone()];
        let board = Board::default();
        let ctx = Ctx { laps: &laps, lap: Some(&lap), flags: LapFlags::default(), now: 0, others_earned: 0, others_total: 0, board: &board, slides, road: Road::default(), challenge: None };
        let (cur, max) = measure(rule, &ctx);
        cur >= max
    }

    #[test]
    fn the_drift_stickers_read_a_laps_slides() {
        let sideways = Rule::ThisLapLongestDriftAtLeast { ms: 2000, no_spins: false };
        assert!(!met(&sideways, 100_000, slid(1_900, 1_900, 0)));
        assert!(met(&sideways, 100_000, slid(2_000, 2_000, 0)));
        let fryer = Rule::ThisLapLongestDriftAtLeast { ms: 10_000, no_spins: true };
        assert!(met(&fryer, 100_000, slid(12_000, 12_000, 0)));
        assert!(!met(&fryer, 100_000, slid(12_000, 12_000, 1)), "a spin spoils it");
        let king = Rule::ThisLapDriftTimeShareAtLeast { percent: 50 };
        assert!(!met(&king, 100_000, slid(49_999, 9_000, 0)));
        assert!(met(&king, 100_000, slid(50_000, 9_000, 0)));
        let top = Rule::ThisLapSpinsAtLeast { n: 1 };
        assert!(met(&top, 100_000, slid(0, 0, 1)) && !met(&top, 100_000, slid(3_000, 3_000, 0)));
        assert!(!met(&sideways, 100_000, Default::default()), "a game that reports no slides cannot earn them");
    }

    #[test]
    fn times_of_day_are_checked_when_the_file_loads() {
        let ok = include_str!("../stickers.json");
        let with = |from: &str, to: &str| {
            let mut v: serde_json::Value = serde_json::from_str(ok).unwrap();
            let i = v["stickers"].as_array().unwrap().iter().position(|s| s["id"] == "lunch-break").unwrap();
            v["stickers"][i]["rule"]["from"] = from.into();
            v["stickers"][i]["rule"]["to"] = to.into();
            v.to_string()
        };
        assert!(Catalogue::from_json(&with("11:30", "13:45")).is_ok());
        assert!(Catalogue::from_json(&with("12:00", "24:00")).is_ok());
        assert!(Catalogue::from_json(&with("noon", "14:00")).unwrap_err().contains("lunch-break"));
        assert!(Catalogue::from_json(&with("12:00", "25:00")).is_err());
    }
}

