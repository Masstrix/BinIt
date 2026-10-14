//! Assetto Corsa (the original) adapter.
//!
//! Reads the game's official shared memory (`Local\acpmf_*`): the `graphics` page for the lap clock,
//! lap counter, pit state and position, the `physics` page for pedals, steering, gear and track limits,
//! and the `static` page for the car and track. Lap detection is the shared [`LapTracker`]; this module
//! only turns the pages into [`Sample`]s and session descriptions. Everything specific to this game
//! lives in this folder: its memory layout, its catalogue seed and its document scanner.
//!
//! Assetto Corsa names cars, tracks and layouts by folder (`ks_porsche_911_gt3_r_2016`,
//! `ks_brands_hatch`, `gp`). Those are stored as they are, so they match what the game's own files
//! say; the UI prettifies them for display.

pub mod documents;
pub mod layout;

use std::time::{Duration, Instant};

use crate::tracker::{LapTracker, STATUS_LIVE, STATUS_OFF, STATUS_PAUSE, STATUS_REPLAY, Sample};
use crate::{CompletedLap, GameAdapter, GameEvent, GameId, GamePhase, LiveState, SessionInfo, TimingKind};
use layout::{Graphics, Physics, Static};

/// The bundled list of stock cars and tracks (the rest comes from the player's own files).
pub const CATALOGUE_JSON: &str = include_str!("catalogue.json");

/// The game's executables: 64-bit, then the 32-bit build some installs still use.
pub const PROCESS_NAMES: [&str; 2] = ["acs.exe", "acs_x86.exe"];
pub use crate::acpmf::{GRAPHICS_PAGE, PHYSICS_PAGE, STATIC_PAGE};

const CONNECTED_POLL: Duration = Duration::from_millis(50);
const DISCONNECTED_POLL: Duration = Duration::from_secs(2);
const LIVE_EVERY: Duration = Duration::from_millis(100);

/// The game's own rule for cutting is "more than two tyres outside the limits"; the shared memory only
/// gives us the number of tyres out, so a lap is flagged when it passes that.
pub const MAX_TYRES_OUT: i32 = 2;

pub fn is_running() -> bool {
    PROCESS_NAMES.iter().any(|name| crate::is_process_running(name))
}

pub fn session_kind_name(session: i32) -> &'static str {
    match session {
        layout::SESSION_PRACTICE => "Practice",
        layout::SESSION_QUALIFY => "Qualify",
        layout::SESSION_RACE => "Race",
        layout::SESSION_HOTLAP => "Hotlap",
        layout::SESSION_TIME_ATTACK => "Time Attack",
        layout::SESSION_DRIFT => "Drift",
        layout::SESSION_DRAG => "Drag",
        _ => "Unknown",
    }
}

/// The game-agnostic description of what is being driven.
pub fn session_info(g: &Graphics, s: &Static) -> SessionInfo {
    SessionInfo {
        game: GameId::AssettoCorsa,
        track: s.track.clone(),
        layout: (!s.track_configuration.is_empty()).then(|| s.track_configuration.clone()),
        car: s.car_model.clone(),
        session_kind: session_kind_name(g.session).to_string(),
        timing: TimingKind::CircuitLap,
        // Anything under 100 m is a missing or bogus length, not a track.
        length_m: (s.track_length_m >= 100.0).then(|| s.track_length_m.round() as u32),
    }
}

/// The player's world (x, z), when the game reports one.
pub fn player_position(g: &Graphics) -> Option<[f32; 2]> {
    let [x, _, z] = g.position;
    (x.is_finite() && z.is_finite() && (x != 0.0 || z != 0.0)).then_some([x, z])
}

pub use crate::acpmf::{display_gear, inputs};

pub fn sample(g: &Graphics, p: &Physics) -> Sample {
    Sample {
        status: g.status,
        lap_count: g.completed_laps,
        last_lap_ms: g.last_time_ms,
        current_lap_ms: g.current_time_ms,
        lap_valid: p.tyres_out <= MAX_TYRES_OUT,
        in_pit_lane: g.in_pit_lane || g.in_pit,
        progress: g.progress,
        inputs: Some(inputs(p)),
    }
}

