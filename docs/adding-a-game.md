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
first one; `acr/` (Assetto Corsa Rally) is the model for a rally game. `dr2/` holds only a catalogue so
far.

## The shared parts a circuit game reuses

* `tracker.rs`: `LapTracker` turns a stream of `Sample`s (status, lap count, lap clock, last lap,
  valid flag, pit flag, track progress, inputs) into laps: out, in, partial and cut laps, timing
  profiles and input traces. An adapter only builds `Sample`s.
* `stage.rs`: `StageTracker`, the rally counterpart: a stage clock and distance driven in, finished stage
  runs out (see "Rally games" below).
* `acpmf.rs`: what Assetto Corsa, Competizione and Rally share: the three `Local\acpmf_*` page names, a
  reader for fields at byte offsets, the physics page, gears and inputs, and the code that opens the pages.
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

## Rally games (stages)

A rally game has no laps. A run is a stage: it starts when the clock starts, ends at a finish line, and the
game's data has no lap counter to say so. `StageTracker` takes `StageSample`s (the stage clock, distance
driven, stage length, whether the game's data is still changing) and reports finished runs.

* **How a stage is stored:** like a lap. The stage's name is the "track", the stage length is the
  "layout" (`12.08 km`), so two stages the game reports under the same name stay apart, the car is the car,
  and each run is a lap with the stage time. Sector boundaries come from the length (one per ~2 km,
  `even_boundaries`), and sector times come from the timing profile, as for laps.
* **The finish line is not the end of the data.** Most stages have a stretch after the line to roll out and
  stop on, so the distance the game reports runs on past the line. The game marks the line by stopping the
  stage clock while the car is still moving, so that is the signal: the clock holds still for 0.7 s while
  the game's data is still updating and the car is at least 90% along. The time is the game's own clock
  at that moment, and everything after it is ignored. (On the stage that was recorded the clock stopped at
  98.4% of the reported length, with a further 120 m of roll-out.)
* **Progress** is distance over the reported stage length, which therefore tops out a little under 1.0.
  Recorded profiles and live progress use the same measure, so deltas stay consistent.
* **Restarts and menus:** the clock or the distance jumping back before the finish abandons the run (no
  result); no clock at all means the menus; joining a run part-way is stored as "partial", as for laps.
* **Not done yet:** learned track outlines are skipped for stages (the recorder closes the loop from the
  end back to the start, which would draw a false line across a point-to-point stage).

## Assetto Corsa Rally: what was found, and what was not checked

Read from a running game (Peugeot 206 WRC on a Welsh gravel stage) with `examples/acr_probe.rs` and a
recording of a whole stage. Published docs for this game's shared memory are thin: community sources say
the pages are the same as Competizione's, which held for the physics page and the strings, but not for
what the game fills in. Details are in the header of `acr/layout.rs`. In short:

* The static page has the car (a display name), the stage name and the stage length; the version strings
  and layout name are empty. The graphics page has the stage clock as **text** (`mm:ss.mmm`), the distance
  driven and the world position; the status, session, lap counter, millisecond clocks, sector index and
  track-position fraction are all zero. The tyres-out count is not filled in, so there is no way to flag
  a cut: every finished run counts as valid.
* After the finish the pages freeze on the results screen (the packet counter stops) and are cleared when
  the player goes back to the menus.
* The memory clock matched the game's displayed final time exactly on the second stage (3:35.010). On the
  first it read 08:40.336 where the display showed 8:40.335, so that is a rounding difference at most, not
  an offset; times are stored as the memory gives them.
* With the game's "drive up to the start" option the distance already counts the approach (116 m while the
  clock sits at 0; the line was at 238 m). A run starts when the clock starts, so the start is judged by the
  clock alone, never the distance.
* The game's stage names (`Wales Afon Biga`) do not match the names in published stage lists
  (`Cwmbiga - Afon Biga`), and several stages can share a reported name, so stages are not pre-populated:
  they appear as they are driven. The bundled cars (`acr/catalogue.json`) come from published lists, except
  `Peugeot 206 WRC`, which was read from the game; where the game spells one differently, the catalogue's
  matching and the game's own spelling take over once a car is driven.
* Not checked: the clutch and steering ranges, a stage restarted from the results screen, and stages
  that start with a countdown (the tracker treats a clock held at zero before the start as not a finish).

## Assetto Corsa: what was checked and what was not

Checked against a running Assetto Corsa 1.16.4 (shared memory version 1.7): the car, track, layout and
length, the lap clock, lap counter, last and best lap, sector index, track progress, world position,
pedals, gear, revs, speed and the tyres-out count. The clutch reads 1.0 with the pedal released (the
adapter inverts it).

Not checked: the steering angle at full lock (it reads about 0.07 at small inputs, so it is assumed to
be -1..1), the lap invalid rule (the game gives only the number of tyres outside the limits; the
adapter flags a lap above two, matching the game's default allowance), and the handbrake (the game's
page doesn't have one).
