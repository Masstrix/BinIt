//! Game adapters for Bin It.
//!
//! Each adapter reads a game's *official* telemetry channel (shared memory or UDP)
//! and turns it into a small set of game-agnostic [`GameEvent`]s. Adapters never
//! inject into or hook the game process, and they are polled at a low rate
//! (see [`GameAdapter::poll_interval`]) so the impact on frame rate is negligible.

pub mod ac;
pub mod acevo;
pub mod acpmf;
pub mod acr;
pub mod catalogue;
pub mod dr2;
pub mod dynamics;
pub mod stage;
pub mod timing;
mod process;
pub mod tracker;
#[cfg(windows)]
mod shm;
/// Raw shared-memory readout for the dev-only Memory page.
#[cfg(windows)]
pub mod readout;

use std::time::Duration;

pub use process::is_process_running;

/// Executables of games Bin It supports (or will), mapped to the game key.
/// Used to tell whether a game is the app the player is currently in.
pub const GAME_PROCESSES: &[(&str, &str)] = &[
    ("AssettoCorsaEVO.exe", "acevo"),
    ("acs.exe", "ac"),
    ("acs_x86.exe", "ac"),
    ("acr.exe", "acr"),
    ("dirtrally2.exe", "dr2"),
];

/// The game key for an executable name (case-insensitive), if it's a supported game.
pub fn game_for_process(exe_name: &str) -> Option<&'static str> {
    GAME_PROCESSES.iter().find(|(exe, _)| exe.eq_ignore_ascii_case(exe_name)).map(|(_, key)| *key)
}

/// Identifies a supported game. Stored with every lap so leaderboards stay per-game.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum GameId {
    AssettoCorsaEvo,
    AssettoCorsa,
    AssettoCorsaRally,
}

impl GameId {
    /// Every game that has an adapter.
    pub const ALL: [GameId; 3] = [GameId::AssettoCorsaEvo, GameId::AssettoCorsa, GameId::AssettoCorsaRally];

    /// The id stored with laps, challenges and maps. Never change one once data exists under it.
    pub fn key(self) -> &'static str {
        match self {
            GameId::AssettoCorsaEvo => "acevo",
            GameId::AssettoCorsa => "ac",
            GameId::AssettoCorsaRally => "acr",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            GameId::AssettoCorsaEvo => "Assetto Corsa EVO",
            GameId::AssettoCorsa => "Assetto Corsa",
            GameId::AssettoCorsaRally => "Assetto Corsa Rally",
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
    /// (Bin It then derives sectors from `profile`).
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
    /// Only part of it was seen (Bin It started mid-lap): not an attempt.
    Partial,
    /// The game flagged it (track limits, cutting): a failed attempt.
    Cut,
    /// The driver in the seat changed during the lap, so it can't be credited to anyone.
    DriverChange,
    /// The game didn't publish a time that fits the lap (its "last lap" still showed the one
    /// before, maybe someone else's), so the time is Bin It's own reading and isn't ranked.
    NoTime,
}

impl UntimedReason {
    pub fn key(self) -> &'static str {
        match self {
            UntimedReason::OutLap => "outLap",
            UntimedReason::InLap => "inLap",
            UntimedReason::Partial => "partial",
            UntimedReason::Cut => "cut",
            UntimedReason::DriverChange => "driverChange",
            UntimedReason::NoTime => "noTime",
        }
    }

    /// Out, in and partial laps aren't attempts at all (never ranked, never counted).
    pub fn is_attempt(self) -> bool {
        self == UntimedReason::Cut
    }
}

/// What the driver has the car's aids and brake balance set to, and how far each can go, for games that publish them
/// (AC EVO so far). Levels are what the car's menus show; the `_max` of each is the car's own limit. Only settings that
/// have been seen to follow the menus in the running game are here.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Aids {
    pub tc_level: u8,
    pub tc_max: u8,
    pub abs_level: u8,
    pub abs_max: u8,
    /// The front share of the braking (0..1), and the range it can be set across.
    pub brake_bias: f32,
    pub bias_min: f32,
    pub bias_max: f32,
    pub diff_power_level: u8,
    pub diff_power_max: u8,
    pub diff_coast_level: u8,
    pub diff_coast_max: u8,
    /// The pit-speed limiter is on.
    pub pit_limiter: bool,
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
    /// Heading, slip, yaw rate and turbo, for games whose physics page has been checked (AC EVO so far).
    pub dynamics: Option<dynamics::Dynamics>,
    /// Where the car is in the world, metres (x, z), when the game says.
    pub position: Option<[f32; 2]>,
    /// The driver aids and brake balance, when the game says (AC EVO so far).
    pub aids: Option<Aids>,
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

/// One adapter per supported game. This is the single place a new game is registered.
pub fn adapters() -> Vec<Box<dyn GameAdapter>> {
    vec![Box::new(acevo::AcEvoAdapter::new()), Box::new(ac::AcAdapter::new()), Box::new(acr::AcrAdapter::new())]
}

/// Runs every game's adapter, one game at a time.
///
/// While no game is connected each adapter is asked in turn (they only look for their game's process,
/// which is cheap at their idle rate). Once one connects it is the only one polled, at its own pace,
/// until it disconnects: the app follows a single game at a time, and a second one running alongside
/// must not interleave its events with the first's.
pub struct GameWatcher {
    adapters: Vec<Box<dyn GameAdapter>>,
    active: Option<usize>,
}

