//! Game adapters for TimeTrial.
//!
//! Each adapter reads a game's *official* telemetry channel (shared memory or UDP)
//! and turns it into a small set of game-agnostic [`GameEvent`]s. Adapters never
//! inject into or hook the game process, and they are polled at a low rate
//! (see [`GameAdapter::poll_interval`]) so the impact on frame rate is negligible.

pub mod acevo;
pub mod timing;
mod process;
#[cfg(windows)]
mod shm;

use std::time::Duration;

pub use process::is_process_running;

/// Executables of games TimeTrial supports (or will), mapped to the game key.
/// Used to tell whether a game is the app the player is currently in.
pub const GAME_PROCESSES: &[(&str, &str)] = &[
    ("AssettoCorsaEVO.exe", "acevo"),
    ("acs.exe", "ac"),
    ("acs_x86.exe", "ac"),
    ("AC2-Win64-Shipping.exe", "acc"),
    ("dirtrally2.exe", "dr2"),
    ("WRC.exe", "wrc"),
];

/// The game key for an executable name (case-insensitive), if it's a supported game.
pub fn game_for_process(exe_name: &str) -> Option<&'static str> {
    GAME_PROCESSES.iter().find(|(exe, _)| exe.eq_ignore_ascii_case(exe_name)).map(|(_, key)| *key)
}

/// Identifies a supported game. Stored with every lap so leaderboards stay per-game.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum GameId {
    AssettoCorsaEvo,
}

impl GameId {
    pub fn key(self) -> &'static str {
        match self {
            GameId::AssettoCorsaEvo => "acevo",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            GameId::AssettoCorsaEvo => "Assetto Corsa EVO",
        }
    }
}

/// Whether the game measures circuit laps or point-to-point rally stages.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimingKind {
    CircuitLap,
    RallyStage,
}

/// What the player is currently driving, and where.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionInfo {
    pub game: GameId,
    pub track: String,
    /// Track layout / configuration; `None` for the default layout.
    pub layout: Option<String>,
    pub car: String,
    /// The game's own name for the session type (e.g. "Hot Stint", "Race").
    pub session_kind: String,
    /// Circuit laps or a rally stage: decides default sector counts.
    pub timing: TimingKind,
    /// Lap / stage length in metres, when the game reports it.
    pub length_m: Option<u32>,
}

/// One finished lap (or stage run).
#[derive(Debug, Clone, PartialEq)]
pub struct CompletedLap {
    pub session: SessionInfo,
    /// Lap number within the game session (1-based).
    pub lap_number: u32,
    pub time_ms: u32,
    /// True only for a proper timed lap (`untimed` is `None`).
    pub valid: bool,
    /// Why the lap doesn't count, if it doesn't.
    pub untimed: Option<UntimedReason>,
    /// Sector splits in ms as reported by the game itself. Empty when it doesn't
    /// (TimeTrial then derives sectors from `profile`).
    pub sectors_ms: Vec<u32>,
    /// Elapsed time at each 0.5% of the lap, when the lap was fully sampled.
    pub profile: Option<timing::TimingProfile>,
    /// What the driver did through the lap (pedals, steering, gear, speed), for comparing laps.
    pub trace: Option<timing::LapTrace>,
}

/// Why a completed lap isn't a timed lap.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UntimedReason {
    /// Started from the pits: not an attempt.
    OutLap,
    /// Ended in the pit lane: not an attempt.
    InLap,
    /// Only part of it was seen (TimeTrial started mid-lap): not an attempt.
    Partial,
    /// The game flagged it (track limits, cutting): a failed attempt.
    Cut,
    /// The driver in the seat changed during the lap, so it can't be credited to anyone.
    DriverChange,
}

impl UntimedReason {
    pub fn key(self) -> &'static str {
        match self {
            UntimedReason::OutLap => "outLap",
            UntimedReason::InLap => "inLap",
            UntimedReason::Partial => "partial",
            UntimedReason::Cut => "cut",
            UntimedReason::DriverChange => "driverChange",
        }
    }

    /// Out, in and partial laps aren't attempts at all (never ranked, never counted).
    pub fn is_attempt(self) -> bool {
        self == UntimedReason::Cut
    }
}

/// What the driver is doing with the car right now. Pedals and steering are as the game reports
/// them (normalised in the adapter), gear 0 is neutral and negative is reverse.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Inputs {
    /// 0.0 (off) .. 1.0 (floored).
    pub throttle: f32,
    pub brake: f32,
    pub clutch: f32,
    pub handbrake: f32,
    /// -1.0 (full left) .. 1.0 (full right).
    pub steering: f32,
    pub gear: i16,
    pub speed_kmh: f32,
    pub rpm: u16,
}

/// What the game is doing, as far as the player can tell.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum GamePhase {
    /// Menus, loading screens, or no session at all.
    #[default]
    Menu,
    /// In the car and driving.
    Driving,
    /// Paused while on track.
    Paused,
    /// Watching a replay.
    Replay,
}

impl GamePhase {
    pub fn key(self) -> &'static str {
        match self {
            GamePhase::Menu => "menu",
            GamePhase::Driving => "driving",
            GamePhase::Paused => "paused",
            GamePhase::Replay => "replay",
        }
    }
}

/// Live state used by the overlay. Cheap to produce; emitted at most a few times a second.
#[derive(Debug, Clone, PartialEq)]
pub struct LiveState {
    pub driving: bool,
    pub phase: GamePhase,
    pub current_lap_ms: u32,
    pub lap_valid: bool,
    /// On an out lap (from the pits or a spawn point): not a timed attempt.
    pub out_lap: bool,
    /// 0.0..1.0 progress around the lap.
    pub lap_progress: f32,
    /// World position of the player's car on the ground plane (x, z) in metres, when the
    /// game reports it. Used to learn track maps and to draw the live map.
    pub position: Option<[f32; 2]>,
    /// Pedals, steering and gear, when the game reports them.
    pub inputs: Option<Inputs>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum GameEvent {
    /// The game is running and its telemetry channel was opened.
    Connected { game: GameId, game_version: String },
    /// The game closed or its telemetry channel went away.
    Disconnected { game: GameId },
    /// Track, layout, car or session changed.
    SessionChanged(SessionInfo),
    LapCompleted(CompletedLap),
    Live(LiveState),
}

/// A source of [`GameEvent`]s for one game.
pub trait GameAdapter: Send {
    fn game(&self) -> GameId;

    fn timing_kind(&self) -> TimingKind;

    /// How often the host should call [`GameAdapter::poll`] while the game is connected.
    fn poll_interval(&self) -> Duration;

    /// Read the latest telemetry and return any events since the last call.
    /// Must be cheap: no blocking, no allocation-heavy work on the happy path.
    fn poll(&mut self) -> Vec<GameEvent>;
}
