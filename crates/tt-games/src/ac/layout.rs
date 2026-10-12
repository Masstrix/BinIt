//! Memory layout of Assetto Corsa's shared-memory pages.
//!
//! The three pages (`Local\acpmf_physics`, `Local\acpmf_graphics`, `Local\acpmf_static`) are the
//! `SPageFilePhysics`, `SPageFileGraphic` and `SPageFileStatic` structs from Kunos' published shared
//! memory header: `#pragma pack(4)`, 4-byte ints and floats, and UTF-16 strings (`wchar_t`).
//!
//! Instead of mirroring the structs we read the handful of fields we use at named byte offsets from a
//! copy of the page. That keeps every layout assumption in this file, makes a game update that moves
//! things easy to spot, and means a page that is shorter than expected (an older version) just leaves
//! the later fields unset instead of failing. The offsets were checked against a running game with
//! `cargo run -p tt-games --example ac_probe`.

/// Fields of the `physics` page.
pub mod physics {
    pub const PACKET_ID: usize = 0;
    pub const GAS: usize = 4;
    pub const BRAKE: usize = 8;
    pub const GEAR: usize = 16;
    pub const RPM: usize = 20;
    pub const STEER_ANGLE: usize = 24;
    pub const SPEED_KMH: usize = 28;
    /// How many tyres are outside the track limits right now (0 to 4).
    pub const TYRES_OUT: usize = 244;
    /// 1.0 with the pedal released, 0.0 pressed.
    pub const CLUTCH: usize = 364;
    /// Bytes to copy: up to and including `CLUTCH`.
    pub const NEEDED: usize = CLUTCH + 4;
}

/// Fields of the `graphics` page.
pub mod graphics {
    pub const PACKET_ID: usize = 0;
    pub const STATUS: usize = 4;
    pub const SESSION: usize = 8;
    pub const COMPLETED_LAPS: usize = 132;
    pub const CURRENT_TIME_MS: usize = 140;
    pub const LAST_TIME_MS: usize = 144;
    pub const BEST_TIME_MS: usize = 148;
    pub const IS_IN_PIT: usize = 160;
    pub const CURRENT_SECTOR: usize = 164;
    /// 0..1 around the lap.
    pub const NORMALIZED_POSITION: usize = 248;
    /// The player's world position: three floats (x, y, z).
    pub const CAR_COORDINATES: usize = 252;
    pub const IS_IN_PIT_LANE: usize = 276;
    pub const NEEDED: usize = IS_IN_PIT_LANE + 4;
}

/// Fields of the `static` page.
pub mod statics {
    pub const SM_VERSION: usize = 0;
    pub const AC_VERSION: usize = 30;
    pub const CAR_MODEL: usize = 68;
    pub const TRACK: usize = 134;
    pub const SECTOR_COUNT: usize = 400;
    /// Track length in metres. Added to the game later than the fields above, so it can be missing.
    pub const TRACK_SPLINE_LENGTH: usize = 520;
    pub const TRACK_CONFIGURATION: usize = 524;
    /// Bytes to copy: everything up to the layout name.
    pub const NEEDED: usize = TRACK_CONFIGURATION + 30;
    /// Fewest bytes that still hold the car and track names.
    pub const MINIMUM: usize = SECTOR_COUNT + 4;
}

pub const SESSION_UNKNOWN: i32 = -1;
pub const SESSION_PRACTICE: i32 = 0;
pub const SESSION_QUALIFY: i32 = 1;
pub const SESSION_RACE: i32 = 2;
pub const SESSION_HOTLAP: i32 = 3;
pub const SESSION_TIME_ATTACK: i32 = 4;
pub const SESSION_DRIFT: i32 = 5;
pub const SESSION_DRAG: i32 = 6;

/// A copy of one page, read at byte offsets. Reads past the end give `None` / an empty string.
pub struct Page<'a>(pub &'a [u8]);

