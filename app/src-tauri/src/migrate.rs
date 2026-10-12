//! Brings data over from the app's old name (TimeTrial). The old folder is only read, never
//! changed, so it stays as a backup.

use std::path::{Path, PathBuf};

/// The data folder the app used under its old identifier, `app.timetrial.desktop`, which sits
/// next to the current one.
pub fn legacy_dir(data_dir: &Path) -> Option<PathBuf> {
    Some(data_dir.parent()?.join("app.timetrial.desktop"))
}

/// Copies the old database (and the catalogue folder) into `data_dir` when there is no new
/// database yet, or only an empty one. Returns whether anything was copied.
///
/// An empty new database is what a Bin It build leaves behind when it ran on this PC before the old
/// data was brought over (a development build, an earlier copy). It is set aside as
/// `binit.db.empty`, not deleted, and only if it has no drivers, laps or challenges at all.
///
/// The new database file is put in place last, so an interrupted copy is simply redone on the
/// next start.
pub fn import_legacy_data(legacy: &Path, data_dir: &Path) -> std::io::Result<bool> {
    let new_db = data_dir.join("binit.db");
    let old_db = legacy.join("timetrial.db");
    if !old_db.is_file() || !tt_core::holds_records(&old_db) {
        return Ok(false);
    }
    if new_db.exists() {
        if tt_core::holds_records(&new_db) {
            return Ok(false);
        }
        for suffix in ["", "-wal", "-shm"] {
            let file = data_dir.join(format!("binit.db{suffix}"));
            if file.exists() {
                std::fs::rename(&file, data_dir.join(format!("binit.db.empty{suffix}")))?;
            }
        }
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
    fn an_empty_new_database_gives_way_to_the_old_data() {
        let root = scratch("empty");
        let (old, new) = (root.join("app.timetrial.desktop"), root.join("app.binit.desktop"));
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&new).unwrap();
        // An earlier Bin It started here once and made an empty database.
        drop(tt_core::BinIt::open(&new.join("binit.db")).unwrap());
        let tt = tt_core::BinIt::open(&old.join("timetrial.db")).unwrap();
        tt.add_driver("Sam", None).unwrap();
        drop(tt);

        assert!(import_legacy_data(&old, &new).unwrap());
        assert!(new.join("binit.db.empty").is_file(), "the empty database is set aside, not deleted");
        let drivers = tt_core::BinIt::open(&new.join("binit.db")).unwrap().drivers().unwrap();
        assert_eq!(drivers.iter().map(|d| d.name.as_str()).collect::<Vec<_>>(), ["Sam"]);

        // Now the new database has the old data in it, so it is never replaced again.
        assert!(!import_legacy_data(&old, &new).unwrap());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_new_database_with_data_is_kept_and_an_empty_old_one_is_ignored() {
        let root = scratch("keep");
        let (old, new) = (root.join("app.timetrial.desktop"), root.join("app.binit.desktop"));
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&new).unwrap();
        let tt = tt_core::BinIt::open(&new.join("binit.db")).unwrap();
        tt.add_driver("Alex", None).unwrap();
        drop(tt);
        let tt = tt_core::BinIt::open(&old.join("timetrial.db")).unwrap();
        tt.add_driver("Sam", None).unwrap();
        drop(tt);
        assert!(!import_legacy_data(&old, &new).unwrap(), "laps made in Bin It are never replaced");

        // An old database with nothing in it isn't worth bringing over either.
        let empty_old = root.join("empty-old");
        std::fs::create_dir_all(&empty_old).unwrap();
        drop(tt_core::BinIt::open(&empty_old.join("timetrial.db")).unwrap());
        let fresh = root.join("fresh");
        assert!(!import_legacy_data(&empty_old, &fresh).unwrap());
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
