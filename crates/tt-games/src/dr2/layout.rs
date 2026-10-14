//! DiRT Rally 2.0's UDP telemetry packet (`extradata="3"`): 66 little-endian `f32`s, 264 bytes, sent about
//! 72 times a second while a stage is loaded.
//!
//! Every index below was read from recordings of the real game (a 9.67 km and a 2.85 km stage, one clean
//! run and one with three penalties, restarts and pauses). The community documentation of this format is
//! thin and partly wrong: the stage length is not at index 62, and the "total distance" at index 3 is a
//! 0..1 progress. What was checked, and what was not, is in `docs/telemetry-data.md`.
//!
//! The packet has **no names**: no stage, no car, no driver. A stage is told apart by its length and a car
//! by its engine (see `known.rs`).
//!
//! Keep every assumption about the layout here, as a named index, so a game update is a one-line change.

/// Floats in a packet.
pub const PACKET_FLOATS: usize = 66;
pub const PACKET_BYTES: usize = PACKET_FLOATS * 4;

/// Indices into the packet.
pub mod idx {
    /// Seconds since the game's session began. Frozen while the game is paused.
    pub const SESSION_TIME: usize = 0;
    /// The stage clock in seconds: 0 before the go, then runs. Includes every penalty added so far (a
    /// jump start starts it at 10.000). Reads 0 again from the finish packet on.
    pub const STAGE_TIME: usize = 1;
    /// Distance driven along the stage, metres. About -2.3 on the start line, passing the stage length at
    /// the finish line.
    pub const DISTANCE: usize = 2;
    /// Progress along the stage, 0..1; jumps to 2.0 in the finish packet.
    pub const PROGRESS: usize = 3;
    pub const POS_X: usize = 4;
    pub const POS_Y: usize = 5;
    pub const POS_Z: usize = 6;
    /// Speed, metres per second.
    pub const SPEED: usize = 7;
    pub const THROTTLE: usize = 29;
    /// -1 (left) .. 1 (right).
    pub const STEERING: usize = 30;
    pub const BRAKE: usize = 31;
    pub const CLUTCH: usize = 32;
    /// -1 reverse, 0 neutral, 1.. forward.
    pub const GEAR: usize = 33;
    /// Stages completed this run: 0, and 1 from the finish packet on.
    pub const STAGES_DONE: usize = 36;
    /// Engine speed, as rpm divided by 10 (see [`RPM_SCALE`]).
    pub const RPM: usize = 37;
    /// The game's own split count: how many splits the car has passed (one per stretch of the stage).
    pub const SPLITS: usize = 48;
    /// 0, and 1 in the finish packet and the few after it.
    pub const COMPLETE: usize = 59;
    /// The stage length, metres. Constant while a stage is loaded.
    pub const STAGE_LENGTH: usize = 61;
    /// The final stage time in seconds, set in the finish packet (0 before). Penalties included.
    pub const FINAL_TIME: usize = 62;
    /// The car's maximum engine speed, same unit as [`RPM`].
    pub const MAX_RPM: usize = 63;
    pub const IDLE_RPM: usize = 64;
    /// Number of forward gears.
    pub const GEARS: usize = 65;
}

/// The rpm fields hold engine speed divided by 10 (a value of 733 for a 7 330 rpm limiter).
pub const RPM_SCALE: f32 = 10.0;

/// One telemetry packet, with the fields Bin It uses.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Packet {
    pub session_s: f32,
    pub stage_s: f32,
    pub distance_m: f32,
    pub progress: f32,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub speed_ms: f32,
    pub throttle: f32,
    pub steering: f32,
    pub brake: f32,
    pub clutch: f32,
    pub gear: i16,
    pub rpm: f32,
    pub splits: u8,
    pub complete: bool,
    pub length_m: f32,
    pub final_s: f32,
    pub max_rpm: f32,
    pub idle_rpm: f32,
    pub gears: u8,
}

impl Packet {
    /// Reads a packet. `None` for anything that is not the 66-float format (another `extradata` setting
    /// sends a different size).
    pub fn parse(bytes: &[u8]) -> Option<Self> {
        if bytes.len() != PACKET_BYTES {
            return None;
        }
        let mut f = [0f32; PACKET_FLOATS];
        for (slot, chunk) in f.iter_mut().zip(bytes.chunks_exact(4)) {
            *slot = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        }
        Some(Self::from_floats(&f))
    }

