//! Names for the stages and cars a game's telemetry doesn't name (DiRT Rally 2.0).
//!
//! The game adapter calls something it can't name "Unknown stage 8B2484": the id is in the label, so a
//! player's runs stay grouped and, when a name is recorded for that id, their stored runs, challenges and
//! maps are relabelled to it. Names come from two places:
//!
//! * the list shipped with Bin It (`tt_games::known_entries`), applied at start-up, so a release that names
//!   a stage names it in everyone's existing data;
//! * names recorded in this install by the developer tools (the `associations` table), which apply at once
//!   and are exported into the shipped list when the developer is happy with them.
//!
//! A recorded name beats a shipped one for the same id. `applied_names` remembers what each id's stored data
//! is currently called, so a name that is later corrected still finds it.

use anyhow::{Result, bail};
use serde::Serialize;
use serde_json::Value;
use tt_games::KnownEntry;

use crate::{AppEvent, BinIt};

/// A stage or car with a name: from the shipped list ("shipped") or recorded here ("dev").
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssociationView {
    pub kind: String,
    /// Its own id: the one in its "Unknown ..." label.
    pub id: String,
    pub name: String,
    /// What it was recorded from: a stage's length and start, a car's engine.
    pub detail: Value,
    pub source: &'static str,
    /// A picture is recorded here (fetch it from the image route).
    pub has_image: bool,
    /// A shipped picture, as a path under the app's assets.
    pub image: Option<String>,
}

/// An "Unknown ..." label found in stored data.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct UnknownSeen {
    pub kind: String,
    pub id: String,
    pub label: String,
    pub runs: u32,
}

/// What the game is telling us about the stage and car being driven right now.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NowDriving {
    /// The stage and car as the adapter read them (`{ "stage": {...}, "car": {...} }`), if a session is running.
    pub identity: Option<Value>,
    pub stage_label: Option<String>,
    pub car_label: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssociationsView {
    pub now: NowDriving,
    pub entries: Vec<AssociationView>,
    pub unknown: Vec<UnknownSeen>,
}

/// The files an export writes: paths relative to the repository root.
#[derive(Debug, Clone, PartialEq)]
pub struct Export {
    pub list: (&'static str, String),
    pub images: Vec<(String, Vec<u8>)>,
}

/// One name in force, whichever list it came from.
struct Merged {
    kind: String,
    ids: Vec<String>,
    name: String,
    detail: Value,
    image: Option<String>,
    source: &'static str,
    has_image: bool,
}

fn extension_for(image_type: &str) -> &'static str {
    match image_type {
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        _ => "png",
    }
}

impl BinIt {
    /// Every name in force for a game: recorded ones first, then shipped ones not overridden by a recorded one.
    fn merged_associations(&self, game: &str) -> Result<Vec<Merged>> {
        let mut out: Vec<Merged> = Vec::new();
        for a in self.store().associations(game)? {
            let detail: Value = serde_json::from_str(&a.detail).unwrap_or(Value::Null);
            let ids = tt_games::ids_for(game, &a.kind, &detail).unwrap_or_else(|| vec![a.id.clone()]);
            out.push(Merged { kind: a.kind, ids, name: a.name, detail, image: None, source: "dev", has_image: a.has_image });
        }
        for KnownEntry { kind, ids, name, detail, image } in tt_games::known_entries(game) {
            if out.iter().any(|m| m.kind == kind && m.ids.iter().any(|i| ids.contains(i))) {
                continue;
            }
            out.push(Merged { kind: kind.to_string(), ids, name, detail, image, source: "shipped", has_image: false });
        }
        Ok(out)
    }

    /// The name recorded for an "Unknown stage XXXXXX" / "Unknown car XXXXXX" label, or the label itself when
    /// nothing is recorded for its id (or it isn't such a label).
    pub fn resolve_unknown(&self, game: &str, label: &str) -> String {
        let Some((kind, id)) = tt_games::id_in_unknown_label(game, label) else {
            return label.to_string();
        };
        match self.merged_associations(game) {
            Ok(list) => list.into_iter().find(|m| m.kind == kind && m.ids.contains(&id)).map_or_else(|| label.to_string(), |m| m.name),
            Err(_) => label.to_string(),
        }
    }

    /// Relabels stored runs, challenges and maps to the names now in force, and back to "Unknown ..." for an id
    /// whose name was removed. Safe to run any time; returns how many labels changed.
    pub fn apply_associations(&self, game: &str) -> Result<usize> {
        let merged = self.merged_associations(game)?;
        let store = self.store();
        let (cars, tracks) = store.stored_names(game)?;
        let mut changed = 0;
        let relabel = |kind: &str, from: &str, to: &str| -> Result<bool> {
            if from == to {
                return Ok(false);
            }
            let stage = kind == "stage";
            if !(if stage { &tracks } else { &cars }).iter().any(|s| s == from) {
                return Ok(false);
            }
            if stage {
                store.rename_track(game, from, to)?;
            } else {
                store.rename_car(game, from, to)?;
            }
            Ok(true)
        };
        for m in &merged {
            // The labels this name's data may be under: unnamed under any of its ids, or under its previous name.
            let mut from: Vec<String> = m.ids.iter().filter_map(|id| tt_games::unknown_label(game, &m.kind, id)).collect();
            if let Some(previous) = store.applied_name(game, &m.kind, &m.ids[0])? {
                from.push(previous);
            }
            for label in from {
                if relabel(&m.kind, &label, &m.name)? {
                    changed += 1;
                }
            }
            store.set_applied_name(game, &m.kind, &m.ids[0], Some(&m.name))?;
        }
        // A name that was removed: its data goes back to being called by its id.
        for (kind, id, name) in store.applied_names(game)? {
            if merged.iter().any(|m| m.kind == kind && m.ids[0] == id) {
                continue;
            }
            if let Some(label) = tt_games::unknown_label(game, &kind, &id)
                && relabel(&kind, &name, &label)?
            {
                changed += 1;
            }
            store.set_applied_name(game, &kind, &id, None)?;
        }
        Ok(changed)
    }

