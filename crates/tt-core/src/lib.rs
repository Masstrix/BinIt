//! TimeTrial core: who's in the seat, recording laps against them, challenges and
//! leaderboards. UI-agnostic; the desktop app and the LAN web server both sit on top.

pub mod model;
mod store;

use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Result, bail};
use serde::Serialize;
use tokio::sync::broadcast;
use tt_games::{CompletedLap, GameEvent, GameId, LiveState, SessionInfo};

pub use model::*;
pub use store::Store;

/// Helmet colours handed out to drivers who don't pick one.
pub const HELMET_COLORS: [&str; 10] = [
    "#FF9F6B", "#4FC3FF", "#FF7AC6", "#4BE3A6", "#FFC93C", "#B18CFF", "#FF6B8A", "#7CF5C4", "#6BD5FF", "#FFD86B",
];

const SEAT_KEY: &str = "seat_driver_id";
const OVERLAY_KEY: &str = "overlay_enabled";
const OVERLAY_FOCUS_KEY: &str = "overlay_focus_only";

/// Pushed to every connected UI (desktop window, overlay, office browsers).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AppEvent {
    #[serde(rename_all = "camelCase")]
    GameStatus { game: Option<String>, game_name: Option<String>, connected: bool },
    Session { session: Option<SessionView> },
    #[serde(rename_all = "camelCase")]
    SeatChanged { driver_id: Option<DriverId> },
    DriversChanged,
    LapRecorded { result: LapResult },
    LapsChanged,
    ChallengesChanged,
    Live { live: LiveView },
    OverlayLayoutChanged { game: String },
    #[serde(rename_all = "camelCase")]
    OverlaySettings { enabled: bool, focus_only: bool },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    #[serde(flatten)]
    pub combo: Combo,
    pub game_name: String,
    pub session_kind: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveView {
    pub driving: bool,
    pub current_lap_ms: u32,
    pub lap_valid: bool,
    pub lap_progress: f32,
}

/// Snapshot for a UI that just connected.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub game: Option<String>,
    pub game_name: Option<String>,
    pub connected: bool,
    pub session: Option<SessionView>,
    pub seat: Option<DriverId>,
    pub live: Option<LiveView>,
    pub overlay_enabled: bool,
    pub overlay_focus_only: bool,
}

#[derive(Default)]
struct Runtime {
    game: Option<GameId>,
    session: Option<SessionView>,
    live: Option<LiveView>,
}

pub struct TimeTrial {
    store: Mutex<Store>,
    runtime: Mutex<Runtime>,
    events: broadcast::Sender<AppEvent>,
}

pub fn now_ms() -> Timestamp {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as Timestamp)
}

fn combo_of(s: &SessionInfo) -> Combo {
    Combo {
        game: s.game.key().to_string(),
        track: s.track.clone(),
        layout: s.layout.clone().unwrap_or_default(),
        car: s.car.clone(),
    }
}

impl TimeTrial {
    pub fn open(db_path: &Path) -> Result<Self> {
        Ok(Self::with_store(Store::open(db_path)?))
    }

    pub fn in_memory() -> Result<Self> {
        Ok(Self::with_store(Store::open_in_memory()?))
    }

    fn with_store(store: Store) -> Self {
        let (events, _) = broadcast::channel(256);
        Self { store: Mutex::new(store), runtime: Mutex::new(Runtime::default()), events }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AppEvent> {
        self.events.subscribe()
    }

    fn emit(&self, event: AppEvent) {
        // No subscribers is fine (e.g. headless tests).
        let _ = self.events.send(event);
    }

    fn store(&self) -> std::sync::MutexGuard<'_, Store> {
        self.store.lock().expect("store mutex poisoned")
    }

    pub fn status(&self) -> Result<Status> {
        let rt = self.runtime.lock().expect("runtime mutex poisoned");
        Ok(Status {
            game: rt.game.map(|g| g.key().to_string()),
            game_name: rt.game.map(|g| g.display_name().to_string()),
            connected: rt.game.is_some(),
            session: rt.session.clone(),
            seat: self.seat()?,
            live: rt.live.clone(),
            overlay_enabled: self.overlay_enabled()?,
            overlay_focus_only: self.overlay_focus_only()?,
        })
    }