#[cfg(windows)]
pub use connection::Connection;

#[cfg(windows)]
mod connection {
    use anyhow::{Result, bail};

    use super::layout::{Graphics, Physics, Static, graphics, physics, statics};
    use crate::acpmf::Pages;

    /// Open handles to the three pages.
    pub struct Connection {
        pages: Pages,
    }

    impl Connection {
        pub fn open() -> Result<Self> {
            let conn = Self::open_unchecked()?;
            let version = conn.read_static().sm_version;
            if version.is_empty() || !version.chars().all(|c| c.is_ascii_graphic()) {
                bail!("static page has no readable version yet");
            }
            Ok(conn)
        }

        /// Opens the pages without checking that the game has filled them in (diagnostics).
        pub fn open_unchecked() -> Result<Self> {
            Ok(Self { pages: Pages::open(graphics::NEEDED, statics::MINIMUM)? })
        }

        /// Reads the graphics page, retrying if the game was mid-write.
        pub fn read_graphics(&self) -> Graphics {
            let mut g = Graphics::parse(&self.pages.graphics(graphics::NEEDED));
            for _ in 0..3 {
                if self.pages.graphics_packet() == g.packet_id {
                    break;
                }
                g = Graphics::parse(&self.pages.graphics(graphics::NEEDED));
            }
            g
        }

        pub fn read_physics(&self) -> Physics {
            Physics::parse(&self.pages.physics(physics::NEEDED))
        }

        pub fn read_static(&self) -> Static {
            Static::parse(&self.pages.statics(statics::NEEDED))
        }

        pub fn physics_bytes(&self) -> Vec<u8> {
            self.pages.physics_all()
        }

        pub fn graphics_bytes(&self) -> Vec<u8> {
            self.pages.graphics_all()
        }

        pub fn static_bytes(&self) -> Vec<u8> {
            self.pages.statics_all()
        }
    }
}

/// The Assetto Corsa [`GameAdapter`].
pub struct AcAdapter {
    #[cfg(windows)]
    conn: Option<Connection>,
    tracker: LapTracker,
    session: Option<SessionInfo>,
    last_live: Option<Instant>,
}

impl Default for AcAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl AcAdapter {
    pub fn new() -> Self {
        Self {
            #[cfg(windows)]
            conn: None,
            tracker: LapTracker::default(),
            session: None,
            last_live: None,
        }
    }

    #[cfg(windows)]
    fn disconnect(&mut self, events: &mut Vec<GameEvent>) {
        if self.conn.take().is_some() {
            events.push(GameEvent::Disconnected { game: GameId::AssettoCorsa });
        }
        self.tracker.reset();
        self.session = None;
    }
}

impl GameAdapter for AcAdapter {
    fn game(&self) -> GameId {
        GameId::AssettoCorsa
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
            if !is_running() {
                return events;
            }
            match Connection::open() {
                Ok(conn) => {
                    events.push(GameEvent::Connected { game: GameId::AssettoCorsa, game_version: conn.read_static().ac_version });
                    self.conn = Some(conn);
                }
                Err(_) => return events,
            }
        }

        let conn = self.conn.as_ref().expect("connected above");
        let g = conn.read_graphics();
        let p = conn.read_physics();

        if g.status == STATUS_OFF && !is_running() {
            self.disconnect(&mut events);
            return events;
        }

        if g.status == STATUS_LIVE {
            let info = session_info(&g, &conn.read_static());
            if self.session.as_ref() != Some(&info) && !info.track.is_empty() {
                // New car or track: laps in progress belong to the old combo.
                self.tracker.reset();
                self.session = Some(info.clone());
                events.push(GameEvent::SessionChanged(info));
            }
        }