    pub fn from_floats(f: &[f32; PACKET_FLOATS]) -> Self {
        Self {
            session_s: f[idx::SESSION_TIME],
            stage_s: f[idx::STAGE_TIME],
            distance_m: f[idx::DISTANCE],
            progress: f[idx::PROGRESS],
            x: f[idx::POS_X],
            y: f[idx::POS_Y],
            z: f[idx::POS_Z],
            speed_ms: f[idx::SPEED],
            throttle: f[idx::THROTTLE],
            steering: f[idx::STEERING],
            brake: f[idx::BRAKE],
            clutch: f[idx::CLUTCH],
            gear: f[idx::GEAR].round() as i16,
            rpm: f[idx::RPM] * RPM_SCALE,
            splits: f[idx::SPLITS].max(0.0) as u8,
            complete: f[idx::COMPLETE] >= 1.0 && f[idx::FINAL_TIME] > 0.0,
            length_m: f[idx::STAGE_LENGTH],
            final_s: f[idx::FINAL_TIME],
            max_rpm: f[idx::MAX_RPM] * RPM_SCALE,
            idle_rpm: f[idx::IDLE_RPM] * RPM_SCALE,
            gears: f[idx::GEARS].max(0.0) as u8,
        }
    }

    /// True when a stage is loaded: the game sends an all-zero packet once it leaves one.
    pub fn has_stage(&self) -> bool {
        self.length_m > 0.0
    }

    /// The stage clock in milliseconds, or `None` when no stage is loaded.
    pub fn clock_ms(&self) -> Option<u32> {
        self.has_stage().then(|| (self.stage_s.max(0.0) as f64 * 1000.0).round() as u32)
    }

    /// The game's final time for the stage, once it is finished. The game shows its time to the
    /// millisecond *truncated* (192.55795 s is 3:12.557), so that is what is stored.
    pub fn final_time_ms(&self) -> Option<u32> {
        self.complete.then(|| (self.final_s as f64 * 1000.0).floor() as u32)
    }

    /// World position on the ground plane (x, z).
    pub fn position(&self) -> [f32; 2] {
        [self.x, self.z]
    }

    pub fn speed_kmh(&self) -> f32 {
        self.speed_ms * 3.6
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real packets from the game, one after another: before the go, mid-stage, the packet after a 4 s
    /// penalty, the finish, and the all-zero packet that ends the stream.
    const PACKETS: &[u8] = include_bytes!("fixtures/packets.bin");

    fn packet(n: usize) -> Packet {
        Packet::parse(&PACKETS[n * PACKET_BYTES..(n + 1) * PACKET_BYTES]).unwrap()
    }

    #[test]
    fn a_packet_before_the_go_has_a_stage_but_no_clock_yet() {
        let p = packet(0);
        assert!(p.has_stage());
        assert_eq!(p.clock_ms(), Some(0));
        assert!((p.length_m - 2845.63).abs() < 0.1);
        assert!(p.distance_m < 0.0, "the start line is at about -2.3 m: {}", p.distance_m);
        assert!(!p.complete);
    }

    #[test]
    fn a_packet_mid_stage_reads_the_driving_fields() {
        let p = packet(1);
        assert!(p.clock_ms().unwrap() > 1_000);
        assert!((0.0..=1.0).contains(&p.progress));
        assert!((0.0..=1.0).contains(&p.throttle) && (0.0..=1.0).contains(&p.brake));
        assert!((-1.0..=1.0).contains(&p.steering));
        assert!((1..=6).contains(&p.gear), "{}", p.gear);
        assert!(p.speed_kmh() > 0.0);
        // The car's engine: idle 1 466 rpm and limiter 7 330 rpm, from the recordings.
        assert!((p.max_rpm - 7_330.4).abs() < 1.0 && (p.idle_rpm - 1_466.1).abs() < 1.0, "{} {}", p.max_rpm, p.idle_rpm);
        assert_eq!(p.gears, 6);
    }

    #[test]
    fn the_finish_packet_carries_the_games_final_time_truncated_to_the_millisecond() {
        let p = packet(3);
        assert!(p.complete);
        assert_eq!(p.clock_ms(), Some(0), "the stage clock reads zero from the finish packet on");
        assert_eq!(p.final_time_ms(), Some(192_557), "the game showed 3:12.557 (the packet holds 192.55795)");
        assert!(p.progress > 1.5, "{}", p.progress);
    }

    #[test]
    fn the_last_packet_has_no_stage() {
        let p = packet(4);
        assert!(!p.has_stage());
        assert_eq!((p.clock_ms(), p.final_time_ms()), (None, None));
    }

    #[test]
    fn anything_but_the_66_float_format_is_ignored() {
        assert!(Packet::parse(&PACKETS[..PACKET_BYTES - 4]).is_none());
        assert!(Packet::parse(&[]).is_none());
    }

    #[test]
    fn the_final_time_floors_whole_milliseconds() {
        let mut f = [0f32; PACKET_FLOATS];
        f[idx::COMPLETE] = 1.0;
        f[idx::STAGE_LENGTH] = 1000.0;
        f[idx::FINAL_TIME] = 156.021_01;
        assert_eq!(Packet::from_floats(&f).final_time_ms(), Some(156_021));
        f[idx::FINAL_TIME] = 469.879_5;
        assert_eq!(Packet::from_floats(&f).final_time_ms(), Some(469_879));
    }
}