impl Page<'_> {
    pub fn i32(&self, at: usize) -> Option<i32> {
        self.0.get(at..at + 4).map(|b| i32::from_le_bytes(b.try_into().expect("4 bytes")))
    }

    pub fn f32(&self, at: usize) -> Option<f32> {
        self.0.get(at..at + 4).map(|b| f32::from_le_bytes(b.try_into().expect("4 bytes")))
    }

    /// A UTF-16 string of at most `chars` characters, up to the first NUL.
    pub fn text(&self, at: usize, chars: usize) -> String {
        let Some(bytes) = self.0.get(at..(at + chars * 2).min(self.0.len())) else { return String::new() };
        let units: Vec<u16> = bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).take_while(|&u| u != 0).collect();
        String::from_utf16_lossy(&units)
    }
}

/// What the `physics` page tells us.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Physics {
    pub gas: f32,
    pub brake: f32,
    pub clutch: f32,
    /// As the game numbers them: 0 = reverse, 1 = neutral, 2 = first.
    pub gear: i32,
    pub rpm: i32,
    pub steer_angle: f32,
    pub speed_kmh: f32,
    pub tyres_out: i32,
}

impl Physics {
    pub fn parse(bytes: &[u8]) -> Self {
        let p = Page(bytes);
        Self {
            gas: p.f32(physics::GAS).unwrap_or(0.0),
            brake: p.f32(physics::BRAKE).unwrap_or(0.0),
            clutch: p.f32(physics::CLUTCH).unwrap_or(0.0),
            gear: p.i32(physics::GEAR).unwrap_or(1),
            rpm: p.i32(physics::RPM).unwrap_or(0),
            steer_angle: p.f32(physics::STEER_ANGLE).unwrap_or(0.0),
            speed_kmh: p.f32(physics::SPEED_KMH).unwrap_or(0.0),
            tyres_out: p.i32(physics::TYRES_OUT).unwrap_or(0),
        }
    }
}

/// What the `graphics` page tells us.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Graphics {
    pub packet_id: i32,
    /// 0 off, 1 replay, 2 live, 3 paused.
    pub status: i32,
    pub session: i32,
    pub completed_laps: i32,
    pub current_time_ms: i32,
    pub last_time_ms: i32,
    pub best_time_ms: i32,
    pub in_pit: bool,
    pub in_pit_lane: bool,
    pub current_sector: i32,
    pub progress: f32,
    /// World (x, y, z) of the player's car.
    pub position: [f32; 3],
}

impl Graphics {
    pub fn parse(bytes: &[u8]) -> Self {
        let p = Page(bytes);
        let coords = graphics::CAR_COORDINATES;
        Self {
            packet_id: p.i32(graphics::PACKET_ID).unwrap_or(0),
            status: p.i32(graphics::STATUS).unwrap_or(0),
            session: p.i32(graphics::SESSION).unwrap_or(SESSION_UNKNOWN),
            completed_laps: p.i32(graphics::COMPLETED_LAPS).unwrap_or(0),
            current_time_ms: p.i32(graphics::CURRENT_TIME_MS).unwrap_or(0),
            last_time_ms: p.i32(graphics::LAST_TIME_MS).unwrap_or(0),
            best_time_ms: p.i32(graphics::BEST_TIME_MS).unwrap_or(0),
            in_pit: p.i32(graphics::IS_IN_PIT).unwrap_or(0) != 0,
            in_pit_lane: p.i32(graphics::IS_IN_PIT_LANE).unwrap_or(0) != 0,
            current_sector: p.i32(graphics::CURRENT_SECTOR).unwrap_or(0),
            progress: p.f32(graphics::NORMALIZED_POSITION).unwrap_or(0.0),
            position: [p.f32(coords).unwrap_or(0.0), p.f32(coords + 4).unwrap_or(0.0), p.f32(coords + 8).unwrap_or(0.0)],
        }
    }
}

/// What the `static` page tells us: set once per session.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Static {
    pub sm_version: String,
    pub ac_version: String,
    /// The car's folder name, like `ks_porsche_911_gt3_r_2016`.
    pub car_model: String,
    /// The track's folder name, like `ks_brands_hatch`.
    pub track: String,
    /// The layout's folder name, like `gp` or `layout_gp_b`; empty for a track with one layout.
    pub track_configuration: String,
    pub sector_count: i32,
    /// Track length in metres, `0.0` when the game doesn't report it.
    pub track_length_m: f32,
}

