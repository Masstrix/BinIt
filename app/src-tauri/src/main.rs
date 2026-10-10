// Release builds are GUI-only (no console window).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod overlay;
mod server;

use std::sync::Arc;

use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};
use tt_core::TimeTrial;
use tt_games::GameAdapter;
use tt_games::acevo::AcEvoAdapter;

fn main() {
    let switch_driver = Shortcut::new(None, Code::F8);
    let hide_overlay = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyH);

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.unminimize();
                let _ = main.set_focus();
            }
        }))
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
        .invoke_handler(tauri::generate_handler![overlay::close_switcher])
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let tt = Arc::new(TimeTrial::open(&data_dir.join("timetrial.db"))?);
            app.manage(tt.clone());

            spawn_game_watcher(tt.clone());

            let overlay_on = tt.overlay_enabled()?;
            let lan = tt.setting(server::LAN_SETTING)?.is_none_or(|v| v == "1");
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = server::serve(tt, handle, lan).await {
                    eprintln!("TimeTrial server stopped: {e:#}");
                }
            });

            overlay::create(app.handle())?;
            overlay::apply_enabled(app.handle(), overlay_on);
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the main window quits the app (the overlay would otherwise linger).
            if window.label() == "main" && matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running TimeTrial");
}

/// Polls the game adapters on one low-priority background thread.
fn spawn_game_watcher(tt: Arc<TimeTrial>) {
    std::thread::Builder::new()
        .name("game-watcher".into())
        .spawn(move || {
            lower_thread_priority();
            let mut adapter = AcEvoAdapter::new();
            loop {
                for event in adapter.poll() {
                    if let Err(e) = tt.handle_game_event(event) {
                        eprintln!("failed to handle game event: {e:#}");
                    }
                }
                std::thread::sleep(adapter.poll_interval());
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
