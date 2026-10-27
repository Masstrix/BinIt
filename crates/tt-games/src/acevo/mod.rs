//! Assetto Corsa EVO adapter.
//!
//! Reads the game's official shared memory (`Local\acevo_pmf_*`). Only the `graphics`
//! (per-frame HUD data) and `static` (per-session) pages are used, plus the first few hundred bytes of the
//! 333 Hz physics page for the car's heading, slip and turbo. Polling at 20 Hz copies ~9 KB per tick:
//! microseconds of work.

pub mod documents;
pub mod layout;

use std::time::{Duration, Instant};

use crate::{CompletedLap, GameAdapter, GameEvent, GameId, LiveState, SessionInfo, TimingKind};
use layout::{Graphics, Static, c_str};
pub use crate::tracker::{DetectedLap, LapTracker, Sample};

/// The bundled list of cars and tracks, in the names the game reports.
pub const CATALOGUE_JSON: &str = include_str!("catalogue.json");

pub const PROCESS_NAME: &str = "AssettoCorsaEVO.exe";
pub const GRAPHICS_PAGE: &str = "Local\\acevo_pmf_graphics";
pub const STATIC_PAGE: &str = "Local\\acevo_pmf_static";
/// The 333 Hz physics page. The adapter never opens it; the dev Memory page does, to look for heading and slip.
pub const PHYSICS_PAGE: &str = "Local\\acevo_pmf_physics";

const CONNECTED_POLL: Duration = Duration::from_millis(50);
const DISCONNECTED_POLL: Duration = Duration::from_secs(2);
// Live timing (delta, sector bars) wants ~10 updates a second; still trivial to send.
const LIVE_EVERY: Duration = Duration::from_millis(100);

pub fn session_kind_name(session: i32) -> &'static str {
    match session {
        layout::SESSION_TIME_ATTACK => "Time Attack",
        layout::SESSION_RACE => "Race",
        layout::SESSION_HOT_STINT => "Hot Stint",
        layout::SESSION_CRUISE => "Cruise",
        _ => "Unknown",
    }
}

/// Builds the game-agnostic session description from the two pages.
pub fn session_info(g: &Graphics, s: &Static) -> SessionInfo {
    let layout = c_str(&s.track_configuration);
    SessionInfo {
        game: GameId::AssettoCorsaEvo,
        track: c_str(&s.track),
        layout: (!layout.is_empty()).then_some(layout),
        car: c_str(&g.car_model),
        session_kind: session_kind_name(s.session).to_string(),
        timing: TimingKind::CircuitLap,
        length_m: (s.track_length_m > 0.0).then(|| s.track_length_m.round() as u32),
    }
}

/// The player's world (x, z): `car_coordinates` is indexed like `car_ids`.
pub fn player_position(g: &Graphics) -> Option<[f32; 2]> {
    let player = g.player_car_id;
    let ids = g.car_ids;
    let coords = g.car_coordinates;
    let i = ids.iter().position(|id| *id == player).unwrap_or(0);
    let [x, _, z] = coords[i];
    (x.is_finite() && z.is_finite() && (x != 0.0 || z != 0.0)).then_some([x, z])
}

/// The game reports gears like Assetto Corsa always has: 0 = reverse, 1 = neutral, 2 = first gear.
/// Bin It uses what drivers call them: -1 = reverse, 0 = neutral, 1 = first.
pub fn display_gear(raw: i16) -> i16 {
    raw.saturating_sub(1)
}

/// Pedals, steering and gear from the graphics page (`inputs`: rpm%, gas, brake, handbrake, clutch, steering, ...).
pub fn inputs(g: &Graphics) -> crate::Inputs {
    let raw = g.inputs;
    let (gear, speed, rpm) = (display_gear(g.gear_int), g.display_speed_kmh, g.rpm);
    crate::Inputs {
        throttle: raw[1],
        brake: raw[2],
        handbrake: raw[3],
        clutch: raw[4],
        steering: raw[5],
        gear,
        speed_kmh: speed as f32,
        rpm,
        dynamics: None,
    }
}

