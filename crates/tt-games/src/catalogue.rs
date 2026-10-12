//! What each game contributes to the track and car catalogue.
//!
//! The catalogue itself (merging, matching, serving it to the UI) lives in `tt-core`. Everything that
//! is specific to one game lives in that game's module and is reached from here by game key:
//!
//! * `<game>/catalogue.json`: the bundled list of content we ship for that game,
//! * `<game>/documents.rs`: names found in the plain-text files that game writes to the user's
//!   Documents folder (never the game's binary content).

use std::path::Path;

/// Names a game's own plain-text files say the player has used. Spellings are the game's own, so a
/// match with telemetry is exact.
#[derive(Debug, Default)]
pub struct Observed {
    pub tracks: Vec<String>,
    /// `(track, layout)` pairs, for games whose files name layouts the way its telemetry does.
    pub track_layouts: Vec<(String, String)>,
    /// `(car, brand)`; the brand is when the file knows it.
    pub cars: Vec<(String, Option<String>)>,
}

/// The bundled catalogue JSON for a game (`{"tracks": [...], "cars": [...]}`), if we ship one.
pub fn seed_json(game: &str) -> Option<&'static str> {
    match game {
        "acevo" => Some(crate::acevo::CATALOGUE_JSON),
        "ac" => Some(crate::ac::CATALOGUE_JSON),
        "acr" => Some(crate::acr::CATALOGUE_JSON),
        "dr2" => Some(crate::dr2::CATALOGUE_JSON),
        _ => None,
    }
}

/// Scans a game's plain-text files under the user's Documents folder.
pub fn observe(game: &str, documents: &Path) -> Observed {
    match game {
        "acevo" => crate::acevo::documents::scan(&documents.join("ACE")),
        "ac" => crate::ac::documents::scan(&documents.join("Assetto Corsa")),
        _ => Observed::default(),
    }
}
