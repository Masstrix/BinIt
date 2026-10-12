//! The "acpmf" shared-memory family: Assetto Corsa, Assetto Corsa Competizione and Assetto Corsa Rally
//! all publish their telemetry as three named pages, `Local\acpmf_physics`, `Local\acpmf_graphics` and
//! `Local\acpmf_static`, in the style of Kunos' published shared-memory header: `#pragma pack(4)`,
//! 4-byte ints and floats, UTF-16 strings.
//!
//! What is common to the family lives here: the page names, a reader for fields at byte offsets, the
//! physics page (the same in every game that was checked) and the code that opens the three pages. What
//! differs (the graphics and static pages, and what the numbers mean) lives in each game's own module,
//! `ac/` and `acr/`.

/// Names of the three pages.
pub const PHYSICS_PAGE: &str = "Local\\acpmf_physics";
pub const GRAPHICS_PAGE: &str = "Local\\acpmf_graphics";
pub const STATIC_PAGE: &str = "Local\\acpmf_static";

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

/// Fields of the `physics` page.
pub mod physics {
    pub const PACKET_ID: usize = 0;
    pub const GAS: usize = 4;
    pub const BRAKE: usize = 8;
    pub const GEAR: usize = 16;
    pub const RPM: usize = 20;
    pub const STEER_ANGLE: usize = 24;
    pub const SPEED_KMH: usize = 28;
    /// How many tyres are outside the track limits right now (0 to 4). Not every game fills it in.
    pub const TYRES_OUT: usize = 244;
    /// 1.0 with the pedal released, 0.0 pressed.
    pub const CLUTCH: usize = 364;
    /// Bytes to copy: up to and including `CLUTCH`.
    pub const NEEDED: usize = CLUTCH + 4;
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

/// The games number gears 0 = reverse, 1 = neutral, 2 = first. TimeTrial uses what drivers call them:
/// -1 = reverse, 0 = neutral, 1 = first.
pub fn display_gear(raw: i32) -> i16 {
    raw.saturating_sub(1).clamp(i16::MIN as i32, i16::MAX as i32) as i16
}

/// Pedals, steering and gear from the physics page, in the ranges TimeTrial uses.
pub fn inputs(p: &Physics) -> crate::Inputs {
    crate::Inputs {
        throttle: p.gas.clamp(0.0, 1.0),
        brake: p.brake.clamp(0.0, 1.0),
        // The games report 1.0 with the pedal released; TimeTrial wants 1.0 for pressed.
        clutch: (1.0 - p.clutch).clamp(0.0, 1.0),
        handbrake: 0.0,
        steering: p.steer_angle.clamp(-1.0, 1.0),
        gear: display_gear(p.gear),
        speed_kmh: p.speed_kmh.max(0.0),
        rpm: p.rpm.clamp(0, u16::MAX as i32) as u16,
    }
}

/// The three open pages.
#[cfg(windows)]
pub struct Pages {
    physics: crate::shm::SharedMemory,
    graphics: crate::shm::SharedMemory,
    statics: crate::shm::SharedMemory,
}

#[cfg(windows)]
impl Pages {
    /// Opens the pages without checking that the game has filled them in. `min_graphics` and
    /// `min_statics` are the fewest bytes the caller's layout needs: a smaller page means another app
    /// created it first, or the game's layout changed.
    pub fn open(min_graphics: usize, min_statics: usize) -> anyhow::Result<Self> {
        use crate::shm::SharedMemory;
        let physics = SharedMemory::open(PHYSICS_PAGE)?;
        let graphics = SharedMemory::open(GRAPHICS_PAGE)?;
        let statics = SharedMemory::open(STATIC_PAGE)?;
        if graphics.region_size() < min_graphics || statics.region_size() < min_statics || physics.region_size() < physics::GAS + 4 {
            anyhow::bail!(
                "shared memory pages are smaller than expected (physics {}, graphics {} of at least {min_graphics}, static {} of at least {min_statics}): another app may have created them first, or the game's layout changed",
                physics.region_size(),
                graphics.region_size(),
                statics.region_size(),
            );
        }
        Ok(Self { physics, graphics, statics })
    }

    pub fn physics(&self, len: usize) -> Vec<u8> {
        self.physics.bytes(len)
    }

    pub fn graphics(&self, len: usize) -> Vec<u8> {
        self.graphics.bytes(len)
    }

    pub fn statics(&self, len: usize) -> Vec<u8> {
        self.statics.bytes(len)
    }

    /// The graphics page's packet counter, to tell whether a read caught the game mid-write.
    pub fn graphics_packet(&self) -> i32 {
        i32::from_le_bytes(self.graphics.bytes(4).try_into().unwrap_or([0; 4]))
    }

    /// The whole of each page, for diagnostics.
    pub fn physics_all(&self) -> Vec<u8> {
        self.physics.bytes(self.physics.region_size())
    }

    pub fn graphics_all(&self) -> Vec<u8> {
        self.graphics.bytes(self.graphics.region_size())
    }

    pub fn statics_all(&self) -> Vec<u8> {
        self.statics.bytes(self.statics.region_size())
    }
}