    /// Records a name for a stage or car (what the developer tools save): `detail` is what it was recorded from,
    /// `image` an optional picture as (bytes, media type). The runs already stored under its "Unknown ..." label
    /// are relabelled at once, and so is the session being driven.
    pub fn save_association(&self, game: &str, kind: &str, name: &str, detail: &Value, image: Option<(Vec<u8>, String)>) -> Result<()> {
        let name = name.trim();
        if name.is_empty() {
            bail!("a name can't be empty");
        }
        let Some(ids) = tt_games::ids_for(game, kind, detail) else {
            bail!("can't tell what this {kind} is from {detail}");
        };
        self.store().put_association(game, kind, &ids[0], name, &detail.to_string(), image.as_ref().map(|(b, t)| (b.as_slice(), t.as_str())))?;
        self.after_associations_changed(game)
    }

    /// Gives a recorded name a picture (it must have been recorded first).
    pub fn set_association_image(&self, game: &str, kind: &str, id: &str, bytes: Vec<u8>, media: &str) -> Result<()> {
        let found = self.store().associations(game)?.into_iter().find(|a| a.kind == kind && a.id == id);
        let Some(a) = found else {
            bail!("record a name for it first");
        };
        self.store().put_association(game, kind, id, &a.name, &a.detail, Some((bytes.as_slice(), media)))?;
        Ok(())
    }

    /// Takes a recorded name away: the data goes back to being called by its id.
    pub fn delete_association(&self, game: &str, kind: &str, id: &str) -> Result<()> {
        self.store().delete_association(game, kind, id)?;
        self.after_associations_changed(game)
    }

    fn after_associations_changed(&self, game: &str) -> Result<()> {
        self.apply_associations(game)?;
        self.refresh_session_names()?;
        self.emit(AppEvent::LapsChanged);
        self.emit(AppEvent::ChallengesChanged);
        self.emit(AppEvent::MapsChanged);
        Ok(())
    }

    /// The session being driven takes the names now in force (without restarting what is being recorded).
    fn refresh_session_names(&self) -> Result<()> {
        let (current, raw) = {
            let rt = self.runtime.lock().expect("runtime mutex poisoned");
            (rt.session_info.clone(), rt.session_raw.clone())
        };
        let (Some(current), Some(mut renamed)) = (current, raw) else {
            return Ok(());
        };
        self.canonical_session(&mut renamed);
        if renamed != current {
            self.set_session(renamed, false)?;
        }
        Ok(())
    }

    /// The picture recorded here for a stage or car, with its media type.
    pub fn association_image(&self, game: &str, kind: &str, id: &str) -> Result<Option<(Vec<u8>, String)>> {
        self.store().association_image(game, kind, id)
    }

    /// Everything the developer's Names page shows.
    pub fn associations_view(&self, game: &str) -> Result<AssociationsView> {
        let now = {
            let rt = self.runtime.lock().expect("runtime mutex poisoned");
            match rt.session_info.as_ref().filter(|i| i.game.key() == game) {
                Some(info) => NowDriving {
                    identity: info.identity.as_deref().and_then(|j| serde_json::from_str(j).ok()),
                    stage_label: Some(info.track.clone()),
                    car_label: Some(info.car.clone()),
                },
                None => NowDriving { identity: None, stage_label: None, car_label: None },
            }
        };
        let entries = self
            .merged_associations(game)?
            .into_iter()
            .map(|m| AssociationView { kind: m.kind, id: m.ids[0].clone(), name: m.name, detail: m.detail, source: m.source, has_image: m.has_image, image: m.image })
            .collect();
        let store = self.store();
        let mut unknown = Vec::new();
        for (kind, rows) in [("stage", store.track_run_counts(game)?), ("car", store.car_run_counts(game)?)] {
            for (label, runs) in rows {
                if let Some((k, id)) = tt_games::id_in_unknown_label(game, &label)
                    && k == kind
                {
                    unknown.push(UnknownSeen { kind: kind.to_string(), id, label, runs });
                }
            }
        }
        Ok(AssociationsView { now, entries, unknown })
    }

    /// What exporting writes into the source tree: the game's list of names with the recorded ones in it, and the
    /// pictures recorded here saved as files (their paths set in the list).
    pub fn export_associations(&self, game: &str) -> Result<Option<Export>> {
        let merged = self.merged_associations(game)?;
        let mut images = Vec::new();
        let mut entries = Vec::new();
        for m in merged {
            let mut image = m.image.clone();
            if m.has_image
                && let Some((bytes, media)) = self.store().association_image(game, &m.kind, &m.ids[0])?
            {
                let path = format!("{}s/{game}/{}.{}", m.kind, m.ids[0], extension_for(&media));
                images.push((format!("app/src/assets/{path}"), bytes));
                image = Some(path);
            }
            let kind: &'static str = if m.kind == "stage" { "stage" } else { "car" };
            entries.push(KnownEntry { kind, ids: m.ids, name: m.name, detail: m.detail, image });
        }
        Ok(tt_games::export_known(game, &entries).map(|list| Export { list, images }))
    }
}