impl GameWatcher {
    pub fn new(adapters: Vec<Box<dyn GameAdapter>>) -> Self {
        Self { adapters, active: None }
    }

    /// Every supported game.
    pub fn standard() -> Self {
        Self::new(adapters())
    }

    /// Events since the last call.
    pub fn poll(&mut self) -> Vec<GameEvent> {
        if let Some(i) = self.active {
            let events = self.adapters[i].poll();
            if events.iter().any(|e| matches!(e, GameEvent::Disconnected { .. })) {
                self.active = None;
            }
            return events;
        }
        for (i, adapter) in self.adapters.iter_mut().enumerate() {
            let events = adapter.poll();
            if events.iter().any(|e| matches!(e, GameEvent::Connected { .. })) {
                self.active = Some(i);
                return events;
            }
        }
        Vec::new()
    }

    /// How long to wait before the next [`GameWatcher::poll`].
    pub fn wait(&self) -> Duration {
        match self.active {
            Some(i) => self.adapters[i].poll_interval(),
            None => self.adapters.iter().map(|a| a.poll_interval()).min().unwrap_or(Duration::from_secs(2)),
        }
    }

    /// The game being followed right now, if any.
    pub fn active_game(&self) -> Option<GameId> {
        self.active.map(|i| self.adapters[i].game())
    }
}

#[cfg(test)]
mod watcher_tests {
    use std::collections::VecDeque;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    /// An adapter that plays back scripted polls and counts how often it was asked.
    struct Scripted {
        game: GameId,
        script: VecDeque<Vec<GameEvent>>,
        polls: Arc<AtomicUsize>,
    }

    impl GameAdapter for Scripted {
        fn game(&self) -> GameId {
            self.game
        }
        fn timing_kind(&self) -> TimingKind {
            TimingKind::CircuitLap
        }
        fn poll_interval(&self) -> Duration {
            Duration::from_millis(if self.script.is_empty() { 2000 } else { 50 })
        }
        fn poll(&mut self) -> Vec<GameEvent> {
            self.polls.fetch_add(1, Ordering::SeqCst);
            self.script.pop_front().unwrap_or_default()
        }
    }

    fn connected(game: GameId) -> GameEvent {
        GameEvent::Connected { game, game_version: String::new() }
    }

    fn scripted(game: GameId, script: Vec<Vec<GameEvent>>) -> (Box<dyn GameAdapter>, Arc<AtomicUsize>) {
        let polls = Arc::new(AtomicUsize::new(0));
        (Box::new(Scripted { game, script: script.into(), polls: polls.clone() }), polls)
    }

    #[test]
    fn once_a_game_connects_the_others_are_left_alone_until_it_disconnects() {
        let (evo, evo_polls) = scripted(
            GameId::AssettoCorsaEvo,
            vec![vec![], vec![connected(GameId::AssettoCorsaEvo)], vec![], vec![GameEvent::Disconnected { game: GameId::AssettoCorsaEvo }]],
        );
        let (ac, ac_polls) = scripted(GameId::AssettoCorsa, vec![vec![], vec![], vec![], vec![], vec![connected(GameId::AssettoCorsa)]]);
        let mut watcher = GameWatcher::new(vec![evo, ac]);

        assert!(watcher.poll().is_empty()); // both asked: nothing running
        assert_eq!((evo_polls.load(Ordering::SeqCst), ac_polls.load(Ordering::SeqCst)), (1, 1));

        assert!(matches!(watcher.poll()[..], [GameEvent::Connected { game: GameId::AssettoCorsaEvo, .. }]));
        assert_eq!(watcher.active_game(), Some(GameId::AssettoCorsaEvo));
        assert_eq!(ac_polls.load(Ordering::SeqCst), 1, "AC was not asked in the round EVO connected");

        watcher.poll(); // EVO is the only one asked while it is connected
        assert_eq!(ac_polls.load(Ordering::SeqCst), 1);

        assert!(matches!(watcher.poll()[..], [GameEvent::Disconnected { .. }]));
        assert_eq!(watcher.active_game(), None);

        watcher.poll(); // both asked again; EVO has nothing, AC is next in its script
        assert!(ac_polls.load(Ordering::SeqCst) >= 2);
    }

    #[test]
    fn the_wait_follows_the_active_game_and_otherwise_the_fastest_idle_rate() {
        let (evo, _) = scripted(GameId::AssettoCorsaEvo, vec![vec![connected(GameId::AssettoCorsaEvo)], vec![]]);
        let (ac, _) = scripted(GameId::AssettoCorsa, vec![]);
        let mut watcher = GameWatcher::new(vec![evo, ac]);
        assert_eq!(watcher.wait(), Duration::from_millis(50), "the quickest adapter sets the idle pace");
        watcher.poll();
        assert_eq!(watcher.wait(), Duration::from_millis(50), "the connected game's own pace");
    }

    #[test]
    fn every_game_has_a_distinct_key_and_an_adapter() {
        let keys: Vec<_> = GameId::ALL.iter().map(|g| g.key()).collect();
        assert_eq!(keys, vec!["acevo", "ac", "acr"]);
        let adapter_games: Vec<_> = adapters().iter().map(|a| a.game()).collect();
        assert_eq!(adapter_games, GameId::ALL.to_vec());
        for game in GameId::ALL {
            assert!(GAME_PROCESSES.iter().any(|(_, key)| *key == game.key()), "{} needs a process name", game.key());
        }
    }
}
