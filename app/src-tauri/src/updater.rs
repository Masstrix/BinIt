//! Updates from the GitHub releases.
//!
//! The installed app checks for a newer release every time it starts. While it checks, a small
//! window with the logo and a progress bar is shown instead of the main window (the main window
//! is created hidden, see `tauri.conf.json`). When there is an update it is downloaded, checked
//! against the public key in `tauri.conf.json`, and the installer runs silently; Bin It exits for
//! that and the installer starts it again. Otherwise (no update, offline) the small window closes
//! and the main window opens; if the download or install fails it says so briefly first.
//!
//! The portable exe can't replace itself, so it only checks in the background and the app links
//! to the download instead. Development builds never check.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

pub const LABEL: &str = "updater";
const EVENT: &str = "updater://stage";
/// How long the check may take before Bin It starts anyway (offline, slow network).
const CHECK_TIMEOUT: Duration = Duration::from_secs(8);
/// How long the download may take. The installer is about 10 MB.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(10 * 60);
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

/// A newer release than this one, if a check has found one.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Available {
    pub version: String,
    pub notes: Option<String>,
}

#[derive(Default)]
struct State {
    stage: Option<Stage>,
    available: Option<Available>,
}

static STATE: Mutex<State> = Mutex::new(State { stage: None, available: None });

fn set_stage(app: &AppHandle, stage: Stage) {
    STATE.lock().unwrap().stage = Some(stage.clone());
    let _ = app.emit_to(LABEL, EVENT, stage);
}

/// Whether this copy was put here by the installer: its uninstaller sits next to it. Only those
/// can update themselves; the portable exe is just a file someone copied.
pub fn is_installed() -> bool {
    std::env::current_exe().ok().and_then(|exe| Some(exe.parent()?.join("uninstall.exe").is_file())).unwrap_or(false)
}

/// The newer release found by this run's check, if any.
pub fn available() -> Option<Available> {
    STATE.lock().unwrap().available.clone()
}

/// Called once from `setup`: shows the update window and updates, or opens the main window.
pub fn start(app: &AppHandle) -> tauri::Result<()> {
    if cfg!(debug_assertions) {
        show_main(app);
        return Ok(());
    }
    if !is_installed() {
        show_main(app);
        // Only to say a new version is out (see `available`).
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = check(&app).await {
                eprintln!("update check failed: {e:#}");
            }
        });
        return Ok(());
    }

    set_stage(app, Stage::Checking);
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

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let started = Instant::now();
        if let Err(e) = update(&app).await {
            eprintln!("update failed: {e:#}");
            set_stage(&app, Stage::Failed { message: "Couldn't update this time. Starting Bin It...".into() });
            tokio::time::sleep(FAILURE_SHOWN).await;
        }
        // No update (or it failed): carry on into the app.
        set_stage(&app, Stage::Starting);
        tokio::time::sleep(MIN_SHOWN.saturating_sub(started.elapsed())).await;
        show_main(&app);
        if let Some(window) = app.get_webview_window(LABEL) {
            let _ = window.close();
        }
    });
    Ok(())
}

/// Looks for a newer release and remembers it.
async fn check(app: &AppHandle) -> anyhow::Result<Option<tauri_plugin_updater::Update>> {
    let update = app.updater_builder().timeout(CHECK_TIMEOUT).build()?.check().await?;
    STATE.lock().unwrap().available =
        update.as_ref().map(|u| Available { version: u.version.clone(), notes: u.body.clone() });
    Ok(update)
}

/// Checks, and if there is a newer release downloads and installs it. Returns only when there was
/// nothing to install (or the check couldn't be made): installing exits the app. An error means the
/// download or install went wrong.
async fn update(app: &AppHandle) -> anyhow::Result<()> {
    // Not reaching GitHub (offline, a slow network) is normal: just start, without a fuss.
    let mut update = match check(app).await {
        Ok(Some(update)) => update,
        Ok(None) => return Ok(()),
        Err(e) => {
            eprintln!("update check failed: {e:#}");
            return Ok(());
        }
    };
    let version = update.version.clone();
    update.timeout = Some(DOWNLOAD_TIMEOUT);

    set_stage(app, Stage::Downloading { version: version.clone(), downloaded: 0, total: None });
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
                    set_stage(app, Stage::Downloading { version: version.clone(), downloaded, total });
                }
            },
            || {},
        )
        .await?;

    set_stage(app, Stage::Installing { version });
    // Let the window show "Installing" before the app exits.
    tokio::time::sleep(Duration::from_millis(600)).await;
    update.install(bytes)?;
    // Windows doesn't get here: the installer has started and Bin It has exited.
    Ok(())
}

fn show_main(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
}

/// The update window asks where things stand when it opens, then follows the events.
#[tauri::command]
pub fn updater_stage() -> Option<Stage> {
    STATE.lock().unwrap().stage.clone()
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
