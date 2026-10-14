# What each game gives us

One table per game: what its telemetry carries, where it is read from, and how far it can be trusted.
The code is the source of truth for offsets (`crates/tt-games/src/<game>/layout.rs`); this is the map to it.

**Status** means: *checked* = read from the running game and compared with what it showed;
*assumed* = taken from published layouts or inferred, not checked; *no* = the game does not provide it.

How a game's data reaches Bin It:

| Game | Key | Channel | How it is read |
|---|---|---|---|
| Assetto Corsa EVO | `acevo` | Shared memory, `Local\acevo_pmf_*` | Polled at 20 Hz; graphics + static pages |
| Assetto Corsa | `ac` | Shared memory, `Local\acpmf_*` | Polled; graphics, physics, static pages |
| Assetto Corsa Rally | `acr` | Shared memory, `Local\acpmf_*` | Polled at 20 Hz; graphics, physics, static pages |
| DiRT Rally 2.0 | `dr2` | **UDP**, 66-float packets at ~72 Hz | Bin It's own port (20790+), added to the game's settings; every packet read |

---

## DiRT Rally 2.0 (UDP)

Packet: 66 little-endian `f32` (264 bytes), `extradata="3"` format. Read in `dr2/layout.rs`, every field a
named index. **No stage name, no car name, no driver name.**

| Data | Index | Unit / meaning | Status |
|---|---|---|---|
| Session clock | 0 | seconds; frozen while paused | checked |
| Stage clock | 1 | seconds; 0 before the go; includes penalties; reads 0 again from the finish packet | checked |
| Distance driven | 2 | metres; about -2.3 on the start line, passes the stage length at the finish | checked |
| Progress | 3 | 0..1; jumps to 2.0 in the finish packet | checked |
| World position | 4, 5, 6 | x, y, z in metres | checked (axes not compared with a map) |
| Speed | 7 | metres per second | checked |
| Throttle, steering, brake, clutch | 29, 30, 31, 32 | 0..1, -1..1, 0..1, 0..1 | checked (clutch reads 1 at the start line, 0 when driving) |
| Gear | 33 | -1 reverse, 0 neutral, 1.. | checked |
| Engine speed | 37 | rpm / 10 | checked |
| Splits passed | 48 | the game's own split counter (about 4 per stage on a 2.8 km stage) | checked |
| Stage complete | 59 (and 36) | 0, then 1 in the finish packet | checked |
| Stage length | 61 | metres; constant | checked |
| **Final time** | 62 | seconds; set in the finish packet, penalties included; the game shows it truncated to the millisecond | checked on two runs (2:36.021 and 3:12.557) |
| Max / idle rpm, gears | 63, 64, 65 | rpm / 10, rpm / 10, count; identify the car | checked (one car) |
| Time penalty | no field | a one-packet jump of the stage clock (4.000 s each on the runs recorded; 10.000 s on a jump start) | checked: size and position; cause of the 4 s ones not confirmed |
| Stage / car / driver name | no | length and engine stand in (`known.json`) | no |
| Track limits, damage, tyres, lap validity | no | | no |

Things to know:
* The game reads its settings only at start-up. Bin It adds its `<udp>` entry to
  `Documents\My Games\DiRT Rally 2.0\hardwaresettings\hardware_settings_config.xml` (backup beside it) and a game
  that was already running has to be restarted once.
* A paused game repeats one packet; the session clock stops. Leaving a stage sends one all-zero packet.
* The finish packet and the two after it are all that is sent after the line: the result is taken from the finish
  packet itself.
* A restart shows as the stage clock and distance going back (the session clock keeps running).

---

## Assetto Corsa EVO (shared memory)

Pages `Local\acevo_pmf_graphics` and `Local\acevo_pmf_static` (the 333 Hz physics page is never opened). The layout
is Kunos' header, `#pragma pack(4)`; the game is in early access and the layout has changed before, so the version is
checked. Read in `acevo/layout.rs`.

| Data | Source | Unit / meaning | Status |
|---|---|---|---|
| Lap clock, last lap, best lap | graphics | milliseconds | checked (the clock runs ~30 ms past the official time before progress wraps) |
| Completed laps | graphics | counter | checked |
| Lap progress | graphics `npos` | 0..1 | checked |
| World position | graphics `car_coordinates` (player car by id) | metres; axes mirrored against a map view | checked |
| Lap validity | graphics `is_valid_lap`, timing state | flag | checked |
| Pit state | graphics | in pit, in pit lane | checked |
| Status | graphics | 0 menu, 1 replay, 2 live, 3 paused | checked |
| Pedals, steering, gear, speed, rpm | graphics inputs block | 0..1, -1..1; gear 0 = reverse, 1 = neutral, 2 = first | checked |
| Car, track, layout, track length, sector count | static | display names | checked |
| Sector splits | no (derived from the timing profile) | | no |

Quirk: about every 5 s the page stops for ~200 ms and the first packet afterwards can mix a new position with an old
clock (filtered in `ProfileRecorder::drop_out_of_step`).

---

## Assetto Corsa (shared memory)

Pages `Local\acpmf_physics`, `acpmf_graphics`, `acpmf_static`. Read in `ac/layout.rs` and `acpmf.rs`. Checked against
Assetto Corsa 1.16.4 (shared memory version 1.7).

| Data | Source | Unit / meaning | Status |
|---|---|---|---|
| Lap clock, last lap, best lap | graphics | milliseconds | checked |
| Lap counter | graphics | counter | checked |
| Lap progress | graphics `normalized position` | 0..1 | checked |
| World position | graphics `car coordinates` | metres | checked |
| Sector index | graphics | | checked |
| Pit state | graphics | in pit, in pit lane | checked |
| Status | graphics | off, replay, live, pause | checked |
| Pedals, gear, rpm, speed | physics | 0..1, gear, rpm, km/h | checked (clutch reads 1.0 released: inverted) |
| Steering | physics | assumed -1..1 (not checked at full lock) | assumed |
| Tyres out | physics | count; more than 2 flags a cut | checked as a count; the rule is an assumption |
| Handbrake | no | | no |
| Car, track, layout, length | static | folder ids (`ks_brands_hatch`, layout `gp`) | checked |

---

## Assetto Corsa Rally (shared memory)

Same page names as Assetto Corsa; the physics page matches, the graphics and static pages follow Competizione's
layout and are mostly empty. Read in `acr/layout.rs`.

| Data | Source | Unit / meaning | Status |
|---|---|---|---|
| Stage clock | graphics, **text** `mm:ss.mmm` | the millisecond clocks are zero | checked (matches the game to the millisecond, once 1 ms off) |
| Distance driven | graphics | metres; includes the drive up to the start | checked |
| World position | graphics | metres | checked |
| Progress | derived: distance / stage length | tops out under 1.0 at the line | derived |
| Pedals, gear, rpm, speed | physics | as AC | checked |
| Clutch, steering range | physics | | not checked |
| Stage name, car, driver, stage length | static | display names (`Wales Afon Biga`, `Peugeot 206 WRC`) | checked |
| Finish | no field | the clock stops while the car rolls on; the pages then freeze | checked |
| Track limits | no | tyres-out count not filled in | no |
| Time penalties | no | not looked for | no |
| Lap counter, status, sectors, progress fraction | no | all zero | no |
