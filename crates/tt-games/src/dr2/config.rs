//! Switching on DiRT Rally 2.0's second UDP output.
//!
//! The game sends its telemetry to every `<udp .../>` entry in
//! `Documents\My Games\DiRT Rally 2.0\hardwaresettings\hardware_settings_config.xml`, and a UDP port can
//! only be bound by one program, so Bin It must not share a port with other tools (a wheel's software,
//! a dashboard): it adds an entry of its own. The game's readme says to "simply duplicate the entire tag".
//!
//! What was found on a real install:
//! * the game only reads the file when it starts: an entry added while it runs sends nothing until the game
//!   is restarted;
//! * the game rewrites the file itself and keeps entries it does not know.
//!
//! So the entry is added while the game is not running where possible, and a game that was already running
//! when it was added is reported as [`ConfigStatus::RestartNeeded`]. The original is saved beside the file as
//! `hardware_settings_config.xml.binit-backup` (once).

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// The first port Bin It tries to listen on. Other tools commonly use 20777 (the game's old default) and
/// 10790 was in use by a wheel's software on the machine this was built on.
pub const FIRST_PORT: u16 = 20790;
/// How many ports from [`FIRST_PORT`] are tried before giving up.
pub const PORT_TRIES: u16 = 10;

/// The payload format the adapter reads (see `layout.rs`).
pub const EXTRADATA: u8 = 3;

/// Where the game keeps its settings, relative to the user's Documents folder.
pub const CONFIG_RELATIVE: &str = "My Games/DiRT Rally 2.0/hardwaresettings/hardware_settings_config.xml";

/// What the check found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigStatus {
    /// Not looked at yet.
    Unknown,
    /// The game's settings file was not found (never run, or not installed).
    NotFound,
    /// The entry is in place.
    Ready,
    /// The entry was added now and the game is not running: it applies at the next start.
    Added,
    /// The entry was added now, but the game is running and only reads its settings at start-up.
    RestartNeeded,
    /// The file could not be read or written.
    Failed,
}

/// The result of looking for our entry in the file's text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Edit {
    /// An enabled entry for the port with our format is there already.
    Present,
    /// The text to write back, with the entry added or corrected.
    Changed(String),
    /// There is no `<motion_platform>` section to add it to.
    NoSection,
}

/// The `<udp .../>` tag for a port.
pub fn entry(port: u16) -> String {
    format!(r#"<udp enabled="true" extradata="{EXTRADATA}" port="{port}" delay="1" ip="127.0.0.1" />"#)
}

/// The `<udp .../>` tags (not `<custom_udp`) as (start, end) byte ranges.
fn udp_tags(xml: &str) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut at = 0;
    while let Some(found) = xml[at..].find("<udp") {
        let start = at + found;
        let after = xml[start + 4..].chars().next();
        let end = xml[start..].find('>').map(|e| start + e + 1);
        match (after, end) {
            (Some(c), Some(end)) if c.is_whitespace() || c == '/' || c == '>' => {
                out.push((start, end));
                at = end;
            }
            (_, Some(end)) => at = end,
            _ => break,
        }
    }
    out
}

fn attribute<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let key = format!(r#"{name}=""#);
    let from = tag.find(&key)? + key.len();
    let to = tag[from..].find('"')?;
    Some(&tag[from..from + to])
}

