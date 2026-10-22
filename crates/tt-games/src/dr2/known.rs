//! Names for the stages and cars DiRT Rally 2.0's telemetry does not name.
//!
//! The packet carries the stage length, the car's engine and the car's position, and no names. A stage or
//! car is known by a stable id worked out from those numbers (see `identity.rs`), and `known.json` says what
//! each recorded one is called. Anything not in the list is called "Unknown stage 8B2484" or "Unknown car
//! AB77AD": the id is in the label, so a player's runs stay grouped correctly and, when a later release
//! names that id, their stored data is relabelled to match.
//!
//! `known.json` is written from the developer's names page (see the app's dev tools), not by hand.

use serde_json::{Value, json};

use super::identity;
use crate::KnownEntry;

/// A stage recorded in `known.json`: where it is, and what it is called.
#[derive(Debug, Clone, PartialEq)]
pub struct KnownStage {
    pub length_m: f32,
    /// The start line (world x, z) as it was read from the game.
    pub start: [f32; 2],
    pub name: String,
}

/// A car recorded in `known.json`: its engine, what it is called and, optionally, its picture (a path under
/// the app's assets).
#[derive(Debug, Clone, PartialEq)]
pub struct KnownCar {
    pub max_rpm: f32,
    pub idle_rpm: f32,
    pub gears: u8,
    pub name: String,
    /// The group it races in (R2, R5, Group A, ...), when recorded.
    pub class: Option<String>,
    pub image: Option<String>,
}

impl KnownStage {
    /// This stage's id, and the neighbouring cell's when its start sits beside a cell edge.
    pub fn ids(&self) -> Vec<String> {
        identity::stage_ids_near(self.length_m, self.start)
    }

    pub fn id(&self) -> String {
        identity::stage_id(self.length_m, self.start)
    }
}

impl KnownCar {
    pub fn id(&self) -> String {
        identity::car_id(self.max_rpm, self.idle_rpm, self.gears)
    }
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct Known {
    pub stages: Vec<KnownStage>,
    pub cars: Vec<KnownCar>,
}

/// The ids a recorded stage or car (its `detail`, as in [`KnownEntry`]) answers to, its own first.
pub fn ids_for(kind: &str, detail: &Value) -> Option<Vec<String>> {
    match kind {
        "stage" => {
            let start = detail["start"].as_array()?;
            let at = [start.first()?.as_f64()? as f32, start.get(1)?.as_f64()? as f32];
            Some(identity::stage_ids_near(detail["length_m"].as_f64()? as f32, at))
        }
        "car" => Some(vec![identity::car_id(detail["max_rpm"].as_f64()? as f32, detail["idle_rpm"].as_f64()? as f32, detail["gears"].as_u64()? as u8)]),
        _ => None,
    }
}

/// `known.json` as it is written from a list of entries: stages then cars, each sorted by name, stable so a
/// re-export of an unchanged list changes nothing in version control.
pub fn export(entries: &[KnownEntry]) -> String {
    let mut stages: Vec<&KnownEntry> = entries.iter().filter(|e| e.kind == "stage").collect();
    let mut cars: Vec<&KnownEntry> = entries.iter().filter(|e| e.kind == "car").collect();
    stages.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.ids[0].cmp(&b.ids[0])));
    cars.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.ids[0].cmp(&b.ids[0])));
    let value = json!({
        "_comment": "Written by the dev tools' Names page, not by hand. A stage is told apart by its length and start line (world x, z), a car by its rev limit, idle speed and gear count: see identity.rs. A stage whose start is not listed here is called 'Unknown stage <id>'.",
        "stages": stages.iter().map(|e| json!({ "length_m": e.detail["length_m"], "start": e.detail["start"], "name": e.name })).collect::<Vec<_>>(),
        "cars": cars.iter().map(|e| {
            let mut car = json!({ "max_rpm": e.detail["max_rpm"], "idle_rpm": e.detail["idle_rpm"], "gears": e.detail["gears"], "name": e.name });
            if let Some(class) = e.detail["class"].as_str().filter(|c| !c.trim().is_empty()) {
                car["class"] = json!(class);
            }
            if let Some(image) = &e.image {
                car["image"] = json!(image);
            }
            car
        }).collect::<Vec<_>>(),
    });
    serde_json::to_string_pretty(&value).expect("json") + "
"
}

