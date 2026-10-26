//! The Garage shop: what can be bought with coins and how an equipped look is checked.
//!
//! Prices and level gates live here, on the server, so a phone can only ask. The app owns how each item is
//! drawn (app/src/looks.ts); the ids must match. Free items (price 0) belong to everyone.

use crate::model::Look;
use crate::progress::ShopEntry;

pub const SHELL: &str = "shell";
pub const DECAL: &str = "decal";
pub const STRIPE: &str = "stripe";
pub const FACE: &str = "face";

/// The preset colours a decal can be painted (free). Upper case `#RRGGBB`; white is the default.
pub const DECAL_COLOURS: &[&str] = &["#FFFFFF", "#14162B", "#FF5D5D", "#FF9F6B", "#FFC93C", "#4FD39A", "#4FC3FF", "#B79BFF", "#FF7AC6"];

/// Every item for sale, from `rewards.json`.
pub fn catalogue() -> &'static [ShopEntry] {
    &crate::progress::rewards().shop
}

pub fn item(slot: &str, id: &str) -> Option<&'static ShopEntry> {
    catalogue().iter().find(|i| i.slot == slot && i.id == id)
}

/// The id a bought item is stored under, e.g. `shell:aurora`.
pub fn key(slot: &str, id: &str) -> String {
    format!("{slot}:{id}")
}

pub fn parse_key(key: &str) -> Option<&'static ShopEntry> {
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
    let decal_color = match (&look.decal, look.decal_color.as_deref()) {
        (None, _) | (_, None) => None,
        (Some(_), Some(c)) => match DECAL_COLOURS.iter().find(|p| p.eq_ignore_ascii_case(c)) {
            Some(p) => Some((*p).to_string()),
            None => return Err(format!("{c} is not one of the decal colours")),
        },
    };
    let decal_at = match (&look.decal, look.decal_at.as_deref()) {
        (None, _) => None,
        (Some(_), None) => Some("side".to_string()),
        (Some(_), Some(at @ ("side" | "top" | "chin"))) => Some(at.to_string()),
        (Some(_), Some(other)) => return Err(format!("a decal cannot go on the {other}")),
    };
    Ok(Look { decal_at, decal_color, ..look.clone() })
}
