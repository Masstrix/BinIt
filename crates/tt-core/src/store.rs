//! SQLite persistence. One file on the rig's PC; everything is synchronous and small.

use std::path::Path;

use anyhow::{Context, Result, bail};
use rusqlite::{Connection, OptionalExtension, Row, params};

use crate::model::*;
use crate::trackmap::TrackMap;
use tt_games::timing::{LapTrace, TimingProfile};

const SCHEMA_VERSION: i32 = 5;
/// Settings that record which app version made, and last opened, this database.
pub const CREATED_WITH_KEY: &str = "created_with";
pub const OPENED_WITH_KEY: &str = "last_opened_with";

pub struct Store {
    conn: Connection,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path).with_context(|| format!("opening {}", path.display()))?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let version: i32 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        // Never touch data made by a newer TimeTrial: opening it here would reset its format number
        // and the next upgrade would then try to add columns that already exist.
        if version > SCHEMA_VERSION {
            bail!(
                "This data was saved by a newer version of TimeTrial (database format {version}; this version understands up to {SCHEMA_VERSION}). Update TimeTrial, or open it with the newer version."
            );
        }
        if version < 1 {
            conn.execute_batch(
                "
                CREATE TABLE drivers (
                    id          INTEGER PRIMARY KEY,
                    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    color       TEXT NOT NULL,
                    created_at  INTEGER NOT NULL
                );
                CREATE TABLE laps (
                    id            INTEGER PRIMARY KEY,
                    driver_id     INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
                    game          TEXT NOT NULL,
                    track         TEXT NOT NULL,
                    layout        TEXT NOT NULL,
                    car           TEXT NOT NULL,
                    session_kind  TEXT NOT NULL,
                    lap_number    INTEGER NOT NULL,
                    time_ms       INTEGER NOT NULL,
                    valid         INTEGER NOT NULL,
                    sectors_ms    TEXT NOT NULL,
                    recorded_at   INTEGER NOT NULL
                );
                CREATE INDEX laps_combo ON laps (game, track, layout, car, time_ms);
                CREATE INDEX laps_driver ON laps (driver_id, recorded_at);
                CREATE TABLE challenges (
                    id          INTEGER PRIMARY KEY,
                    name        TEXT NOT NULL,
                    game        TEXT NOT NULL,
                    track       TEXT NOT NULL,
                    layout      TEXT NOT NULL,
                    car         TEXT,
                    starts_at   INTEGER NOT NULL,
                    ends_at     INTEGER,
                    valid_only  INTEGER NOT NULL,
                    max_laps    INTEGER,
                    prizes      TEXT NOT NULL,
                    created_at  INTEGER NOT NULL
                );
                CREATE TABLE settings (
                    key    TEXT PRIMARY KEY,
                    value  TEXT NOT NULL
                );
                ",
            )?;
        }
        if version < 2 {
            // Why a lap wasn't timed: cut / outLap / inLap / partial. Older invalid laps stay NULL.
            conn.execute_batch("ALTER TABLE laps ADD COLUMN untimed_reason TEXT;")?;
        }
        if version < 3 {
            // Timing profile per lap (see docs/sectors.md) and sector boundaries per track layout.
            conn.execute_batch(
                "
                ALTER TABLE laps ADD COLUMN profile BLOB;
                CREATE TABLE sector_layouts (
                    game        TEXT NOT NULL,
                    track       TEXT NOT NULL,
                    layout      TEXT NOT NULL,
                    boundaries  TEXT NOT NULL,
                    source      TEXT NOT NULL,
                    PRIMARY KEY (game, track, layout)
                );
                ",
            )?;
        }
        if version < 4 {
            // Track outlines learned from telemetry (see trackmap.rs): JSON [[x, z], ...].
            conn.execute_batch(
                "
                CREATE TABLE track_maps (
                    game         TEXT NOT NULL,
                    track        TEXT NOT NULL,
                    layout       TEXT NOT NULL,
                    points       TEXT NOT NULL,
                    recorded_at  INTEGER NOT NULL,
                    PRIMARY KEY (game, track, layout)
                );
                ",
            )?;
        }
        if version < 5 {
            // Driver inputs through each lap (throttle, brake, steering, gear): see LapTrace.
            conn.execute_batch("ALTER TABLE laps ADD COLUMN trace BLOB;")?;
        }
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        Ok(Self { conn })
    }

    // ---- settings ----------------------------------------------------------

    pub fn setting(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0))
            .optional()?)
    }

    pub fn set_setting(&self, key: &str, value: Option<&str>) -> Result<()> {
        match value {
            Some(v) => self.conn.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, v],
            )?,
            None => self.conn.execute("DELETE FROM settings WHERE key = ?1", [key])?,
        };
        Ok(())
    }

    // ---- drivers -----------------------------------------------------------

    pub fn drivers(&self) -> Result<Vec<Driver>> {
        let mut stmt = self.conn.prepare("SELECT id, name, color, created_at FROM drivers ORDER BY name")?;
        let rows = stmt.query_map([], driver_from_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn driver(&self, id: DriverId) -> Result<Option<Driver>> {
        Ok(self
            .conn
            .query_row("SELECT id, name, color, created_at FROM drivers WHERE id = ?1", [id], driver_from_row)
            .optional()?)
    }

    pub fn driver_by_name(&self, name: &str) -> Result<Option<Driver>> {
        Ok(self
            .conn
            .query_row("SELECT id, name, color, created_at FROM drivers WHERE name = ?1", [name], driver_from_row)
            .optional()?)
    }

    pub fn insert_driver(&self, name: &str, color: &str, now: Timestamp) -> Result<Driver> {
        self.conn.execute(
            "INSERT INTO drivers (name, color, created_at) VALUES (?1, ?2, ?3)",
            params![name, color, now],
        )?;
        Ok(Driver { id: self.conn.last_insert_rowid(), name: name.to_string(), color: color.to_string(), created_at: now })
    }

    pub fn update_driver(&self, id: DriverId, name: &str, color: &str) -> Result<()> {
        self.conn.execute("UPDATE drivers SET name = ?2, color = ?3 WHERE id = ?1", params![id, name, color])?;
        Ok(())
    }

    pub fn driver_count(&self) -> Result<i64> {
        Ok(self.conn.query_row("SELECT COUNT(*) FROM drivers", [], |r| r.get(0))?)
    }

    // ---- laps --------------------------------------------------------------

    pub fn insert_lap(&self, lap: &Lap, profile: Option<&TimingProfile>, trace: Option<&LapTrace>) -> Result<LapId> {
        self.conn.execute(
            "INSERT INTO laps (driver_id, game, track, layout, car, session_kind, lap_number, time_ms, valid, sectors_ms, recorded_at, untimed_reason, profile, trace)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                lap.driver_id,
                lap.combo.game,
                lap.combo.track,
                lap.combo.layout,
                lap.combo.car,
                lap.session_kind,
                lap.lap_number,
                lap.time_ms,
                lap.valid,
                serde_json::to_string(&lap.sectors_ms)?,
                lap.recorded_at,
                lap.untimed_reason,
                profile.map(TimingProfile::to_bytes),
                trace.map(LapTrace::to_bytes),
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// A lap's timing profile (elapsed ms at each 0.5% of the lap), if it has one.
    pub fn lap_profile(&self, id: LapId) -> Result<Option<TimingProfile>> {
        let bytes: Option<Vec<u8>> = self
            .conn
            .query_row("SELECT profile FROM laps WHERE id = ?1", [id], |r| r.get(0))
            .optional()?
            .flatten();
        Ok(bytes.and_then(|b| TimingProfile::from_bytes(&b)))
    }

    /// A lap's recorded driver inputs, if it has them.
    pub fn lap_trace(&self, id: LapId) -> Result<Option<LapTrace>> {
        let bytes: Option<Vec<u8>> = self
            .conn
            .query_row("SELECT trace FROM laps WHERE id = ?1", [id], |r| r.get(0))
            .optional()?
            .flatten();
        Ok(bytes.and_then(|b| LapTrace::from_bytes(&b)))
    }

    pub fn lap(&self, id: LapId) -> Result<Option<Lap>> {
        Ok(self.conn.query_row(&format!("{LAP_SELECT} WHERE id = ?1"), [id], lap_from_row).optional()?)
    }

    /// Each driver's fastest timed lap on every track + car they have driven.
    pub fn best_times_by_driver(&self) -> Result<Vec<(DriverId, Combo, u32)>> {
        let mut stmt = self.conn.prepare(
            "SELECT driver_id, game, track, layout, car, MIN(time_ms) FROM laps
             WHERE valid = 1 AND untimed_reason IS NULL AND driver_id IS NOT NULL
             GROUP BY driver_id, game, track, layout, car",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get(0)?, Combo { game: r.get(1)?, track: r.get(2)?, layout: r.get(3)?, car: r.get(4)? }, r.get(5)?))
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn about_counts(&self) -> Result<AboutCounts> {
        let n = |sql: &str| -> Result<u32> { Ok(self.conn.query_row(sql, [], |r| r.get(0))?) };
        Ok(AboutCounts {
            drivers: n("SELECT COUNT(*) FROM drivers")?,
            laps: n("SELECT COUNT(*) FROM laps")?,
            timed_laps: n("SELECT COUNT(*) FROM laps WHERE valid = 1 AND untimed_reason IS NULL")?,
            traced_laps: n("SELECT COUNT(*) FROM laps WHERE trace IS NOT NULL")?,
            challenges: n("SELECT COUNT(*) FROM challenges")?,
            schema_version: self.conn.pragma_query_value(None, "user_version", |r| r.get(0))?,
            created_with: self.setting(CREATED_WITH_KEY)?,
            previous_version: None,
        })
    }

    /// Every lap a driver has recorded, oldest first (rows only, no traces).
    pub fn driver_laps(&self, driver_id: DriverId) -> Result<Vec<Lap>> {
        let mut stmt = self.conn.prepare(&format!("{LAP_SELECT} WHERE driver_id = ?1 ORDER BY recorded_at, id"))?;
        let rows = stmt.query_map([driver_id], lap_from_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn recent_laps(&self, limit: u32) -> Result<Vec<Lap>> {
        let mut stmt = self.conn.prepare(&format!("{LAP_SELECT} ORDER BY recorded_at DESC, id DESC LIMIT ?1"))?;
        let rows = stmt.query_map([limit], lap_from_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn set_lap_driver(&self, lap_id: LapId, driver_id: Option<DriverId>) -> Result<()> {
        self.conn.execute("UPDATE laps SET driver_id = ?2 WHERE id = ?1", params![lap_id, driver_id])?;
        Ok(())
    }

    /// Fastest valid lap on a combo, optionally for one driver, excluding one lap.
    pub fn best_valid_time(&self, combo: &Combo, driver_id: Option<DriverId>, exclude: LapId) -> Result<Option<u32>> {
        Ok(self.conn.query_row(
            "SELECT MIN(time_ms) FROM laps
             WHERE game = ?1 AND track = ?2 AND layout = ?3 AND car = ?4 AND valid = 1 AND id != ?5
               AND (?6 IS NULL OR driver_id = ?6)",
            params![combo.game, combo.track, combo.layout, combo.car, exclude, driver_id],
            |r| r.get(0),
        )?)
    }

    /// Tracks and cars that have laps for a game, for leaderboard filters.
    pub fn combos(&self, game: Option<&str>) -> Result<Vec<Combo>> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT game, track, layout, car FROM laps WHERE ?1 IS NULL OR game = ?1 ORDER BY game, track, layout, car",
        )?;
        let rows = stmt.query_map([game], |r| {
            Ok(Combo { game: r.get(0)?, track: r.get(1)?, layout: r.get(2)?, car: r.get(3)? })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Distinct car and track names stored for a game (laps, challenges and maps).
    pub fn stored_names(&self, game: &str) -> Result<(Vec<String>, Vec<String>)> {
        let col = |sql: &str| -> Result<Vec<String>> {
            let mut stmt = self.conn.prepare(sql)?;
            let rows = stmt.query_map([game], |r| r.get::<_, String>(0))?;
            Ok(rows.collect::<Result<_, _>>()?)
        };
        let cars = col("SELECT car FROM laps WHERE game = ?1 UNION SELECT car FROM challenges WHERE game = ?1 AND car IS NOT NULL")?;
        let tracks = col(
            "SELECT track FROM laps WHERE game = ?1 UNION SELECT track FROM challenges WHERE game = ?1 UNION SELECT track FROM track_maps WHERE game = ?1",
        )?;
        Ok((cars, tracks))
    }

    /// Re-labels stored data under the catalogue's name for a car.
    pub fn rename_car(&self, game: &str, from: &str, to: &str) -> Result<()> {
        self.conn.execute("UPDATE laps SET car = ?3 WHERE game = ?1 AND car = ?2", params![game, from, to])?;
        self.conn.execute("UPDATE challenges SET car = ?3 WHERE game = ?1 AND car = ?2", params![game, from, to])?;
        Ok(())
    }

    /// Re-labels stored data under the catalogue's name for a track. Per-track extras keep
    /// whichever row already exists under the new name.
    pub fn rename_track(&self, game: &str, from: &str, to: &str) -> Result<()> {
        self.conn.execute("UPDATE laps SET track = ?3 WHERE game = ?1 AND track = ?2", params![game, from, to])?;
        self.conn.execute("UPDATE challenges SET track = ?3 WHERE game = ?1 AND track = ?2", params![game, from, to])?;
        self.conn.execute("UPDATE OR IGNORE track_maps SET track = ?3 WHERE game = ?1 AND track = ?2", params![game, from, to])?;
        self.conn.execute("UPDATE OR IGNORE sector_layouts SET track = ?3 WHERE game = ?1 AND track = ?2", params![game, from, to])?;
        Ok(())
    }

    pub fn count_laps(&self, f: &LapFilter) -> Result<u32> {
        Ok(self.conn.query_row(
            "SELECT COUNT(*) FROM laps WHERE game = ?1 AND track = ?2 AND (?3 IS NULL OR layout = ?3) AND (?4 IS NULL OR car = ?4)",
            params![f.game, f.track, f.layout, f.car],
            |r| r.get(0),
        )?)
    }

    pub fn delete_laps(&self, f: &LapFilter) -> Result<usize> {
        Ok(self.conn.execute(
            "DELETE FROM laps WHERE game = ?1 AND track = ?2 AND (?3 IS NULL OR layout = ?3) AND (?4 IS NULL OR car = ?4)",
            params![f.game, f.track, f.layout, f.car],
        )?)
    }

    /// Drops the learned map and the sector layout of a track (one layout, or all when `layout` is `None`).
    pub fn forget_track_extras(&self, game: &str, track: &str, layout: Option<&str>) -> Result<()> {
        for table in ["track_maps", "sector_layouts"] {
            self.conn.execute(
                &format!("DELETE FROM {table} WHERE game = ?1 AND track = ?2 AND (?3 IS NULL OR layout = ?3)"),
                params![game, track, layout],
            )?;
        }
        Ok(())
    }

    pub fn track_map(&self, game: &str, track: &str, layout: &str) -> Result<Option<Vec<[f32; 2]>>> {
        let raw: Option<String> = self
            .conn
            .query_row(
                "SELECT points FROM track_maps WHERE game = ?1 AND track = ?2 AND layout = ?3",
                params![game, track, layout],
                |r| r.get(0),
            )
            .optional()?;
        Ok(raw.and_then(|r| serde_json::from_str(&r).ok()))
    }

    pub fn track_maps(&self, game: &str) -> Result<Vec<TrackMap>> {
        let mut stmt = self.conn.prepare("SELECT track, layout, points FROM track_maps WHERE game = ?1 ORDER BY track, layout")?;
        let rows = stmt.query_map([game], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?;
        let mut out = Vec::new();
        for row in rows {
            let (track, layout, raw) = row?;
            if let Ok(points) = serde_json::from_str(&raw) {
                out.push(TrackMap { game: game.to_string(), track, layout, points, rotate: 0, mirror: false });
            }
        }
        Ok(out)
    }

    pub fn set_track_map(&self, game: &str, track: &str, layout: &str, points: &[[f32; 2]], now: Timestamp) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO track_maps (game, track, layout, points, recorded_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![game, track, layout, serde_json::to_string(points)?, now],
        )?;
        Ok(())
    }

    pub fn leaderboard(&self, q: &LeaderboardQuery) -> Result<Vec<LeaderboardEntry>> {
        // Guests (NULL driver) are ranked per lap, so key them by negative lap id.
        // Out, in and partial laps aren't attempts: never ranked, never use up a lap limit.
        let mut stmt = self.conn.prepare(
            "WITH window_laps AS (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY COALESCE(driver_id, -id) ORDER BY recorded_at, id) AS attempt
                FROM laps
                WHERE game = ?1 AND track = ?2 AND layout = ?3
                  AND (untimed_reason IS NULL OR untimed_reason = 'cut')
                  AND (?4 IS NULL OR car = ?4)
                  AND (?5 IS NULL OR recorded_at >= ?5)
                  AND (?6 IS NULL OR recorded_at < ?6)
             ),
             counted AS (
                SELECT * FROM window_laps
                WHERE (?7 IS NULL OR attempt <= ?7) AND (?8 OR valid = 1)
             )
             SELECT driver_id, id, MIN(time_ms) AS best, car, COUNT(*), recorded_at, sectors_ms,
                    GROUP_CONCAT(CASE WHEN valid = 1 THEN sectors_ms END, '|')
             FROM counted
             GROUP BY COALESCE(driver_id, -id)
             ORDER BY best, recorded_at",
        )?;
        let rows = stmt.query_map(
            params![q.game, q.track, q.layout, q.car, q.from, q.to, q.max_laps, q.include_invalid],
            |r| {
                Ok((
                    r.get::<_, Option<DriverId>>(0)?,
                    r.get::<_, LapId>(1)?,
                    r.get::<_, u32>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, u32>(4)?,
                    r.get::<_, Timestamp>(5)?,
                    r.get::<_, String>(6)?,
                    r.get::<_, Option<String>>(7)?,
                ))
            },
        )?;

        let mut out: Vec<LeaderboardEntry> = Vec::new();
        for row in rows {
            let (driver_id, lap_id, time_ms, car, lap_count, set_at, sectors, all_sectors) = row?;
            let sectors_ms: Vec<u32> = serde_json::from_str(&sectors).unwrap_or_default();
            // The driver's best time in each sector, over all their valid laps here.
            let mut best_sectors_ms: Vec<Option<u32>> = Vec::new();
            for lap in all_sectors.as_deref().unwrap_or("").split('|') {
                let Ok(s) = serde_json::from_str::<Vec<u32>>(lap) else { continue };
                if s.is_empty() || (!best_sectors_ms.is_empty() && s.len() != best_sectors_ms.len()) {
                    continue;
                }
                best_sectors_ms.resize(s.len(), None);
                for (b, t) in best_sectors_ms.iter_mut().zip(s) {
                    *b = Some(b.map_or(t, |b| b.min(t)));
                }
            }
            let leader = out.first().map_or(time_ms, |e| e.time_ms);
            out.push(LeaderboardEntry {
                position: out.len() as u32 + 1,
                driver_id,
                lap_id,
                time_ms,
                gap_ms: time_ms - leader,
                car,
                lap_count,
                set_at,
                sectors_ms,
                best_sectors_ms,
            });
        }
        Ok(out)
    }

    // ---- sectors -------------------------------------------------------------

    /// Sector boundaries for a track layout and where they came from ("even", "learned", "game").
    pub fn sector_layout(&self, game: &str, track: &str, layout: &str) -> Result<Option<(Vec<f32>, String)>> {
        let row: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT boundaries, source FROM sector_layouts WHERE game = ?1 AND track = ?2 AND layout = ?3",
                params![game, track, layout],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        Ok(row.and_then(|(b, src)| serde_json::from_str(&b).ok().map(|b| (b, src))))
    }

    pub fn set_sector_layout(&self, game: &str, track: &str, layout: &str, boundaries: &[f32], source: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO sector_layouts (game, track, layout, boundaries, source) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(game, track, layout) DO UPDATE SET boundaries = excluded.boundaries, source = excluded.source",
            params![game, track, layout, serde_json::to_string(boundaries)?, source],
        )?;
        Ok(())
    }

    /// Re-splits every lap on a track layout that has a profile, e.g. after better
    /// boundaries were learned.
    pub fn resplit(&self, game: &str, track: &str, layout: &str, boundaries: &[f32]) -> Result<usize> {
        let laps: Vec<(LapId, Vec<u8>)> = {
            let mut stmt = self.conn.prepare(
                "SELECT id, profile FROM laps WHERE game = ?1 AND track = ?2 AND layout = ?3 AND profile IS NOT NULL",
            )?;
            let rows = stmt.query_map(params![game, track, layout], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<Result<_, _>>()?
        };
        let mut n = 0;
        for (id, bytes) in laps {
            if let Some(profile) = TimingProfile::from_bytes(&bytes) {
                let sectors = serde_json::to_string(&profile.split(boundaries))?;
                n += self.conn.execute("UPDATE laps SET sectors_ms = ?2 WHERE id = ?1", params![id, sectors])?;
            }
        }
        Ok(n)
    }

    /// Profile of the fastest valid lap on a combo (one driver's, or anyone's).
    pub fn best_profile(&self, combo: &Combo, driver_id: Option<DriverId>) -> Result<Option<TimingProfile>> {
        let bytes: Option<Vec<u8>> = self
            .conn
            .query_row(
                "SELECT profile FROM laps
                 WHERE game = ?1 AND track = ?2 AND layout = ?3 AND car = ?4 AND valid = 1 AND profile IS NOT NULL
                   AND (?5 IS NULL OR driver_id = ?5)
                 ORDER BY time_ms LIMIT 1",
                params![combo.game, combo.track, combo.layout, combo.car, driver_id],
                |r| r.get(0),
            )
            .optional()?;
        Ok(bytes.and_then(|b| TimingProfile::from_bytes(&b)))
    }

    /// Sector times of every valid lap on a combo, excluding one lap.
    pub fn valid_sectors(&self, combo: &Combo, exclude: LapId) -> Result<Vec<(Option<DriverId>, Vec<u32>)>> {
        let mut stmt = self.conn.prepare(
            "SELECT driver_id, sectors_ms FROM laps
             WHERE game = ?1 AND track = ?2 AND layout = ?3 AND car = ?4 AND valid = 1 AND id != ?5",
        )?;
        let rows = stmt.query_map(params![combo.game, combo.track, combo.layout, combo.car, exclude], |r| {
            let raw: String = r.get(1)?;
            Ok((r.get::<_, Option<DriverId>>(0)?, serde_json::from_str::<Vec<u32>>(&raw).unwrap_or_default()))
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?.into_iter().filter(|(_, s)| !s.is_empty()).collect())
    }

    // ---- challenges --------------------------------------------------------

    pub fn insert_challenge(&self, c: &NewChallenge, starts_at: Timestamp, now: Timestamp) -> Result<Challenge> {
        self.conn.execute(
            "INSERT INTO challenges (name, game, track, layout, car, starts_at, ends_at, valid_only, max_laps, prizes, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                c.name,
                c.game,
                c.track,
                c.layout,
                c.car,
                starts_at,
                c.ends_at,
                c.valid_only,
                c.max_laps,
                serde_json::to_string(&c.prizes)?,
                now
            ],
        )?;
        Ok(self.challenge(self.conn.last_insert_rowid())?.expect("just inserted"))
    }

    pub fn challenge(&self, id: ChallengeId) -> Result<Option<Challenge>> {
        Ok(self.conn.query_row(&format!("{CHALLENGE_SELECT} WHERE id = ?1"), [id], challenge_from_row).optional()?)
    }

    pub fn challenges(&self) -> Result<Vec<Challenge>> {
        let mut stmt = self.conn.prepare(&format!("{CHALLENGE_SELECT} ORDER BY starts_at DESC"))?;
        let rows = stmt.query_map([], challenge_from_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Challenge window can be ended early ("Until I end it").
    pub fn set_challenge_end(&self, id: ChallengeId, ends_at: Option<Timestamp>) -> Result<()> {
        self.conn.execute("UPDATE challenges SET ends_at = ?2 WHERE id = ?1", params![id, ends_at])?;
        Ok(())
    }

    pub fn delete_challenge(&self, id: ChallengeId) -> Result<()> {
        self.conn.execute("DELETE FROM challenges WHERE id = ?1", [id])?;
        Ok(())
    }
}

const LAP_SELECT: &str = "SELECT id, driver_id, game, track, layout, car, session_kind, lap_number, time_ms, valid, sectors_ms, recorded_at, untimed_reason FROM laps";
const CHALLENGE_SELECT: &str = "SELECT id, name, game, track, layout, car, starts_at, ends_at, valid_only, max_laps, prizes, created_at FROM challenges";

fn driver_from_row(r: &Row) -> rusqlite::Result<Driver> {
    Ok(Driver { id: r.get(0)?, name: r.get(1)?, color: r.get(2)?, created_at: r.get(3)? })
}

fn lap_from_row(r: &Row) -> rusqlite::Result<Lap> {
    let sectors: String = r.get(10)?;
    Ok(Lap {
        id: r.get(0)?,
        driver_id: r.get(1)?,
        combo: Combo { game: r.get(2)?, track: r.get(3)?, layout: r.get(4)?, car: r.get(5)? },
        session_kind: r.get(6)?,
        lap_number: r.get(7)?,
        time_ms: r.get(8)?,
        valid: r.get(9)?,
        untimed_reason: r.get(12)?,
        sectors_ms: serde_json::from_str(&sectors).unwrap_or_default(),
        recorded_at: r.get(11)?,
    })
}

fn challenge_from_row(r: &Row) -> rusqlite::Result<Challenge> {
    let prizes: String = r.get(10)?;
    Ok(Challenge {
        id: r.get(0)?,
        name: r.get(1)?,
        game: r.get(2)?,
        track: r.get(3)?,
        layout: r.get(4)?,
        car: r.get(5)?,
        starts_at: r.get(6)?,
        ends_at: r.get(7)?,
        valid_only: r.get(8)?,
        max_laps: r.get(9)?,
        prizes: serde_json::from_str(&prizes).unwrap_or_default(),
        created_at: r.get(11)?,
    })
}