        let s = sample(&g, &p);
        if let Some(lap) = self.tracker.update(s)
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
                penalties: Vec::new(),
            }));
        }

        let now = Instant::now();
        if self.last_live.is_none_or(|t| now.duration_since(t) >= LIVE_EVERY) {
            self.last_live = Some(now);
            events.push(GameEvent::Live(LiveState {
                driving: g.status == STATUS_LIVE,
                phase: match g.status {
                    STATUS_LIVE => GamePhase::Driving,
                    STATUS_PAUSE => GamePhase::Paused,
                    STATUS_REPLAY => GamePhase::Replay,
                    _ => GamePhase::Menu,
                },
                current_lap_ms: g.current_time_ms.max(0) as u32,
                lap_valid: s.lap_valid,
                out_lap: self.tracker.on_out_lap(),
                lap_progress: g.progress.clamp(0.0, 1.0),
                position: player_position(&g),
                inputs: s.inputs,
                penalties: Vec::new(),
            }));
        }

        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn static_page() -> Static {
        Static {
            car_model: "ks_porsche_911_gt3_r_2016".into(),
            track: "ks_nurburgring".into(),
            track_configuration: "layout_gp_b".into(),
            track_length_m: 5148.0,
            ..Static::default()
        }
    }

    #[test]
    fn the_session_names_the_car_track_layout_and_length_as_the_game_does() {
        let g = Graphics { session: layout::SESSION_HOTLAP, ..Graphics::default() };
        let info = session_info(&g, &static_page());
        assert_eq!(info.game, GameId::AssettoCorsa);
        assert_eq!((info.track.as_str(), info.layout.as_deref(), info.car.as_str()), ("ks_nurburgring", Some("layout_gp_b"), "ks_porsche_911_gt3_r_2016"));
        assert_eq!((info.session_kind.as_str(), info.length_m), ("Hotlap", Some(5148)));
    }

    #[test]
    fn a_track_with_one_layout_and_no_length_leaves_both_unset() {
        let s = Static { track: "monza".into(), car_model: "ks_mazda_mx5_cup".into(), ..Static::default() };
        let info = session_info(&Graphics::default(), &s);
        assert_eq!((info.layout, info.length_m), (None, None));
    }

    #[test]
    fn gears_become_the_ones_drivers_use() {
        assert_eq!(display_gear(0), -1, "reverse");
        assert_eq!(display_gear(1), 0, "neutral");
        assert_eq!(display_gear(2), 1, "first gear");
        assert_eq!(display_gear(i32::MIN), i16::MIN, "never wraps");
    }

    #[test]
    fn inputs_are_clamped_into_their_ranges() {
        let p = Physics { gas: 1.4, brake: -0.2, clutch: 0.25, gear: 4, rpm: 70_000, steer_angle: -3.0, speed_kmh: -1.0, tyres_out: 0 };
        let i = inputs(&p);
        assert_eq!((i.throttle, i.brake, i.clutch, i.steering), (1.0, 0.0, 0.75, -1.0));
        assert_eq!((i.gear, i.rpm, i.speed_kmh), (3, u16::MAX, 0.0));
    }

    #[test]
    fn a_lap_is_flagged_once_more_than_two_tyres_are_out() {
        let g = Graphics { status: STATUS_LIVE, ..Graphics::default() };
        let valid = |tyres_out| sample(&g, &Physics { tyres_out, ..Physics::default() }).lap_valid;
        assert!(valid(0) && valid(2));
        assert!(!valid(3) && !valid(4));
    }

    #[test]
    fn the_pit_box_and_the_pit_lane_both_count_as_the_pits() {
        let p = Physics::default();
        assert!(sample(&Graphics { in_pit: true, ..Graphics::default() }, &p).in_pit_lane);
        assert!(sample(&Graphics { in_pit_lane: true, ..Graphics::default() }, &p).in_pit_lane);
        assert!(!sample(&Graphics::default(), &p).in_pit_lane);
    }

    #[test]
    fn the_bundled_catalogue_is_valid_and_ids_are_lowercase_folder_names() {
        let v: serde_json::Value = serde_json::from_str(CATALOGUE_JSON).unwrap();
        for list in ["tracks", "cars"] {
            for entry in v[list].as_array().unwrap() {
                let name = entry["name"].as_str().unwrap();
                assert_eq!(name, name.to_lowercase(), "{name} must match the telemetry's lowercase folder name");
            }
        }
    }
}
