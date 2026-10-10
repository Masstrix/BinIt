//! The in-game overlay: a transparent, click-through, always-on-top window over the
//! primary monitor.
//!
//! The window is created "no-activate", so it never takes focus from the game. While the
//! F8 driver switcher is open, the keys it needs (numbers, arrows, letters, Enter, Esc...)
//! are registered as temporary global hotkeys and forwarded to the overlay UI, then
//! released again. The game keeps focus the whole time, and the switcher still works
//! (with a spoken confirmation) when a game runs in exclusive fullscreen and the overlay
//! can't be seen.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut};

pub const LABEL: &str = "overlay";

static SWITCHER_OPEN: AtomicBool = AtomicBool::new(false);
/// Serialises (un)registration so rapid F8 presses can't interleave.
static KEYS_LOCK: Mutex<()> = Mutex::new(());

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
        // Tauri's file-drop handler would swallow the page's own drag events.
        .disable_drag_drop_handler()
        .build()?;

    if let Some(monitor) = window.primary_monitor()? {
        window.set_position(*monitor.position())?;
        window.set_size(*monitor.size())?;
    }
    window.set_ignore_cursor_events(true)?;
    make_non_activating(&window);
    window.show()?;
    Ok(window)
}

/// Clicking the overlay must never pull focus away from the game.
#[cfg(windows)]
fn make_non_activating(window: &WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GWL_EXSTYLE, GetWindowLongPtrW, SetWindowLongPtrW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            let hwnd = hwnd.0 as _;
            let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style | (WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW) as isize);
        }
    }
}

#[cfg(not(windows))]
fn make_non_activating(_window: &WebviewWindow) {}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

/// Keys captured only while the switcher is open, with the name sent to the UI.
fn switcher_keys() -> &'static HashMap<u32, (Shortcut, &'static str)> {
    static KEYS: OnceLock<HashMap<u32, (Shortcut, &'static str)>> = OnceLock::new();
    KEYS.get_or_init(|| {
        let mut keys: Vec<(Code, &'static str)> = vec![
            (Code::Escape, "Escape"),
            (Code::Enter, "Enter"),
            (Code::NumpadEnter, "Enter"),
            (Code::Backspace, "Backspace"),
            (Code::Space, " "),
            (Code::ArrowUp, "ArrowUp"),
            (Code::ArrowDown, "ArrowDown"),
            (Code::ArrowLeft, "ArrowLeft"),
            (Code::ArrowRight, "ArrowRight"),
            (Code::Minus, "-"),
        ];
        let digits = [
            (Code::Digit0, Code::Numpad0, "0"),
            (Code::Digit1, Code::Numpad1, "1"),
            (Code::Digit2, Code::Numpad2, "2"),
            (Code::Digit3, Code::Numpad3, "3"),
            (Code::Digit4, Code::Numpad4, "4"),
            (Code::Digit5, Code::Numpad5, "5"),
            (Code::Digit6, Code::Numpad6, "6"),
            (Code::Digit7, Code::Numpad7, "7"),
            (Code::Digit8, Code::Numpad8, "8"),
            (Code::Digit9, Code::Numpad9, "9"),
        ];
        for (d, n, name) in digits {
            keys.push((d, name));
            keys.push((n, name));
        }
        let letters = [
            (Code::KeyA, "a"), (Code::KeyB, "b"), (Code::KeyC, "c"), (Code::KeyD, "d"), (Code::KeyE, "e"),
            (Code::KeyF, "f"), (Code::KeyG, "g"), (Code::KeyH, "h"), (Code::KeyI, "i"), (Code::KeyJ, "j"),
            (Code::KeyK, "k"), (Code::KeyL, "l"), (Code::KeyM, "m"), (Code::KeyN, "n"), (Code::KeyO, "o"),
            (Code::KeyP, "p"), (Code::KeyQ, "q"), (Code::KeyR, "r"), (Code::KeyS, "s"), (Code::KeyT, "t"),
            (Code::KeyU, "u"), (Code::KeyV, "v"), (Code::KeyW, "w"), (Code::KeyX, "x"), (Code::KeyY, "y"),
            (Code::KeyZ, "z"),
        ];
        keys.extend(letters);
        keys.into_iter()
            .map(|(code, name)| {
                let s = Shortcut::new(None, code);
                (s.id(), (s, name))
            })
            .collect()
    })
}

/// Called from the global-shortcut handler. Returns true if the key belonged to the switcher.
pub fn handle_switcher_key(app: &AppHandle, shortcut: &Shortcut) -> bool {
    if !SWITCHER_OPEN.load(Ordering::SeqCst) {
        return false;
    }
    let Some((_, name)) = switcher_keys().get(&shortcut.id()) else { return false };
    let _ = app.emit_to(LABEL, "switcher-key", *name);
    true
}

/// (Un)registers the switcher's keys. Always runs on its own thread: the shortcut plugin
/// calls our handler while holding its lock, and registers via the main thread, so doing
/// this inline from the handler or a command would deadlock.
fn capture_keys(app: &AppHandle, capture: bool) {
    let app = app.clone();
    std::thread::spawn(move || {
        let _guard = KEYS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let gs = app.global_shortcut();
        for (shortcut, _) in switcher_keys().values() {
            let registered = gs.is_registered(*shortcut);
            if capture && !registered {
                // A key another app already owns just won't be captured.
                let _ = gs.register(*shortcut);
            } else if !capture && registered {
                let _ = gs.unregister(*shortcut);
            }
        }
    });
}

/// F8: open the switcher or close it.
pub fn toggle_switcher(app: &AppHandle) {
    set_switcher(app, !SWITCHER_OPEN.load(Ordering::SeqCst));
}

pub fn set_switcher(app: &AppHandle, open: bool) {
    if SWITCHER_OPEN.swap(open, Ordering::SeqCst) == open {
        return;
    }
    capture_keys(app, open);
    if let Some(w) = window(app) {
        // Mouse clicks work while open; the window is no-activate so focus stays in the game.
        let _ = w.set_ignore_cursor_events(!open);
        if open {
            let _ = w.show();
        }
        let _ = w.emit_to(LABEL, "switcher", open);
    }
}

/// Ctrl+Shift+H: hide or show the whole overlay.
pub fn toggle_visible(app: &AppHandle) {
    let Some(w) = window(app) else { return };
    set_visible(app, !w.is_visible().unwrap_or(false));
}

pub fn set_visible(app: &AppHandle, visible: bool) {
    let Some(w) = window(app) else { return };
    if visible {
        let _ = w.show();
    } else {
        set_switcher(app, false);
        let _ = w.hide();
    }
}

/// Called by the overlay UI when the switcher closes itself (pick, Esc, add).
#[tauri::command]
pub fn close_switcher(app: AppHandle) {
    set_switcher(&app, false);
}
