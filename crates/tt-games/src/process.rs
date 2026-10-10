//! Cheap "is the game running?" check, used before touching any telemetry channel.
//!
//! Some third-party tools (wheel software, dashboards) create the same shared-memory
//! names as the games do, so a mapping existing is not proof the game is running.

/// Returns true if a process with this executable name (case-insensitive) is running.
#[cfg(windows)]
pub fn is_process_running(exe_name: &str) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };

    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return false;
        }

        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;

        let mut found = false;
        let mut ok = Process32FirstW(snapshot, &mut entry) != 0;
        while ok {
            let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
            if name.eq_ignore_ascii_case(exe_name) {
                found = true;
                break;
            }
            ok = Process32NextW(snapshot, &mut entry) != 0;
        }

        CloseHandle(snapshot);
        found
    }
}

#[cfg(not(windows))]
pub fn is_process_running(_exe_name: &str) -> bool {
    false
}