pub fn sample(g: &Graphics) -> Sample {
    Sample {
        status: g.status,
        lap_count: g.total_lap_count,
        last_lap_ms: g.last_laptime_ms,
        current_lap_ms: g.current_lap_time_ms,
        lap_valid: g.is_valid_lap != 0 && g.timing_state.is_invalid == 0,
        in_pit_lane: g.is_in_pit_lane != 0 || g.is_in_pit_box != 0,
        progress: g.npos,
            inputs: Some(inputs(g)),
}
}

#[cfg(windows)]
pub use connection::Connection;

#[cfg(windows)]
mod connection {
    use anyhow::{Result, bail};

    use super::layout::{Graphics, Static, c_str};
    use super::{GRAPHICS_PAGE, PHYSICS_PAGE, STATIC_PAGE};
    use crate::acpmf::{self, Physics};
    use crate::shm::SharedMemory;

    /// Open handles to the pages we read. The physics page is optional: without it everything but heading and
    /// slip still works.
    pub struct Connection {
        graphics: SharedMemory,
        statics: SharedMemory,
        physics: Option<SharedMemory>,
    }

    impl Connection {
        pub fn open() -> Result<Self> {
            let conn = Self::open_unchecked()?;
            let version = c_str(&conn.read_static().sm_version);
            if version.is_empty() || !version.chars().all(|c| c.is_ascii_graphic()) {
                bail!("static page has no readable version yet");
            }
            Ok(conn)
        }

        /// Opens the pages without checking that the game has filled them in (diagnostics).
        pub fn open_unchecked() -> Result<Self> {
            let graphics = SharedMemory::open(GRAPHICS_PAGE)?;
            let statics = SharedMemory::open(STATIC_PAGE)?;
            if graphics.region_size() < size_of::<Graphics>() {
                bail!(
                    "graphics page is {} bytes, expected at least {} (another app may have created it first, or the game's layout changed)",
                    graphics.region_size(),
                    size_of::<Graphics>()
                );
            }
            let physics = SharedMemory::open(PHYSICS_PAGE).ok().filter(|p| p.region_size() >= acpmf::physics::NEEDED);
            Ok(Self { graphics, statics, physics })
        }

        /// Reads the graphics page, retrying if the game was mid-write.
        pub fn read_graphics(&self) -> Graphics {
            let mut g: Graphics = self.graphics.read().expect("size checked on open");
            for _ in 0..3 {
                let packet_after: i32 = self.graphics.read().expect("size checked on open");
                if packet_after == g.packet_id {
                    break;
                }
                g = self.graphics.read().expect("size checked on open");
            }
            g
        }

        /// The car's motion from the physics page, when the game publishes one.
        pub fn read_physics(&self) -> Option<Physics> {
            self.physics.as_ref().map(|p| Physics::parse(&p.bytes(acpmf::physics::NEEDED)))
        }

        pub fn read_static(&self) -> Static {
            self.statics.read().expect("static page smaller than 208 bytes")
        }

        pub fn graphics_bytes(&self) -> Vec<u8> {
            self.graphics.bytes(self.graphics.region_size())
        }

        pub fn static_bytes(&self) -> Vec<u8> {
            self.statics.bytes(self.statics.region_size())
        }

        pub fn graphics_region_size(&self) -> usize {
            self.graphics.region_size()
        }
    }
}

/// The AC EVO [`GameAdapter`].
pub struct AcEvoAdapter {
    #[cfg(windows)]
    conn: Option<Connection>,
    tracker: LapTracker,
    session: Option<SessionInfo>,
    last_live: Option<Instant>,
}

impl Default for AcEvoAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl AcEvoAdapter {
    pub fn new() -> Self {
        Self {
            #[cfg(windows)]
            conn: None,
            tracker: LapTracker::default(),
            session: None,
            last_live: None,
        }
    }

