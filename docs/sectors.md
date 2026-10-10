# Sectors & live timing

How TimeTrial records sector times for every kind of game, and drives live timing
(delta to best, sector indicators) in the overlay.

## The problem

Games expose sectors very differently:

| Game | Game-reported sectors | Position along the lap / stage |
|---|---|---|
| AC EVO | None live. `Documents/ACE/Results/*.sessionresults.json` has 3 splits for each driver's best lap, after the session | `npos` 0–1 (graphics page) |
| Assetto Corsa / ACC | Live: `currentSectorIndex`, `lastSectorTime` (+ sector count in the static page) | `normalizedCarPosition` |
| DiRT Rally 2.0 | None | Lap/stage distance + track length (UDP, `extradata=3`) |
| EA WRC | Live: `stage_previous_split_time` (game-defined split count) | `stage_current_distance`, `stage_length`, `stage_progress` |

Circuits usually have 3 sectors; rally stages have anything from 2 to 8+ splits.

## The model: a timing profile per lap

For every completed lap (or stage run) we store a **timing profile**: the elapsed time
(ms) at which the car reached each 0.5% of the distance, i.e. 201 points from 0% to
100% (≈800 bytes). It's built from the adapter's position samples (20 Hz) by linear
interpolation.

Everything else is derived from the profile:

- **Sector times** for *any* set of boundaries: `t(b[i+1]) - t(b[i])`.
- **Live delta**: current elapsed time minus the reference lap's time at the same
  progress.
- **Re-splitting**: when better boundaries are learned (e.g. the game's real sector
  lines), past laps are re-split exactly, because the profile is kept.

## Sector layouts

Each combo (game, track, layout) has a **sector layout**: the boundaries as fractions
of the distance, e.g. `[0.0, 0.31, 0.68, 1.0]`, plus where they came from:

| Source | Used when |
|---|---|
| `game` | The game reports splits live (AC, ACC, WRC): the progress at which each split arrives is recorded, and the game's own split times are stored as-is. |
| `learned` | Boundaries recovered from game data after the fact (AC EVO results file: find where the stored profile reaches each reported split). |
| `even` | Fallback: circuits get 3 equal sectors; rally stages get one sector per ~2 km of stage length, clamped to 4–8. |

A later, better source replaces an earlier one (`even` → `learned` → `game`), and
existing laps are re-split from their profiles.

## Colours (timing-screen convention)

- **Purple**: fastest sector anyone has set on this combo.
- **Green**: the driver's personal best for that sector.
- **Yellow**: slower than the driver's best.
- Grey: not reached yet.

## Live timing

The adapter publishes progress + current time ~4 times a second. The core keeps the
current lap's crossings and, for each update, computes:

- `delta_ms` against the seated driver's best lap on this combo (fallback: combo best),
- which sector the car is in, and the status/time of each completed sector.

The overlay's **Live timing** widget shows lap time, the delta, and one bar per sector.

## Not done yet

- Learning AC EVO's sector lines from its results files (`learned` source).
- AC / ACC / DiRT Rally 2.0 / EA WRC adapters (the model already supports their data).
