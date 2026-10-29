# Achievement stickers

Stickers are the app's achievements: things a driver earns by driving, each with a name, a one-line rule, a rarity and a
reward. The designs are on the Achievements page of the design canvas ("Stickers: how they work" and "all 54").
This file is how to set them up and what is built.

Everything about a sticker is data in [`crates/tt-core/stickers.json`](../crates/tt-core/stickers.json). Edit, rebuild,
ship: the numbers and rules change for everyone, the same way `rewards.json` does for the shop.

## Setting one up

```json
{ "id": "ten-laps", "name": "Ten laps", "group": "first-steps", "rarity": "common",
  "how": "Ten timed laps on one track.",
  "rule": { "kind": "lapsOnOneTrack", "n": 10 } }
```

| Field | What it does |
|---|---|
| `id` | Stable, kebab-case. Never rename one that has shipped: earned stickers are stored by id. |
| `name`, `how` | What the driver sees. `how` is the rule in plain words. |
| `group` | One of `groups` at the top of the file. |
| `rarity` | `common`, `rare`, `epic` or `legendary`. Sets the colour and the default pay. |
| `hidden` + `hint` | A hidden sticker shows only `hint` (and the name "Hidden sticker") until it is earned. |
| `reward` | Optional custom reward, below. |
| `rule` | How it is earned, below. `null` = designed but not detectable yet; it shows as locked. |

### Pay: default per rarity, override per sticker

`rarityPay` sets what each rarity pays. Change one number and every sticker of that rarity follows:

```json
"rarityPay": { "common": { "xp": 20, "coins": 20 }, "rare": { "xp": 50, "coins": 60 }, ... }
```

A sticker with a `reward` overrides any part of that. Leave a field out to keep the rarity's number:

```json
{ "id": "crown", ..., "reward": { "item": "decal:crown" } }
{ "id": "completionist", ..., "reward": { "xp": 1000, "coins": 1000, "item": "shell:gold" } }
```

* `xp`, `coins`: replace the rarity's pay for this sticker. Capped at 10,000 so a typo cannot mint a level.
* `item`: a shop item given free, as `slot:id` from the shop in `rewards.json` (`decal:crown`, `shell:gold`). The driver
  owns it and can wear it without buying it. A wrong id stops the app from starting (see below).

### Rules