    fn disconnect(&mut self, events: &mut Vec<GameEvent>) {
        #[cfg(windows)]
        if self.conn.take().is_some() {
            events.push(GameEvent::Disconnected { game: GameId::AssettoCorsaEvo });
        }
        self.tracker.reset();
        self.session = None;
    }
}

impl GameAdapter for AcEvoAdapter {
    fn game(&self) -> GameId {
        GameId::AssettoCorsaEvo
    }

    fn timing_kind(&self) -> TimingKind {
        TimingKind::CircuitLap
    }

    fn poll_interval(&self) -> Duration {
        #[cfg(windows)]
        if self.conn.is_some() {
            return CONNECTED_POLL;
        }
        DISCONNECTED_POLL
    }

    #[cfg(not(windows))]
    fn poll(&mut self) -> Vec<GameEvent> {
        Vec::new()
    }

    #[cfg(windows)]
    fn poll(&mut self) -> Vec<GameEvent> {
        let mut events = Vec::new();

        if self.conn.is_none() {
            if !crate::is_process_running(PROCESS_NAME) {
                return events;
            }
            match Connection::open() {
                Ok(conn) => {
                    let game_version = c_str(&conn.read_static().ac_evo_version);
                    events.push(GameEvent::Connected { game: GameId::AssettoCorsaEvo, game_version });
                    self.conn = Some(conn);
                }
                Err(_) => return events,
            }
        }

        let conn = self.conn.as_ref().expect("connected above");
        let g = conn.read_graphics();

        if g.status == layout::STATUS_OFF && !crate::is_process_running(PROCESS_NAME) {
            self.disconnect(&mut events);
            return events;
        }

        if g.status == layout::STATUS_LIVE {
            let info = session_info(&g, &conn.read_static());
            if self.session.as_ref() != Some(&info) && !info.track.is_empty() {
                // New car/track: laps in progress belong to the old combo.
                self.tracker.reset();
                self.session = Some(info.clone());
                events.push(GameEvent::SessionChanged(info));
            }
        }

        if let Some(lap) = self.tracker.update(sample(&g))
            && let Some(session) = self.session.clone()
        {
            events.push(GameEvent::LapCompleted(CompletedLap {
                session,
                lap_number: lap.lap_number,
                time_ms: lap.time_ms,
                valid: lap.untimed.is_none(),
                untimed: lap.untimed,
                sectors_ms: Vec::new(),
                profile: lap.profile,
                trace: lap.trace,
            }));
        }

        let now = Instant::now();
        if self.last_live.is_none_or(|t| now.duration_since(t) >= LIVE_EVERY) {
            self.last_live = Some(now);
            events.push(GameEvent::Live(LiveState {
                driving: g.status == layout::STATUS_LIVE,
                phase: match g.status {
                    layout::STATUS_LIVE => crate::GamePhase::Driving,
                    layout::STATUS_PAUSE => crate::GamePhase::Paused,
                    layout::STATUS_REPLAY => crate::GamePhase::Replay,
                    _ => crate::GamePhase::Menu,
                },
                current_lap_ms: g.current_lap_time_ms.max(0) as u32,
                lap_valid: sample(&g).lap_valid,
                out_lap: self.tracker.on_out_lap(),
                lap_progress: g.npos.clamp(0.0, 1.0),
                position: player_position(&g),
                inputs: Some(crate::Inputs {
                    dynamics: conn.read_physics().map(|p| crate::dynamics::Dynamics::from_physics(&p)),
                    ..inputs(&g)
                }),
            }));
        }

        events
    }
}

#[cfg(test)]
mod gear_tests {
    use super::display_gear;

    #[test]
    fn the_games_gear_numbers_become_the_ones_drivers_use() {
        assert_eq!(display_gear(0), -1, "reverse");
        assert_eq!(display_gear(1), 0, "neutral");
        assert_eq!(display_gear(2), 1, "first gear");
        assert_eq!(display_gear(7), 6);
        assert_eq!(display_gear(i16::MIN), i16::MIN, "never wraps");
    }
}
