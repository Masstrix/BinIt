//! Names found in AC EVO's plain-text files under `Documents/ACE`: session results and the last
//! loaded event. Layout names there differ from telemetry's, so only tracks and cars are taken.

use std::path::Path;

use crate::catalogue::Observed;

pub fn scan(dir: &Path) -> Observed {
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

#[cfg(test)]
mod tests {
    use super::*;

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
        let o = scan(dir.path());
        assert!(o.tracks.contains(&"Suzuka".to_string()) && o.tracks.contains(&"Brands Hatch".to_string()));
        assert_eq!(o.cars, vec![("Dallara EXP".to_string(), Some("Dallara".to_string()))]);
    }
}
