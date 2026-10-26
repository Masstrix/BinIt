//! The Garage shop: what can be bought with coins and how an equipped look is checked.
//!
//! Prices and level gates live here, on the server, so a phone can only ask. The app owns how each item is
//! drawn (app/src/looks.ts); the ids must match. Free items (price 0) belong to everyone.

use crate::model::Look;

pub const SHELL: &str = "shell";
pub const DECAL: &str = "decal";
pub const STRIPE: &str = "stripe";
pub const FACE: &str = "face";

pub struct Entry {
    pub slot: &'static str,
    pub id: &'static str,
    pub price: i64,
    pub min_level: u32,
}

const fn e(slot: &'static str, id: &'static str, price: i64, min_level: u32) -> Entry {
    Entry { slot, id, price, min_level }
}

pub const CATALOGUE: &[Entry] = &[
    e(SHELL, "sunset", 150, 1),
    e(SHELL, "ocean", 150, 1),
    e(SHELL, "ember", 150, 1),
    e(SHELL, "lagoon", 180, 1),
    e(SHELL, "aurora", 320, 3),
    e(SHELL, "rally", 420, 3),
    e(SHELL, "holo", 1500, 5),
    e(SHELL, "gold", 2000, 9),
    e(SHELL, "nightsky", 1200, 5),
    e(SHELL, "inferno", 1500, 5),
    e(SHELL, "nebula", 1800, 7),
    e(SHELL, "glacier", 1200, 5),
    e(DECAL, "flame", 0, 1),
    e(DECAL, "bolt", 0, 1),
    e(DECAL, "star", 40, 1),
    e(DECAL, "chequer", 40, 1),
    e(DECAL, "heart", 60, 1),
    e(DECAL, "flag", 80, 1),
    e(DECAL, "moon", 80, 1),
    e(DECAL, "wing", 160, 2),
    e(DECAL, "crown", 250, 6),
    e(DECAL, "skull", 300, 3),
    e(STRIPE, "centre", 0, 1),
    e(STRIPE, "twin", 20, 1),
    e(STRIPE, "band", 20, 1),
    e(STRIPE, "chequer", 100, 2),
    e(FACE, "chill", 0, 1),
    e(FACE, "focus", 0, 1),
    e(FACE, "happy", 0, 1),
    e(FACE, "cheeky", 20, 1),
    e(FACE, "sleepy", 40, 1),
    e(FACE, "wide", 40, 1),
    e(FACE, "angry", 60, 1),
    e(FACE, "peaked", 60, 1),
    e(FACE, "stars", 150, 2),
    e(FACE, "hearts", 150, 2),
    e(FACE, "cash", 300, 4),
];

pub fn item(slot: &str, id: &str) -> Option<&'static Entry> {
    CATALOGUE.iter().find(|i| i.slot == slot && i.id == id)
}

/// The id a bought item is stored under, e.g. `shell:aurora`.
pub fn key(slot: &str, id: &str) -> String {
    format!("{slot}:{id}")
}

pub fn parse_key(key: &str) -> Option<&'static Entry> {
    let (slot, id) = key.split_once(':')?;
    item(slot, id)
}

/// Whether the driver may wear this item: it is free, or they bought it.
fn usable(owned: &[String], slot: &str, id: &str) -> Result<(), String> {
    let Some(entry) = item(slot, id) else { return Err(format!("no such {slot}: {id}")) };
    if entry.price == 0 || owned.iter().any(|o| *o == key(slot, id)) {
        Ok(())
    } else {
        Err(format!("you do not own {id} yet"))
    }
}

/// Checks that everything in `look` exists and is owned (or free). Returns the cleaned look.
pub fn check_look(owned: &[String], look: &Look) -> Result<Look, String> {
    if let Some(id) = &look.shell {
        usable(owned, SHELL, id)?;
    }
    if let Some(id) = &look.decal {
        usable(owned, DECAL, id)?;
    }
    if let Some(id) = &look.stripe {
        usable(owned, STRIPE, id)?;
    }
    if let Some(id) = &look.face {
        usable(owned, FACE, id)?;
    }
    if let Some(n) = look.number
        && !(1..=99).contains(&n)
    {
        return Err("the race number is 1 to 99".into());
    }
    let decal_at = match (&look.decal, look.decal_at.as_deref()) {
        (None, _) => None,
        (Some(_), None) => Some("side".to_string()),
        (Some(_), Some(at @ ("side" | "top" | "chin"))) => Some(at.to_string()),
        (Some(_), Some(other)) => return Err(format!("a decal cannot go on the {other}")),
    };
    Ok(Look { decal_at, ..look.clone() })
}
