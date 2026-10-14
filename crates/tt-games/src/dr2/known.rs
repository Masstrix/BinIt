//! Names for the stages and cars DiRT Rally 2.0's telemetry does not name.
//!
//! The packet carries the stage length and the car's engine (max and idle rpm, gear count) and nothing
//! else, so a name is looked up in `known.json`, which grows as stages and cars are read from the game.
//! Anything not in the list gets a name made from those numbers, so two different stages and cars are
//! still kept apart in the leaderboards and the data is not lost: it can be renamed later.

/// A stage length matches within this many metres.
const LENGTH_TOLERANCE_M: f32 = 2.0;
/// An engine speed matches within this many rpm.
const RPM_TOLERANCE: f32 = 15.0;

#[derive(Debug)]
struct Stage {
    length_m: f32,
    name: String,
}

#[derive(Debug)]
struct Car {
    max_rpm: f32,
    idle_rpm: f32,
    gears: u8,
    name: String,
}

#[derive(Debug, Default)]
pub struct Known {
    stages: Vec<Stage>,
    cars: Vec<Car>,
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
            .filter_map(|s| Some(Stage { length_m: s["length_m"].as_f64()? as f32, name: s["name"].as_str()?.to_string() }))
            .collect();
        let cars = items("cars")
            .iter()
            .filter_map(|c| {
                Some(Car {
                    max_rpm: c["max_rpm"].as_f64()? as f32,
                    idle_rpm: c["idle_rpm"].as_f64()? as f32,
                    gears: c["gears"].as_u64()? as u8,
                    name: c["name"].as_str()?.to_string(),
                })
            })
            .collect();
        Self { stages, cars }
    }

    /// The stage's name, or one made from its length.
    pub fn stage_name(&self, length_m: f32) -> String {
        self.stages
            .iter()
            .find(|s| (s.length_m - length_m).abs() <= LENGTH_TOLERANCE_M)
            .map(|s| s.name.clone())
            .unwrap_or_else(|| format!("Unknown stage {:.2} km", length_m / 1000.0))
    }

    /// The car's name, or one made from its engine.
    pub fn car_name(&self, max_rpm: f32, idle_rpm: f32, gears: u8) -> String {
        self.cars
            .iter()
            .find(|c| c.gears == gears && (c.max_rpm - max_rpm).abs() <= RPM_TOLERANCE && (c.idle_rpm - idle_rpm).abs() <= RPM_TOLERANCE)
            .map(|c| c.name.clone())
            .unwrap_or_else(|| format!("Unknown car ({gears} gears, {:.0} rpm)", max_rpm))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIST: &str = r#"{
        "stages": [{"length_m": 2845.6, "name": "Test Stage"}],
        "cars": [{"max_rpm": 7330.0, "idle_rpm": 1466.0, "gears": 6, "name": "Test Car"}]
    }"#;

    #[test]
    fn a_known_stage_and_car_are_named_within_the_tolerance() {
        let k = Known::parse(LIST);
        assert_eq!(k.stage_name(2845.63), "Test Stage");
        assert_eq!(k.stage_name(2847.0), "Test Stage");
        assert_eq!(k.car_name(7330.4, 1466.1, 6), "Test Car");
    }

    #[test]
    fn anything_else_gets_a_name_made_from_the_numbers() {
        let k = Known::parse(LIST);
        assert_eq!(k.stage_name(9666.5), "Unknown stage 9.67 km");
        assert_eq!(k.car_name(7330.0, 1466.0, 5), "Unknown car (5 gears, 7330 rpm)");
        assert_eq!(k.car_name(6500.0, 1466.0, 6), "Unknown car (6 gears, 6500 rpm)");
    }

    #[test]
    fn the_bundled_list_parses() {
        let _ = Known::bundled();
        assert!(serde_json::from_str::<serde_json::Value>(include_str!("known.json")).is_ok());
    }
}