    /// Whether the in-game overlay is drawn at all. On by default.
    pub fn overlay_enabled(&self) -> Result<bool> {
        Ok(self.store().setting(OVERLAY_KEY)?.is_none_or(|v| v == "1"))
    }

    pub fn set_overlay_enabled(&self, enabled: bool) -> Result<()> {
        self.store().set_setting(OVERLAY_KEY, Some(if enabled { "1" } else { "0" }))?;
        self.emit_overlay_settings()
    }

    /// Only draw the overlay while a supported game is the focused app. On by default.
    pub fn overlay_focus_only(&self) -> Result<bool> {
        Ok(self.store().setting(OVERLAY_FOCUS_KEY)?.is_none_or(|v| v == "1"))
    }

    pub fn set_overlay_focus_only(&self, focus_only: bool) -> Result<()> {
        self.store().set_setting(OVERLAY_FOCUS_KEY, Some(if focus_only { "1" } else { "0" }))?;
        self.emit_overlay_settings()
    }

    fn emit_overlay_settings(&self) -> Result<()> {
        self.emit(AppEvent::OverlaySettings { enabled: self.overlay_enabled()?, focus_only: self.overlay_focus_only()? });
        Ok(())
    }

    pub fn setting(&self, key: &str) -> Result<Option<String>> {
        self.store().setting(key)
    }

    pub fn set_setting(&self, key: &str, value: Option<&str>) -> Result<()> {
        self.store().set_setting(key, value)
    }

    /// Per-game overlay layout, as JSON owned by the UI. `None` = use the game's default.
    pub fn overlay_layout(&self, game: &str) -> Result<Option<serde_json::Value>> {
        let raw = self.store().setting(&format!("overlay_layout:{game}"))?;
        Ok(raw.and_then(|r| serde_json::from_str(&r).ok()))
    }

    /// Saves (or with `None`, resets) a game's overlay layout and tells every UI.
    pub fn set_overlay_layout(&self, game: &str, layout: Option<&serde_json::Value>) -> Result<()> {
        if game.is_empty() || !game.chars().all(|c| c.is_ascii_alphanumeric()) {
            bail!("unknown game");
        }
        let raw = layout.map(serde_json::to_string).transpose()?;
        if raw.as_ref().is_some_and(|r| r.len() > 16_000) {
            bail!("layout is too large");
        }
        self.store().set_setting(&format!("overlay_layout:{game}"), raw.as_deref())?;
        self.emit(AppEvent::OverlayLayoutChanged { game: game.to_string() });
        Ok(())
    }

    // ---- drivers & the seat ------------------------------------------------

    pub fn drivers(&self) -> Result<Vec<Driver>> {
        self.store().drivers()
    }

    /// Adds a driver by name. If the name already exists (any case) that driver is
    /// returned instead: on a trust-based shared rig, typing your name is "logging in".
    pub fn add_driver(&self, name: &str, color: Option<&str>) -> Result<Driver> {
        let name = name.trim();
        if name.is_empty() {
            bail!("a driver needs a name");
        }
        if name.chars().count() > 32 {
            bail!("names are limited to 32 characters");
        }
        let store = self.store();
        if let Some(existing) = store.driver_by_name(name)? {
            return Ok(existing);
        }
        let color = match color {
            Some(c) => valid_color(c)?,
            None => HELMET_COLORS[store.driver_count()? as usize % HELMET_COLORS.len()].to_string(),
        };
        let driver = store.insert_driver(name, &color, now_ms())?;
        drop(store);
        self.emit(AppEvent::DriversChanged);
        Ok(driver)
    }

    pub fn update_driver(&self, id: DriverId, name: &str, color: &str) -> Result<Driver> {
        let name = name.trim();
        if name.is_empty() {
            bail!("a driver needs a name");
        }
        let color = valid_color(color)?;
        let store = self.store();
        if let Some(other) = store.driver_by_name(name)?
            && other.id != id
        {
            bail!("someone is already called {name}");
        }
        store.update_driver(id, name, &color)?;
        let driver = store.driver(id)?.ok_or_else(|| anyhow::anyhow!("no such driver"))?;
        drop(store);
        self.emit(AppEvent::DriversChanged);
        Ok(driver)
    }

    pub fn seat(&self) -> Result<Option<DriverId>> {
        Ok(self.store().setting(SEAT_KEY)?.and_then(|v| v.parse().ok()))
    }

