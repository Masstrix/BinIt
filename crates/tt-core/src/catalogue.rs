//! The catalogue: every track, layout and car TimeTrial knows about for a game, so
//! pickers can offer things nobody has driven yet.
//!
//! Sources, merged by normalised name (never by reading game binaries):
//!   1. bundled lists in `data/<game>.json`, maintained by us,
//!   2. an optional user file `catalogue/<game>.json` in the app data folder (same format),
//!   3. names seen in a game's plain-text files (AC EVO `Documents/ACE`),
//!   4. everything that has actually been driven (the laps table).
//!
//! Names are exactly what the game's telemetry reports; they're what laps and
//! challenges match on. `aliases` are only for search ("Bathurst" finds Mount Panorama).
//! `seen` marks entries confirmed by 3 or 4, so the UI can flag the unconfirmed ones.

use std::collections::{BTreeSet, HashMap};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::model::Combo;

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Seed {
    #[serde(default)]
    pub tracks: Vec<SeedTrack>,
    #[serde(default)]
    pub cars: Vec<SeedCar>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SeedTrack {
    pub name: String,
    #[serde(default)]
    pub country: Option<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
    /// "circuit" (default) or "rally".
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub layouts: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SeedCar {
    pub name: String,
    #[serde(default)]
    pub brand: Option<String>,
    #[serde(default)]
    pub class: Option<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatLayout {
    /// Empty string = the default layout.
    pub name: String,
    pub seen: bool,
    pub has_map: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatTrack {
    pub name: String,
    pub country: Option<String>,
    pub aliases: Vec<String>,
    pub kind: String,
    pub layouts: Vec<CatLayout>,
    pub seen: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatCar {
    pub name: String,
    pub brand: Option<String>,
    pub class: Option<String>,
    pub aliases: Vec<String>,
    pub seen: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalogue {
    pub game: String,
    pub tracks: Vec<CatTrack>,
    pub cars: Vec<CatCar>,
}

/// Lowercase letters and digits only, with common accents folded, so "Nürburgring",
/// "Nurburgring" and "nurburg-ring" compare equal.
pub fn norm(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'à' | 'á' | 'â' | 'ä' | 'ã' | 'å' => 'a',
            'è' | 'é' | 'ê' | 'ë' => 'e',
            'ì' | 'í' | 'î' | 'ï' => 'i',
            'ò' | 'ó' | 'ô' | 'ö' | 'õ' => 'o',
            'ù' | 'ú' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            c => c,
        })
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

/// Words of a name, lowercase and accent-folded: "Porsche 911 GT3 Cup (992)" -> {porsche, 911, gt3, cup, 992}.
fn tokens(s: &str) -> BTreeSet<String> {
    let spaced: String = s.chars().map(|c| if c.is_alphanumeric() { c } else { ' ' }).collect();
    spaced.split_whitespace().map(norm).filter(|t| !t.is_empty()).collect()
}

/// Maps whatever spelling a game or a fan list uses to the catalogue's own name for the entry.
/// Tried in order: same letters and digits as the name or an alias; else one entry whose words
/// are all contained in the incoming name (or the other way round), when both have at least two
/// words. An ambiguous or unknown name returns `None` and is kept as the game spelled it.
pub fn resolve(entries: &[(&str, &[String])], incoming: &str) -> Option<String> {
    let key = norm(incoming);
    if key.is_empty() {
        return None;
    }
    let spellings = |(name, aliases): &(&str, &[String])| {
        std::iter::once(name.to_string()).chain(aliases.iter().cloned()).collect::<Vec<_>>()
    };
    if let Some((name, _)) = entries.iter().find(|e| spellings(e).iter().any(|s| norm(s) == key)) {
        return Some(name.to_string());
    }
    let words = tokens(incoming);
    if words.len() < 2 {
        return None;
    }
    let mut hits: Vec<&str> = entries
        .iter()
        .filter(|e| {
            spellings(e).iter().any(|s| {
                let t = tokens(s);
                t.len() >= 2 && (t.is_subset(&words) || words.is_subset(&t))
            })
        })
        .map(|(name, _)| *name)
        .collect();
    hits.dedup();
    (hits.len() == 1).then(|| hits[0].to_string())
}

/// The catalogue's name for a track, from the bundled and user lists (unchanged if unknown).
pub fn canonical_track(seeds: &[Seed], name: &str) -> String {
    let entries: Vec<(&str, &[String])> =
        seeds.iter().flat_map(|s| s.tracks.iter().map(|t| (t.name.as_str(), t.aliases.as_slice()))).collect();
    resolve(&entries, name).unwrap_or_else(|| name.to_string())
}

/// The catalogue's name for a car (unchanged if unknown).
pub fn canonical_car(seeds: &[Seed], name: &str) -> String {
    let entries: Vec<(&str, &[String])> =
        seeds.iter().flat_map(|s| s.cars.iter().map(|c| (c.name.as_str(), c.aliases.as_slice()))).collect();
    resolve(&entries, name).unwrap_or_else(|| name.to_string())
}

/// The bundled seed for a game (empty if we ship none).
pub fn bundled(game: &str) -> Seed {
    let raw = match game {
        "acevo" => include_str!("../data/acevo.json"),
        "dr2" => include_str!("../data/dr2.json"),
        _ => return Seed::default(),
    };
    serde_json::from_str(raw).expect("bundled catalogue is valid JSON")
}

/// A user-supplied `<dir>/<game>.json`; a missing or broken file is just ignored.
pub fn custom(dir: &Path, game: &str) -> Seed {
    std::fs::read_to_string(dir.join(format!("{game}.json")))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// Names observed in AC EVO's plain-text files under `Documents/ACE`: session results
/// and the last loaded event. Layout names there differ from telemetry's, so only
/// tracks and cars are taken.
#[derive(Debug, Default)]
pub struct Observed {
    pub tracks: Vec<String>,
    pub cars: Vec<(String, Option<String>)>,
}

pub fn scan_ace_documents(dir: &Path) -> Observed {
    let mut out = Observed::default();
    let read = |p: &Path| std::fs::read_to_string(p).ok().and_then(|r| serde_json::from_str::<serde_json::Value>(&r).ok());

    if let Some(season) = read(&dir.join("last_season.seasondefinition.json")) {
        collect_track_names(&season, &mut out.tracks);
    }
    let Ok(entries) = std::fs::read_dir(dir.join("Results")) else { return out };
    for path in entries.flatten().map(|e| e.path()) {
        if !path.to_string_lossy().ends_with(".sessionresults.json") {
            continue;
        }
        let Some(v) = read(&path) else { continue };
        if let Some(t) = v.get("track").and_then(|t| t.as_str()) {
            out.tracks.push(t.to_string());
        }
        for d in v.get("drivers").and_then(|d| d.as_array()).into_iter().flatten() {
            if let Some(car) = d.get("car_name").and_then(|c| c.as_str()).filter(|c| !c.is_empty()) {
                out.cars.push((car.to_string(), d.get("car_brand").and_then(|b| b.as_str()).map(String::from)));
            }
        }
    }
    out
}

/// `track_content_data.name` anywhere in a season definition.
fn collect_track_names(v: &serde_json::Value, out: &mut Vec<String>) {
    match v {
        serde_json::Value::Object(m) => {
            if let Some(name) = m.get("track_content_data").and_then(|t| t.get("name")).and_then(|n| n.as_str()) {
                out.push(name.to_string());
            }
            m.values().for_each(|c| collect_track_names(c, out));
        }
        serde_json::Value::Array(a) => a.iter().for_each(|c| collect_track_names(c, out)),
        _ => {}
    }
}

/// Builds a game's catalogue. `maps` holds `(track, layout)` pairs that have a learned map.
pub fn build(game: &str, seeds: Vec<Seed>, observed: &Observed, driven: &[Combo], maps: &[(String, String)]) -> Catalogue {
    let mut tracks: Vec<CatTrack> = Vec::new();
    let mut cars: Vec<CatCar> = Vec::new();
    let mut track_ix: HashMap<String, usize> = HashMap::new();
    let mut car_ix: HashMap<String, usize> = HashMap::new();

    // Inserts or updates a track; confirmed (`seen`) entries adopt the game's own spelling.
    let mut upsert_track = |name: &str, seen: bool, seed: Option<&SeedTrack>, layout: Option<&str>| {
        let i = *track_ix.entry(norm(name)).or_insert_with(|| {
            tracks.push(CatTrack {
                name: name.to_string(),
                country: None,
                aliases: Vec::new(),
                kind: "circuit".into(),
                layouts: Vec::new(),
                seen: false,
            });
            tracks.len() - 1
        });
        let t = &mut tracks[i];
        if seen && !t.seen && t.name != name {
            let old = std::mem::replace(&mut t.name, name.to_string());
            t.aliases.push(old);
        }
        t.seen |= seen;
        if let Some(s) = seed {
            t.country = t.country.take().or_else(|| s.country.clone());
            if let Some(k) = &s.kind {
                t.kind = k.clone();
            }
            for a in &s.aliases {
                if norm(a) != norm(&t.name) && !t.aliases.iter().any(|x| norm(x) == norm(a)) {
                    t.aliases.push(a.clone());
                }
            }
            for l in &s.layouts {
                add_layout(t, l, false);
            }
        }
        if let Some(l) = layout {
            add_layout(t, l, seen);
        }
    };

    for seed in &seeds {
        for t in &seed.tracks {
            upsert_track(&t.name, false, Some(t), None);
        }
    }
    for name in &observed.tracks {
        upsert_track(name, true, None, None);
    }
    for c in driven {
        upsert_track(&c.track, true, None, Some(&c.layout));
    }

    let mut upsert_car = |name: &str, seen: bool, brand: Option<&str>, class: Option<&str>, aliases: &[String]| {
        let i = *car_ix.entry(norm(name)).or_insert_with(|| {
            cars.push(CatCar { name: name.to_string(), brand: None, class: None, aliases: Vec::new(), seen: false });
            cars.len() - 1
        });
        let c = &mut cars[i];
        if seen && !c.seen && c.name != name {
            let old = std::mem::replace(&mut c.name, name.to_string());
            c.aliases.push(old);
        }
        c.seen |= seen;
        c.brand = c.brand.take().or_else(|| brand.map(String::from));
        c.class = c.class.take().or_else(|| class.map(String::from));
        for a in aliases {
            if norm(a) != norm(&c.name) && !c.aliases.iter().any(|x| norm(x) == norm(a)) {
                c.aliases.push(a.clone());
            }
        }
    };
    for seed in &seeds {
        for c in &seed.cars {
            upsert_car(&c.name, false, c.brand.as_deref(), c.class.as_deref(), &c.aliases);
        }
    }
    for (name, brand) in &observed.cars {
        upsert_car(name, true, brand.as_deref(), None, &[]);
    }
    for c in driven {
        upsert_car(&c.car, true, None, None, &[]);
    }

    // Cars seen in telemetry carry no brand: take a known brand the name starts with, else its first word.
    let brands: Vec<String> = cars.iter().filter_map(|c| c.brand.clone()).collect();
    for c in cars.iter_mut().filter(|c| c.brand.is_none()) {
        let lower = c.name.to_lowercase();
        c.brand = brands
            .iter()
            .filter(|b| lower.starts_with(&b.to_lowercase()))
            .max_by_key(|b| b.len())
            .cloned()
            .or_else(|| c.name.split_whitespace().next().filter(|w| w.chars().any(char::is_alphabetic)).map(String::from));
    }

    for t in &mut tracks {
        let name = norm(&t.name);
        for l in &mut t.layouts {
            l.has_map = maps.iter().any(|(mt, ml)| norm(mt) == name && norm(ml) == norm(&l.name));
        }
        t.layouts.sort_by_key(|l| l.name.to_lowercase());
    }
    tracks.sort_by_key(|t| t.name.to_lowercase());
    cars.sort_by_key(|c| (c.brand.clone().unwrap_or_default().to_lowercase(), c.name.to_lowercase()));
    Catalogue { game: game.to_string(), tracks, cars }
}

fn add_layout(t: &mut CatTrack, name: &str, seen: bool) {
    let key = norm(name);
    match t.layouts.iter_mut().find(|l| norm(&l.name) == key) {
        Some(l) => {
            if seen && !l.seen {
                l.name = name.to_string();
            }
            l.seen |= seen;
        }
        None => t.layouts.push(CatLayout { name: name.to_string(), seen, has_map: false }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn combo(track: &str, layout: &str, car: &str) -> Combo {
        Combo { game: "acevo".into(), track: track.into(), layout: layout.into(), car: car.into() }
    }

    #[test]
    fn game_spellings_resolve_to_catalogue_names() {
        let seeds = vec![bundled("acevo")];
        let car = |n: &str| canonical_car(&seeds, n);
        // Fan-list spelling, telemetry spelling and extra words all land on one entry.
        assert_eq!(car("Porsche 992 GT3 Cup"), "Porsche 911 GT3 Cup (992)");
        assert_eq!(car("porsche 911 gt3 cup (992)"), "Porsche 911 GT3 Cup (992)");
        assert_eq!(car("Ferrari F2004 (V10 Formula 1)"), "Ferrari F2004");
        assert_eq!(car("Mercedes-AMG GT2"), "Mercedes-AMG GT2");
        // Similar cars stay apart; ambiguous or unknown names are left as the game spelled them.
        assert_eq!(car("Ferrari 296 GT3"), "Ferrari 296 GT3");
        assert_eq!(car("Ferrari 296 GTB"), "Ferrari 296 GTB");
        assert_eq!(car("BMW M2"), "BMW M2");
        assert_eq!(car("Some Mod Car"), "Some Mod Car");
        let track = |n: &str| canonical_track(&seeds, n);
        assert_eq!(track("Bathurst"), "Mount Panorama");
        assert_eq!(track("Paul Ricard"), "Circuit Paul Ricard");
        assert_eq!(track("Nürburgring"), "Nurburgring");
        assert_eq!(track("Nurburgring Nordschleife"), "Nurburgring");
        assert_eq!(track("Fuji"), "Fuji Speedway");
    }

    #[test]
    fn bundled_lists_parse() {
        assert!(!bundled("acevo").tracks.is_empty());
        assert!(!bundled("dr2").cars.is_empty());
        assert!(bundled("nope").tracks.is_empty());
    }

    #[test]
    fn driven_names_confirm_and_replace_seeded_spellings() {
        let seed = Seed {
            tracks: vec![SeedTrack {
                name: "Nurburgring".into(),
                country: Some("DE".into()),
                aliases: vec!["Ring".into()],
                kind: None,
                layouts: vec!["GP".into()],
            }],
            cars: vec![],
        };
        let driven = [combo("Nürburgring", "gp", "Dallara EXP")];
        let cat = build("acevo", vec![seed], &Observed::default(), &driven, &[]);
        assert_eq!(cat.tracks.len(), 1);
        let t = &cat.tracks[0];
        assert_eq!(t.name, "Nürburgring");
        assert!(t.seen && t.aliases.contains(&"Nurburgring".to_string()) && t.aliases.contains(&"Ring".to_string()));
        assert_eq!(t.layouts.len(), 1);
        assert_eq!((t.layouts[0].name.as_str(), t.layouts[0].seen), ("gp", true));
        assert_eq!(cat.cars.len(), 1);
        assert!(cat.cars[0].seen);
    }

    #[test]
    fn brandless_cars_get_a_brand_from_their_name() {
        let seed = Seed {
            tracks: vec![],
            cars: vec![SeedCar { name: "Mercedes-AMG GT3".into(), brand: Some("Mercedes-AMG".into()), class: None, aliases: vec![] }],
        };
        let driven = [combo("x", "", "Mercedes-AMG GT3 Evo"), combo("x", "", "Ferrari F2004")];
        let cat = build("acevo", vec![seed], &Observed::default(), &driven, &[]);
        let brand = |n: &str| cat.cars.iter().find(|c| c.name == n).unwrap().brand.clone();
        assert_eq!(brand("Mercedes-AMG GT3 Evo").as_deref(), Some("Mercedes-AMG"));
        assert_eq!(brand("Ferrari F2004").as_deref(), Some("Ferrari"));
    }

    #[test]
    fn maps_flag_matching_layouts() {
        let driven = [combo("Imola", "", "x"), combo("Imola", "Short", "x")];
        let cat = build("acevo", vec![], &Observed::default(), &driven, &[("imola".into(), "".into())]);
        let layouts = &cat.tracks[0].layouts;
        assert_eq!(layouts.iter().filter(|l| l.has_map).count(), 1);
        assert!(layouts.iter().find(|l| l.name.is_empty()).unwrap().has_map);
    }

    #[test]
    fn scans_ace_documents() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("Results")).unwrap();
        std::fs::write(
            dir.path().join("Results/a.sessionresults.json"),
            r#"{"track":"Suzuka","layout":"East Time Attack","drivers":[{"car_name":"Dallara EXP","car_brand":"Dallara"}]}"#,
        )
        .unwrap();
        std::fs::write(
            dir.path().join("last_season.seasondefinition.json"),
            r#"{"event_map":{"0":{"session_map":{"0":{"scene":{"track_content_data":{"name":"Brands Hatch"}}}}}}}"#,
        )
        .unwrap();
        let o = scan_ace_documents(dir.path());
        assert!(o.tracks.contains(&"Suzuka".to_string()) && o.tracks.contains(&"Brands Hatch".to_string()));
        assert_eq!(o.cars, vec![("Dallara EXP".to_string(), Some("Dallara".to_string()))]);
    }
}