/// Adds (or corrects) the entry for `port` in the settings text, leaving everything else as it was.
pub fn ensure_entry(xml: &str, port: u16) -> Edit {
    let tags = udp_tags(xml);
    let port_text = port.to_string();
    let ours = tags.iter().find(|&&(s, e)| attribute(&xml[s..e], "port") == Some(port_text.as_str()));
    if let Some(&(s, e)) = ours {
        let tag = &xml[s..e];
        if attribute(tag, "enabled") == Some("true") && attribute(tag, "extradata") == Some(&EXTRADATA.to_string()) {
            return Edit::Present;
        }
        return Edit::Changed(format!("{}{}{}", &xml[..s], entry(port), &xml[e..]));
    }
    // Add a new line after the last <udp> entry, indented like it.
    if let Some(&(s, e)) = tags.last() {
        let line_start = xml[..s].rfind('\n').map_or(0, |n| n + 1);
        let indent = &xml[line_start..s];
        let indent = if indent.trim().is_empty() { indent } else { "" };
        let eol = if xml[e..].starts_with("\r\n") { "\r\n" } else { "\n" };
        let mut out = String::with_capacity(xml.len() + 100);
        out.push_str(&xml[..e]);
        out.push_str(eol);
        out.push_str(indent);
        out.push_str(&entry(port));
        out.push_str(&xml[e..]);
        return Edit::Changed(out);
    }
    // No <udp> at all: put one at the end of <motion_platform>.
    match xml.find("</motion_platform>") {
        Some(at) => {
            let line_start = xml[..at].rfind('\n').map_or(0, |n| n + 1);
            let indent = &xml[line_start..at];
            let indent = if indent.trim().is_empty() { indent } else { "" };
            let eol = if xml.contains("\r\n") { "\r\n" } else { "\n" };
            let mut out = String::with_capacity(xml.len() + 100);
            out.push_str(&xml[..line_start]);
            out.push_str(indent);
            out.push('\t');
            out.push_str(&entry(port));
            out.push_str(eol);
            out.push_str(&xml[line_start..]);
            Edit::Changed(out)
        }
        None => Edit::NoSection,
    }
}

/// The settings file under a Documents folder.
pub fn config_path(documents: &Path) -> PathBuf {
    documents.join(CONFIG_RELATIVE)
}

/// Makes sure the settings file has our entry, saving the original first. `game_running` says whether the
/// game has the file loaded already (a change then waits for a restart).
pub fn ensure_configured(path: &Path, port: u16, game_running: bool) -> ConfigStatus {
    let xml = match fs::read_to_string(path) {
        Ok(xml) => xml,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return ConfigStatus::NotFound,
        Err(_) => return ConfigStatus::Failed,
    };
    match ensure_entry(&xml, port) {
        Edit::Present => ConfigStatus::Ready,
        Edit::NoSection => ConfigStatus::Failed,
        Edit::Changed(new) => {
            let backup = path.with_file_name("hardware_settings_config.xml.binit-backup");
            if !backup.exists() && fs::write(&backup, &xml).is_err() {
                return ConfigStatus::Failed;
            }
            if fs::write(path, new).is_err() {
                return ConfigStatus::Failed;
            }
            if game_running { ConfigStatus::RestartNeeded } else { ConfigStatus::Added }
        }
    }
}

/// The user's Documents folder (it may be redirected, e.g. into OneDrive).
#[cfg(windows)]
pub fn documents_dir() -> Option<PathBuf> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;

    use windows_sys::Win32::System::Com::CoTaskMemFree;
    use windows_sys::Win32::UI::Shell::{FOLDERID_Documents, SHGetKnownFolderPath};

    // SAFETY: the call fills `raw` with a NUL-terminated wide string that we copy and then free.
    unsafe {
        let mut raw: *mut u16 = std::ptr::null_mut();
        if SHGetKnownFolderPath(&FOLDERID_Documents, 0, std::ptr::null_mut(), &mut raw) != 0 || raw.is_null() {
            return None;
        }
        let len = (0..).take_while(|&i| *raw.add(i) != 0).count();
        let path = PathBuf::from(OsString::from_wide(std::slice::from_raw_parts(raw, len)));
        CoTaskMemFree(raw as *const _);
        Some(path)
    }
}

