//! Memory layout of Assetto Corsa Rally's shared-memory pages, as found by reading a running game.
//!
//! The page names and the physics page are the family's (see `acpmf`); the physics page fields used
//! here were checked against the running game. The graphics and static pages follow Assetto Corsa
//! Competizione's layout (not the original Assetto Corsa's), and what the game fills in is much less
//! than the layout has room for. Checked against Assetto Corsa Rally while driving a Peugeot 206 WRC
//! on a Welsh gravel stage:
//!
//! * `static` has the car name (offset 68, a display name such as `Peugeot 206 WRC`), the stage name
//!   (134, such as `Wales Afon Biga`), the driver's name (200) and the stage length in metres (520). The
//!   two version strings and the layout name are empty.
//! * `graphics` has a packet counter, the **stage clock as text** (`mm:ss.mmm`, offset 12), the
//!   distance driven (156) and the car's world position (256). Everything a circuit game would use is
//!   zero: the status, the session type, the lap counter, the millisecond clocks, the sector index and
//!   the track-position fraction. The last, best and split time strings stay empty.
//! * At the finish line the stage clock stops while the car keeps rolling; once it has stopped the whole
//!   page set freezes (the packet counter stops). The finish line is short of the stage length (98.4% on
//!   the stage that was recorded).
//!
//! Every assumption is a named offset below, so a game update that moves things is a one-line change.

use crate::acpmf::Page;

/// Fields of the `graphics` page.
pub mod graphics {
    pub const PACKET_ID: usize = 0;
    /// The stage clock as UTF-16 text, `mm:ss.mmm` (15 characters).
    pub const CLOCK_TEXT: usize = 12;
    pub const LAST_TIME_TEXT: usize = 42;
    pub const BEST_TIME_TEXT: usize = 72;
    /// Metres driven in the stage so far (a float).
    pub const DISTANCE_TRAVELED: usize = 156;
    /// Competizione's layout from here: the number of cars, then each car's (x, y, z).
    pub const ACTIVE_CARS: usize = 252;
    pub const CAR_COORDINATES: usize = 256;
    pub const CAR_IDS: usize = 976;
    pub const PLAYER_CAR_ID: usize = 1216;
    /// Cars the coordinate and id arrays hold.
    pub const MAX_CARS: usize = 60;
    pub const NEEDED: usize = PLAYER_CAR_ID + 4;
}

/// Fields of the `static` page.
pub mod statics {
    pub const CAR_MODEL: usize = 68;
    pub const STAGE: usize = 134;
    pub const PLAYER_NAME: usize = 200;
    /// The stage's length in metres (a float).
    pub const STAGE_LENGTH: usize = 520;
    pub const NEEDED: usize = STAGE_LENGTH + 4;
}

/// Reads a clock like `08:40.336` or `1:02:03.456` as milliseconds. Empty or malformed text is `None`.
pub fn parse_clock(text: &str) -> Option<u32> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    let (clock, millis) = match text.split_once('.') {
        Some((clock, frac)) if !frac.is_empty() && frac.chars().all(|c| c.is_ascii_digit()) => {
            // Take the fraction as thousandths whatever its length.
            let padded = format!("{frac:0<3}");
            (clock, padded[..3].parse::<u32>().ok()?)
        }
        Some(_) => return None,
        None => (text, 0),
    };
    let mut seconds = 0u32;
    let parts: Vec<&str> = clock.split(':').collect();
    if parts.is_empty() || parts.len() > 3 {
        return None;
    }
    for part in parts {
        seconds = seconds.checked_mul(60)?.checked_add(part.parse::<u32>().ok()?)?;
    }
    seconds.checked_mul(1000)?.checked_add(millis)
}

/// What the `graphics` page tells us.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Graphics {
    pub packet_id: i32,
    /// The stage clock text as the game wrote it; empty when it shows none.
    pub clock_text: String,
    pub distance_m: f32,
    /// The player's world (x, y, z), when the game gives one.
    pub position: Option<[f32; 3]>,
}

impl Graphics {
    pub fn parse(bytes: &[u8]) -> Self {
        let p = Page(bytes);
        // The coordinate array is indexed like the id array; the player is the entry whose id is `playerCarID`.
        let player_id = p.i32(graphics::PLAYER_CAR_ID).unwrap_or(0);
        let active = p.i32(graphics::ACTIVE_CARS).unwrap_or(0).clamp(0, graphics::MAX_CARS as i32) as usize;
        let slot = (0..active.max(1))
            .find(|&i| p.i32(graphics::CAR_IDS + i * 4) == Some(player_id))
            .unwrap_or(0);
        let at = graphics::CAR_COORDINATES + slot * 12;
        let position = match (p.f32(at), p.f32(at + 4), p.f32(at + 8)) {
            (Some(x), Some(y), Some(z)) if x.is_finite() && y.is_finite() && z.is_finite() && (x != 0.0 || z != 0.0) => Some([x, y, z]),
            _ => None,
        };
        Self {
            packet_id: p.i32(graphics::PACKET_ID).unwrap_or(0),
            clock_text: p.text(graphics::CLOCK_TEXT, 15),
            distance_m: p.f32(graphics::DISTANCE_TRAVELED).filter(|d| d.is_finite() && *d >= 0.0).unwrap_or(0.0),
            position,
        }
    }

    /// The stage clock in milliseconds.
    pub fn clock_ms(&self) -> Option<u32> {
        parse_clock(&self.clock_text)
    }
}

