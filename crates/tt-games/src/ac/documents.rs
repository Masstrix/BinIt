//! Names found in the plain-text files Assetto Corsa keeps under `Documents/Assetto Corsa`:
//!
//! * `cfg/race.ini`: the track, layout and car of the last race that was set up,
//! * `personalbest.ini`: one `[car@track-layout]` section for everything the player has set a best
//!   lap on.
//!
//! Both use the game's own folder names in the same spelling the telemetry reports (lowercased here,
//! since `personalbest.ini` writes them in capitals). Installed mods show up as well, which is the
//! point: nothing we could bundle lists them.

use std::path::Path;

use crate::catalogue::Observed;

pub fn scan(dir: &Path) -> Observed {
    let mut out = Observed::default();
    if let Ok(text) = std::fs::read_to_string(dir.join("cfg").join("race.ini")) {
        parse_race_ini(&text, &mut out);
    }
    if let Ok(text) = std::fs::read_to_string(dir.join("personalbest.ini")) {
        parse_personal_best(&text, &mut out);
    }
    out
}

/// `[RACE]` with `TRACK`, `CONFIG_TRACK` (the layout) and `MODEL` (the car).
fn parse_race_ini(text: &str, out: &mut Observed) {
    let (mut track, mut layout, mut car) = (String::new(), String::new(), String::new());
    let mut in_race = false;
    for line in text.lines().map(str::trim) {
        if let Some(section) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            in_race = section.eq_ignore_ascii_case("RACE");
        } else if in_race && let Some((key, value)) = line.split_once('=') {
            let value = value.trim().to_lowercase();
            match key.trim().to_ascii_uppercase().as_str() {
                "TRACK" => track = value,
                "CONFIG_TRACK" => layout = value,
                "MODEL" => car = value,
                _ => {}
            }
        }
    }
    if !track.is_empty() {
        out.tracks.push(track.clone());
        if !layout.is_empty() {
            out.track_layouts.push((track, layout));
        }
    }
    if !car.is_empty() {
        out.cars.push((car, None));
    }
}

/// Sections look like `[KS_AUDI_R8_LMS_2016@KS_NURBURGRING-LAYOUT_GP_B]`: the car, then the track and
/// its layout joined by a dash. A track whose own folder name has a dash (`trento-bondone`) can't be
/// told apart from a layout by looking at the text, so those are matched against our bundled list first.
fn parse_personal_best(text: &str, out: &mut Observed) {
    let known = known_tracks();
    for line in text.lines().map(str::trim) {
        let Some(section) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) else { continue };
        let Some((car, track_and_layout)) = section.split_once('@') else { continue };
        let (car, whole) = (car.trim().to_lowercase(), track_and_layout.trim().to_lowercase());
        if car.is_empty() || whole.is_empty() {
            continue;
        }
        out.cars.push((car, None));
        let (track, layout) = if known.contains(&whole) {
            (whole, String::new())
        } else {
            match whole.split_once('-') {
                Some((t, l)) => (t.to_string(), l.to_string()),
                None => (whole, String::new()),
            }
        };
        out.tracks.push(track.clone());
        if !layout.is_empty() {
            out.track_layouts.push((track, layout));
        }
    }
}

/// Folder names of the tracks in the bundled list.
fn known_tracks() -> Vec<String> {
    serde_json::from_str::<serde_json::Value>(super::CATALOGUE_JSON)
        .ok()
        .and_then(|v| v.get("tracks").and_then(|t| t.as_array()).cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|t| t.get("name").and_then(|n| n.as_str()).map(str::to_lowercase))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_last_race_gives_a_track_layout_and_car() {
        let mut o = Observed::default();
        parse_race_ini("[RACE]\nTRACK=hampton_downs_motorsport_park\nCONFIG_TRACK=international\nMODEL=urd_radical_sr3xxr_2023\nCARS=1\n[GHOST_CAR]\nTRACK=ignored\n", &mut o);
        assert_eq!(o.tracks, vec!["hampton_downs_motorsport_park"]);
        assert_eq!(o.track_layouts, vec![("hampton_downs_motorsport_park".to_string(), "international".to_string())]);
        assert_eq!(o.cars, vec![("urd_radical_sr3xxr_2023".to_string(), None)]);
    }

    #[test]
    fn personal_bests_name_cars_tracks_and_layouts_in_lowercase() {
        let mut o = Observed::default();
        parse_personal_best(
            "[KS_AUDI_R8_LMS_2016@KS_NURBURGRING-LAYOUT_GP_B]\nDATE=1\nTIME=140365\n\n[FERRARI_F40@MONZA]\nTIME=1\n\n[KS_MAZDA_MX5_CUP@TRENTO-BONDONE]\nTIME=1\n",
            &mut o,
        );
        let cars: Vec<_> = o.cars.iter().map(|c| c.0.as_str()).collect();
        assert_eq!(cars, vec!["ks_audi_r8_lms_2016", "ferrari_f40", "ks_mazda_mx5_cup"]);
        assert!(o.track_layouts.contains(&("ks_nurburgring".to_string(), "layout_gp_b".to_string())));
        assert!(o.tracks.contains(&"monza".to_string()));
        // A dash inside a track's own folder name is not a layout.
        assert!(o.tracks.contains(&"trento-bondone".to_string()));
        assert!(!o.tracks.contains(&"trento".to_string()));
    }
}
