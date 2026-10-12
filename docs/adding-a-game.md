# Adding a game

Each game's integration lives in its own folder in `crates/tt-games/src/<game>/` and nothing else
knows its details. The shared parts (lap detection, timing profiles, the shared-memory reader, process
detection, the catalogue merge) are game-agnostic. A game plugs in at a handful of named points.

## What a game owns

```
crates/tt-games/src/<game>/
    mod.rs           the adapter: reads the game's telemetry, emits GameEvents
    layout.rs        the telemetry layout (memory offsets, packet fields) and how to parse it
    documents.rs     names found in the plain-text files the game writes to Documents (catalogue "observed")
    catalogue.json   the cars and tracks we ship for it (names exactly as its telemetry reports them)
```

`ac/` (Assetto Corsa) is the model to copy for another shared-memory circuit game; `acevo/` is the
first one. `dr2/` holds only a catalogue so far.

## The shared parts a circuit game reuses

* `tracker.rs`: `LapTracker` turns a stream of `Sample`s (status, lap count, lap clock, last lap,
  valid flag, pit flag, track progress, inputs) into laps: out, in, partial and cut laps, timing
  profiles and input traces. An adapter only builds `Sample`s.
* `shm.rs`, `process.rs`: read a named shared-memory page; check whether the game's process runs.
* `timing.rs`: per-lap timing profiles and traces.

## Registering a game (every place, in order)

1. `GameId` in `tt-games/src/lib.rs`: a new variant, its `key()` (stored with every lap, challenge
   and map: never change it afterwards) and `display_name()`. Add it to `GameId::ALL`.
2. `GAME_PROCESSES` in the same file: the game's executable names.
3. `adapters()` in the same file: one line that constructs the adapter. `GameWatcher` runs them all,
   one game at a time.
4. `tt-games/src/catalogue.rs`: add the game to `seed_json` and, if it has a scanner, `observe`.
5. The UI, by key: `GAME_NAMES` in `app/src/format.ts`, `GAMES` in `app/src/pages/Games.tsx`
   (`ready: true`), and a profile in `app/src/overlayLayout.ts` (an empty `hud` is fine until its HUD
   is mapped).

Data never mixes between games because every table that holds tracks, cars or laps carries a `game`
column (see the test `games_with_identical_names_never_mix`). Nothing else in `tt-core` names a game.

## Names

Store the game's own names. AC EVO reports display names (`Imola`); Assetto Corsa reports folder ids
(`ks_porsche_911_gt3_r_2016`, `ks_brands_hatch`, layout `gp`). The UI prettifies for display only
(`carName`, `trackName` in `app/src/format.ts`), so what is stored always matches the game's files.

## Verifying against a real game

Write a probe like `examples/ac_probe.rs`: it opens the pages, prints the parsed fields every half
second and runs the real adapter, so you can drive and compare with what the game shows.

```
cargo run -p tt-games --example ac_probe -- --seconds 60
```

Check, with the game running: names, lap clock, lap counter, track position moving 0 to 1, pedals,
gear, units. Keep every assumption about the layout in `layout.rs` as a named offset so a game update
is a one-line change.

Do not restart the dev app mid-lap while testing: a restart rejoins a lap already under way, and that
lap is stored as "partial".

## The overlay and a game's own window

The overlay is a transparent, click-through, topmost window over the game's monitor
(`app/src-tauri/src/overlay.rs`). A game that makes its own window topmost (Assetto Corsa does) can
end up above it: Windows orders topmost windows by when each was last raised, and showing the overlay
does not raise one that is already topmost. TimeTrial therefore raises it (without activating it)
whenever it is shown, whenever a supported game takes the foreground, and once a second while it is
meant to be drawn. To check on a machine: list windows top to bottom (`EnumWindows` returns z-order) and
confirm the "TimeTrial overlay" window comes before the game's. A game in true exclusive fullscreen
can't be drawn over at all; it needs borderless or windowed.

## Assetto Corsa: what was checked and what was not

Checked against a running Assetto Corsa 1.16.4 (shared memory version 1.7): the car, track, layout and
length, the lap clock, lap counter, last and best lap, sector index, track progress, world position,
pedals, gear, revs, speed and the tyres-out count. The clutch reads 1.0 with the pedal released (the
adapter inverts it).

Not checked: the steering angle at full lock (it reads about 0.07 at small inputs, so it is assumed to
be -1..1), the lap invalid rule (the game gives only the number of tyres outside the limits; the
adapter flags a lap above two, matching the game's default allowance), and the handbrake (the game's
page doesn't have one).