/// The label for a stage that has no name yet.
pub fn unknown_stage(id: &str) -> String {
    format!("Unknown stage {id}")
}

/// The label for a car that has no name yet.
pub fn unknown_car(id: &str) -> String {
    format!("Unknown car {id}")
}

/// The id inside an "Unknown stage XXXXXX" or "Unknown car XXXXXX" label, if that is what `label` is.
pub fn id_in_label(label: &str) -> Option<&str> {
    let id = label.strip_prefix("Unknown stage ").or_else(|| label.strip_prefix("Unknown car "))?;
    (id.len() == 6 && id.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_lowercase())).then_some(id)
}

impl Known {
    /// The list shipped with Bin It.
    pub fn bundled() -> Self {
        Self::parse(include_str!("known.json"))
    }

    /// Reads the list; entries that are incomplete are skipped, and unreadable JSON is an empty list.
    pub fn parse(json: &str) -> Self {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(json) else {
            return Self::default();
        };
        let items = |key: &str| v[key].as_array().cloned().unwrap_or_default();
        let stages = items("stages")
            .iter()
            .filter_map(|s| {
                let start = s["start"].as_array()?;
                Some(KnownStage {
                    length_m: s["length_m"].as_f64()? as f32,
                    start: [start.first()?.as_f64()? as f32, start.get(1)?.as_f64()? as f32],
                    name: s["name"].as_str()?.to_string(),
                })
            })
            .collect();
        let cars = items("cars")
            .iter()
            .filter_map(|c| {
                Some(KnownCar {
                    max_rpm: c["max_rpm"].as_f64()? as f32,
                    idle_rpm: c["idle_rpm"].as_f64()? as f32,
                    gears: c["gears"].as_u64()? as u8,
                    name: c["name"].as_str()?.to_string(),
                    class: c["class"].as_str().map(str::to_string),
                    image: c["image"].as_str().map(str::to_string),
                })
            })
            .collect();
        Self { stages, cars }
    }

    /// Every recorded stage and car as the generic entries the rest of the app works with.
    pub fn entries(&self) -> Vec<KnownEntry> {
        let stages = self.stages.iter().map(|s| KnownEntry {
            kind: "stage",
            ids: s.ids(),
            name: s.name.clone(),
            detail: json!({ "length_m": s.length_m, "start": s.start }),
            image: None,
        });
        let cars = self.cars.iter().map(|c| KnownEntry {
            kind: "car",
            ids: vec![c.id()],
            name: c.name.clone(),
            detail: json!({ "max_rpm": c.max_rpm, "idle_rpm": c.idle_rpm, "gears": c.gears, "class": c.class }),
            image: c.image.clone(),
        });
        stages.chain(cars).collect()
    }

    /// The stage's name, or "Unknown stage <id>". `start` is where the start line is, when the stage was seen
    /// from its start: a stage joined part-way has none, and is only named if its length picks out one stage.
    pub fn stage_name(&self, length_m: f32, start: Option<[f32; 2]>) -> String {
        match start {
            Some(start) => {
                let id = identity::stage_id(length_m, start);
                match self.stages.iter().find(|s| s.length_m.round() == length_m.round() && s.ids().contains(&id)) {
                    Some(s) => s.name.clone(),
                    None => unknown_stage(&id),
                }
            }
            None => {
                let same: Vec<&KnownStage> = self.stages.iter().filter(|s| s.length_m.round() == length_m.round()).collect();
                match same[..] {
                    [only] => only.name.clone(),
                    _ => format!("Unknown stage {:.2} km (start not seen)", length_m / 1000.0),
                }
            }
        }
    }

