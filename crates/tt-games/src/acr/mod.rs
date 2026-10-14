//! Assetto Corsa Rally adapter: the first rally game.
//!
//! Reads the game's shared memory, the same `Local\acpmf_*` pages as Assetto Corsa (see `acpmf`), but
//! the data is a stage's, not a lap's: a stage clock and distance driven, with no lap counter, no
//! status and no track-position fraction. The layout, and what was found when it was read from a
//! running game, is in `layout.rs`. Deciding when a stage starts, restarts and finishes is the shared
//! [`StageTracker`]; this module turns the pages into stage samples and a session description.
//!
//! A stage is stored like a lap: its name is the "track", its length (`12.08 km`) is the "layout" so two
//! stages the game gives the same name stay apart, and each run is a lap with the stage time.

pub mod layout;

use std::time::{Duration, Instant};

use crate::acpmf::Physics;
pub use crate::acpmf::{display_gear, inputs};
use crate::stage::{StageSample, StageTracker};
use crate::{CompletedLap, GameAdapter, GameEvent, GameId, GamePhase, LiveState, SessionInfo, TimingKind};
use layout::{Graphics, Static};

/// The bundled list of cars (stages are learned as they are driven: the game's names for them can't be
/// matched to published lists).
pub const CATALOGUE_JSON: &str = include_str!("catalogue.json");

pub const PROCESS_NAME: &str = "acr.exe";

const CONNECTED_POLL: Duration = Duration::from_millis(50);
const DISCONNECTED_POLL: Duration = Duration::from_secs(2);
const LIVE_EVERY: Duration = Duration::from_millis(100);
/// The data counts as moving if the game's packet counter changed within this long.
const ALIVE_MS: u64 = 1_000;

pub fn is_running() -> bool {
    crate::is_process_running(PROCESS_NAME)
}

/// A stage's second name: its length, to the nearest 10 m. The game reports a region and a place
/// (`Wales Afon Biga`), and several stages can end at the same place, so the length tells them apart.
pub fn stage_variant(length_m: f32) -> String {
    format!("{:.2} km", (length_m / 10.0).round() / 100.0)
}

/// The game-agnostic description of the stage being driven.
pub fn session_info(s: &Static) -> SessionInfo {
    SessionInfo {
        game: GameId::AssettoCorsaRally,
        track: s.stage.clone(),
        layout: (s.length_m > 0.0).then(|| stage_variant(s.length_m)),
        car: s.car.clone(),
        session_kind: "Stage".to_string(),
        timing: TimingKind::RallyStage,
        length_m: (s.length_m > 0.0).then(|| s.length_m.round() as u32),
    }
}

/// The player's world (x, z).
pub fn player_position(g: &Graphics) -> Option<[f32; 2]> {
    g.position.map(|[x, _, z]| [x, z])
}

/// How far along the stage the car is: distance driven over the stage length (the finish line is a
/// little short of 1.0).
pub fn progress(g: &Graphics, s: &Static) -> f32 {
    if s.length_m > 0.0 { (g.distance_m / s.length_m).clamp(0.0, 1.0) } else { 0.0 }
}

#[cfg(windows)]
pub use connection::Connection;

#[cfg(windows)]
mod connection {
    use anyhow::Result;

    use super::layout::{Graphics, Static, graphics, statics};
    use crate::acpmf::{Pages, Physics, physics};

    /// Open handles to the three pages.
    pub struct Connection {
        pages: Pages,
    }

    impl Connection {
        /// Opens the pages. They exist (empty) before a stage is loaded, so nothing is checked about
        /// their content: the stage name appearing is what says a stage is loaded.
        pub fn open() -> Result<Self> {
            Ok(Self { pages: Pages::open(graphics::NEEDED, statics::NEEDED)? })
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
    }
}

/// The Assetto Corsa Rally [`GameAdapter`].
pub struct AcrAdapter {
    #[cfg(windows)]
    conn: Option<Connection>,
    tracker: StageTracker,
    session: Option<SessionInfo>,
    last_live: Option<Instant>,
    started: Instant,
    last_packet: Option<i32>,
    last_packet_change_ms: u64,
}

impl Default for AcrAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl AcrAdapter {
    pub fn new() -> Self {
        Self {
            #[cfg(windows)]
            conn: None,
            tracker: StageTracker::default(),
            session: None,
            last_live: None,
            started: Instant::now(),
            last_packet: None,
            last_packet_change_ms: 0,
        }
    }

