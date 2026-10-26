//! Levels, XP and coins.
//!
//! Every reward is a row in `point_events` (an append-only ledger), so a balance is just a sum, nothing can
//! drift, and the app can always say why you got something. XP only goes up and sets your level; coins are
//! earned alongside it and are what a Garage would spend later (nothing spends them yet).

use crate::model::Timestamp;

/// What a valid, timed lap earns.
pub const LAP_XP: i64 = 10;
pub const LAP_COINS: i64 = 1;
/// A personal best (not the first lap on a track and car).
pub const PB_XP: i64 = 50;
pub const PB_COINS: i64 = 5;
/// The fastest lap anyone has set on a track and car, beating someone else's.
pub const RECORD_XP: i64 = 150;
pub const RECORD_COINS: i64 = 20;
/// The first valid lap on a new track and car.
pub const FIRST_XP: i64 = 25;
pub const FIRST_COINS: i64 = 2;

/// Plain laps stop paying after this many in 24 hours on one track and car, so lapping a corner on the
/// rig cannot be farmed. Bests and records are never capped: they are hard to fake.
pub const LAP_CAP_PER_DAY: i64 = 30;
pub const DAY_MS: Timestamp = 24 * 60 * 60 * 1000;

/// Total XP needed to reach `level` (level 1 is 0). Each level costs 100 more than the one before:
/// 100, 300, 600, 1000, 1500, ...
pub fn xp_for_level(level: u32) -> i64 {
    let l = i64::from(level.max(1));
    100 * (l - 1) * l / 2
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
    fn every_level_has_a_title() {
        for l in 0..30 {
            assert!(!title_for(l).is_empty());
        }
        assert_eq!(title_for(4), "Podium Regular");
    }
}