| `kind` | Earned when | Fields |
|---|---|---|
| `timedLaps` | `n` timed laps in total (not cut, out or in laps) | `n` |
| `timedLapsOnOneTrack` | `n` timed laps on one track (any car) | `n` |
| `tracksDriven` | timed laps on `n` different tracks | `n` |
| `carsDriven` | timed laps in `n` different cars | `n` |
| `gamesDriven` | timed laps in `n` different games | `n` |
| `daysInARow` | laps on `n` days in a row, counting back from the latest | `n` |
| `cleanLapsInARow` | the last `n` attempts were all timed, none cut | `n` |
| `steadyLapsInARow` | the last `n` timed laps on a track and car are within `withinMs` of each other | `n`, `withinMs` |
| `thisLapIsPersonalBest` | this lap beat the driver's own best on that track and car | none |
| `thisLapIsTrackRecord` | this lap beat everyone else's best | none |
| `thisLapInChallenge` | this lap counted in a running challenge | none |
| `thisLapTimeEndsIn` | this lap's time ends in these milliseconds | `ms` |
| `thisLapTimeIsPalindrome` | this lap's time reads the same backwards (1:42.241) | none |
| `timedLapsOnTrack` | `n` timed laps on one of these tracks | `n`, `on` |
| `thisLapFasterThan` | this lap was quicker than `ms`, on one of these tracks (`on` empty = any track), in an allowed car | `ms`, `on`, optional `exceptCarClasses`, optional `onlyCarClasses` |
| `thisLapTimeEndsInSecondsAndMs` | this lap's time ends in these seconds and milliseconds (7:20.832 is 20 and 832), on these tracks | `seconds`, `ms`, `on` |
| `thisLapLongestDriftAtLeast` | this lap's longest drift lasted `ms` or more (a drift is the game's: 12 degrees of slip or more at speed); `noSpins` also needs a lap with no spin | `ms`, optional `noSpins` |
| `thisLapDriftTimeShareAtLeast` | drifting added up to `percent` of this lap's time | `percent` |
| `thisLapSpinsAtLeast` | this lap had `n` spins (90 degrees of slip or more) | `n` |
| `thisLapSlowerThanYourBestBy` | this lap was `percent` slower than your own best on that track and car | `percent` |
| `lapsWithinPercentOfYourBest` | `n` timed laps on one track and car, all within `withinPercent` of your best there | `n`, `withinPercent` |
| `thisLapSectorFasterThanEveryoneElse` | a sector was quicker than any other driver's on that track and car | none |
| `thisLapWithinPercentOfAnotherDriversBest` | this lap was within `percent` of another driver's best on that track and car | `percent` |
| `recordsHeldOnDifferentTracks` | you hold the best time on `n` different tracks (track and layout, any car), each with another driver on the board | `n` |
| `thisLapWinsFromBottomHalf` | this lap took the best time on a board of at least `minDrivers`, while your previous best was in its bottom half | `minDrivers` |
| `thisLapPassesAnotherDriver` | this lap was faster than another driver's best that had beaten your previous best | none |
| `thisLapWithinOfAnotherDriversTime` | this lap was within `ms` of another driver's best, but not equal | `ms` |
| `thisLapEqualsAnotherDriversTime` | this lap equals another driver's best exactly | none |
| `recordHeldForDays` | you have held the best time on a track and car for `days` days, with another driver on the board | `days` |
| `thisLapHasNoSpin` | this lap had no spin (a game that reports no physics counts as none) | none |
| `thisLapSetBetweenLocalTimes` | the lap was set between two local times of day on the rig's PC (`from` up to `to`, like `"12:00"` and `"14:00"`; `"24:00"` is the end of the day), on any of `days` (`mon` to `sun`; leave out for every day) | `from`, `to`, optional `days` |
| `thisLapIsPersonalBestAfterLapsWithoutOne` | a new personal best after `n` laps in a row on that track and car that did not beat the best before them | `n` |
| `thisCutLapEndsARunWithinPercentOfAnotherDriversBest` | a cut lap that ends a run of `n` cut laps in a row on that track and car, each within `percent` of another driver's best | `n`, `percent` |
| `driftDistanceInTotalAtLeast` | the driver has drifted `metres` in total (only laps recorded after distance was measured count) | `metres` |
| `thisLapHandbrakeDriftsAtLeast` | `n` drifts began with the handbrake pulled (within a second before) | `n` |
| `thisLapFinishesFacingBackwards` | slip of `slipDeg` or more at the last sample before the line, at `minSpeedKmh` or more | `slipDeg`, `minSpeedKmh` |
| `thisLapStoppedFacingTheWrongWay` | the car stopped (under `belowKmh`) pointing `degrees` or more away from the direction the track's learned map runs | `belowKmh`, `degrees` |
| `challengeFinishedInTopPlaces` | when a challenge ends: finished in its top `places`, with at least `minEntrants` drivers | `places`, `minEntrants` |
| `challengeFinishedOutsideTopPlaces` | when a challenge ends: finished outside its top `places` | `places`, `minEntrants` |
| `challengesWonInARow` | won the last `n` challenges in a row (counting only ones with `minEntrants` drivers) | `n`, `minEntrants` |
| `challengeFinishedWithEveryLapClean` | when a challenge ends: at least `minLaps` timed laps in it and not one cut lap | `minLaps` |
| `allOtherStickers` | every other sticker is earned | none |

