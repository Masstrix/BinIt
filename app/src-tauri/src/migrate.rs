//! Brings data over from the app's old name (TimeTrial). The old folder is only read, never
//! changed, so it stays as a backup.

use std::path::{Path, PathBuf};

/// The data folder the app used under its old identifier, `app.timetrial.desktop`, which sits
/// next to the current one.
pub fn legacy_dir(data_dir: &Path) -> Option<PathBuf> {
    Some(data_dir.parent()?.join("app.timetrial.desktop"))
}

/// Copies the old database (and the catalogue folder) into `data_dir` when there is no new
/// database yet. Returns whether anything was copied.
///
/// The new database file is put in place last, so an interrupted copy is simply redone on the
/// next start.
pub fn import_legacy_data(legacy: &Path, data_dir: &Path) -> std::io::Result<bool> {
    let new_db = data_dir.join("binit.db");
    let old_db = legacy.join("timetrial.db");
    if new_db.exists() || !old_db.is_file() {
        return Ok(false);
    }
    std::fs::create_dir_all(data_dir)?;
    // The log holds laps not yet folded into the main file. The shared-memory file is rebuilt by SQLite.
    let old_wal = legacy.join("timetrial.db-wal");
    let new_wal = data_dir.join("binit.db-wal");
    if old_wal.is_file() {
        std::fs::copy(&old_wal, &new_wal)?;
    } else if new_wal.exists() {
        std::fs::remove_file(&new_wal)?;
    }
    let partial = data_dir.join("binit.db.partial");
    std::fs::copy(&old_db, &partial)?;
    copy_dir(&legacy.join("catalogue"), &data_dir.join("catalogue"))?;
    std::fs::rename(&partial, &new_db)?;
    Ok(true)
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    if !from.is_dir() {
        return Ok(());
    }
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
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

    #[test]
    fn old_data_is_copied_once_and_left_in_place() {
        let root = scratch("copy");
        let (old, new) = (root.join("app.timetrial.desktop"), root.join("app.binit.desktop"));
        std::fs::create_dir_all(old.join("catalogue")).unwrap();
        std::fs::write(old.join("timetrial.db"), b"db").unwrap();
        std::fs::write(old.join("timetrial.db-wal"), b"wal").unwrap();
        std::fs::write(old.join("catalogue").join("acevo.json"), b"{}").unwrap();

        assert!(import_legacy_data(&old, &new).unwrap());
        assert_eq!(std::fs::read(new.join("binit.db")).unwrap(), b"db");
        assert_eq!(std::fs::read(new.join("binit.db-wal")).unwrap(), b"wal");
        assert!(new.join("catalogue").join("acevo.json").is_file());
        assert!(old.join("timetrial.db").is_file(), "the old copy stays as a backup");
        assert!(!new.join("binit.db.partial").exists());

        // Once there is a new database, the old one is never copied over it.
        std::fs::write(new.join("binit.db"), b"newer").unwrap();
        assert!(!import_legacy_data(&old, &new).unwrap());
        assert_eq!(std::fs::read(new.join("binit.db")).unwrap(), b"newer");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn nothing_happens_without_old_data() {
        let root = scratch("none");
        assert!(!import_legacy_data(&root.join("app.timetrial.desktop"), &root.join("app.binit.desktop")).unwrap());
        assert!(!root.join("app.binit.desktop").exists());
        let _ = std::fs::remove_dir_all(&root);
    }
}
