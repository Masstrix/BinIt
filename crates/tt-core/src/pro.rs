//! Pro-lap challenges: beat, or get close to, a lap a real driver set.
//!
//! The challenges themselves are `crates/tt-core/pro_challenges.toml`, compiled into the app. A lap counts towards
//! one only while that challenge is switched on (it belongs to the seat, so it stays on when another driver sits
//! down) and only when it is a valid lap on the challenge's track, layout and car (or car class). Every such lap is
//! an ordinary lap on the normal boards as well; `pro_attempts` just links it to the challenge. See
//! docs/real-world-benchmarks.md for where the times come from.

use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::catalogue::{Seed, norm};
use crate::model::{Awards, Combo, DriverId, Lap, LapId, Timestamp};
use crate::progress::{self, Pay};
use crate::store::Store;

/// The setting that holds the id of the challenge that is switched on (absent: none).
pub const ACTIVE_SETTING: &str = "pro_active";

/// A challenge as the app uses it: everything resolved (the time in milliseconds, the margin and rewards filled in
/// from the file's defaults). What is written in `pro_challenges.toml` is [`RawChallenge`], which is easier to type.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProChallenge {
    pub id: String,
    /// A challenge that is switched off in the file is kept (and checked) but is not shown, cannot be switched on and
    /// counts no laps. Not sent to the UI: it only ever sees enabled ones.
    #[serde(skip)]
    pub enabled: bool,
    pub name: String,
    /// The games it can be driven in. Empty means any game.
    pub games: Vec<String>,
    /// The track as the app shows it (the first one written).
    pub track: String,
    /// What the file wrote for the track: one name or several, each may use `*` ("Bathurst*").
    pub tracks: Vec<String>,
    /// Those, plus every alias in `track_aliases.toml` for them: the spellings a lap's track is matched against.
    #[serde(default)]
    pub track_patterns: Vec<String>,
    /// The layout shown for it (the first one when several are accepted). Empty = any layout.
    pub layout: String,
    /// Every layout name a lap may be on: one game calls it "GP", another's track file calls it "day". Empty = any
    /// layout does, and only the track has to match.
    pub layouts: Vec<String>,
    /// One specific car (the catalogue's name for it)...
    pub car: Option<String>,
    /// ...or any car of this catalogue class (`GT3`).
    pub class: Option<String>,
    pub time_ms: u32,
    /// A lap this far (in percent) behind the pro time is "pro level".
    pub margin_percent: f64,
    /// The slowest lap that is still pro level.
    pub limit_ms: u32,
    pub rewards: ProRewards,
    pub driver: String,
    /// `YYYY-MM`.
    pub date: String,
    pub real_car: String,
    pub session: String,
    /// `A` (notarised or official timing), `B` (maker test or a named magazine test), `C` (single secondary source).
    pub confidence: String,
    pub source: String,
    pub about: String,
    /// The picture in `app/public/challenge-art/`, with its file extension (`monza.jpg`).
    pub art: Option<String>,
    /// CSS `object-position` for the picture on the detail page's banner (`"60% 40%"`), when the file sets one.
    pub art_offset: Option<String>,
    /// The same for the tall card in the list; the banner's when the file sets only that one.
    pub card_offset: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProRewards {
    /// Paid the first time a counted lap is within the margin.
    pub pro_level: Pay,
    /// Paid the first time a counted lap is faster than the pro.
    pub beat: Pay,
}

// ---- what is written in the file ----------------------------------------------------------------------------------

/// One value or a list of them: `"acevo"` or `["acevo", "ac"]`.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum OneOrMany {
    One(String),
    Many(Vec<String>),
}

/// A paragraph, or its lines (so a long text can be wrapped in the file; the lines are joined with a space).
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum Text {
    One(String),
    Lines(Vec<String>),
}