    /// Puts a driver in the seat (`None` = nobody; laps are recorded as guest laps).
    pub fn set_seat(&self, driver_id: Option<DriverId>) -> Result<()> {
        let store = self.store();
        if let Some(id) = driver_id
            && store.driver(id)?.is_none()
        {
            bail!("no such driver");
        }
        store.set_setting(SEAT_KEY, driver_id.map(|id| id.to_string()).as_deref())?;
        drop(store);
        self.emit(AppEvent::SeatChanged { driver_id });
        Ok(())
    }

    /// The one-step "type your name and go" flow used by the app and the overlay.
    pub fn add_and_seat(&self, name: &str, color: Option<&str>) -> Result<Driver> {
        let driver = self.add_driver(name, color)?;
        self.set_seat(Some(driver.id))?;
        Ok(driver)
    }

    // ---- laps ----------------------------------------------------------------

    pub fn recent_laps(&self, limit: u32) -> Result<Vec<Lap>> {
        self.store().recent_laps(limit)
    }

    /// Assigns a guest lap (or a mis-attributed one) to a driver.
    pub fn claim_lap(&self, lap_id: LapId, driver_id: Option<DriverId>) -> Result<()> {
        self.store().set_lap_driver(lap_id, driver_id)?;
        self.emit(AppEvent::LapsChanged);
        Ok(())
    }

    pub fn combos(&self, game: Option<&str>) -> Result<Vec<Combo>> {
        self.store().combos(game)
    }

    pub fn leaderboard(&self, q: &LeaderboardQuery) -> Result<Vec<LeaderboardEntry>> {
        self.store().leaderboard(q)
    }

    pub fn record_lap(&self, completed: &CompletedLap) -> Result<LapResult> {
        self.record_lap_at(completed, now_ms())
    }

    fn record_lap_at(&self, completed: &CompletedLap, now: Timestamp) -> Result<LapResult> {
        let combo = combo_of(&completed.session);
        let driver_id = self.seat()?;
        let store = self.store();

        let challenges: Vec<Challenge> =
            store.challenges()?.into_iter().filter(|c| challenge_applies(c, &combo, now)).collect();
        let before: Vec<Option<u32>> =
            challenges.iter().map(|c| Ok(standing(&store, c, driver_id, now)?.map(|s| s.0))).collect::<Result<_>>()?;

        let mut lap = Lap {
            id: 0,
            driver_id,
            combo: combo.clone(),
            session_kind: completed.session.session_kind.clone(),
            lap_number: completed.lap_number,
            time_ms: completed.time_ms,
            valid: completed.valid,
            untimed_reason: completed.untimed.map(|r| r.key().to_string()),
            sectors_ms: completed.sectors_ms.clone(),
            recorded_at: now,
        };
        lap.id = store.insert_lap(&lap)?;

        let (personal_best, combo_record) = if lap.valid {
            let pb = match driver_id {
                Some(id) => store.best_valid_time(&combo, Some(id), lap.id)?.is_none_or(|t| lap.time_ms < t),
                None => false,
            };
            let record = store.best_valid_time(&combo, None, lap.id)?.is_none_or(|t| lap.time_ms < t);
            (pb, record)
        } else {
            (false, false)
        };

        let mut standings = Vec::new();
        for (c, previous_position) in challenges.iter().zip(before) {
            let now_standing = standing(&store, c, driver_id, now + 1)?;
            standings.push(ChallengeStanding {
                challenge_id: c.id,
                challenge_name: c.name.clone(),
                position: now_standing.map(|s| s.0),
                previous_position,
                gap_to_leader_ms: now_standing.map(|s| s.1),
            });
        }
        drop(store);

        let result = LapResult { lap, personal_best, combo_record, challenges: standings };
        self.emit(AppEvent::LapRecorded { result: result.clone() });
        Ok(result)
    }

    // ---- challenges ------------------------------------------------------------

    pub fn challenges(&self) -> Result<Vec<Challenge>> {
        self.store().challenges()
    }

