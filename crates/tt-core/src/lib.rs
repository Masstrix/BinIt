//! Bin It core: who's in the seat, recording laps against them, challenges and
//! leaderboards. UI-agnostic; the desktop app and the LAN web server both sit on top.

pub mod catalogue;
pub mod live;
pub mod model;
pub mod pairing;
pub mod progress;
mod store;
pub mod trackmap;

use std::path::{Path, PathBuf};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Result, bail};
use serde::Serialize;
use tokio::sync::broadcast;
use tt_games::timing::even_boundaries;
use tt_games::{CompletedLap, GameEvent, GameId, LiveState, SessionInfo, TimingKind, UntimedReason};

use trackmap::{MapRecorder, TrackMap};
use live::{LiveTiming, LiveTimingView, TimingContext, sector_status};

pub use model::*;
pub use store::Store;

/// Helmet colours handed out to drivers who don't pick one.
pub const HELMET_COLORS: [&str; 10] = [
    "#FF9F6B", "#4FC3FF", "#FF7AC6", "#4BE3A6", "#FFC93C", "#B18CFF", "#FF6B8A", "#7CF5C4", "#6BD5FF", "#FFD86B",
];

const SEAT_KEY: &str = store::SEAT_SETTING;
const OVERLAY_KEY: &str = "overlay_enabled";
const OVERLAY_FOCUS_KEY: &str = "overlay_focus_only";
const OVERLAY_SHOW_KEY: &str = "overlay_show";

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
    /// A track map was learned: pickers and the live map should refetch.
    MapsChanged,
    Live { live: LiveView },
    OverlayLayoutChanged { game: String },
    #[serde(rename_all = "camelCase")]
    OverlaySettings { enabled: bool, focus_only: bool, show: String },
    /// The app's update status changed (found a new version, checking, installing): the desktop
    /// app keeps it, this only carries it to every screen.
    UpdateChanged { update: serde_json::Value },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    #[serde(flatten)]
    pub combo: Combo,
    pub game_name: String,
    pub session_kind: String,
    /// How many sectors this track layout is split into.
    pub sector_count: usize,
    /// Sector boundaries as fractions of the lap, `[0.0, ..., 1.0]` (so the UI can colour the map).
    pub boundaries: Vec<f32>,
}

/// Pedals, steering and gear for the live inputs display.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveInputs {
    pub throttle: f32,
    pub brake: f32,
    pub clutch: f32,
    pub handbrake: f32,
    pub steering: f32,
    pub gear: i16,
    pub speed_kmh: f32,
    pub rpm: u16,
}

