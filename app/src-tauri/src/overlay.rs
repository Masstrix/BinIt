//! The in-game overlay: a transparent, click-through, always-on-top window over the
//! primary monitor. It only takes mouse/keyboard input while the F8 driver switcher is
//! open. Requires the game to run in borderless-windowed mode.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const LABEL: &str = "overlay";

static SWITCHER_OPEN: AtomicBool = AtomicBool::new(false);

pub fn create(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html#/overlay".into()))
        .title("TimeTrial overlay")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .build()?;

    if let Some(monitor) = window.primary_monitor()? {
        window.set_position(*monitor.position())?;
        window.set_size(*monitor.size())?;
    }
    window.set_ignore_cursor_events(true)?;
    window.show()?;
    Ok(window)
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

/// F8: open the switcher (taking input) or close it (back to click-through).
pub fn toggle_switcher(app: &AppHandle) {
    set_switcher(app, !SWITCHER_OPEN.load(Ordering::SeqCst));
}

pub fn set_switcher(app: &AppHandle, open: bool) {
    let Some(w) = window(app) else { return };
    SWITCHER_OPEN.store(open, Ordering::SeqCst);
    let _ = w.set_ignore_cursor_events(!open);
    if open {
        let _ = w.show();
        let _ = w.set_focus();
    }
    let _ = w.emit_to(LABEL, "switcher", open);
}

/// Ctrl+Shift+H: hide or show the whole overlay.
pub fn toggle_visible(app: &AppHandle) {
    let Some(w) = window(app) else { return };
    if w.is_visible().unwrap_or(false) {
        set_switcher(app, false);
        let _ = w.hide();
    } else {
        let _ = w.show();
    }
}

/// Called by the overlay UI when the switcher closes itself (pick, Esc, add).
#[tauri::command]
pub fn close_switcher(app: AppHandle) {
    set_switcher(&app, false);
}
