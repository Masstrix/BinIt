//! Updates from the GitHub releases.
//!
//! The installed app checks for a newer release every time it starts. While it checks, a small
//! window with the logo and a progress bar is shown instead of the main window (the main window
//! is created hidden, see `tauri.conf.json`). When there is an update it is downloaded, checked
//! against the public key in `tauri.conf.json`, and the installer runs silently; Bin It exits for
//! that and the installer starts it again. Otherwise (no update, offline) the small window closes
//! and the main window opens; if the download or install fails it says so briefly first.
//!
//! While it runs, the app looks again every hour. A newer version found then is only announced
//! (the Advanced page and a button in the menu, on the PC and on phones); someone has to choose
//! "Update now", so nobody is thrown out mid-lap. The same small window shows that update.
//!
//! The portable exe can't replace itself, so it only checks and the app links to the download
//! instead. Development builds only check when asked.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::bail;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::{Update, UpdaterExt};
use tt_core::BinIt;

pub const LABEL: &str = "updater";
const EVENT: &str = "updater://stage";
/// How long a check may take before giving up (offline, slow network).
const CHECK_TIMEOUT: Duration = Duration::from_secs(8);
/// How long the download may take. The installer is about 10 MB.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// How often a running app looks for a new release.
const POLL_EVERY: Duration = Duration::from_secs(60 * 60);
/// The window stays up at least this long, so a quick "no update" doesn't just flash.
const MIN_SHOWN: Duration = Duration::from_millis(1200);
/// How long a failure stays on screen before the app opens anyway.
const FAILURE_SHOWN: Duration = Duration::from_millis(2500);

const RELEASES: &str = "https://github.com/Masstrix/BinIt/releases";

/// What the update window shows.
#[derive(Clone, Serialize)]
#[serde(tag = "stage", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Stage {
    Checking,
    Downloading { version: String, downloaded: u64, total: Option<u64> },
    Installing { version: String },
    Failed { message: String },
    Starting,
}

/// A newer release than this one.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Available {
    pub version: String,
    pub notes: Option<String>,
}

/// What sort of copy this is, which decides what it can do about an update.
#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    /// Put here by the installer (its uninstaller sits next to it): updates itself.
    Installed,
    /// Just a file someone copied: can only say there's a new version.
    Portable,
    Development,
}

pub fn kind() -> Kind {
    if cfg!(debug_assertions) {
        return Kind::Development;
    }
    let installed = std::env::current_exe().ok().and_then(|exe| Some(exe.parent()?.join("uninstall.exe").is_file()));
    if installed == Some(true) { Kind::Installed } else { Kind::Portable }
}

/// Everything a screen shows about updates: the Advanced page, the menu button, phones.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub current: &'static str,
    pub kind: Kind,
    /// A newer release, from the last check that worked.
    pub latest: Option<Available>,
    pub checking: bool,
    /// When a check last worked (ms since the Unix epoch).
    pub last_checked: Option<i64>,
    /// Why the last check or update didn't work, until one does.
    pub error: Option<String>,
    /// While an update is being installed (or the startup check runs): what the small window shows.
    pub stage: Option<Stage>,
}

#[derive(Default)]
struct State {
    latest: Option<Available>,
    checking: bool,
    last_checked: Option<i64>,
    error: Option<String>,
    stage: Option<Stage>,
}

static STATE: Mutex<State> = Mutex::new(State { latest: None, checking: false, last_checked: None, error: None, stage: None });

fn state() -> std::sync::MutexGuard<'static, State> {
    STATE.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn status() -> Status {
    let s = state();
    Status {
        current: env!("CARGO_PKG_VERSION"),
        kind: kind(),
        latest: s.latest.clone(),
        checking: s.checking,
        last_checked: s.last_checked,
        error: s.error.clone(),
        stage: s.stage.clone(),
    }
}

/// Tells every screen (through the app's event stream) that the status changed.
fn broadcast(app: &AppHandle) {
    if let (Some(tt), Ok(json)) = (app.try_state::<Arc<BinIt>>(), serde_json::to_value(status())) {
        tt.update_changed(json);
    }
}

fn set_stage(app: &AppHandle, stage: Option<Stage>) {
    state().stage = stage.clone();
    if let Some(stage) = stage {
        let _ = app.emit_to(LABEL, EVENT, stage);
    }
    broadcast(app);
}

/// Called once from `setup`: shows the update window and updates, or opens the main window. Then
/// keeps looking for new releases in the background.
pub fn start(app: &AppHandle) -> tauri::Result<()> {
    match kind() {
        Kind::Development => show_main(app),
        Kind::Portable => {
            show_main(app);
            spawn_polling(app.clone(), Duration::ZERO);
        }
        Kind::Installed => {
            set_stage(app, Some(Stage::Checking));
            open_window(app)?;
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                startup(&app).await;
                spawn_polling(app, POLL_EVERY);
            });
        }
    }
    Ok(())
}

/// The startup check: install a newer release straight away, otherwise open the app.
async fn startup(app: &AppHandle) {
    let started = Instant::now();
    // Not reaching GitHub (offline, a slow network) is normal: just start, without a fuss.
    if let Ok(Some(update)) = check(app).await
        && let Err(e) = install(app, update).await
    {
        fail(app, &e).await;
    }
    // No update (or it failed): carry on into the app.
    set_stage(app, Some(Stage::Starting));
    tokio::time::sleep(MIN_SHOWN.saturating_sub(started.elapsed())).await;
    set_stage(app, None);
    show_main(app);
    close_window(app);
}