    /// The car's name, or "Unknown car <id>".
    pub fn car_name(&self, max_rpm: f32, idle_rpm: f32, gears: u8) -> String {
        let id = identity::car_id(max_rpm, idle_rpm, gears);
        self.cars.iter().find(|c| c.id() == id).map(|c| c.name.clone()).unwrap_or_else(|| unknown_car(&id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIST: &str = r#"{
        "stages": [{"length_m": 2845.63, "start": [903.70, 205.61], "name": "Test Stage"}],
        "cars": [{"max_rpm": 7749.26, "idle_rpm": 1780.24, "gears": 5, "name": "Test Car", "class": "R5", "image": "cars/test.png"}]
    }"#;

    #[test]
    fn a_known_stage_is_named_whatever_a_start_does_within_the_grid() {
        let k = Known::parse(LIST);
        for z in [205.56, 205.61, 205.67] {
            assert_eq!(k.stage_name(2845.63, Some([903.70, z])), "Test Stage", "z {z}");
        }
    }

    #[test]
    fn the_same_length_starting_elsewhere_is_another_stage() {
        let k = Known::parse(LIST);
        // The reverse direction: same length, the other end.
        let reverse = k.stage_name(2845.63, Some([1500.0, -300.0]));
        assert!(reverse.starts_with("Unknown stage ") && id_in_label(&reverse).is_some(), "{reverse}");
        assert_ne!(reverse, k.stage_name(2845.63, Some([2000.0, 40.0])), "and each place has its own id");
    }

    #[test]
    fn a_recorded_start_beside_a_cell_edge_is_found_from_either_side() {
        // Recorded at x = 900.3 (0.3 m into its cell); a player's start 0.5 m the other way is in the cell before.
        let k = Known::parse(r#"{"stages": [{"length_m": 1000.0, "start": [900.3, 225.0], "name": "Edge"}]}"#);
        assert_eq!(k.stage_name(1000.0, Some([900.3, 225.0])), "Edge");
        assert_eq!(k.stage_name(1000.0, Some([899.8, 225.0])), "Edge");
        assert!(k.stage_name(1000.0, Some([800.0, 225.0])).starts_with("Unknown"));
    }

    #[test]
    fn a_stage_joined_part_way_is_named_only_when_its_length_picks_out_one() {
        let k = Known::parse(LIST);
        assert_eq!(k.stage_name(2845.63, None), "Test Stage");
        assert_eq!(k.stage_name(9666.5, None), "Unknown stage 9.67 km (start not seen)");
        let two = Known::parse(r#"{"stages": [
            {"length_m": 2845.63, "start": [903.7, 205.6], "name": "Forward"},
            {"length_m": 2845.63, "start": [1500.0, -300.0], "name": "Reverse"}]}"#);
        assert!(two.stage_name(2845.63, None).starts_with("Unknown stage 2.85 km"), "ambiguous: not guessed");
    }

    #[test]
    fn a_car_is_named_by_its_engine_or_called_unknown_with_its_id() {
        let k = Known::parse(LIST);
        assert_eq!(k.car_name(7749.3, 1780.2, 5), "Test Car");
        assert_eq!(k.car_name(8377.58, 2199.11, 5), "Unknown car ABC5D6");
        assert_eq!(k.cars[0].image.as_deref(), Some("cars/test.png"));
        assert_eq!(k.cars[0].class.as_deref(), Some("R5"));
    }

    #[test]
    fn an_unknown_label_carries_its_id_and_can_be_read_back() {
        assert_eq!(id_in_label("Unknown stage 8B2484"), Some("8B2484"));
        assert_eq!(id_in_label("Unknown car AB77AD"), Some("AB77AD"));
        assert_eq!(id_in_label("Wales Bidno Reservoir"), None);
        assert_eq!(id_in_label("Unknown stage 2.85 km (start not seen)"), None);
        assert_eq!(id_in_label("Unknown car (5 gears, 7749 rpm)"), None);
    }

    #[test]
    fn entries_round_trip_through_the_exported_file() {
        let k = Known::parse(LIST);
        let again = Known::parse(&export(&k.entries()));
        assert_eq!(again, k);
        // And the file doesn't change when exported again.
        assert_eq!(export(&again.entries()), export(&k.entries()));
    }

    #[test]
    fn a_recorded_detail_answers_to_the_same_ids_the_stream_computes() {
        let stage = json!({ "length_m": 2845.63, "start": [903.7, 205.61] });
        assert_eq!(ids_for("stage", &stage).unwrap()[0], identity::stage_id(2845.63, [903.7, 205.61]));
        let car = json!({ "max_rpm": 7749.3, "idle_rpm": 1780.2, "gears": 5 });
        assert_eq!(ids_for("car", &car).unwrap(), vec![identity::car_id(7749.26, 1780.24, 5)]);
        assert!(ids_for("stage", &json!({ "length_m": 1.0 })).is_none());
    }

    #[test]
    fn the_bundled_list_parses() {
        let _ = Known::bundled();
        assert!(serde_json::from_str::<serde_json::Value>(include_str!("known.json")).is_ok());
    }
}
