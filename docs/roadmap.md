# Roadmap

Planned work that is researched but not started. Newest ideas at the bottom of each section.

## Track & car catalogue and searchable pickers

**Status (2026-10-11):** first slices built. Decisions below were made while the owner was away; change any of them if you disagree.

### Decisions
1. **No game binaries, ever.** We don't read `content.kspkg`, `.nefs`, textures or any packed game data. Only plain-text sources: JSON the game writes to Documents, official telemetry, and files we ship. (Reading AC's own `ui_car.json`-style text files stays possible later, but isn't needed yet.)
2. **Catalogue = merge of four sources by normalised name** (`crates/tt-core/src/catalogue.rs`): bundled `data/<game>.json`, an optional user file `<app data>/catalogue/<game>.json` (same format; drop one in to add cars/tracks without a release), names seen in AC EVO's `Documents/ACE` (session results, last event), and everything ever driven.
3. **Names are exactly the telemetry's strings.** Laps and challenges match on them, so the catalogue never renames anything. `aliases` are search-only ("Bathurst" finds Mount Panorama). When a seeded entry is later driven, the game's spelling wins and ours becomes an alias. `seen` marks entries confirmed in-game; the picker shows "Not driven yet" on the rest.
4. **Layout names from AC EVO session results are ignored** (they differ from telemetry: `GP Time Attack` vs `GP`); only their track and car names are used.
5. **Track maps are learned, not imported.** `trackmap.rs` records the player's world x/z against lap progress and, on the first clean timed lap with at least 90% coverage and no big gaps, stores a 400-point outline per game/track/layout (`track_maps` table, schema v4). First map wins; later laps don't overwrite it. This works for any game that reports world position.
6. **Bundled AC EVO list is deliberately small** (only names we have seen or are sure of). The game can't be enumerated, so it fills in from play, results files and the user file. DiRT Rally 2.0 ships its 12 locations and a starter car list; those entries are unconfirmed until that adapter exists.
7. **One `Picker` component** replaces the Track/Car dropdowns on Challenges and Leaderboard: opens a dialog with an autofocused search box (every word must match name, brand, class, country or alias; accents ignored), filter chips (country / class), cards with a map thumbnail or brand badge, grouped by brand for cars, keyboard driven (arrows, Enter). Leaderboard pickers only list what has laps; the new-challenge form lists everything in the catalogue. Small fixed lists (period, date parts) stay `Dropdown`.
8. **Live map** (`LiveMap`) is on the Home page, so office browsers on the LAN see it too: the car dot moves on the learned map; before the map exists it shows lap progress and says the track is being learned. Position is part of the existing 10 Hz live event; no extra game polling.

### Pre-populated AC EVO list (2026-10-11)
AC EVO can't be enumerated from the install (everything is in the unreadable `content.kspkg`), so the bundled list comes from fan-maintained web lists current to update 0.8 (July 2026): 67 cars (simracingcockpit.gg) and 17 tracks (onlineracedriver.com, traxion.gg, update notes). Decided with the owner:
- **Tolerant name matching.** Every track and car the game reports is resolved to its catalogue entry before it's stored (`catalogue::resolve`): same letters/digits as the name or an alias, else exactly one entry whose words (2 or more) are contained in the incoming name or vice versa. So "Porsche 911 GT3 Cup (992)" and the fan list's "Porsche 992 GT3 Cup" are one car, while "Ferrari 296 GT3" and "Ferrari 296 GTB", or an ambiguous "BMW M2", never merge. Unresolvable names are kept as the game spelled them and show up as new learned entries.
- **Stored data is relabelled** to catalogue names at startup (`canonicalize_history`), so earlier laps join the same boards.
- **Tracks only, layouts learned.** Layout names are whatever the game sends; only ones seen in play (GP, East, Touristenfahrten) are listed. Layouts are never rewritten.
- Where the game's own spelling is known (Porsche 911 GT3 Cup (992), Mercedes-AMG GT2, Ferrari 488 Challenge Evo, Ferrari F2004, Dallara EXP), that is the catalogue name and the fan spelling is an alias. For the rest, the fan spelling is used until the game says otherwise; a drop-in `catalogue/acevo.json` can add aliases.
- To refresh the list after a game update: add new names to `crates/tt-core/data/acevo.json`.

### Not done yet
- Steam install detection and a Games page that lists installed games (no game process needed).
- Reading AC / EA WRC text files for full lists (`ui_car.json`, `ids.json`). Both are text, so allowed by decision 1.
- A `/live` full-screen page for an office TV; map zoom/trail; car images (none available without game files, so badges are used).
- AC EVO's real layout names for Brands Hatch, Nurburgring etc. are unconfirmed in the bundled list.
- Sector markers on the map, and a "records at this corner" overlay.
- Importing past AC EVO session results as laps (sector splits are there).

## Live & historical telemetry

**Goal:** see each lap on a track map, both live while someone drives and afterwards when comparing past laps ("where did Jess find 0.2s?").