#[cfg(not(windows))]
pub fn documents_dir() -> Option<PathBuf> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The relevant part of a real settings file (tabs, as the game writes it).
    const REAL: &str = "<motion_platform>\n\t\t<dbox enabled=\"true\" />\n\t\t<udp enabled=\"true\" extradata=\"3\" port=\"10790\" delay=\"1\" ip=\"127.0.0.1\" />\n\t\t<custom_udp filename=\"packet_data.xml\" enabled=\"false\" port=\"20777\" delay=\"1\" ip=\"127.0.0.1\" />\n\t\t<fanatec enabled=\"true\" />\n\t</motion_platform>\n";

    fn changed(edit: Edit) -> String {
        match edit {
            Edit::Changed(s) => s,
            other => panic!("expected a change, got {other:?}"),
        }
    }

    #[test]
    fn our_entry_goes_after_the_existing_one_and_nothing_else_moves() {
        let out = changed(ensure_entry(REAL, 20790));
        let lines: Vec<&str> = out.lines().collect();
        assert_eq!(lines[2], "\t\t<udp enabled=\"true\" extradata=\"3\" port=\"10790\" delay=\"1\" ip=\"127.0.0.1\" />");
        assert_eq!(lines[3], "\t\t<udp enabled=\"true\" extradata=\"3\" port=\"20790\" delay=\"1\" ip=\"127.0.0.1\" />");
        assert!(lines[4].contains("custom_udp"));
        assert_eq!(lines.len(), REAL.lines().count() + 1);
    }

    #[test]
    fn the_wheel_softwares_entry_is_not_taken_for_ours_and_custom_udp_is_not_a_udp_entry() {
        assert_eq!(udp_tags(REAL).len(), 1);
        assert!(matches!(ensure_entry(REAL, 10790), Edit::Present), "an entry with that port and format is already there");
    }

    #[test]
    fn adding_it_twice_changes_nothing_the_second_time() {
        let once = changed(ensure_entry(REAL, 20790));
        assert_eq!(ensure_entry(&once, 20790), Edit::Present);
    }

    #[test]
    fn a_disabled_or_wrong_format_entry_for_our_port_is_corrected_in_place() {
        let xml = REAL.replace("</motion_platform>", "\t<udp enabled=\"false\" extradata=\"1\" port=\"20790\" delay=\"1\" ip=\"127.0.0.1\" />\n</motion_platform>");
        let out = changed(ensure_entry(&xml, 20790));
        assert_eq!(out.matches("port=\"20790\"").count(), 1);
        assert!(out.contains(&entry(20790)));
    }

    #[test]
    fn windows_line_endings_are_kept() {
        let out = changed(ensure_entry(&REAL.replace('\n', "\r\n"), 20790));
        assert!(!out.replace("\r\n", "").contains('\n'), "no bare line feeds were introduced");
        assert!(out.contains(&format!("/>\r\n\t\t{}", entry(20790))));
    }

    #[test]
    fn with_no_udp_entry_at_all_it_goes_at_the_end_of_the_section() {
        let xml = "<motion_platform>\n\t<dbox enabled=\"true\" />\n</motion_platform>\n";
        let out = changed(ensure_entry(xml, 20790));
        assert_eq!(out, format!("<motion_platform>\n\t<dbox enabled=\"true\" />\n\t{}\n</motion_platform>\n", entry(20790)));
        assert_eq!(ensure_entry("<other/>", 20790), Edit::NoSection);
    }

    #[test]
    fn the_file_is_backed_up_once_and_a_running_game_needs_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hardware_settings_config.xml");
        fs::write(&path, REAL).unwrap();

        assert_eq!(ensure_configured(&path, 20790, true), ConfigStatus::RestartNeeded);
        let backup = dir.path().join("hardware_settings_config.xml.binit-backup");
        assert_eq!(fs::read_to_string(&backup).unwrap(), REAL, "the original is kept");
        assert!(fs::read_to_string(&path).unwrap().contains(&entry(20790)));

        assert_eq!(ensure_configured(&path, 20790, true), ConfigStatus::Ready);
        // A later change (another port) must not overwrite the first backup.
        assert_eq!(ensure_configured(&path, 20791, false), ConfigStatus::Added);
        assert_eq!(fs::read_to_string(&backup).unwrap(), REAL);
    }

    #[test]
    fn a_missing_file_is_reported_not_created() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(ensure_configured(&dir.path().join("nope.xml"), 20790, false), ConfigStatus::NotFound);
    }
}
