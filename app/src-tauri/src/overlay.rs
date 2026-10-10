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
        // With the overlay switched off the switcher runs hidden: keys + voice only.
        let drawn = is_enabled() && w.is_visible().unwrap_or(false);
        let _ = w.set_ignore_cursor_events(!(open && drawn));
        let _ = w.emit_to(LABEL, "switcher", open);
    }
}

/// The user's on/off setting. Off = nothing is ever drawn over the game; F8 still works
/// (blind, with the optional spoken confirmation).
static ENABLED: AtomicBool = AtomicBool::new(true);
/// Only draw while a supported game is the focused app.
static FOCUS_ONLY: AtomicBool = AtomicBool::new(true);
/// Updated by the foreground watcher.
static GAME_FOCUSED: AtomicBool = AtomicBool::new(false);

pub fn is_enabled() -> bool {
    ENABLED.load(Ordering::SeqCst)
}

/// Should the overlay be drawn right now?
fn wanted() -> bool {
    is_enabled() && (!FOCUS_ONLY.load(Ordering::SeqCst) || GAME_FOCUSED.load(Ordering::SeqCst))
}

/// Shows or hides the window to match the settings and focus. Call on the main thread.
pub fn refresh(app: &AppHandle) {
    set_visible(app, wanted());
}

/// Applies the saved settings. Call on the main thread.
pub fn apply_settings(app: &AppHandle, enabled: bool, focus_only: bool) {
    ENABLED.store(enabled, Ordering::SeqCst);
    FOCUS_ONLY.store(focus_only, Ordering::SeqCst);
    refresh(app);
}

/// Ctrl+Shift+H: flip the saved on/off setting, so the app's toggle stays in sync.
pub fn toggle_enabled(app: &AppHandle) {
    let enabled = !is_enabled();
    if let Some(tt) = app.try_state::<std::sync::Arc<tt_core::TimeTrial>>() {
        let _ = tt.set_overlay_enabled(enabled);
    }
    ENABLED.store(enabled, Ordering::SeqCst);
    refresh(app);
}

/// Watches which app is in the foreground, using a Windows event hook (no polling), and
/// shows the overlay only while a supported game is focused (when that option is on).
#[cfg(windows)]
pub fn spawn_focus_watcher(app: AppHandle) {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, EVENT_SYSTEM_FOREGROUND, GetForegroundWindow, GetMessageW, MSG, TranslateMessage,
        WINEVENT_OUTOFCONTEXT,
    };

    static APP: OnceLock<AppHandle> = OnceLock::new();

    fn on_foreground(hwnd: HWND) {
        let focused = foreground_game(hwnd).is_some();
        if GAME_FOCUSED.swap(focused, Ordering::SeqCst) != focused
            && let Some(app) = APP.get()
        {
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || refresh(&handle));
        }
    }

    unsafe extern "system" fn callback(_: HWINEVENTHOOK, _: u32, hwnd: HWND, _: i32, _: i32, _: u32, _: u32) {
        on_foreground(hwnd);
    }

    let _ = APP.set(app);
    std::thread::Builder::new()
        .name("focus-watcher".into())
        .spawn(|| unsafe {
            // Out-of-context hooks deliver events to this thread's message loop.
            let hook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, std::ptr::null_mut(), Some(callback), 0, 0, WINEVENT_OUTOFCONTEXT);
            if hook.is_null() {
                eprintln!("[overlay] could not watch the foreground window; showing the overlay regardless of focus");
                GAME_FOCUSED.store(true, Ordering::SeqCst);
                return;
            }
            on_foreground(GetForegroundWindow());
            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        })
        .expect("spawn focus watcher");
}

#[cfg(not(windows))]
pub fn spawn_focus_watcher(_app: AppHandle) {
    GAME_FOCUSED.store(true, Ordering::SeqCst);
}

/// The game key of the process owning `hwnd`, if it's a supported game.
#[cfg(windows)]
fn foreground_game(hwnd: windows_sys::Win32::Foundation::HWND) -> Option<&'static str> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW};
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

    if hwnd.is_null() {
        return None;
    }
    unsafe {
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 {
            return None;
        }
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return None;
        }
        let mut buf = [0u16; 512];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(process, 0, buf.as_mut_ptr(), &mut len) != 0;
        CloseHandle(process);
        if !ok {
            return None;
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        let exe = path.rsplit(['\\', '/']).next().unwrap_or_default();
        tt_games::game_for_process(exe)
    }
}

/// Shows or hides the window without changing the saved setting (benchmarks).
pub fn set_visible(app: &AppHandle, visible: bool) {
    let Some(w) = window(app) else { return };
    let result = if visible {
        w.show()
    } else {
        // Keep the switcher's keys working while hidden; just stop drawing.
        let _ = w.set_ignore_cursor_events(true);
        w.hide()
    };
    if let Err(e) = result {
        eprintln!("[overlay] could not {} the overlay: {e}", if visible { "show" } else { "hide" });
    }
}

/// Called by the overlay UI when the switcher closes itself (pick, Esc, add).
#[tauri::command]
pub fn close_switcher(app: AppHandle) {
    set_switcher(&app, false);
}
