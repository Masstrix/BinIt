//! Game adapters for TimeTrial.
//!
//! Each adapter reads a game's *official* telemetry channel (shared memory or UDP)
//! and turns it into a small set of game-agnostic [`GameEvent`]s. Adapters never
//! inject into or hook the game process, and they are polled at a low rate
//! (see [`GameAdapter::poll_interval`]) so the impact on frame rate is negligible.

pub mod acevo;
mod process;
#[cfg(windows)]
mod shm;

use std::time::Duration;

pub use process::is_process_running;

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
}

/// One finished lap (or stage run).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompletedLap {
    pub session: SessionInfo,
    /// Lap number within the game session (1-based).
    pub lap_number: u32,
    pub time_ms: u32,
    /// False if the game flagged the lap (track limits, cuts...) at any point.
    pub valid: bool,
    /// Sector splits in ms, when the game exposes them. Empty otherwise.
    pub sectors_ms: Vec<u32>,
}

/// Live state used by the overlay. Cheap to produce; emitted at most a few times a second.
#[derive(Debug, Clone, PartialEq)]
pub struct LiveState {
    pub driving: bool,
    pub current_lap_ms: u32,
    pub lap_valid: bool,
    /// 0.0..1.0 progress around the lap.
    pub lap_progress: f32,
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