impl From<tt_games::Inputs> for LiveInputs {
    fn from(i: tt_games::Inputs) -> Self {
        Self { throttle: i.throttle, brake: i.brake, clutch: i.clutch, handbrake: i.handbrake, steering: i.steering, gear: i.gear, speed_kmh: i.speed_kmh, rpm: i.rpm }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveView {
    pub driving: bool,
    /// "menu", "driving", "paused" or "replay".
    pub phase: &'static str,
    pub current_lap_ms: u32,
    pub lap_valid: bool,
    pub out_lap: bool,
    /// Why the lap in progress won't be timed, besides a cut: "driverChange".
    pub void_reason: Option<&'static str>,
    pub lap_progress: f32,
    /// Car position in world metres (x, z), for the live map.
    pub position: Option<[f32; 2]>,
    pub inputs: Option<LiveInputs>,
    /// Delta and sector bars for the lap in progress (when there's a session).
    pub timing: Option<LiveTimingView>,
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
    /// When widgets are drawn: "always", "drivingPaused" (not in menus) or "driving" (only while driving).
    pub overlay_show: String,
}

#[derive(Default)]
struct Runtime {
    game: Option<GameId>,
    session: Option<SessionView>,
    session_info: Option<SessionInfo>,
    live: Option<LiveView>,
    timing: LiveTiming,
    map: MapRecorder,
    /// The seat changed hands during the lap in progress: that lap won't count for anyone.
    lap_driver_changed: bool,
    /// A lap just ended (the car crossed the line) that had a driver change in it, and its result hasn't arrived yet.
    void_pending: bool,
    /// The car has crossed the line on a lap that should be reported shortly (out laps aren't reported by the game).
    wrap_waiting: bool,
    last_progress: f32,
    last_out_lap: bool,
    /// The stage clock at the previous live reading, to notice a restart.
    last_clock_ms: u32,
}

/// Where the catalogue looks for extra names. Set by the host app.
#[derive(Default, Clone)]
pub struct CataloguePaths {
    /// The user's Documents folder. Each game's scanner (`tt_games::catalogue::observe`) looks in its own
    /// subfolder for the plain-text files that game writes.
    pub documents: Option<PathBuf>,
    /// Folder of user-supplied `<game>.json` lists.
    pub custom: Option<PathBuf>,
}

pub struct BinIt {
    previous_version: Mutex<Option<String>>,
    catalogue_paths: Mutex<CataloguePaths>,
    store: Mutex<Store>,
    runtime: Mutex<Runtime>,
    events: broadcast::Sender<AppEvent>,
    /// One-time codes for pairing another phone to a driver: driver -> (code, runs out at). Never stored.
    pair_codes: Mutex<HashMap<DriverId, (String, Timestamp)>>,
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

impl BinIt {
    pub fn open(db_path: &Path) -> Result<Self> {
        let store = Store::open(db_path)?;
        // Note which version made this data and which one had it last, for the About page and for
        // working out what a future upgrade has to do.
        let version = env!("CARGO_PKG_VERSION");
        let previous = store.setting(store::OPENED_WITH_KEY)?;
        if store.setting(store::CREATED_WITH_KEY)?.is_none() {
            store.set_setting(store::CREATED_WITH_KEY, Some(version))?;
        }
        store.set_setting(store::OPENED_WITH_KEY, Some(version))?;
        let tt = Self::with_store(store);
        *tt.previous_version.lock().expect("previous version mutex poisoned") = previous;
        Ok(tt)
    }

    pub fn in_memory() -> Result<Self> {
        Ok(Self::with_store(Store::open_in_memory()?))
    }

    fn with_store(store: Store) -> Self {
        let (events, _) = broadcast::channel(256);
        Self { previous_version: Mutex::default(), catalogue_paths: Mutex::default(), store: Mutex::new(store), runtime: Mutex::new(Runtime::default()), events, pair_codes: Mutex::default() }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AppEvent> {
        self.events.subscribe()
    }

    /// Tells every screen the update status changed (see `AppEvent::UpdateChanged`).
    pub fn update_changed(&self, update: serde_json::Value) {
        self.emit(AppEvent::UpdateChanged { update });
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
            overlay_show: self.overlay_show()?,
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

    /// When the overlay's widgets show: "always", "drivingPaused" (hidden in menus and replays; the
    /// default) or "driving" (only while actually driving).
    pub fn overlay_show(&self) -> Result<String> {
        Ok(self.store().setting(OVERLAY_SHOW_KEY)?.filter(|v| ["always", "drivingPaused", "driving"].contains(&v.as_str())).unwrap_or_else(|| "drivingPaused".into()))
    }

    pub fn set_overlay_show(&self, mode: &str) -> Result<()> {
        if !["always", "drivingPaused", "driving"].contains(&mode) {
            bail!("unknown overlay mode");
        }
        self.store().set_setting(OVERLAY_SHOW_KEY, Some(mode))?;
        self.emit_overlay_settings()
    }

    fn emit_overlay_settings(&self) -> Result<()> {
        self.emit(AppEvent::OverlaySettings { enabled: self.overlay_enabled()?, focus_only: self.overlay_focus_only()?, show: self.overlay_show()? });
        Ok(())
    }

    pub fn setting(&self, key: &str) -> Result<Option<String>> {
        self.store().setting(key)
    }

    /// Adds another database's drivers, laps, challenges and maps to this one, skipping what is
    /// already here (see [`Store::merge_from`]). `other` is changed (upgraded), so pass a copy.
    pub fn merge_from(&self, other: &Path) -> Result<MergeReport> {
        self.store().merge_from(other)
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

    // ---- paired phones -----------------------------------------------------

    /// Pairs a phone with a driver and returns its token (shown once; only a hash is kept).
    ///
    /// A driver nobody has claimed can be claimed by anyone, like typing a name on the rig. Once a phone is
    /// paired, another one needs the driver's one-time `code` (see `new_pair_code`).
    pub fn pair_device(&self, driver_id: DriverId, code: Option<&str>, label: &str) -> Result<(String, Driver)> {
        let store = self.store();
        let driver = store.driver(driver_id)?.ok_or_else(|| anyhow::anyhow!("no such driver"))?;
        if store.device_count(driver_id)? > 0 {
            let Some(code) = code.map(str::trim).filter(|c| !c.is_empty()) else {
                return Err(pairing::PairError::CodeNeeded.into());
            };
            let mut codes = self.pair_codes.lock().expect("pair codes mutex poisoned");
            match codes.get(&driver_id) {
                Some((expected, until)) if *until > now_ms() && expected == code => {
                    codes.remove(&driver_id);
                }
                _ => return Err(pairing::PairError::BadCode.into()),
            }
        }
        let token = pairing::new_token()?;
        let label: String = label.trim().chars().take(40).collect();
        store.insert_device(driver_id, &pairing::hash_token(&token), if label.is_empty() { "Phone" } else { &label }, now_ms())?;
        drop(store);
        self.emit(AppEvent::DriversChanged);
        Ok((token, driver))
    }

    /// A six digit code that lets one more phone pair with this driver, for the next few minutes.
    pub fn new_pair_code(&self, driver_id: DriverId) -> Result<(String, Timestamp)> {
        if self.store().driver(driver_id)?.is_none() {
            bail!("no such driver");
        }
        let code = pairing::new_code()?;
        let until = now_ms() + pairing::CODE_TTL_MS;
        self.pair_codes.lock().expect("pair codes mutex poisoned").insert(driver_id, (code.clone(), until));
        Ok((code, until))
    }

    /// Who a phone's token belongs to (and note that it was just used).
    pub fn device_for_token(&self, token: &str) -> Result<Option<(Device, Driver)>> {
        let store = self.store();
        let Some(device) = store.device_by_hash(&pairing::hash_token(token))? else { return Ok(None) };
        let Some(driver) = store.driver(device.driver_id)? else { return Ok(None) };
        let now = now_ms();
        if now - device.last_seen > 60_000 {
            store.touch_device(device.id, now)?;
        }
        Ok(Some((device, driver)))
    }

    /// The phone logs itself out: its token stops working.
    pub fn unpair_token(&self, token: &str) -> Result<bool> {
        let store = self.store();
        let Some(device) = store.device_by_hash(&pairing::hash_token(token))? else { return Ok(false) };
        store.delete_device(device.id)?;
        drop(store);
        self.emit(AppEvent::DriversChanged);
        Ok(true)
    }

    pub fn devices(&self) -> Result<Vec<Device>> {
        self.store().devices()
    }

    /// Signs one phone out (from the PC, or from the driver's own phone).
    pub fn remove_device(&self, id: i64) -> Result<()> {
        self.store().delete_device(id)?;
        self.emit(AppEvent::DriversChanged);
        Ok(())
    }

    /// Signs every phone out of a driver, e.g. after one was lost. The next phone to claim them wins.
    pub fn remove_driver_devices(&self, driver_id: DriverId) -> Result<usize> {
        let n = self.store().delete_driver_devices(driver_id)?;
        self.pair_codes.lock().expect("pair codes mutex poisoned").remove(&driver_id);
        self.emit(AppEvent::DriversChanged);
        Ok(n)
    }

    /// Whether any phone is paired to this driver (an unpaired driver can be edited by anyone, as before).
    pub fn driver_is_claimed(&self, driver_id: DriverId) -> Result<bool> {
        Ok(self.store().device_count(driver_id)? > 0)
    }

    // ---- profile ---------------------------------------------------------

    /// Level, XP, coins, bests and stickers for the You page.
    pub fn profile(&self, driver_id: DriverId) -> Result<Profile> {
        let driver = self.store().driver(driver_id)?.ok_or_else(|| anyhow::anyhow!("no such driver"))?;
        let laps = self.driver_laps(driver_id)?;
        let store = self.store();
        let (xp, coins) = store.point_totals(driver_id)?;
        let level = progress::level_of(xp);
        let recent = store.recent_point_events(driver_id, 8)?;

        let clean_laps = laps.iter().filter(|l| l.valid).count() as u32;
        let attempts = laps.iter().filter(|l| l.valid || matches!(l.untimed_reason.as_deref(), None | Some("cut"))).count() as u32;
        let clean_percent = if attempts == 0 { 100 } else { (f64::from(clean_laps) * 100.0 / f64::from(attempts)).round() as u32 };
        let mut tracks: Vec<(&str, &str, &str)> =
            laps.iter().filter(|l| l.valid).map(|l| (l.combo.game.as_str(), l.combo.track.as_str(), l.combo.layout.as_str())).collect();
        tracks.sort_unstable();
        tracks.dedup();

        // Where each of this driver's bests ranks among everyone's.
        let all = store.profile_best_times()?;
        drop(store);
        let mut bests: Vec<ProfileBest> = all
            .iter()
            .filter(|(_, d, _)| *d == driver_id)
            .map(|(combo, _, time)| {
                let rivals: Vec<u32> = all.iter().filter(|(c, _, _)| c == combo).map(|(_, _, t)| *t).collect();
                ProfileBest { combo: combo.clone(), time_ms: *time, position: 1 + rivals.iter().filter(|t| *t < time).count() as u32, of: rivals.len() as u32 }
            })
            .collect();
        bests.sort_by(|a, b| (&a.combo.game, &a.combo.track, &a.combo.layout, &a.combo.car).cmp(&(&b.combo.game, &b.combo.track, &b.combo.layout, &b.combo.car)));

        let streak_days = streak_days(laps.iter().filter(|l| l.valid).map(|l| l.recorded_at), now_ms());
        let holds_a_record = bests.iter().any(|b| b.position == 1 && b.of > 1);
        let sticker = |id: &str, name: &str, hint: &str, earned: bool| Sticker { id: id.into(), name: name.into(), hint: hint.into(), earned };
        let stickers = vec![
            sticker("first-lap", "First lap", "Set a clean lap", clean_laps >= 1),
            sticker("ten-clean", "10 clean laps", "Ten laps with no cuts", clean_laps >= 10),
            sticker("fifty-clean", "50 clean laps", "Fifty laps with no cuts", clean_laps >= 50),
            sticker("explorer", "3 tracks", "Set a clean lap on three tracks", tracks.len() >= 3),
            sticker("record", "Track record", "Hold the fastest lap on a track and car", holds_a_record),
            sticker("streak", "3-day streak", "Drive three days in a row", streak_days >= 3),
            sticker("clean-sweep", "Clean sweep", "Ten attempts, none cut", attempts >= 10 && clean_laps == attempts),
            sticker("regular", "Level 5", "Reach level 5", level >= 5),
        ];

        Ok(Profile {
            driver,
            level,
            title: progress::title_for(level).into(),
            next_title: progress::title_for(level + 1).into(),
            xp,
            level_start_xp: progress::xp_for_level(level),
            next_level_xp: progress::xp_for_level(level + 1),
            coins,
            attempts,
            clean_laps,
            clean_percent,
            tracks: tracks.len() as u32,
            streak_days,
            bests,
            stickers,
            recent,
        })
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
        let before = store.setting(SEAT_KEY)?.and_then(|v| v.parse::<DriverId>().ok());
        store.set_setting(SEAT_KEY, driver_id.map(|id| id.to_string()).as_deref())?;
        drop(store);
        if before != driver_id {
            // Swapping drivers part-way round a lap would let someone take over a good lap (or dump a bad
            // one on somebody else), so the lap in progress is voided for everybody.
            let mut rt = self.runtime.lock().expect("runtime mutex poisoned");
            let on_track = rt.session_info.is_some() && rt.live.as_ref().is_some_and(|l| l.phase == "driving" || l.phase == "paused");
            if on_track {
                rt.lap_driver_changed = true;
            }
        }
        // Live delta compares against the new driver's PB.
        self.refresh_timing()?;
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

    /// The throttle / brake / steering / gear trace of a lap, if it was recorded.
    pub fn lap_trace(&self, id: LapId) -> Result<Option<tt_games::timing::LapTrace>> {
        self.store().lap_trace(id)
    }

    /// Row counts and the schema version, for the About page.
    pub fn about_counts(&self) -> Result<AboutCounts> {
        let mut counts = self.store().about_counts()?;
        counts.previous_version = self.previous_version.lock().expect("previous version mutex poisoned").clone();
        Ok(counts)
    }

    /// Speed scores for everyone: see [`DriverRating`]. Only like-for-like comparisons count (same
    /// track, layout and car, with at least two drivers), so a rating can't be skewed by one driver
    /// choosing a slower car or an easier track.
    pub fn driver_ratings(&self) -> Result<Vec<DriverRating>> {
        let store = self.store();
        let drivers = store.drivers()?;
        let times = store.best_times_by_driver()?;
        let mut fastest: std::collections::HashMap<&Combo, u32> = std::collections::HashMap::new();
        let mut entrants: std::collections::HashMap<&Combo, u32> = std::collections::HashMap::new();
        for (_, combo, ms) in &times {
            let f = fastest.entry(combo).or_insert(*ms);
            *f = (*f).min(*ms);
            *entrants.entry(combo).or_insert(0) += 1;
        }
        Ok(drivers
            .iter()
            .map(|d| {
                let mut gaps = Vec::new();
                let mut fastest_on = 0;
                for (id, combo, ms) in &times {
                    if *id != d.id || entrants[combo] < 2 {
                        continue;
                    }
                    let best = fastest[combo];
                    gaps.push((*ms as f64 - best as f64) / best as f64 * 100.0);
                    if *ms == best {
                        fastest_on += 1;
                    }
                }
                let score = (!gaps.is_empty()).then(|| (100.0 - gaps.iter().sum::<f64>() / gaps.len() as f64).clamp(0.0, 100.0));
                DriverRating { driver_id: d.id, score, combos: gaps.len() as u32, fastest_on }
            })
            .collect())
    }

    /// All of a driver's laps, oldest first: what their progress over time is drawn from.
    pub fn driver_laps(&self, driver_id: DriverId) -> Result<Vec<Lap>> {
        self.store().driver_laps(driver_id)
    }

    pub fn recent_laps(&self, limit: u32) -> Result<Vec<Lap>> {
        self.store().recent_laps(limit)
    }

    /// Assigns a guest lap (or a mis-attributed one) to a driver.
    pub fn claim_lap(&self, lap_id: LapId, driver_id: Option<DriverId>) -> Result<()> {
        self.store().set_lap_driver(lap_id, driver_id)?;
        self.refresh_timing()?;
        self.emit(AppEvent::LapsChanged);
        Ok(())
    }

    pub fn set_catalogue_paths(&self, paths: CataloguePaths) {
        *self.catalogue_paths.lock().expect("catalogue paths mutex poisoned") = paths;
    }

    /// The catalogue lists (bundled, then the user's) used to name things consistently.
    fn seeds(&self, game: &str) -> Vec<catalogue::Seed> {
        let custom = self.catalogue_paths.lock().expect("catalogue paths mutex poisoned").custom.clone();
        let mut seeds = vec![catalogue::bundled(game)];
        seeds.extend(custom.map(|dir| catalogue::custom(&dir, game)));
        seeds
    }

    /// Rewrites a session's track and car to the catalogue's names, so a lap driven in a car the
    /// game calls "Porsche 911 GT3 Cup (992)" and a challenge made from "Porsche 992 GT3 Cup" agree.
    fn canonical_session(&self, info: &mut SessionInfo) {
        let seeds = self.seeds(info.game.key());
        info.track = catalogue::canonical_track(&seeds, &info.track);
        info.car = catalogue::canonical_car(&seeds, &info.car);
    }

    /// Brings laps and challenges recorded before a name was in the catalogue under the catalogue's
    /// name. Safe to run any time; does nothing when everything already agrees.
    pub fn canonicalize_history(&self, game: &str) -> Result<usize> {
        let seeds = self.seeds(game);
        let store = self.store();
        let (cars, tracks) = store.stored_names(game)?;
        let mut changed = 0;
        for car in cars {
            let canon = catalogue::canonical_car(&seeds, &car);
            if canon != car {
                store.rename_car(game, &car, &canon)?;
                changed += 1;
            }
        }
        for track in tracks {
            let canon = catalogue::canonical_track(&seeds, &track);
            if canon != track {
                store.rename_track(game, &track, &canon)?;
                changed += 1;
            }
        }
        Ok(changed)
    }

    /// Every track, layout and car for a game, including ones nobody has driven.
    pub fn catalogue(&self, game: &str) -> Result<catalogue::Catalogue> {
        let paths = self.catalogue_paths.lock().expect("catalogue paths mutex poisoned").clone();
        let mut seeds = vec![catalogue::bundled(game)];
        if let Some(dir) = &paths.custom {
            seeds.push(catalogue::custom(dir, game));
        }
        let observed = match &paths.documents {
            Some(dir) => tt_games::catalogue::observe(game, dir),
            None => catalogue::Observed::default(),
        };
        let store = self.store();
        let driven = store.combos(Some(game))?;
        let maps: Vec<(String, String)> = store.track_maps(game)?.into_iter().map(|m| (m.track, m.layout)).collect();
        Ok(catalogue::build(game, seeds, &observed, &driven, &maps))
    }

    /// Learned track outlines for a game.
    pub fn track_maps(&self, game: &str) -> Result<Vec<TrackMap>> {
        let store = self.store();
        let mut maps = store.track_maps(game)?;
        for m in &mut maps {
            let raw = store.setting(&map_view_key(&m.game, &m.track, &m.layout))?;
            if let Some((rotate, mirror)) = raw.as_deref().and_then(|r| r.split_once(',')) {
                m.rotate = rotate.parse().unwrap_or(0);
                m.mirror = mirror == "1";
            }
        }
        Ok(maps)
    }

    /// How a track's map is drawn (rotation in degrees clockwise, and mirroring), for tracks whose
    /// world axes don't match the way people expect to see them.
    pub fn set_map_view(&self, game: &str, track: &str, layout: &str, rotate: u16, mirror: bool) -> Result<()> {
        if rotate % 90 != 0 || rotate >= 360 {
            bail!("rotation must be 0, 90, 180 or 270");
        }
        let value = format!("{rotate},{}", u8::from(mirror));
        self.store().set_setting(&map_view_key(game, track, layout), Some(&value))?;
        self.emit(AppEvent::MapsChanged);
        Ok(())
    }

    /// How many laps a cleanup would delete.
    pub fn count_laps(&self, filter: &LapFilter) -> Result<u32> {
        self.store().count_laps(filter)
    }

    /// Permanently deletes laps (and with `forget_map`, the learned map and sector layout of the
    /// track) so that bad or test data can be cleared. Challenges stay; their boards just lose the laps.
    pub fn delete_laps(&self, filter: &LapFilter) -> Result<usize> {
        let store = self.store();
        let deleted = store.delete_laps(filter)?;
        if filter.forget_map {
            store.forget_track_extras(&filter.game, &filter.track, filter.layout.as_deref())?;
        }
        drop(store);
        // Live timing's reference and bests came from these laps.
        self.refresh_timing()?;
        self.emit(AppEvent::LapsChanged);
        if filter.forget_map {
            self.emit(AppEvent::MapsChanged);
        }
        Ok(deleted)
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
        // Before this lap is saved: every lap so far, including one recorded in this same millisecond.
        let before: Vec<Option<u32>> =
            challenges.iter().map(|c| Ok(standing(&store, c, driver_id, now + 1)?.map(|s| s.0))).collect::<Result<_>>()?;

        // Sectors: the game's own when it reports them, else split from the lap's profile.
        let boundaries = boundaries_for(&store, &completed.session)?;
        let sectors_ms = if !completed.sectors_ms.is_empty() {
            completed.sectors_ms.clone()
        } else {
            completed.profile.as_ref().map(|p| p.split(&boundaries)).unwrap_or_default()
        };

        let mut lap = Lap {
            id: 0,
            driver_id,
            combo: combo.clone(),
            session_kind: completed.session.session_kind.clone(),
            lap_number: completed.lap_number,
            time_ms: completed.time_ms,
            valid: completed.valid,
            untimed_reason: completed.untimed.map(|r| r.key().to_string()),
            sectors_ms,
            recorded_at: now,
        };
        lap.id = store.insert_lap(&lap, completed.profile.as_ref(), completed.trace.as_ref())?;

        // Purple / green / yellow per sector, against every other valid lap on this combo.
        let sector_status = if lap.valid || completed.untimed == Some(UntimedReason::Cut) {
            let others = store.valid_sectors(&combo, lap.id)?;
            let (overall, driver) = sector_bests(&others, lap.sectors_ms.len(), driver_id);
            lap.sectors_ms.iter().enumerate().map(|(i, &t)| sector_status(t, overall[i], driver[i])).collect()
        } else {
            Vec::new()
        };

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
        let awards = match driver_id {
            Some(id) if lap.valid => award_lap(&store, id, &lap, &combo, personal_best, combo_record, now)?,
            _ => Awards::default(),
        };
        drop(store);
        // New bests / PB change what live timing compares against.
        self.refresh_timing()?;

        let result = LapResult { lap, personal_best, combo_record, sector_status, challenges: standings, awards };
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

    /// Every ranked driver's best lap with its timing profile, so the UI can run them side by side.
    pub fn challenge_replay(&self, id: ChallengeId) -> Result<Vec<ReplayEntry>> {
        let store = self.store();
        let c = store.challenge(id)?.ok_or_else(|| anyhow::anyhow!("no such challenge"))?;
        store
            .leaderboard(&challenge_query(&c))?
            .into_iter()
            .map(|e| {
                let profile = store.lap_profile(e.lap_id)?.map(|p| p.0);
                Ok(ReplayEntry { position: e.position, driver_id: e.driver_id, lap_id: e.lap_id, time_ms: e.time_ms, profile })
            })
            .collect()
    }

    // ---- game events -------------------------------------------------------------

    /// Feed every event from a game adapter through here.
    pub fn handle_game_event(&self, mut event: GameEvent) -> Result<()> {
        match &mut event {
            GameEvent::SessionChanged(info) => self.canonical_session(info),
            GameEvent::LapCompleted(lap) => self.canonical_session(&mut lap.session),
            _ => {}
        }
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
                let boundaries = boundaries_for(&self.store(), &info)?;
                let view = SessionView {
                    combo: combo_of(&info),
                    game_name: info.game.display_name().to_string(),
                    session_kind: info.session_kind.clone(),
                    sector_count: boundaries.len().saturating_sub(1),
                    boundaries,
                };
                {
                    let mut rt = self.runtime.lock().expect("runtime mutex poisoned");
                    rt.session = Some(view.clone());
                    rt.session_info = Some(info);
                    // The path so far belonged to the previous track.
                    rt.map.reset();
                }
                self.refresh_timing()?;
                self.emit(AppEvent::Session { session: Some(view) });
            }
            GameEvent::LapCompleted(mut lap) => {
                let changed = {
                    let mut rt = self.runtime.lock().expect("runtime mutex poisoned");
                    // The lap's result can arrive a moment after the car crossed the line: by then a new
                    // lap has begun, and a swap made in that gap belongs to the new lap, not this one.
                    if std::mem::take(&mut rt.wrap_waiting) {
                        std::mem::take(&mut rt.void_pending)
                    } else {
                        std::mem::take(&mut rt.lap_driver_changed)
                    }
                };
                // Only a lap that would have counted (or been a failed attempt) needs voiding; out, in and
                // partial laps are already not timed.
                if changed && matches!(lap.untimed, None | Some(UntimedReason::Cut)) {
                    lap.untimed = Some(UntimedReason::DriverChange);
                    lap.valid = false;
                    lap.profile = None;
                    lap.trace = None;
                }
                self.learn_map(&lap)?;
                self.record_lap(&lap)?;
            }
            GameEvent::Live(LiveState { driving, phase, current_lap_ms, lap_valid, out_lap, lap_progress, position, inputs }) => {
                let mut rt = self.runtime.lock().expect("runtime mutex poisoned");
                let timing = if out_lap {
                    rt.timing.pause();
                    None
                } else if driving && rt.session_info.is_some() {
                    rt.timing.update(lap_progress, current_lap_ms)
                } else {
                    None
                };
                let stage = rt.session_info.as_ref().is_some_and(|s| s.timing == TimingKind::RallyStage);
                if stage && current_lap_ms + 1_000 < rt.last_clock_ms {
                    // The stage was restarted: the path so far belongs to the abandoned run.
                    rt.map.reset();
                }
                rt.last_clock_ms = current_lap_ms;
                // On a stage the path starts when the clock does, not at the drive-up to the line.
                let on_course = !stage || current_lap_ms > 0;
                if let (true, false, true, true, Some(pos)) = (driving, out_lap, rt.session_info.is_some(), on_course, position) {
                    rt.map.record(lap_progress, pos);
                }
                // Crossing the line starts a new lap. A swap during an out lap (a handover in the pits) is
                // fine: that lap isn't timed. A swap during a timed lap voids it when its result arrives.
                if rt.last_progress > 0.9 && lap_progress < 0.1 {
                    if rt.last_out_lap {
                        rt.lap_driver_changed = false;
                    } else {
                        rt.void_pending = std::mem::take(&mut rt.lap_driver_changed);
                        rt.wrap_waiting = true;
                    }
                }
                rt.last_progress = lap_progress;
                rt.last_out_lap = out_lap;
                let changed = rt.lap_driver_changed && !out_lap;
                let lap_valid = lap_valid && !changed;
                let live = LiveView { driving, phase: phase.key(), current_lap_ms, lap_valid, out_lap, void_reason: changed.then_some("driverChange"), lap_progress, position, inputs: inputs.map(LiveInputs::from), timing };
                rt.live = Some(live.clone());
                drop(rt);
                self.emit(AppEvent::Live { live });
            }
        }
        Ok(())
    }
}

impl BinIt {
    /// The path driven so far on the current lap or stage, for drawing a map while it is learned.
    pub fn learning_path(&self) -> Vec<[f32; 2]> {
        self.runtime.lock().expect("runtime mutex poisoned").map.partial()
    }

    /// Keeps the outline of a clean lap as the track's map, if the track has none yet.
    fn learn_map(&self, lap: &CompletedLap) -> Result<()> {
        let mut rt = self.runtime.lock().expect("runtime mutex poisoned");
        // A circuit's outline is a closed loop; a rally stage runs from one place to another and is kept
        // as an open path, or the end would be joined back to the start across the countryside.
        let closed = lap.session.timing != TimingKind::RallyStage;
        let points = if closed { rt.map.finish() } else { rt.map.finish_open() };
        drop(rt);
        let (true, Some(points)) = (lap.valid && lap.untimed.is_none(), points) else { return Ok(()) };
        let c = combo_of(&lap.session);
        let store = self.store();
        if store.track_map(&c.game, &c.track, &c.layout)?.is_some() {
            return Ok(());
        }
        store.set_track_map(&c.game, &c.track, &c.layout, &points, closed, now_ms())?;
        drop(store);
        self.emit(AppEvent::MapsChanged);
        Ok(())
    }

    /// Reloads what live timing compares against: the track's sector boundaries, the
    /// seated driver's PB profile (else the combo's best) and the best sector times.
    fn refresh_timing(&self) -> Result<()> {
        let Some(info) = self.runtime.lock().expect("runtime mutex poisoned").session_info.clone() else {
            return Ok(());
        };
        let seat = self.seat()?;
        let combo = combo_of(&info);
        let ctx = {
            let store = self.store();
            let boundaries = boundaries_for(&store, &info)?;
            let rows = store.valid_sectors(&combo, -1)?;
            let (best_overall, best_driver) = sector_bests(&rows, boundaries.len().saturating_sub(1), seat);
            // The reference is the fastest lap that has a recorded profile. Call it "PB" / "Best" only
            // when that really is the fastest valid lap; otherwise name the lap by its time.
            let label = |profile: &tt_games::timing::TimingProfile, fastest: Option<u32>, word: &str| {
                let ms = profile.total_ms();
                if fastest == Some(ms) { word.to_string() } else { format!("{}:{:02}.{:03}", ms / 60_000, ms / 1000 % 60, ms % 1000) }
            };
            let pb = match seat {
                Some(id) => match store.best_profile(&combo, Some(id))? {
                    Some(p) => {
                        let l = label(&p, store.best_valid_time(&combo, Some(id), -1)?, "PB");
                        Some((p, l))
                    }
                    None => None,
                },
                None => None,
            };
            let reference = match pb {
                Some(r) => Some(r),
                None => match store.best_profile(&combo, None)? {
                    Some(p) => {
                        let l = label(&p, store.best_valid_time(&combo, None, -1)?, "Best");
                        Some((p, l))
                    }
                    None => None,
                },
            };
            TimingContext { boundaries, reference, best_overall, best_driver }
        };
        self.runtime.lock().expect("runtime mutex poisoned").timing.configure(ctx);
        Ok(())
    }

    /// Sector boundaries for a track layout. Exposed for the UI and future learning.
    pub fn sector_boundaries(&self, game: &str, track: &str, layout: &str) -> Result<Option<Vec<f32>>> {
        Ok(self.store().sector_layout(game, track, layout)?.map(|(b, _)| b))
    }
}

/// Sector boundaries for a session's track layout, creating even ones the first time.
fn boundaries_for(store: &Store, info: &SessionInfo) -> Result<Vec<f32>> {
    let c = combo_of(info);
    if let Some((b, _)) = store.sector_layout(&c.game, &c.track, &c.layout)?
        && b.len() >= 2
    {
        return Ok(b);
    }
    let b = even_boundaries(info.timing == TimingKind::RallyStage, info.length_m.map(|m| m as f32));
    store.set_sector_layout(&c.game, &c.track, &c.layout, &b, "even")?;
    Ok(b)
}

/// Best time per sector: (anyone's, this driver's). Only laps split into `n` sectors count.
fn sector_bests(rows: &[(Option<DriverId>, Vec<u32>)], n: usize, driver: Option<DriverId>) -> (Vec<Option<u32>>, Vec<Option<u32>>) {
    let mut overall = vec![None; n];
    let mut mine = vec![None; n];
    for (who, sectors) in rows.iter().filter(|(_, s)| s.len() == n) {
        for (i, &t) in sectors.iter().enumerate() {
            overall[i] = Some(overall[i].map_or(t, |b: u32| b.min(t)));
            if driver.is_some() && *who == driver {
                mine[i] = Some(mine[i].map_or(t, |b: u32| b.min(t)));
            }
        }
    }
    (overall, mine)
}

fn map_view_key(game: &str, track: &str, layout: &str) -> String {
    format!("map_view:{game}|{track}|{layout}")
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

/// Pays a driver for a valid lap: see `progress` for what each thing is worth.
fn award_lap(store: &Store, driver: DriverId, lap: &Lap, combo: &Combo, personal_best: bool, combo_record: bool, now: Timestamp) -> Result<Awards> {
    use progress::*;
    let first_here = store.best_valid_time(combo, Some(driver), lap.id)?.is_none();
    let xp_before = store.point_totals(driver)?.0;
    let mut awards = Awards::default();
    let mut give = |kind: &str, xp: i64, coins: i64, reason: &str| -> Result<()> {
        store.insert_point_event(driver, kind, xp, coins, Some(lap.id), now)?;
        awards.xp += xp;
        awards.coins += coins;
        awards.reasons.push(reason.to_string());
        Ok(())
    };
    if first_here {
        give("first", FIRST_XP, FIRST_COINS, "First lap here")?;
    }
    if store.lap_awards_since(driver, combo, now - DAY_MS)? < LAP_CAP_PER_DAY {
        give("lap", LAP_XP, LAP_COINS, "Clean lap")?;
    }
    if personal_best && !first_here {
        give("pb", PB_XP, PB_COINS, "Personal best")?;
    }
    if combo_record && store.others_have_valid_lap(combo, driver, lap.id)? {
        give("record", RECORD_XP, RECORD_COINS, "Track record")?;
    }
    let level_after = level_of(xp_before + awards.xp);
    if level_after > level_of(xp_before) {
        awards.level_up = Some(level_after);
    }
    Ok(awards)
}

/// Consecutive days, ending today or yesterday, with at least one of `times` (UTC days).
fn streak_days(times: impl Iterator<Item = Timestamp>, now: Timestamp) -> u32 {
    let mut days: Vec<i64> = times.map(|t| t.div_euclid(progress::DAY_MS)).collect();
    days.sort_unstable();
    days.dedup();
    let today = now.div_euclid(progress::DAY_MS);
    let Some(&last) = days.last() else { return 0 };
    if today - last > 1 {
        return 0;
    }
    let mut streak = 1;
    for pair in days.windows(2).rev() {
        if pair[1] - pair[0] == 1 {
            streak += 1;
        } else {
            break;
        }
    }
    streak
}
