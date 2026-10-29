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
use std::sync::LazyLock;

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
    /// This lap was quicker than `ms`, on one of these tracks (empty = any track).
    ThisLapFasterThan { ms: u32, on: Vec<TrackRef> },
    /// This lap's time ends in these seconds and milliseconds, on one of these tracks (7:20.832 ends in 20 s 832 ms).
    ThisLapTimeEndsInSecondsAndMs { seconds: u32, ms: u32, on: Vec<TrackRef> },
    /// Every other sticker in the book.
    AllOtherStickers,
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
        Rule::ThisLapFasterThan { ms, on } => (on_lap(&|l| l.time_ms < *ms && on_track(l, on)), 1),
        Rule::ThisLapTimeEndsInSecondsAndMs { seconds, ms, on } => (on_lap(&|l| l.time_ms % 60_000 == seconds * 1000 + ms && on_track(l, on)), 1),
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

/// A driver's whole book: every sticker, what they have and how far along the rest are.
pub fn book(store: &Store, driver: DriverId, now: Timestamp) -> Result<StickerBook> {
    let cat = catalogue();
    let laps = store.driver_laps(driver)?;
    let earned: HashMap<String, Timestamp> = store.driver_stickers(driver)?.into_iter().collect();
    let total = cat.stickers.len() as u32;
    let ctx = Ctx { laps: &laps, lap: None, flags: LapFlags::default(), now, others_earned: earned.len() as u32, others_total: total.saturating_sub(1) };
    let stickers: Vec<StickerView> = cat
        .stickers
        .iter()
        .map(|s| {
            let at = earned.get(&s.id).copied();
            let shown = at.is_some() || !s.hidden;
            let pay = cat.pay(s);
            let one_off = matches!(s.rule, Some(Rule::ThisLapIsPersonalBest | Rule::ThisLapIsTrackRecord | Rule::ThisLapInChallenge | Rule::ThisLapTimeEndsIn { .. } | Rule::ThisLapTimeIsPalindrome | Rule::ThisLapFasterThan { .. } | Rule::ThisLapTimeEndsInSecondsAndMs { .. }));
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

/// One-off pass over everyone's history so nobody starts at zero: unlocks what the laps already prove, pays nothing.
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
        unlock_pass(store, d.id, &laps, None, LapFlags::default(), now, None, &mut sink)?;
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
    // The Completionist goes last, so it sees what this very lap unlocked.
    for completionist in [false, true] {
        for s in &cat.stickers {
            let Some(rule) = &s.rule else { continue };
            if earned.contains(&s.id) || (*rule == Rule::AllOtherStickers) != completionist {
                continue;
            }
            let ctx = Ctx { laps, lap, flags, now, others_earned: earned.len() as u32, others_total: total.saturating_sub(1) };
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
}