### Data available
- AC EVO graphics page: `npos` (0–1 lap progress), `car_coordinates[60][3]` (world XYZ, player car via `player_car_id`), speed, gear, throttle/brake/steering percentages, current lap time, delta, valid flag. Physics page (333 Hz) has full vehicle dynamics if ever needed.
- AC / ACC shared memory, DiRT Rally 2.0 and EA WRC UDP telemetry all include world position, speed and inputs.

### Ideas
- **Learned track maps:** record world X/Z over one clean lap and store a simplified outline per track/layout. Works for every game, AC EVO included. Use AC's `map.png` until a lap has been recorded.
- **Live view:** car dot moving on the map, speed/throttle/brake traces, in the app and on office screens via the LAN page.
- **Lap traces:** keep a downsampled trace per lap (e.g. 10–20 Hz: distance, x/z, speed, throttle, brake, gear) for comparing two laps with overlaid speed graphs and a delta along the lap.
- **Sectors:** derive splits from `npos` for games that don't publish them; prefer the game's own splits where available.

### Driver inputs and the Telemetry page (2026-10-11)
- **Live:** the AC EVO graphics page's `inputs` block gives throttle, brake, clutch, handbrake and steering; `gear_int`, `display_speed_kmh` and `rpm` come from the same page. Observed on the rig: pedals 0..1, steering -1..1 (sign: negative = left, to be confirmed), clutch 0 on an automatic. They ride in the existing 10 Hz live event (`LiveView.inputs`); no extra polling.
- **Per lap:** `ProfileRecorder` also keeps the inputs at every sample (about 20 Hz) and `finish_trace` returns a `LapTrace` under the same rules as the timing profile (a lap that wasn't sampled well has neither). Stored as one blob per lap in `laps.trace` (schema v5): 13 bytes a sample, around 25 KB for a 90 s lap. `GET /api/laps/{id}/trace` returns rows of `[progress, elapsedMs, speedKmh, throttle, brake, clutch, steering, gear]`.
- **What is kept (decided 2026-10-11):** every lap's row (time, sectors, validity) is kept forever: it's tiny and drives progression over time. The heavy input trace is kept **only for proper timed laps** (not cut, in, out or partial laps), with no cap and no pruning, so every valid lap stays fully comparable. A car that isn't moving adds no samples. No lossy downsampling. Lossless compression of stored traces is a possible later step once real sizes are measured (expected several times smaller); the blob has a version byte so it can be added without breaking old rows.
- **Versions and upgrades:** three separate things, each for its own job. (1) The database *format* is SQLite's `user_version` (`SCHEMA_VERSION` in `store.rs`); every table or column change adds a numbered migration, and a database made by a *newer* format is refused with a clear message (the app shows a dialog) instead of being downgraded. (2) Stored blobs carry their own version byte (`LapTrace` is v1), so a new encoding such as compression can be read alongside the old one and old rows can be converted lazily or not at all. (3) The *app* version (from `Cargo.toml`) is recorded in the database as `created_with` and `last_opened_with` and shown on the Advanced page, for support and to see what a data folder has been through. Measured on the first real traces: about 13 KB for a 54 s lap; plain deflate only gets that down about 1.7x, so compression is not worth doing yet.
- **Telemetry page** (`#/telemetry`): the live map with sector colours next to gear, speed, rpm, pedal bars, a steering bar and a rolling 10 s trace. Works on phones.
- **Not done yet:** comparing two laps' traces (speed / throttle / brake against distance with a delta), an overlay widget version, (gear numbers: the game reports 0 = reverse, 1 = neutral, 2 = first, and the adapter shifts them down by one so Bin It uses -1 = reverse, 0 = neutral, 1 = first).

### Future: which way the car is facing (noted 2026-10-14)
- **Goal:** draw cars on the track maps (live map, telemetry minimap, challenge race replay) as arrows pointing where the car is actually facing, so spins and big slides show up in replays.
- **Today:** nothing records it. Lap traces hold progress, time, speed, inputs and gear; live data has world position only. No adapter reads heading or yaw.
- **To do:** read the car's heading wherever a game publishes it (AC EVO's physics page has it; check AC, ACC, DiRT Rally 2.0 and EA WRC telemetry too), carry it in the live event and add it to `LapTrace` as a new blob version, so older laps still read.
- **Watch for:** the angle must go through the same rotate and mirror as the map (AC EVO's map axes are mirrored); interpolate between samples the short way round across ±180°.
- **Fallback:** laps and games without a heading point the arrow along the track outline at the car's position (the same direction the map's "turn with the car" view uses). That arrow can ship first on its own; the recorded heading then just swaps its angle source.

### Performance constraints
- Keep the adapter's 20 Hz polling. Recording a trace must not add game-thread work: copy the few fields we need, then batch-write to SQLite off the poll thread.
- Store traces compactly (e.g. one blob per lap); expect around 100 KB per lap at 20 Hz.
- The overlay stays minimal (max two widgets). Rich telemetry views belong in the app and LAN pages, not over the game.