fn spawn_polling(app: AppHandle, first_wait: Duration) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(first_wait).await;
        loop {
            check_now(&app).await;
            tokio::time::sleep(POLL_EVERY).await;
        }
    });
}

/// Looks for a newer release, notes what it found, and tells every screen.
async fn check(app: &AppHandle) -> anyhow::Result<Option<Update>> {
    {
        let mut s = state();
        if s.checking {
            bail!("already checking");
        }
        s.checking = true;
    }
    broadcast(app);
    let result = async { anyhow::Ok(app.updater_builder().timeout(CHECK_TIMEOUT).build()?.check().await?) }.await;
    {
        let mut s = state();
        s.checking = false;
        match &result {
            Ok(update) => {
                s.latest = update.as_ref().map(|u| Available { version: u.version.clone(), notes: u.body.clone() });
                s.last_checked = Some(now_ms());
                s.error = None;
            }
            Err(e) => s.error = Some(format!("Couldn't reach GitHub to check ({e})")),
        }
    }
    broadcast(app);
    result
}

/// "Check for updates": from the Advanced page or a phone. Returns where things stand afterwards.
pub async fn check_now(app: &AppHandle) -> Status {
    // Not while an update installs. (Read first: the lock mustn't be held through the check.)
    let installing = state().stage.is_some();
    if !installing && let Err(e) = check(app).await {
        eprintln!("update check failed: {e:#}");
    }
    status()
}

/// "Update now": from the Advanced page, the menu button or a phone. Shows the small window and
/// installs the newest release; Bin It closes and the installer starts it again.
pub fn install_now(app: &AppHandle) -> Result<(), String> {
    if kind() != Kind::Installed {
        return Err("This copy of Bin It can't update itself. Download the new version instead.".into());
    }
    {
        let mut s = state();
        if s.stage.is_some() {
            return Err("Bin It is already updating.".into());
        }
        if s.latest.is_none() {
            return Err("There's no newer version to install. Check for updates first.".into());
        }
        s.stage = Some(Stage::Checking);
    }
    broadcast(app);
    let _ = app.emit_to(LABEL, EVENT, Stage::Checking);
    if let Err(e) = open_window(app) {
        set_stage(app, None);
        return Err(format!("Couldn't open the update window: {e}"));
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Ask again, so it's the newest release that gets installed.
        let result = async {
            // An hourly check may be running: let it finish.
            while state().checking {
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
            match check(&app).await? {
                Some(update) => install(&app, update).await,
                None => bail!("Bin It is already up to date"),
            }
        }
        .await;
        if let Err(e) = result {
            fail(&app, &e).await;
            set_stage(&app, None);
            show_main(&app);
            close_window(&app);
        }
    });
    Ok(())
}

/// Downloads and installs an update. On Windows this doesn't return when it works: the installer
/// has started and Bin It has exited.
async fn install(app: &AppHandle, mut update: Update) -> anyhow::Result<()> {
    let version = update.version.clone();
    update.timeout = Some(DOWNLOAD_TIMEOUT);

    set_stage(app, Some(Stage::Downloading { version: version.clone(), downloaded: 0, total: None }));
    let mut downloaded = 0u64;
    let mut shown_percent = None;
    let bytes = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                // One update per percent is plenty for a progress bar.
                let percent = total.map(|t| downloaded * 100 / t.max(1));
                if percent != shown_percent || total.is_none() {
                    shown_percent = percent;
                    set_stage(app, Some(Stage::Downloading { version: version.clone(), downloaded, total }));
                }
            },
            || {},
        )
        .await?;

    set_stage(app, Some(Stage::Installing { version }));
    // Let the window (and any phone) show "Installing" before the app exits.
    tokio::time::sleep(Duration::from_millis(600)).await;
    update.install(bytes)?;
    // Only on systems where installing doesn't exit the app (not Windows).
    app.restart();
}

/// Shows that an update didn't work for a moment, and keeps the reason for the Advanced page.
async fn fail(app: &AppHandle, e: &anyhow::Error) {
    eprintln!("update failed: {e:#}");
    state().error = Some(format!("The update didn't work ({e})"));
    set_stage(app, Some(Stage::Failed { message: "Couldn't update this time. Starting Bin It...".into() }));
    tokio::time::sleep(FAILURE_SHOWN).await;
}

fn open_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html#/updater".into()))
        .title("Bin It")
        .inner_size(300.0, 340.0)
        .resizable(false)
        .maximizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .center()
        .build()?;
    Ok(())
}

fn close_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.close();
    }
}

fn show_main(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

/// The update window asks where things stand when it opens, then follows the events.
#[tauri::command]
pub fn updater_stage() -> Option<Stage> {
    state().stage.clone()
}

/// Opens a download in the browser: the latest installer, the latest portable exe, or the
/// release page. Fixed addresses only, so the UI can't open anything else through this.
#[tauri::command]
pub fn open_download(app: AppHandle, what: String) -> Result<(), String> {
    let url = match what.as_str() {
        "installer" => format!("{RELEASES}/latest/download/BinIt-setup.exe"),
        "portable" => format!("{RELEASES}/latest/download/BinIt-portable.exe"),
        "release" => format!("{RELEASES}/latest"),
        _ => return Err(format!("unknown download: {what}")),
    };
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}