    pub fn create_challenge(&self, c: &NewChallenge) -> Result<Challenge> {
        if c.name.trim().is_empty() {
            bail!("give the challenge a name");
        }
        let now = now_ms();
        let starts_at = c.starts_at.unwrap_or(now);
        if let Some(end) = c.ends_at
            && end <= starts_at
        {
            bail!("the challenge must end after it starts");
        }
        let challenge = self.store().insert_challenge(c, starts_at, now)?;
        self.emit(AppEvent::ChallengesChanged);
        Ok(challenge)
    }

    pub fn end_challenge(&self, id: ChallengeId) -> Result<()> {
        self.store().set_challenge_end(id, Some(now_ms()))?;
        self.emit(AppEvent::ChallengesChanged);
        Ok(())
    }

    pub fn delete_challenge(&self, id: ChallengeId) -> Result<()> {
        self.store().delete_challenge(id)?;
        self.emit(AppEvent::ChallengesChanged);
        Ok(())
    }

    pub fn challenge_leaderboard(&self, id: ChallengeId) -> Result<Vec<LeaderboardEntry>> {
        let store = self.store();
        let c = store.challenge(id)?.ok_or_else(|| anyhow::anyhow!("no such challenge"))?;
        store.leaderboard(&challenge_query(&c))
    }

    // ---- game events -------------------------------------------------------------

    /// Feed every event from a game adapter through here.
    pub fn handle_game_event(&self, event: GameEvent) -> Result<()> {
        match event {
            GameEvent::Connected { game, .. } => {
                self.runtime.lock().expect("runtime mutex poisoned").game = Some(game);
                self.emit(AppEvent::GameStatus {
                    game: Some(game.key().to_string()),
                    game_name: Some(game.display_name().to_string()),
                    connected: true,
                });
            }
            GameEvent::Disconnected { .. } => {
                *self.runtime.lock().expect("runtime mutex poisoned") = Runtime::default();
                self.emit(AppEvent::GameStatus { game: None, game_name: None, connected: false });
                self.emit(AppEvent::Session { session: None });
            }
            GameEvent::SessionChanged(info) => {
                let view = SessionView {
                    combo: combo_of(&info),
                    game_name: info.game.display_name().to_string(),
                    session_kind: info.session_kind.clone(),
                };
                self.runtime.lock().expect("runtime mutex poisoned").session = Some(view.clone());
                self.emit(AppEvent::Session { session: Some(view) });
            }
            GameEvent::LapCompleted(lap) => {
                self.record_lap(&lap)?;
            }
            GameEvent::Live(LiveState { driving, current_lap_ms, lap_valid, lap_progress }) => {
                let live = LiveView { driving, current_lap_ms, lap_valid, lap_progress };
                self.runtime.lock().expect("runtime mutex poisoned").live = Some(live.clone());
                self.emit(AppEvent::Live { live });
            }
        }
        Ok(())
    }
}

fn valid_color(c: &str) -> Result<String> {
    let ok = c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|ch| ch.is_ascii_hexdigit());
    if !ok {
        bail!("colour must look like #RRGGBB");
    }
    Ok(c.to_uppercase())
}

fn challenge_applies(c: &Challenge, combo: &Combo, now: Timestamp) -> bool {
    c.game == combo.game
        && c.track == combo.track
        && c.layout == combo.layout
        && c.car.as_ref().is_none_or(|car| *car == combo.car)
        && c.starts_at <= now
        && c.ends_at.is_none_or(|end| now < end)
}

fn challenge_query(c: &Challenge) -> LeaderboardQuery {
    LeaderboardQuery {
        game: c.game.clone(),
        track: c.track.clone(),
        layout: c.layout.clone(),
        car: c.car.clone(),
        from: Some(c.starts_at),
        to: c.ends_at,
        include_invalid: !c.valid_only,
        max_laps: c.max_laps,
    }
}

/// (position, gap to leader) of a driver in a challenge, if they have a counted lap.
fn standing(store: &Store, c: &Challenge, driver_id: Option<DriverId>, now: Timestamp) -> Result<Option<(u32, u32)>> {
    let Some(driver_id) = driver_id else { return Ok(None) };
    let mut q = challenge_query(c);
    q.to = Some(q.to.map_or(now, |end| end.min(now)));
    Ok(store
        .leaderboard(&q)?
        .into_iter()
        .find(|e| e.driver_id == Some(driver_id))
        .map(|e| (e.position, e.gap_ms)))
}

#[cfg(test)]
mod tests;