`on` is a list of tracks, each `{ "track": "Nurburgring", "layout": "Touristenfahrten" }` (`layout` is optional). Spelling,
case and punctuation do not matter, but list every name each game uses for the circuit: Assetto Corsa EVO reports the
Nordschleife as track `Nurburgring`, layout `Nordschleife` ; `Touristenfahrten` is its public layout (shared with other cars on track), Assetto Corsa as `ks_nordschleife`. A different layout of the same
track does not match: the Nurburgring GP circuit is not the Nordschleife. The Green Hell stickers split it: Green Hell and Ring
regular accept any Nordschleife layout (including Touristenfahrten and Assetto Corsa's endurance layout), while the timed
ones (Sub eight, Sub seven, 20.832) need the closed Nordschleife layout, so a time set among tourists doesn't count.

`exceptCarClasses` stops cars that are far quicker than the sticker is about from earning it: Sub eight and Sub seven rule
out `Open wheel`, `Formula`, `LMP1`, `LMP2`, `Prototype` and `Hypercar`, so a Formula 1 car cannot take them. Classes are the
ones in the game's catalogue (`crates/tt-games/src/*/catalogue.json`), matched loosely and found by the car's name or any
alias. `onlyCarClasses` is the opposite, an allow-list; it also rules out any car the catalogue has no class for. A car
with no class is allowed by `exceptCarClasses`, so an unlisted mod car can still earn it.

Kinds starting `thisLap` are about the lap that was just recorded, so they can only be earned live, never from history.

A new kind of sticker needs a new variant in `Rule` and a line in `measure` (`crates/tt-core/src/stickers.rs`); after
that any number of stickers can use it.

The file is checked when the app starts and by `cargo test -p tt-core`: duplicate ids, an unknown rarity or group, a
hidden sticker with no hint, and a reward item that is not in the shop all fail with the sticker's id in the message.

## How it works

* **Unlocking.** After a timed lap is recorded, the driver's stickers are checked and any that are now complete are
  unlocked and paid, once, in the same step as the lap's own XP and coins. They come back on the lap result
  (`awards.stickers`), and their XP and coins are included in `awards.xp` / `awards.coins`.
* **Storage.** `driver_stickers` (schema 13): driver, sticker id, the lap that earned it, when. The pay is a normal row in the
  points ledger (`sticker:<id>`), so balances are still sums and the "recent" list shows it. A free item is a
  `driver_items` row with price 0.
* **Never taken away.** Losing a record does not remove a sticker.
* **Back-filled once.** The first time the new version opens an existing database, stickers the old laps already prove
  are unlocked, quietly, with no pay. One-off moments (a PB, a track record, a lucky time) cannot be proven from
  history, so those are only earned live.
* **Only timed laps count,** and guest laps (nobody in the seat) earn nothing, like XP.
* **API.** `GET /api/drivers/{id}/stickers` returns every sticker with `earned`, `earnedAt`, `progress`, its pay and
  `detectable`. A hidden sticker that is not earned has no name. In the UI: `api.stickerBook(id)` and the
  `StickerBook` type in `app/src/api.ts`.

## What can be detected today, and what cannot

All 54 stickers have a rule. Some depend on what a game reports, and a few need testing against real play:

* **Drifting and spins** (Sideways, Tyre fryer, Drift king, Spinning top, Skid marks, Handbrake hero, Tidy lap's "no spin")
  need a game that reports physics (AC EVO so far). Skid marks and Handbrake hero count only laps recorded since drift
  distance and the handbrake were added to the slide stats.
* **Time of day** uses the PC's local clock when a lap is recorded, daylight saving included. The windows are in
  `stickers.json`, so changing "after 19:00" is an edit there. Laps recorded before this existed are not looked at.
* **Challenge stickers** unlock when a challenge ends and is settled (the same moment its coins are paid), including for
  challenges that ended before this existed. Where each driver finished is kept in `challenge_results` (schema 15).
* **Moonwalk and Wrong way round** read the lap trace (and, for Wrong way round, the track's learned map for which way the
  track runs). They were built from the trace format and tested on made-up laps, so they need trying on a real lap.
* **Rule bender** needs cut laps to carry the game's lap time; they are recorded, but check one on real data.

## The parcel

Everything a driver earns is paid the moment it unlocks, and also waits in their **parcel** until they have been shown it.
The next time that driver is on the app as themselves (the phone or browser signed in as them, or the PC's seated driver, and
not while they are driving) a full-screen takeover covers everything: open it, see what they got, collect. There is no close
button, so it cannot be missed.

* With three stickers or fewer it shows each as a card. With more it first walks through the three rarest, one at a time (Next,
  or Skip to everything), then shows all of them in a compact grid, with the total coins and XP, any level reached and any free
  items above **Collect**.
* `GET /api/drivers/{id}/parcel` returns it (or null) and `POST /api/drivers/{id}/parcel/collect` marks everything seen.
  Unseen is `driver_stickers.seen_at IS NULL` (schema 16). Stickers earned before parcels existed count as already seen.
* The catch-up for old laps and challenge stickers also arrive in a parcel. Collecting does not pay anything (that already
  happened); it only stops the parcel from showing again.
* UI: `ParcelGate` and `ParcelOverlay` in `app/src/components/Parcel.tsx`. `?mock&idle` shows a twelve-sticker parcel in the mock.

## In the app

* **Profile** (`app/src/pages/You.tsx`, `StickerHighlights` in `app/src/pages/Stickers.tsx`): the Stickers section shows how
  many are earned, the three the driver chose to show (or their rarest so far until they choose), the latest four and
  the three nearest to unlocking.
* **Sticker book** (`#/you/{id}/stickers`, `StickerBookPage`): every sticker by group, filtered by All / Earned / To do and
  by group, with a sheet for each. On your own profile (or from the PC) an earned sticker can be shown on the profile
  or removed; at most three. Saved in `driver_pins` (schema 14) through `PUT /api/drivers/{id}/stickers/pinned`.
* **Drawing.** `app/src/stickers.ts` maps each sticker id to its icon and each rarity to its colours. A sticker added to
  `stickers.json` without an icon there shows a star until one is added.
* The progress bars are the profile's flat `.you-bar` (the driver's colour for the total, the rarity colour for one sticker).

## Not built yet

* The unlock toast from `awards.stickers` (the parcel now covers telling the driver), and the helmet slot for wearing a sticker. The overlay still toasts the
  original eight computed stickers (`Profile.stickers`) by comparing profiles; they should be replaced by the book, which
  would also stop a double toast for "First lap".
* A mock for `?mock` UI work (the sticker routes are not in `app/src/mock/server.ts`, so the section is empty there).
* Items that stickers unlock beyond `reward.item` (the Home track backdrop does not exist yet).