/// A lap time: `"6:49.328"`, whole milliseconds, or its parts (`{ "min": 6, "sec": 49, "ms": 328 }`).
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum TimeSpec {
    Text(String),
    Ms(u32),
    Parts(TimeParts),
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
struct TimeParts {
    #[serde(alias = "h", alias = "hr", alias = "hrs")]
    hours: u32,
    #[serde(alias = "m", alias = "min", alias = "mins", alias = "minute")]
    minutes: u32,
    #[serde(alias = "s", alias = "sec", alias = "secs", alias = "second")]
    seconds: u32,
    #[serde(alias = "milliseconds", alias = "millis")]
    ms: u32,
}

/// Where in a picture to centre it when it is cropped: `"60% 40%"`, `[60, 40]`, `{ "x": 60, "y": 40 }`, or words
/// (`"left"`, `"right top"`). The first number is across (0 left, 100 right), the second is down (0 top, 100 bottom).
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum OffsetSpec {
    Text(String),
    Pair(Vec<f64>),
    Xy { x: f64, y: f64 },
}

impl OffsetSpec {
    /// As the CSS `object-position` the UI uses (`"60% 40%"`).
    fn css(&self) -> Result<String, String> {
        let bad = || "a picture offset is two numbers, across then down, from 0 to 100 (for example \"60% 40%\")".to_string();
        let word = |t: &str| -> Option<f64> {
            let t = t.trim().trim_end_matches('%');
            match t.to_ascii_lowercase().as_str() {
                "left" | "top" => Some(0.0),
                "center" | "centre" => Some(50.0),
                "right" | "bottom" => Some(100.0),
                n => n.parse::<f64>().ok(),
            }
        };
        let (x, y) = match self {
            OffsetSpec::Xy { x, y } => (*x, *y),
            OffsetSpec::Pair(v) if v.len() == 2 => (v[0], v[1]),
            OffsetSpec::Pair(_) => return Err(bad()),
            OffsetSpec::Text(t) => {
                let parts: Vec<&str> = t.split_whitespace().collect();
                match parts.as_slice() {
                    [x] => (word(x).ok_or_else(bad)?, 50.0),
                    [x, y] => (word(x).ok_or_else(bad)?, word(y).ok_or_else(bad)?),
                    _ => return Err(bad()),
                }
            }
        };
        if !x.is_finite() || !y.is_finite() {
            return Err(bad());
        }
        Ok(format!("{}% {}%", x.clamp(0.0, 100.0), y.clamp(0.0, 100.0)))
    }
}

/// Rewards of one challenge; anything left out comes from the file's defaults.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawRewards {
    pro_level: Option<Pay>,
    beat: Option<Pay>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawChallenge {
    id: String,
    /// `false` keeps the challenge in the file but switched off (default: on).
    #[serde(default = "default_enabled")]
    enabled: bool,
    name: String,
    /// One game, a list of games, or `"any"` (also what leaving it out means).
    #[serde(default, alias = "games")]
    game: Option<OneOrMany>,
    /// One name, or several, each of which may use `*` as "anything".
    track: OneOrMany,
    /// One layout, or a list of the names it goes by in the different games.
    #[serde(default)]
    layout: Option<OneOrMany>,
    #[serde(default)]
    car: Option<String>,
    #[serde(default)]
    class: Option<String>,
    #[serde(alias = "timeMs")]
    time: TimeSpec,
    #[serde(default)]
    margin_percent: Option<f64>,
    #[serde(default)]
    rewards: Option<RawRewards>,
    driver: String,
    #[serde(default)]
    date: String,
    real_car: String,
    session: String,
    confidence: String,
    source: String,
    about: Text,
    #[serde(default)]
    art: Option<String>,
    /// Where to centre the picture on the detail page's wide banner.
    #[serde(default)]
    art_offset: Option<OffsetSpec>,
    /// Where to centre it on the tall card in the list (a tall card shows a narrow slice of a wide picture, so this
    /// matters most). Defaults to `artOffset`.
    #[serde(default)]
    card_offset: Option<OffsetSpec>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawFile {
    /// The margin and rewards a challenge uses unless it sets its own (a file of your own can leave these out and
    /// use the bundled ones).
    #[serde(default)]
    margin_percent: Option<f64>,
    #[serde(default)]
    rewards: Option<ProRewards>,
    challenges: Vec<RawChallenge>,
}

fn default_margin() -> f64 {
    3.0
}

fn default_enabled() -> bool {
    true
}

/// `"6:49.328"` to milliseconds. Also `"1:02:03.456"`, `"49.3"` (seconds), `"6:49"` and `"7:40.7"` (a short fraction
/// is tenths and hundredths of a second, not milliseconds).
pub fn parse_time(text: &str) -> Result<u32, String> {
    let bad = || format!("\"{text}\" is not a lap time (write it like 6:49.328)");
    let text = text.trim();
    let mut parts: Vec<&str> = text.split(':').collect();
    let seconds = parts.pop().filter(|s| !s.is_empty()).ok_or_else(bad)?;
    if parts.len() > 2 {
        return Err(bad());
    }
    let (whole, fraction) = seconds.split_once('.').unwrap_or((seconds, ""));
    let digits = |s: &str| s.chars().all(|c| c.is_ascii_digit());
    if whole.is_empty() || !digits(whole) || !digits(fraction) || fraction.len() > 3 {
        return Err(bad());
    }
    let ms: u64 = format!("{fraction:0<3}").parse().map_err(|_| bad())?;
    let mut total: u64 = whole.parse::<u64>().map_err(|_| bad())? * 1000 + ms;
    for (i, p) in parts.iter().rev().enumerate() {
        let n: u64 = p.trim().parse().map_err(|_| bad())?;
        total += n * 60_000 * 60u64.pow(i as u32);
    }
    u32::try_from(total).map_err(|_| bad())
}

impl TimeSpec {
    fn ms(&self) -> Result<u32, String> {
        match self {
            TimeSpec::Text(t) => parse_time(t),
            TimeSpec::Ms(ms) => Ok(*ms),
            TimeSpec::Parts(p) => u32::try_from(u64::from(p.hours) * 3_600_000 + u64::from(p.minutes) * 60_000 + u64::from(p.seconds) * 1000 + u64::from(p.ms))
                .map_err(|_| "that lap time is too long".to_string()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProRules {
    /// The margin challenges use unless they set their own.
    pub margin_percent: f64,
    /// The rewards challenges use unless they set their own.
    pub rewards: ProRewards,
    pub challenges: Vec<ProChallenge>,
}

fn clean(p: Pay) -> Pay {
    Pay { xp: p.xp.max(0), coins: p.coins.max(0) }
}

/// The slowest lap that is still pro level: the pro time plus the margin.
pub fn limit_ms(time_ms: u32, margin_percent: f64) -> u32 {
    (f64::from(time_ms) * (1.0 + margin_percent / 100.0)).floor() as u32
}

/// Whether `text` fits `pattern`, where `*` means "anything". Capitals, spaces and punctuation never matter
/// (`"Bathurst*"` fits `bathurst_fm7`; `"GP"` fits `gp`), and an empty pattern fits only an empty text.
pub fn glob_match(pattern: &str, text: &str) -> bool {
    let text = norm(text);
    let parts: Vec<String> = pattern.split('*').map(norm).collect();
    if parts.len() == 1 {
        return parts[0] == text;
    }
    let (first, last) = (&parts[0], &parts[parts.len() - 1]);
    if !text.starts_with(first.as_str()) || text.len() < first.len() + last.len() || !text.ends_with(last.as_str()) {
        return false;
    }
    let mut rest = &text[first.len()..text.len() - last.len()];
    for part in &parts[1..parts.len() - 1] {
        match rest.find(part.as_str()) {
            Some(at) => rest = &rest[at + part.len()..],
            None => return false,
        }
    }
    true
}

/// Reads a config file's text: TOML, or JSON when it starts with `{` (the format these files used to be in, and handy
/// for tests), so a file of your own written either way works.
fn read_text<T: serde::de::DeserializeOwned>(text: &str) -> Result<T, String> {
    let text = text.trim_start_matches('\u{feff}');
    if text.trim_start().starts_with('{') {
        serde_json::from_str(text).map_err(|e| e.to_string())
    } else {
        toml::from_str(text).map_err(|e| e.to_string())
    }
}

/// Track name -> every spelling a game reports for it (see `track_aliases.toml`).
pub type TrackAliases = std::collections::BTreeMap<String, Vec<String>>;

fn parse_aliases(text: &str) -> Result<TrackAliases, String> {
    let raw: std::collections::BTreeMap<String, OneOrMany> = read_text(text)?;
    Ok(raw
        .into_iter()
        .filter(|(name, _)| !name.starts_with('_'))
        .map(|(name, spellings)| {
            let list = match spellings {
                OneOrMany::One(s) => vec![s],
                OneOrMany::Many(l) => l,
            };
            (name, list)
        })
        .collect())
}

static ALIASES: LazyLock<TrackAliases> =
    LazyLock::new(|| parse_aliases(include_str!("../track_aliases.toml")).unwrap_or_else(|e| panic!("crates/tt-core/track_aliases.toml is not valid: {e}")));

impl ProRules {
    /// Gives every challenge the spellings of its track: what it wrote, plus the aliases filed under the same name.
    fn resolve_tracks(&mut self, aliases: &TrackAliases) {
        for c in &mut self.challenges {
            c.track_patterns = c.tracks.clone();
            for (name, spellings) in aliases {
                if c.tracks.iter().any(|t| !t.contains('*') && norm(t) == norm(name)) {
                    for sp in spellings {
                        if !c.track_patterns.contains(sp) {
                            c.track_patterns.push(sp.clone());
                        }
                    }
                }
            }
        }
    }

    /// Reads a whole file. A mistake is named with the challenge it is in, so it is easy to find.
    pub fn from_json(text: &str) -> Result<Self, String> {
        Self::parse(text, None)
    }

    /// `fallback` is the margin and rewards to use when the file does not give its own.
    fn parse(text: &str, fallback: Option<(f64, &ProRewards)>) -> Result<Self, String> {
        let file: RawFile = read_text(text)?;
        let margin_percent = file.margin_percent.or(fallback.map(|f| f.0)).unwrap_or_else(default_margin).clamp(0.0, 50.0);
        let given = file.rewards.or_else(|| fallback.map(|f| f.1.clone())).ok_or("set \"rewards\": what pro level and beating the pro pay")?;
        let rewards = ProRewards { pro_level: clean(given.pro_level), beat: clean(given.beat) };
        let mut challenges: Vec<ProChallenge> = Vec::new();
        for raw in file.challenges {
            let id = raw.id.clone();
            let err = |e: String| format!("challenge \"{id}\": {e}");
            if challenges.iter().any(|c| c.id == raw.id) {
                return Err(err("this id is used twice".into()));
            }
            if raw.car.is_some() == raw.class.is_some() {
                return Err(err("set either \"car\" or \"class\"".into()));
            }
            let time_ms = raw.time.ms().map_err(err)?;
            if time_ms == 0 {
                return Err(err("the time must be more than zero".into()));
            }
            let margin = raw.margin_percent.unwrap_or(margin_percent).clamp(0.0, 50.0);
            let own = raw.rewards.unwrap_or_default();
            let art_offset = raw.art_offset.as_ref().map(OffsetSpec::css).transpose().map_err(err)?;
            let card_offset = raw.card_offset.as_ref().map(OffsetSpec::css).transpose().map_err(err)?;
            let tracks = match raw.track {
                OneOrMany::One(t) => vec![t],
                OneOrMany::Many(t) => t,
            };
            if tracks.is_empty() || tracks.iter().any(|t| t.trim().is_empty()) {
                return Err(err("set a \"track\"".into()));
            }
            // Left out, empty or an empty list: any layout will do, so only the track has to match.
            let layouts: Vec<String> = match raw.layout {
                None => Vec::new(),
                Some(OneOrMany::One(l)) => vec![l],
                Some(OneOrMany::Many(l)) => l,
            }
            .into_iter()
            .filter(|l| !l.trim().is_empty())
            .collect();
            let games = match raw.game {
                None => Vec::new(),
                Some(OneOrMany::One(g)) => vec![g],
                Some(OneOrMany::Many(g)) => g,
            };
            // "any" anywhere in the list means any game.
            let games = if games.iter().any(|g| g.trim().eq_ignore_ascii_case("any")) { Vec::new() } else { games.into_iter().map(|g| g.trim().to_string()).collect() };
            challenges.push(ProChallenge {
                id: raw.id,
                enabled: raw.enabled,
                name: raw.name,
                games,
                track: tracks[0].clone(),
                track_patterns: tracks.clone(),
                tracks,
                layout: layouts.first().cloned().unwrap_or_default(),
                layouts,
                car: raw.car,
                class: raw.class,
                time_ms,
                margin_percent: margin,
                limit_ms: limit_ms(time_ms, margin),
                rewards: ProRewards { pro_level: own.pro_level.map_or(rewards.pro_level, clean), beat: own.beat.map_or(rewards.beat, clean) },
                driver: raw.driver,
                date: raw.date,
                real_car: raw.real_car,
                session: raw.session,
                confidence: raw.confidence,
                source: raw.source,
                about: match raw.about {
                    Text::One(t) => t,
                    Text::Lines(lines) => lines.join(" "),
                },
                art: raw.art,
                art_offset: art_offset.clone(),
                card_offset: card_offset.or(art_offset),
            });
        }
        Ok(ProRules { margin_percent, rewards, challenges })
    }
}

static RULES: LazyLock<ProRules> = LazyLock::new(|| {
    let mut rules = ProRules::from_json(include_str!("../pro_challenges.toml")).unwrap_or_else(|e| panic!("crates/tt-core/pro_challenges.toml is not valid: {e}"));
    rules.resolve_tracks(&ALIASES);
    rules
});

/// The challenges that ship with the app: `crates/tt-core/pro_challenges.toml` as it was when the app was built.
pub fn rules() -> &'static ProRules {
    &RULES
}

/// The file you can put in the app's data folder to add challenges (or change a bundled one: the same `id` replaces it).
pub const FILE_NAME: &str = "pro_challenges.toml";
/// Your own names for tracks, next to it: adds to the bundled `track_aliases.toml`.
pub const ALIASES_FILE: &str = "track_aliases.toml";

/// The text of a config file in `dir`: its `.toml`, or failing that a `.json` of the same name (the older format).
/// `None` when there is neither; otherwise the file's name (for naming a mistake) and what reading it gave.
fn read_file(dir: &Path, name: &str) -> Option<(String, std::io::Result<String>)> {
    let json = format!("{}.json", name.trim_end_matches(".toml"));
    for file in [name.to_string(), json] {
        match std::fs::read_to_string(dir.join(&file)) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            result => return Some((file, result)),
        }
    }
    None
}
/// The pictures for your own challenges go in this folder next to it.
pub const ART_DIR: &str = "challenge-art";

/// The challenges in force right now: the bundled ones plus the ones in the data folder.
#[derive(Debug, Clone, PartialEq)]
pub struct Loaded {
    pub rules: ProRules,
    /// What is wrong with the file in the data folder (it is left out until it is fixed); empty when all is well.
    pub problems: Vec<String>,
    pub folder: Option<PathBuf>,
}

/// Reads the bundled challenges and the file in `folder` (if there is one). Cheap enough to do every time the
/// challenges are looked at, so a change to the file shows up without restarting the app.
pub fn load(folder: Option<&Path>) -> Loaded {
    let mut rules = RULES.clone();
    let mut problems = Vec::new();
    if let Some(dir) = folder {
        match read_file(dir, FILE_NAME) {
            Some((file, Ok(text))) => match ProRules::parse(&text, Some((rules.margin_percent, &rules.rewards))) {
                Ok(mine) => {
                    for c in mine.challenges {
                        match rules.challenges.iter().position(|x| x.id == c.id) {
                            Some(i) => rules.challenges[i] = c,
                            None => rules.challenges.push(c),
                        }
                    }
                }
                Err(e) => problems.push(format!("{file}: {e}")),
            },
            Some((file, Err(e))) => problems.push(format!("{file}: could not be read ({e})")),
            None => {}
        }
    }
    let mut aliases = ALIASES.clone();
    if let Some(dir) = folder {
        match read_file(dir, ALIASES_FILE) {
            Some((file, Ok(text))) => match parse_aliases(&text) {
                Ok(mine) => {
                    for (name, spellings) in mine {
                        aliases.entry(name).or_default().extend(spellings);
                    }
                }
                Err(e) => problems.push(format!("{file}: {e}")),
            },
            Some((file, Err(e))) => problems.push(format!("{file}: could not be read ({e})")),
            None => {}
        }
    }
    rules.resolve_tracks(&aliases);
    Loaded { rules, problems, folder: folder.map(Path::to_path_buf) }
}

impl Loaded {
    /// The challenges that are switched on.
    pub fn enabled(&self) -> impl Iterator<Item = &ProChallenge> {
        self.rules.challenges.iter().filter(|c| c.enabled)
    }

    /// An enabled challenge by id.
    pub fn find(&self, id: &str) -> Option<&ProChallenge> {
        self.enabled().find(|c| c.id == id)
    }
}

/// A picture in the data folder's `challenge-art`, if there is one by that name. Only a plain file name is allowed.
pub fn art_path(folder: &Path, file: &str) -> Option<PathBuf> {
    let plain = !file.is_empty() && file.len() < 200 && !file.starts_with('.') && !file.contains(['/', '\\', ':']);
    let path = folder.join(ART_DIR).join(file);
    (plain && path.is_file()).then_some(path)
}

impl ProChallenge {
    /// Whether this challenge can be driven in `game`.
    pub fn in_game(&self, game: &str) -> bool {
        self.games.is_empty() || self.games.iter().any(|g| g == game)
    }

    /// Whether `track` (as a game reports it) is one this challenge's track goes by, including its aliases.
    fn on_track(&self, track: &str) -> bool {
        self.track_patterns.iter().any(|p| glob_match(p, track))
    }

    /// Whether a lap's layout is one the challenge accepts: any, when it names none (`*` works in a name too).
    fn on_layout(&self, layout: &str) -> bool {
        self.layouts.is_empty() || self.layouts.iter().any(|l| glob_match(l, layout))
    }

    /// Whether a lap on `combo` is on this challenge's track, layout and car (or car class). `seeds` are the
    /// catalogue lists, to look a car's class up.
    pub fn matches(&self, combo: &Combo, seeds: &[Seed]) -> bool {
        if !self.in_game(&combo.game) || !self.on_layout(&combo.layout) || !self.on_track(&combo.track) {
            return false;
        }
        if let Some(car) = &self.car {
            return norm(car) == norm(&combo.car);
        }
        let Some(class) = &self.class else { return false };
        let car = norm(&combo.car);
        seeds
            .iter()
            .flat_map(|s| &s.cars)
            .find(|c| norm(&c.name) == car)
            .and_then(|c| c.class.as_deref())
            .is_some_and(|c| c.eq_ignore_ascii_case(class))
    }
}

/// One driver's best counted lap on a challenge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProBest {
    pub driver_id: DriverId,
    pub time_ms: u32,
    pub lap_id: LapId,
    pub at: Timestamp,
    /// How many counted laps they have driven on it.
    pub attempts: u32,
}

/// A counted lap, for a driver's own list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProAttempt {
    pub lap_id: LapId,
    pub time_ms: u32,
    pub at: Timestamp,
}

/// A challenge with everyone's best counted lap, quickest first.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProEntry {
    #[serde(flatten)]
    pub challenge: ProChallenge,
    pub board: Vec<ProBest>,
}

/// Everything the Pro laps page needs.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProOverview {
    /// What is wrong with the file in the data folder, if anything.
    pub problems: Vec<String>,
    /// Where to put `pro_challenges.toml` and the `challenge-art` folder to add challenges of your own.
    pub folder: Option<String>,
    /// The challenge that is switched on (belongs to the seat).
    pub active: Option<String>,
    pub challenges: Vec<ProEntry>,
}

