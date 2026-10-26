//! Levels, XP and coins.
//!
//! Every reward is a row in `point_events` (an append-only ledger), so a balance is just a sum, nothing can
//! drift, and the app can always say why you got something. XP only goes up and sets your level; coins are
//! earned alongside it and are what a Garage would spend later (nothing spends them yet).

use std::sync::LazyLock;

use serde::{Deserialize, Serialize};

use crate::model::Timestamp;

pub const DAY_MS: Timestamp = 24 * 60 * 60 * 1000;

/// What one kind of reward pays.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pay {
    pub xp: i64,
    pub coins: i64,
}

/// One thing the shop sells (`rewards.json`). Free items (price 0) belong to everyone.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShopEntry {
    /// `shell`, `decal`, `stripe` or `face`.
    pub slot: String,
    /// Matches the drawing in app/src/looks.ts.
    pub id: String,
    pub price: i64,
    pub min_level: u32,
}

/// Everything that decides how fast XP and coins come in and what things cost. It is `crates/tt-core/rewards.json`,
/// compiled into the app, so a balance change ships with the next update.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rewards {
    /// A valid, timed lap.
    pub clean_lap: Pay,
    /// The first valid lap on a new track and car.
    pub first_lap: Pay,
    /// A personal best (not the first lap on a track and car).
    pub personal_best: Pay,
    /// The fastest lap anyone has set on a track and car, beating someone else's.
    pub track_record: Pay,
    /// Plain laps stop paying after this many in 24 hours on one track and car, so lapping a corner on the rig
    /// cannot be farmed. Bests and records are never capped: they are hard to fake.
    pub daily_lap_cap: i64,
    /// Each level costs this much more than the one before: with 100 it takes 100, 300, 600, 1000, 1500 XP in total.
    pub level_xp_step: i64,
    pub shop: Vec<ShopEntry>,
}

impl Rewards {
    /// Rules that keep a typo from breaking the ledger: nothing pays or costs less than nothing, levels have a size.
    fn sanitised(mut self) -> Self {
        for p in [&mut self.clean_lap, &mut self.first_lap, &mut self.personal_best, &mut self.track_record] {
            p.xp = p.xp.max(0);
            p.coins = p.coins.max(0);
        }
        self.daily_lap_cap = self.daily_lap_cap.max(0);
        self.level_xp_step = self.level_xp_step.max(1);
        for e in &mut self.shop {
            e.price = e.price.max(0);
            e.min_level = e.min_level.max(1);
        }
        self
    }

    pub fn from_json(text: &str) -> Result<Self, serde_json::Error> {
        Ok(serde_json::from_str::<Rewards>(text)?.sanitised())
    }
}

static RULES: LazyLock<Rewards> =
    LazyLock::new(|| Rewards::from_json(include_str!("../rewards.json")).expect("crates/tt-core/rewards.json is not valid"));

/// The rules in force: `crates/tt-core/rewards.json` as it was when the app was built.
pub fn rewards() -> &'static Rewards {
    &RULES
}

/// Total XP needed to reach `level` (level 1 is 0). Each level costs `level_xp_step` more than the one before.
pub fn xp_for_level(level: u32) -> i64 {
    let l = i64::from(level.max(1));
    rewards().level_xp_step * (l - 1) * l / 2
}

pub fn level_of(xp: i64) -> u32 {
    let mut level = 1;
    while xp_for_level(level + 1) <= xp {
        level += 1;
    }
    level
}

/// A name for each stretch of levels, shown next to the level.
pub fn title_for(level: u32) -> &'static str {
    match level {
        0 | 1 => "Rookie",
        2 => "Qualifier",
        3 => "Regular",
        4 => "Podium Regular",
        5 => "Contender",
        6 | 7 => "Veteran",
        8 | 9 => "Ace",
        _ => "Legend",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels_get_further_apart() {
        assert_eq!((xp_for_level(1), xp_for_level(2), xp_for_level(3), xp_for_level(4), xp_for_level(5)), (0, 100, 300, 600, 1000));
        assert_eq!(level_of(0), 1);
        assert_eq!(level_of(99), 1);
        assert_eq!(level_of(100), 2);
        assert_eq!(level_of(599), 3);
        assert_eq!(level_of(600), 4);
        assert_eq!(level_of(1_000_000), level_of(1_000_000));
        assert!(level_of(1_000_000) > 40);
    }

    #[test]
    fn the_bundled_rules_parse_and_make_sense() {
        let r = rewards();
        assert_eq!((r.clean_lap.xp, r.clean_lap.coins), (10, 1));
        assert!(r.daily_lap_cap > 0 && r.level_xp_step > 0);
        // Every item is in a known slot, once, and each slot has something free to start with.
        let mut seen = std::collections::HashSet::new();
        for e in &r.shop {
            assert!(["shell", "decal", "stripe", "face"].contains(&e.slot.as_str()), "unknown slot {}", e.slot);
            assert!(seen.insert((e.slot.clone(), e.id.clone())), "{}:{} is listed twice", e.slot, e.id);
        }
        for slot in ["decal", "stripe", "face"] {
            assert!(r.shop.iter().any(|e| e.slot == slot && e.price == 0), "{slot} has nothing free");
        }
    }

    #[test]
    fn nonsense_values_are_pulled_back_into_range() {
        let json = r#"{ "cleanLap": { "xp": -5, "coins": -1 }, "firstLap": { "xp": 1, "coins": 1 }, "personalBest": { "xp": 1, "coins": 1 },
            "trackRecord": { "xp": 1, "coins": 1 }, "dailyLapCap": -3, "levelXpStep": 0,
            "shop": [{ "slot": "shell", "id": "x", "price": -9, "minLevel": 0 }] }"#;
        let r = Rewards::from_json(json).unwrap();
        assert_eq!((r.clean_lap.xp, r.clean_lap.coins, r.level_xp_step, r.daily_lap_cap), (0, 0, 1, 0));
        assert_eq!((r.shop[0].price, r.shop[0].min_level), (0, 1));
        assert!(Rewards::from_json("not json").is_err());
    }

    #[test]
    fn every_level_has_a_title() {
        for l in 0..30 {
            assert!(!title_for(l).is_empty());
        }
        assert_eq!(title_for(4), "Podium Regular");
    }
}