    #[cfg(windows)]
    fn disconnect(&mut self, events: &mut Vec<GameEvent>) {
        if self.conn.take().is_some() {
            events.push(GameEvent::Disconnected { game: GameId::AssettoCorsaRally });
        }
        self.tracker.reset();
        self.session = None;
        self.last_packet = None;
    }
}

impl GameAdapter for AcrAdapter {
    fn game(&self) -> GameId {
        GameId::AssettoCorsaRally
    }

    fn timing_kind(&self) -> TimingKind {
        TimingKind::RallyStage
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
                    // The pages carry no game version.
                    events.push(GameEvent::Connected { game: GameId::AssettoCorsaRally, game_version: String::new() });
                    self.conn = Some(conn);
                }
                Err(_) => return events,
            }
        }
        if !is_running() {
            self.disconnect(&mut events);
            return events;
        }

        let conn = self.conn.as_ref().expect("connected above");
        let now_ms = self.started.elapsed().as_millis() as u64;
        let g = conn.read_graphics();
        let p: Physics = conn.read_physics();
        let s = conn.read_static();

        // The game gives no "live" status, so the packet counter says whether the data is moving.
        let updating = self.last_packet != Some(g.packet_id);
        if updating {
            self.last_packet = Some(g.packet_id);
            self.last_packet_change_ms = now_ms;
        }
        let alive = now_ms.saturating_sub(self.last_packet_change_ms) < ALIVE_MS;

        if s.has_stage() {
            let info = session_info(&s);
            if self.session.as_ref() != Some(&info) {
                // A different stage or car: a run in progress belongs to the old one.
                self.tracker.reset();
                self.session = Some(info.clone());
                events.push(GameEvent::SessionChanged(info));
            }
        }

        let stage = StageSample {
            at_ms: now_ms,
            clock_ms: g.clock_ms(),
            distance_m: g.distance_m,
            length_m: (s.length_m > 0.0).then_some(s.length_m),
            updating,
            inputs: Some(inputs(&p)),
            position: player_position(&g),
        };
        if let Some(done) = self.tracker.update(stage)
            && let Some(session) = self.session.clone()
        {
            events.push(GameEvent::LapCompleted(CompletedLap {
                session,
                lap_number: done.attempt,
                time_ms: done.time_ms,
                valid: done.untimed.is_none(),
                untimed: done.untimed,
                sectors_ms: Vec::new(),
                profile: done.profile,
                trace: done.trace,
                penalties: done.penalties,
            }));
        }

        let now = Instant::now();
        if self.last_live.is_none_or(|t| now.duration_since(t) >= LIVE_EVERY) {
            self.last_live = Some(now);
            // Driving until the finish line: after it the game keeps updating while the car rolls out,
            // and that stretch is not part of the run.
            let driving = s.has_stage() && g.clock_ms().is_some() && alive && !self.tracker.is_finished();
            events.push(GameEvent::Live(LiveState {
                driving,
                phase: if driving { GamePhase::Driving } else { GamePhase::Menu },
                current_lap_ms: g.clock_ms().unwrap_or(0),
                lap_valid: true,
                out_lap: false,
                lap_progress: progress(&g, &s),
                position: player_position(&g),
                inputs: Some(inputs(&p)),
                penalties: Vec::new(),
            }));
        }

        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stage() -> Static {
        Static { car: "Peugeot 206 WRC".into(), stage: "Wales Afon Biga".into(), driver: "Axeora".into(), length_m: 12_077.0 }
    }

    #[test]
    fn the_session_is_the_stage_name_with_its_length_as_the_layout() {
        let info = session_info(&stage());
        assert_eq!(info.game, GameId::AssettoCorsaRally);
        assert_eq!((info.track.as_str(), info.layout.as_deref(), info.car.as_str()), ("Wales Afon Biga", Some("12.08 km"), "Peugeot 206 WRC"));
        assert_eq!((info.session_kind.as_str(), info.timing, info.length_m), ("Stage", TimingKind::RallyStage, Some(12_077)));
    }

    #[test]
    fn two_stages_with_the_same_reported_name_stay_apart_by_length() {
        let a = session_info(&stage());
        let b = session_info(&Static { length_m: 5_012.0, ..stage() });
        assert_eq!(a.track, b.track);
        assert_ne!(a.layout, b.layout);
        assert_eq!(b.layout.as_deref(), Some("5.01 km"));
    }

    #[test]
    fn a_small_difference_in_the_reported_length_is_the_same_stage() {
        assert_eq!(stage_variant(12_077.0), stage_variant(12_079.9));
        assert_eq!(stage_variant(12_077.0), "12.08 km");
    }

    #[test]
    fn a_stage_without_a_length_has_no_layout() {
        let info = session_info(&Static { length_m: 0.0, ..stage() });
        assert_eq!((info.layout, info.length_m), (None, None));
    }

    #[test]
    fn progress_is_distance_over_stage_length_and_zero_without_one() {
        let g = Graphics { distance_m: 6_038.5, ..Graphics::default() };
        assert!((progress(&g, &stage()) - 0.5).abs() < 0.001);
        assert_eq!(progress(&g, &Static { length_m: 0.0, ..stage() }), 0.0);
        assert_eq!(progress(&Graphics { distance_m: 99_999.0, ..Graphics::default() }, &stage()), 1.0);
    }

    /// The real recording of a stage's last 90 seconds (see the fixture's header), fed through the clock
    /// parser and the stage tracker exactly as the adapter does.
    #[test]
    fn a_real_recorded_stage_finish_is_detected_at_the_clock_stop_not_at_the_end_of_the_data() {
        use crate::UntimedReason;
        use crate::stage::{StageSample, StageTracker};

        let mut tracker = StageTracker::default();
        let mut last_packet = None;
        let mut found = Vec::new();
        for line in include_str!("fixtures/stage_finish.csv").lines().filter(|l| !l.starts_with('#')).skip(1) {
            let f: Vec<&str> = line.split(',').collect();
            let packet: i32 = f[1].parse().unwrap();
            let sample = StageSample {
                at_ms: f[0].parse().unwrap(),
                clock_ms: layout::parse_clock(f[2]),
                distance_m: f[3].parse().unwrap(),
                length_m: Some(12_077.0),
                updating: last_packet != Some(packet),
                inputs: None,
                position: None,
            };
            last_packet = Some(packet);
            if let Some(done) = tracker.update(sample) {
                found.push((packet, done));
            }
        }
        assert_eq!(found.len(), 1, "one finish in the recording");
        let (packet_when_found, done) = &found[0];
        assert_eq!(done.time_ms, 520_336, "the clock the game's memory held at the line");
        assert_eq!((done.attempt, done.untimed), (1, Some(UntimedReason::Partial)), "the recording joined the stage part-way");
        assert_ne!(*packet_when_found, 37_780, "found while the car was still rolling, before the pages froze");
        // The clock stopped at 11 882.6 m (98.4% of the 12 077 m length); the roll-out went on to 12 003.5 m.
        assert!((11_880.0..12_004.0).contains(&done.finish_distance_m), "{}", done.finish_distance_m);
        assert!(tracker.is_finished());
    }

    /// A whole stage from the drive-up to the start line to the finish: the distance already reads 116 m
    /// while the clock sits at zero, and the start line is at ~238 m. The run must count as a proper timed one.
    #[test]
    fn a_real_stage_driven_up_to_the_start_line_is_a_timed_run() {
        use crate::stage::{StageSample, StageTracker};

        let mut tracker = StageTracker::default();
        let mut last_packet = None;
        let mut found = Vec::new();
        for line in include_str!("fixtures/stage_full.csv").lines().filter(|l| !l.starts_with('#')).skip(1) {
            let f: Vec<&str> = line.split(',').collect();
            let packet: i32 = f[1].parse().unwrap();
            let sample = StageSample {
                at_ms: f[0].parse().unwrap(),
                clock_ms: layout::parse_clock(f[2]),
                distance_m: f[3].parse().unwrap(),
                length_m: Some(5_600.0),
                updating: last_packet != Some(packet),
                inputs: None,
                position: None,
            };
            last_packet = Some(packet);
            found.extend(tracker.update(sample));
        }
        assert_eq!(found.len(), 1);
        assert_eq!((found[0].time_ms, found[0].attempt, found[0].untimed), (215_010, 1, None));
        assert!(found[0].profile.is_some());
    }

    #[test]
    fn the_catalogue_is_valid_and_lists_the_car_that_was_read_from_the_game() {
        let v: serde_json::Value = serde_json::from_str(CATALOGUE_JSON).unwrap();
        assert!(v["cars"].as_array().unwrap().iter().any(|c| c["name"] == "Peugeot 206 WRC"));
    }
}