/// What a counted lap did for the pop-up and the overlay widget.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProLapResult {
    pub challenge_id: String,
    pub challenge_name: String,
    pub time_ms: u32,
    /// This lap minus the pro time: negative is faster than the pro.
    pub gap_ms: i64,
    pub pro_level: bool,
    pub beat: bool,
    /// How many counted laps this driver now has on it.
    pub attempt: u32,
    /// Their quickest counted lap so far.
    pub new_best: bool,
    /// The rewards were paid with this lap (they are paid once).
    pub paid_pro_level: bool,
    pub paid_beat: bool,
    /// Their place among everyone's best counted laps, and how many drivers have one.
    pub position: Option<u32>,
    pub drivers: u32,
}

fn level_kind(id: &str) -> String {
    format!("pro:level:{id}")
}

fn beat_kind(id: &str) -> String {
    format!("pro:beat:{id}")
}

/// Records `lap` as an attempt when `active` is a challenge it counts for, and pays what that earns. The XP and
/// coins are added to `awards`, so the lap's pop-up shows them with everything else the lap paid.
pub(crate) fn record_attempt(store: &Store, seeds: &[Seed], c: &ProChallenge, driver: DriverId, lap: &Lap, awards: &mut Awards, now: Timestamp) -> Result<Option<ProLapResult>> {
    if !lap.valid || lap.untimed_reason.is_some() || !c.matches(&lap.combo, seeds) {
        return Ok(None);
    }
    let best_before = store.pro_best(&c.id, driver)?;
    store.insert_pro_attempt(lap.id, &c.id, driver, lap.time_ms, now)?;

    let pro_level = lap.time_ms <= c.limit_ms;
    let beat = lap.time_ms < c.time_ms;
    let total_before = store.point_totals(driver)?.0;
    let mut paid = |kind: String, pay: Pay, reason: String| -> Result<bool> {
        if store.point_event_exists(driver, &kind)? {
            return Ok(false);
        }
        store.insert_point_event(driver, &kind, pay.xp, pay.coins, Some(lap.id), now)?;
        awards.xp += pay.xp;
        awards.coins += pay.coins;
        awards.reasons.push(reason);
        Ok(true)
    };
    let paid_pro_level = pro_level && paid(level_kind(&c.id), c.rewards.pro_level, format!("Pro level: {}", c.name))?;
    let paid_beat = beat && paid(beat_kind(&c.id), c.rewards.beat, format!("Beat the pro: {}", c.name))?;
    let level_after = progress::level_of(total_before + paid_total(&c.rewards, paid_pro_level, paid_beat));
    if level_after > progress::level_of(total_before) && awards.level_up.is_none_or(|l| l < level_after) {
        awards.level_up = Some(level_after);
    }

    let board = store.pro_board(&c.id)?;
    Ok(Some(ProLapResult {
        challenge_id: c.id.clone(),
        challenge_name: c.name.clone(),
        time_ms: lap.time_ms,
        gap_ms: i64::from(lap.time_ms) - i64::from(c.time_ms),
        pro_level,
        beat,
        attempt: store.pro_attempt_count(&c.id, driver)?,
        new_best: best_before.is_none_or(|b| lap.time_ms < b),
        paid_pro_level,
        paid_beat,
        position: board.iter().position(|b| b.driver_id == driver).map(|i| i as u32 + 1),
        drivers: board.len() as u32,
    }))
}

fn paid_total(rewards: &ProRewards, level: bool, beat: bool) -> i64 {
    (if level { rewards.pro_level.xp } else { 0 }) + (if beat { rewards.beat.xp } else { 0 })
}