/// What the `static` page tells us.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Static {
    /// The car's name as the game shows it.
    pub car: String,
    /// The stage's name as the game reports it.
    pub stage: String,
    pub driver: String,
    /// The stage's length in metres, `0.0` when the game doesn't report it.
    pub length_m: f32,
}

impl Static {
    pub fn parse(bytes: &[u8]) -> Self {
        let p = Page(bytes);
        Self {
            car: p.text(statics::CAR_MODEL, 33),
            stage: p.text(statics::STAGE, 33),
            driver: p.text(statics::PLAYER_NAME, 33),
            length_m: p.f32(statics::STAGE_LENGTH).filter(|l| l.is_finite() && *l >= 100.0).unwrap_or(0.0),
        }
    }

    /// A stage is loaded: the game fills in the stage name once one is.
    pub fn has_stage(&self) -> bool {
        !self.stage.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn put_i32(buf: &mut [u8], at: usize, v: i32) {
        buf[at..at + 4].copy_from_slice(&v.to_le_bytes());
    }
    fn put_f32(buf: &mut [u8], at: usize, v: f32) {
        buf[at..at + 4].copy_from_slice(&v.to_le_bytes());
    }
    fn put_text(buf: &mut [u8], at: usize, s: &str) {
        for (i, u) in s.encode_utf16().enumerate() {
            buf[at + i * 2..at + i * 2 + 2].copy_from_slice(&u.to_le_bytes());
        }
    }

    #[test]
    fn the_stage_clock_text_is_read_as_milliseconds() {
        // The finish of the recorded stage: the memory held 08:40.336.
        assert_eq!(parse_clock("08:40.336"), Some(520_336));
        assert_eq!(parse_clock("00:00.000"), Some(0));
        assert_eq!(parse_clock("01:50.110"), Some(110_110));
        assert_eq!(parse_clock("1:02:03.456"), Some(3_723_456), "hours, in case a stage is ever that long");
        assert_eq!(parse_clock("12:05.5"), Some(725_500), "a short fraction is thousandths, padded");
        assert_eq!(parse_clock("12:05"), Some(725_000));
    }

    #[test]
    fn no_clock_or_a_malformed_one_is_none() {
        for bad in ["", "   ", "abc", "12:xx.100", ":.", "12:05.", "1:2:3:4.000", "-1:00.000"] {
            assert_eq!(parse_clock(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn graphics_fields_are_read_from_their_offsets_and_the_player_is_found_by_id() {
        let mut b = vec![0u8; graphics::NEEDED];
        put_i32(&mut b, graphics::PACKET_ID, 9899);
        put_text(&mut b, graphics::CLOCK_TEXT, "01:50.110");
        put_f32(&mut b, graphics::DISTANCE_TRAVELED, 2454.6);
        // Two cars; the player's id is 7 and sits in slot 1.
        put_i32(&mut b, graphics::ACTIVE_CARS, 2);
        put_i32(&mut b, graphics::CAR_IDS, 3);
        put_i32(&mut b, graphics::CAR_IDS + 4, 7);
        put_i32(&mut b, graphics::PLAYER_CAR_ID, 7);
        put_f32(&mut b, graphics::CAR_COORDINATES, 1.0);
        put_f32(&mut b, graphics::CAR_COORDINATES + 8, 2.0);
        put_f32(&mut b, graphics::CAR_COORDINATES + 12, 1632.0);
        put_f32(&mut b, graphics::CAR_COORDINATES + 16, 438.7);
        put_f32(&mut b, graphics::CAR_COORDINATES + 20, -569.5);
        let g = Graphics::parse(&b);
        assert_eq!((g.packet_id, g.clock_text.as_str(), g.clock_ms()), (9899, "01:50.110", Some(110_110)));
        assert_eq!(g.distance_m, 2454.6);
        assert_eq!(g.position, Some([1632.0, 438.7, -569.5]));
    }

    #[test]
    fn with_no_car_ids_the_player_is_the_first_entry_as_the_recorded_game_has_it() {
        let mut b = vec![0u8; graphics::NEEDED];
        put_f32(&mut b, graphics::CAR_COORDINATES, 1662.2);
        put_f32(&mut b, graphics::CAR_COORDINATES + 4, 469.0);
        put_f32(&mut b, graphics::CAR_COORDINATES + 8, -56.3);
        assert_eq!(Graphics::parse(&b).position, Some([1662.2, 469.0, -56.3]));
    }

    #[test]
    fn a_cleared_page_in_the_menus_has_no_clock_no_position_and_no_stage() {
        let g = Graphics::parse(&vec![0u8; graphics::NEEDED]);
        assert_eq!((g.clock_ms(), g.position, g.distance_m), (None, None, 0.0));
        assert!(!Static::parse(&vec![0u8; statics::NEEDED]).has_stage());
    }

    #[test]
    fn static_fields_are_the_names_and_the_stage_length() {
        let mut b = vec![0u8; statics::NEEDED];
        put_text(&mut b, statics::CAR_MODEL, "Peugeot 206 WRC");
        put_text(&mut b, statics::STAGE, "Wales Afon Biga");
        put_text(&mut b, statics::PLAYER_NAME, "Axeora");
        put_f32(&mut b, statics::STAGE_LENGTH, 12_077.0);
        let s = Static::parse(&b);
        assert_eq!((s.car.as_str(), s.stage.as_str(), s.driver.as_str(), s.length_m), ("Peugeot 206 WRC", "Wales Afon Biga", "Axeora", 12_077.0));
        assert!(s.has_stage());
        // A bogus length is no length.
        put_f32(&mut b, statics::STAGE_LENGTH, 3.0);
        assert_eq!(Static::parse(&b).length_m, 0.0);
    }
}
