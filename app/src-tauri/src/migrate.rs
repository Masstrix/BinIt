//! Brings data over from the app's old name (TimeTrial). The old folder is only read, never
//! changed, so it stays as a backup.
//!
//! The old data is merged into Bin It's, not copied over it: drivers are matched by name and laps,
//! challenges and maps that Bin It already has are skipped (see `BinIt::merge_from`). So it works
//! whether Bin It has no data yet, an empty database, or laps of its own, and merging the same data
//! again adds nothing. It runs again only when the old database changes (someone used TimeTrial
//! since), which is noted in the `timetrial_merged` setting.

use std::path::{Path, PathBuf};

use anyhow::Context;
use tt_core::{BinIt, MergeReport};

/// Which old database was merged last: its files' sizes and modification times.
const MERGED_SETTING: &str = "timetrial_merged";

/// The data folder the app used under its old identifier, `app.timetrial.desktop`, which sits
/// next to the current one.
pub fn legacy_dir(data_dir: &Path) -> Option<PathBuf> {
    Some(data_dir.parent()?.join("app.timetrial.desktop"))
}

/// Merges the old database (and the catalogue folder) into Bin It's, when there is one and it has
/// changed since it was last merged. Returns what was added, or `None` when there was nothing to do.
pub fn merge_legacy_data(tt: &BinIt, legacy: &Path, data_dir: &Path) -> anyhow::Result<Option<MergeReport>> {
    let old_db = legacy.join("timetrial.db");
    let old_wal = legacy.join("timetrial.db-wal");
    if !old_db.is_file() {
        return Ok(None);
    }
    let stamp = fingerprint(&[&old_db, &old_wal]);
    if tt.setting(MERGED_SETTING)?.as_deref() == Some(stamp.as_str()) {
        return Ok(None);
    }

    // Merging brings the database up to this version's format, so it works on a copy. The log
    // holds laps not yet folded into the main file; the shared-memory file is rebuilt by SQLite.
    let copy = data_dir.join("timetrial-merge.db");
    let copy_wal = data_dir.join("timetrial-merge.db-wal");
    let remove_copy = || {
        for f in [&copy, &copy_wal, &data_dir.join("timetrial-merge.db-shm")] {
            let _ = std::fs::remove_file(f);
        }
    };
    remove_copy();
    std::fs::copy(&old_db, &copy).with_context(|| format!("copying {}", old_db.display()))?;
    if old_wal.is_file() {
        std::fs::copy(&old_wal, &copy_wal).with_context(|| format!("copying {}", old_wal.display()))?;
    }
    let merged = tt.merge_from(&copy);
    remove_copy();
    let report = merged?;

    copy_missing(&legacy.join("catalogue"), &data_dir.join("catalogue"))?;
    tt.set_setting(MERGED_SETTING, Some(&stamp))?;
    Ok(Some(report))
}

/// Sizes and modification times: changes whenever the old app records anything.
fn fingerprint(files: &[&Path]) -> String {
    files
        .iter()
        .map(|f| match std::fs::metadata(f) {
            Ok(m) => {
                let modified = m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok());
                format!("{}:{}", m.len(), modified.map_or(0, |d| d.as_millis()))
            }
            Err(_) => "-".into(),
        })
        .collect::<Vec<_>>()
        .join(",")
}

/// Copies the files in `from` that `to` doesn't have yet. Bin It's own files are kept.
fn copy_missing(from: &Path, to: &Path) -> std::io::Result<()> {
    if !from.is_dir() {
        return Ok(());
    }
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_missing(&entry.path(), &target)?;
        } else if !target.exists() {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("binit-migrate-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// The old app's folder, with a database holding these drivers.
    fn old_app(root: &Path, drivers: &[&str]) -> PathBuf {
        let old = root.join("app.timetrial.desktop");
        std::fs::create_dir_all(&old).unwrap();
        let tt = BinIt::open(&old.join("timetrial.db")).unwrap();
        for d in drivers {
            tt.add_driver(d, None).unwrap();
        }
        old
    }

    fn names(tt: &BinIt) -> Vec<String> {
        let mut names: Vec<_> = tt.drivers().unwrap().into_iter().map(|d| d.name).collect();
        names.sort();
        names
    }

    #[test]
    fn old_data_is_merged_once_and_left_in_place() {
        let root = scratch("merge");
        let old = old_app(&root, &["Sam", "Alex"]);
        std::fs::create_dir_all(old.join("catalogue")).unwrap();
        std::fs::write(old.join("catalogue").join("acevo.json"), b"{}").unwrap();
        let before = std::fs::read(old.join("timetrial.db")).unwrap();

        let new = root.join("app.binit.desktop");
        std::fs::create_dir_all(&new).unwrap();
        let tt = BinIt::open(&new.join("binit.db")).unwrap();
        tt.add_driver("alex", None).unwrap(); // the same person, already here

        let report = merge_legacy_data(&tt, &old, &new).unwrap().unwrap();
        assert_eq!(report.drivers, 1, "only Sam is new");
        assert_eq!(names(&tt), ["Sam", "alex"]);
        assert!(new.join("catalogue").join("acevo.json").is_file());
        assert!(!new.join("timetrial-merge.db").exists(), "the working copy is removed");
        assert_eq!(std::fs::read(old.join("timetrial.db")).unwrap(), before, "the old data is never changed");

        // Nothing changed in the old app since: nothing to do.
        assert!(merge_legacy_data(&tt, &old, &new).unwrap().is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn merging_again_after_the_old_app_was_used_adds_only_what_is_new() {
        let root = scratch("again");
        let old = old_app(&root, &["Sam"]);
        let new = root.join("app.binit.desktop");
        std::fs::create_dir_all(&new).unwrap();
        let tt = BinIt::open(&new.join("binit.db")).unwrap();
        merge_legacy_data(&tt, &old, &new).unwrap().unwrap();

        // Someone opens TimeTrial again and adds a driver.
        BinIt::open(&old.join("timetrial.db")).unwrap().add_driver("Jo", None).unwrap();
        tt.set_setting(MERGED_SETTING, Some("stale")).unwrap(); // as if the files' times had moved on
        let report = merge_legacy_data(&tt, &old, &new).unwrap().unwrap();
        assert_eq!(report, MergeReport { drivers: 1, laps: 0, challenges: 0 });
        assert_eq!(names(&tt), ["Jo", "Sam"]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn nothing_happens_without_old_data() {
        let root = scratch("none");
        let new = root.join("app.binit.desktop");
        std::fs::create_dir_all(&new).unwrap();
        let tt = BinIt::open(&new.join("binit.db")).unwrap();
        assert!(merge_legacy_data(&tt, &root.join("app.timetrial.desktop"), &new).unwrap().is_none());
        assert!(tt.setting(MERGED_SETTING).unwrap().is_none());
        let _ = std::fs::remove_dir_all(&root);
    }
}
