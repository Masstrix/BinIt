// Release builds are GUI-only (no console window).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod migrate;
mod overlay;
mod server;
mod updater;

use std::sync::Arc;

use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};
use tt_core::BinIt;
use tt_games::{GameId, GameWatcher};

/// A plain error dialog, for failures that happen before there is a window to show anything in.
#[cfg(windows)]
fn message_box(title: &str, text: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW};
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    // SAFETY: both strings are NUL-terminated and outlive the call; no owner window.
    unsafe { MessageBoxW(std::ptr::null_mut(), wide(text).as_ptr(), wide(title).as_ptr(), MB_OK | MB_ICONERROR) };
}

#[cfg(not(windows))]
fn message_box(title: &str, text: &str) {
    eprintln!("{title}: {text}");
}

fn main() {
    let switch_driver = Shortcut::new(None, Code::F8);
    let hide_overlay = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyH);

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            // While an update is being checked or installed, that window is the one to bring forward.
            let window = app.get_webview_window(updater::LABEL).or_else(|| app.get_webview_window("main"));
            if let Some(window) = window {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts([switch_driver, hide_overlay])
                .expect("valid shortcuts")
                .with_handler(move |app, shortcut, event| {
                    if event.state != ShortcutState::Pressed || overlay::handle_switcher_key(app, shortcut) {
                        return;
                    }
                    if *shortcut == switch_driver {
                        overlay::toggle_switcher(app);
                    } else if *shortcut == hide_overlay {
                        overlay::toggle_enabled(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![overlay::close_switcher, updater::updater_stage, updater::open_download])
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let tt = match BinIt::open(&data_dir.join("binit.db")) {
                Ok(tt) => Arc::new(tt),
                Err(e) => {
                    // There's no console in a release build, so say why we're closing.
                    message_box("Bin It can't open its data", &format!("{e:#}

Data folder: {}", data_dir.display()));
                    return Err(e.into());
                }
            };
            // Data saved under the old name (TimeTrial) is merged in, and again whenever it changes.
            // It's not worth refusing to start over: Bin It's own data is untouched if this fails.
            if let Some(legacy) = migrate::legacy_dir(&data_dir) {
                match migrate::merge_legacy_data(&tt, &legacy, &data_dir) {
                    Ok(Some(r)) => eprintln!("data: merged {} drivers, {} laps, {} challenges from {}", r.drivers, r.laps, r.challenges, legacy.display()),
                    Ok(None) => {}
                    Err(e) => message_box(
                        "Bin It can't bring over your TimeTrial data",
                        &format!("{e:#}\n\nBin It will start with its own data. Old folder (left as it was): {}", legacy.display()),
                    ),
                }
            }
            // Plain-text sources for the track/car catalogue (never game binaries).
            tt.set_catalogue_paths(tt_core::CataloguePaths {
                documents: app.path().document_dir().ok(),
                custom: Some(data_dir.join("catalogue")),
            });
            // Laps from before a name was in the catalogue get filed under the catalogue's name.
            for game in GameId::ALL {
                match tt.canonicalize_history(game.key()) {
                    Ok(0) => {}
                    Ok(n) => eprintln!("catalogue: relabelled {n} stored {} names", game.key()),
                    Err(e) => eprintln!("catalogue: could not relabel stored {} names: {e:#}", game.key()),
                }
            }
            app.manage(tt.clone());

            spawn_game_watcher(tt.clone());

            let overlay_on = tt.overlay_enabled()?;
            let overlay_focus_only = tt.overlay_focus_only()?;
            let lan = tt.setting(server::LAN_SETTING)?.is_none_or(|v| v == "1");
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = server::serve(tt, handle, lan).await {
                    eprintln!("Bin It server stopped: {e:#}");
                }
            });

            overlay::create(app.handle())?;
            overlay::apply_settings(app.handle(), overlay_on, overlay_focus_only);
            overlay::spawn_focus_watcher(app.handle().clone());
            // The main window starts hidden: this shows it, or first shows the update window.
            updater::start(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the main window quits the app (the overlay would otherwise linger).
            if window.label() == "main" && matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Bin It");
}

/// Polls the game adapters on one low-priority background thread.
fn spawn_game_watcher(tt: Arc<BinIt>) {
    std::thread::Builder::new()
        .name("game-watcher".into())
        .spawn(move || {
            lower_thread_priority();
            let mut watcher = GameWatcher::standard();
            loop {
                for event in watcher.poll() {
                    if let Err(e) = tt.handle_game_event(event) {
                        eprintln!("failed to handle game event: {e:#}");
                    }
                }
                std::thread::sleep(watcher.wait());
            }
        })
        .expect("spawn game watcher");
}

#[cfg(windows)]
fn lower_thread_priority() {
    use windows_sys::Win32::System::Threading::{GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_BELOW_NORMAL};
    unsafe {
        SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_BELOW_NORMAL);
    }
}

#[cfg(not(windows))]
fn lower_thread_priority() {}
