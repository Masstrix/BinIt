# Roadmap

Planned work that is researched but not started. Newest ideas at the bottom of each section.

## Visual track & car selection (content catalogue)

**Goal:** pick tracks and cars from images (car previews, badges, track maps) instead of plain names, in challenge setup, leaderboard filters and anywhere else a combo is chosen. It should work without the game running.

### Finding installed games
- Read Steam's `steamapps/libraryfolders.vdf` and `appmanifest_<appid>.acf` to see which supported games are installed and where. No game process is needed.
- Steam app ids: AC `244210`, AC EVO `3058630`, DiRT Rally 2.0 `690790`, EA WRC `1849250`, ACC `805550`.
- Show installed games on the Games page even when nothing is running.

### What each game exposes (checked 2026-10-10 on the rig PC)

| Game | Source | Contents |
|---|---|---|
| Assetto Corsa | `content/cars/*/ui/ui_car.json`, `badge.png`, `skins/*/preview.jpg`; `content/tracks/*/ui[/<layout>]/ui_track.json`, `preview.png`, `outline.png`, `map.png` | Everything, including mods: names, brand, class, specs, images, track length/country, maps per layout. 254 cars and 31 tracks on the rig. |
| EA WRC | `Documents/My Games/WRC/telemetry/readme/ids.json` (UTF-16, official) | 103 vehicles, 20 classes, 35 manufacturers, 20 locations, 264 routes (stages). Names only, no images. Also needed to decode telemetry ids. |
| DiRT Rally 2.0 | `locations/*.nefs`, `cars/*.nefs` (packed) | File names only (e.g. `finland__finland_rally_01`, `037`). Ship our own name list. |
| AC EVO | `content.kspkg` (69 GB, obfuscated) | Not readable, and we won't try to decrypt it (game terms, and it breaks every update). Use the sources below instead. |

### AC EVO without the content package
- `Documents/ACE/Results/*.sessionresults.json`: per session, with track, layout, car brand/name, best lap, laps and **sector splits** (e.g. `["00:49.800","00:33.654","00:40.797"]`). Use this to add sectors to recorded laps and to import past sessions.
- `Documents/ACE/last_season.seasondefinition.json`: track metadata (name, nation, coordinates, internal folder path) for the last loaded event.
- Build the catalogue from what's been driven, plus a starter list we maintain. Images would be our own or user-supplied.

### Plan
1. Steam install detection plus a `Catalogue` per game adapter (cars, tracks/layouts, image paths), cached in SQLite.
2. Serve catalogue images from the local server (read from the game folder; never redistributed).
3. Visual pickers in the UI: car grid with previews/badges, track grid with maps.
4. Import AC EVO session results (sectors, history).

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

### Performance constraints
- Keep the adapter's 20 Hz polling. Recording a trace must not add game-thread work: copy the few fields we need, then batch-write to SQLite off the poll thread.
- Store traces compactly (e.g. one blob per lap); expect around 100 KB per lap at 20 Hz.
- The overlay stays minimal (max two widgets). Rich telemetry views belong in the app and LAN pages, not over the game.