impl Static {
    pub fn parse(bytes: &[u8]) -> Self {
        let p = Page(bytes);
        Self {
            sm_version: p.text(statics::SM_VERSION, 15),
            ac_version: p.text(statics::AC_VERSION, 15),
            car_model: p.text(statics::CAR_MODEL, 33),
            track: p.text(statics::TRACK, 33),
            track_configuration: p.text(statics::TRACK_CONFIGURATION, 15),
            sector_count: p.i32(statics::SECTOR_COUNT).unwrap_or(0),
            track_length_m: p.f32(statics::TRACK_SPLINE_LENGTH).filter(|l| l.is_finite() && *l > 0.0).unwrap_or(0.0),
        }
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
    fn graphics_fields_are_read_from_their_offsets() {
        let mut b = vec![0u8; graphics::NEEDED];
        put_i32(&mut b, graphics::STATUS, 2);
        put_i32(&mut b, graphics::SESSION, SESSION_HOTLAP);
        put_i32(&mut b, graphics::COMPLETED_LAPS, 7);
        put_i32(&mut b, graphics::CURRENT_TIME_MS, 31_250);
        put_i32(&mut b, graphics::LAST_TIME_MS, 102_318);
        put_i32(&mut b, graphics::IS_IN_PIT_LANE, 1);
        put_f32(&mut b, graphics::NORMALIZED_POSITION, 0.25);
        put_f32(&mut b, graphics::CAR_COORDINATES, 10.0);
        put_f32(&mut b, graphics::CAR_COORDINATES + 8, -20.0);
        let g = Graphics::parse(&b);
        assert_eq!((g.status, g.session, g.completed_laps), (2, SESSION_HOTLAP, 7));
        assert_eq!((g.current_time_ms, g.last_time_ms), (31_250, 102_318));
        assert!(g.in_pit_lane && !g.in_pit);
        assert_eq!((g.progress, g.position), (0.25, [10.0, 0.0, -20.0]));
    }

    #[test]
    fn static_strings_are_utf16_and_stop_at_the_first_nul() {
        let mut b = vec![0u8; statics::NEEDED];
        put_text(&mut b, statics::SM_VERSION, "1.7");
        put_text(&mut b, statics::CAR_MODEL, "ks_porsche_911_gt3_r_2016");
        put_text(&mut b, statics::TRACK, "ks_nurburgring");
        put_text(&mut b, statics::TRACK_CONFIGURATION, "layout_gp_b");
        put_f32(&mut b, statics::TRACK_SPLINE_LENGTH, 5148.0);
        let s = Static::parse(&b);
        assert_eq!((s.sm_version.as_str(), s.car_model.as_str()), ("1.7", "ks_porsche_911_gt3_r_2016"));
        assert_eq!((s.track.as_str(), s.track_configuration.as_str(), s.track_length_m), ("ks_nurburgring", "layout_gp_b", 5148.0));
    }

    #[test]
    fn an_older_shorter_static_page_just_lacks_the_later_fields() {
        let mut b = vec![0u8; statics::MINIMUM];
        put_text(&mut b, statics::TRACK, "monza");
        let s = Static::parse(&b);
        assert_eq!(s.track, "monza");
        assert_eq!((s.track_configuration.as_str(), s.track_length_m), ("", 0.0));
    }

    #[test]
    fn physics_inputs_are_read_and_a_short_page_defaults_to_neutral() {
        let mut b = vec![0u8; physics::NEEDED];
        put_f32(&mut b, physics::GAS, 0.8);
        put_f32(&mut b, physics::BRAKE, 0.1);
        put_i32(&mut b, physics::GEAR, 4);
        put_i32(&mut b, physics::RPM, 7200);
        put_f32(&mut b, physics::SPEED_KMH, 188.5);
        put_i32(&mut b, physics::TYRES_OUT, 3);
        let p = Physics::parse(&b);
        assert_eq!((p.gas, p.brake, p.gear, p.rpm, p.speed_kmh, p.tyres_out), (0.8, 0.1, 4, 7200, 188.5, 3));
        let empty = Physics::parse(&[]);
        assert_eq!((empty.gear, empty.tyres_out), (1, 0), "neutral and nothing out when the page is missing");
    }
}
