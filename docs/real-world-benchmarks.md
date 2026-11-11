# Real-world benchmark times (research notes)

Working list for a possible "how do you stack up against the pros" challenge. **Research only: nothing in the app reads
this yet.** Times are facts we looked up; we keep our own table and a source link, never copied text.

Scope: only tracks and cars that exist in our catalogues (`crates/tt-games/src/{ac,acevo}/catalogue.json`). Rally
(DR2, ACR) is out: stage times are not published per car in a comparable way.

## Adding challenges without rebuilding

The challenges that ship with the app are `crates/tt-core/pro_challenges.toml` (the top of that file lists every way to
write a time, a game, a car and so on). To add your own, or change a bundled one (the same `id` replaces it), make a
`pro_challenges.toml` in the app's data folder under `pro-laps`
(`%APPDATA%\app.binit.desktop\pro-laps`), with your pictures in a `challenge-art` folder next to it. The file is read again
each time the Pro laps page opens, so there is nothing to restart. A mistake in it is shown at the top of the page and the
bundled challenges carry on. The file can leave out `marginPercent` and `rewards` to use the bundled ones. A picture is
looked for in that folder first, then among the ones that ship with the app.

## How to read this

**Confidence**
- **A**: notarised or official record attempt, or an official series timing record.
- **B**: manufacturer test (not independently verified), or a magazine test (Sport Auto) with a named driver.
- **C**: single source, secondary report, or conditions unclear. Do not use without re-checking.

**Layout matters.** Two Nordschleife lengths appear in sources:
- 20.832 km: the full lap, what the Nürburgring now certifies. This matches AC EVO `Touristenfahrten` and AC `nordschleife`.
- 20.600 km: older/manufacturer tests that skip a short section. About **4.5 to 4.7 s faster** than the full lap for a
  ~7 min car. Where a source gave both, both are listed. Never compare a 20.6 time to a full-lap sim time.
- 25.378 km: the 24h combined layout (GP circuit + Nordschleife). Matches AC `endurance`, not the EVO layout.

**Match grade** (sim car vs real car)
- **Exact**: same model and generation.
- **Close**: same model, different spec or generation (name the difference).
- **Class only**: a fair comparison of category, not of the same car.
- **None**: nothing sensible to compare against; leave it out.

Real laps are flying laps on warm, fresh tyres, often hand-picked days. Show these as a target to approach, not a
pass/fail line, and label the unverified ones as claims.

---

## 1. Nordschleife, road cars (full 20.832 km lap)

| Real car | Time | Driver | Date | Conf. | Sim car (game) | Match |
|---|---|---|---|---|---|---|
| Porsche 911 GT3 RS (992.1) | 6:49.328 | Jörg Bergmeister | 2022-10 | A | 992 GT3 RS (EVO) | Exact |
| Porsche 911 GT3 RS Manthey Kit (992.1) | 6:45.389 | Jörg Bergmeister | 2025-04 | A | 992 GT3 RS (EVO) | Close (kit not in sim) |
| Porsche 718 Cayman GT4 RS (982) | 7:09.300 | Jörg Bergmeister | 2021-09 | A | 718 Cayman GT4 RS (EVO) | Exact |
| Porsche 718 Cayman GT4 RS Manthey Kit | 7:03.121 | Jörg Bergmeister | 2023-07 | A | 718 Cayman GT4 RS (EVO) | Close |
| BMW M4 CSL (G82) | 7:20.207 (7:15.677 on 20.6) | Jörg Weidinger | 2022-04 | B | M4 CSL (EVO) | Exact |
| BMW M2 (G87) | 7:38.706 (7:33.906 on 20.6) | Jörg Weidinger | 2023-08 | B | M2 G87 (EVO) | Exact |
| Audi RS 3 (8Y) | 7:40.748 (7:35.522 on 20.6) | Frank Stippler | 2021-06 | A | RS 3 Sportback (EVO) | Exact |

Notes: the Audi RS 3 and the Porsche GT4 RS / 992 GT3 RS runs were notarised. The BMW times are manufacturer tests.

## 2. Nordschleife, road cars (20.6 km only: not comparable to a full-lap sim time)

Use only if the sim layout can be shortened to match, or after adding ~4.6 s as a rough estimate (label it as an estimate).

| Real car | Time (20.6 km) | Driver | Date | Conf. | Sim car (game) | Match |
|---|---|---|---|---|---|---|
| Ferrari 296 GTB (Assetto Fiorano) | 6:58.70 | Christian Gebhardt (Sport Auto) | 2023-06 | B | 296 GTB (EVO) | Close (Fiorano pack) |
| Chevrolet Camaro ZL1 1LE (2018) | 7:16.04 | Bill Wise (GM) | 2017 | B | Camaro ZL1 1LE (EVO) | Exact |
| BMW M8 Competition Coupé (F92) | 7:32.79 | Christian Gebhardt | 2020-06 | B | M8 Competition (EVO) | Exact |
| Alpine A110 S (2022, semi-slicks, aero pack) | 7:42.659 | Christian Gebhardt | 2022-10 | B | A110 S (EVO) | Close (tyres/aero) |
| Ferrari 488 GTB | 7:21.63 | Christian Gebhardt | 2016-11 | B | 488 GTB (AC) | Exact |
| Nissan GT-R (R35, 2009-11) | 7:19 to 7:38 (spread) | various | 2009-12 | B/C | GT-R GT3 (AC) is a race car | None: not the same car |
| VW Golf 8 GTI Clubsport | 8:03.00 | Sport Auto | ~2020 | C | Golf 8 GTI Clubsport (EVO) | Exact, layout unconfirmed |
| Hyundai i30 N Performance | 8:05.19 | Sport Auto | ~2017 | C | i30 N (EVO) | Exact, layout unconfirmed |
| Toyota GR86 | 8:27.27 | unclear | unclear | C | GR86 (EVO) | Exact, layout unconfirmed |
| Alpine A110 (2017) | 8:03.33 | Sport Auto | 2017 | C | A110 S (EVO) | Close |
| BMW M3 CSL (E46) | 7:50 | Horst von Saurma | 2003 | B | M3 E46 CSL (EVO) | Exact |

## 3. Nordschleife, GT3 and race cars (24h combined layout, 25.378 km, matches AC `endurance`)

| Real car | Time | Driver | Session | Conf. | Sim car (game) | Match |
|---|---|---|---|---|---|---|
| Mercedes-AMG GT3 Evo | 8:09.058 | Raffaele Marciello | 2023 24h pole | A | AMG GT3 (AC, 2015 spec) | Close (older car) |
| Porsche 911 GT3 R (991) | 8:09.105 | Laurens Vanthoor | 2018 24h pole | A | 911 GT3 R 2016 (AC) | Close (2018 vs 2016 spec) |
| McLaren MP4-12C GT3 | 8:10.921 | Kévin Estre | 2014 24h pole | A | 650 GT3 (AC) | Class only (650S successor) |
| Porsche 911 GT3 R (991), race lap | 8:17.340 | Nick Tandy | 2018 24h race | A | 911 GT3 R 2016 (AC) | Close |

Caution: a 24h lap is run in traffic, with the weather of the day, and the GT3 BoP changes between years.

## 4. Mount Panorama (Bathurst), AC EVO "GP" layout

| Real car | Time | Driver | Session | Conf. | Sim car (game) | Match |
|---|---|---|---|---|---|---|
| Audi R8 GT3 (Ultra spec) | 1:59.291 | Chris Mies | 2018 Challenge Bathurst sprint | A | R8 LMS GT3 Evo II (EVO) | Close (older R8) |
| McLaren 650S GT3 | 2:01.567 | Shane van Gisbergen | 2016 12 Hour race lap | A | (none in EVO; 650 GT3 is AC, no Bathurst) | Class only |
| Mercedes-AMG GT3 (no BoP) | 1:56.6054 | Jules Gounon | 2024 12 Hour testing | C | AMG GT2 (EVO) is a different car | Class only; unrestricted |
| Porsche 911 GT3 Cup (Carrera Cup) | 2:06.2285 | Jaxon Evans | 2018 race | A | 911 GT3 Cup (992) (EVO) | Close (991 vs 992) |
| Toyota 86 (spec series) | 2:37.4873 | Luke van Herwaarde | 2019 race | A | GR86 (EVO) | Class only (race-prepped 86) |

**Decision: the Bathurst headline is the restricted (BoP) time, Shane van Gisbergen's 2:01.567 (McLaren 650S GT3, 2016
12 Hour race lap, grade A).** The faster 1:59.291 (Audi R8, Challenge Bathurst sprint) and 1:56.605 (unrestricted AMG GT3)
are not like-for-like with a BoP-balanced sim car, so they are kept here as context only. Category challenge: any GT3.

Not usable: Supercars (2:03.5 qualifying, Cam Waters 2020), F1 demo (1:48.88, Jenson Button): no sim car. The Brabham
BT62 1:58 was a 12-hour weekend demo: no sim car.

Gap: the current GT3 12 Hour pole times for 2024 and 2025 (all five of our EVO GT3 types race there) were not
checked. These would give the cleanest, same-car-class comparison and are the first thing to research next.

## 4b. Monza, F1 (EVO has the Ferrari F2004)

| Real car | Time | Driver | Session | Conf. | Sim car (game) | Match |
|---|---|---|---|---|---|---|
| Ferrari F2004 | 1:20.089 | Rubens Barrichello | 2004 Italian GP pole | A | Ferrari F2004 (EVO) | Exact |
| Ferrari F2004 | 1:21.046 | Rubens Barrichello | 2004 Italian GP fastest race lap | A | Ferrari F2004 (EVO) | Exact |

The first is the first F1 challenge (a qualifying lap, low fuel, one-lap tyres). Imola 2004 (Schumacher, F2004, fastest
race lap 1:20.411) is a possible second, but pole there went to Button's BAR and the 2004 layout is unchecked.

## 5. Spa-Francorchamps (AC `spa`, EVO)

| Real car | Time | Driver | Session | Conf. | Sim car (game) | Match |
|---|---|---|---|---|---|---|
| McLaren 720S Evo GT3 | 2:15.264 | Dean MacDonald | 2025 GT Open race lap | C | GT3 cars (AC, EVO) | Class only |
| Porsche 911 RSR (GTE) | 2:11.219 (quali) / 2:13.658 (race) | Kévin Estre | 2021 | B | 911 RSR 2017 (AC) | Close (2019 spec in 2021) |
| Toyota TS050 Hybrid (LMP1) | 1:53.658 (quali) / 1:57.394 (race) | Sarrazin / Conway | 2017 / 2018 | B | 919 Hybrid 2016 (AC) | Class only |
| McLaren Senna | 2:24 | n/a | 2019 | C | P1 (AC) | Class only (hypercar) |
| Porsche 911 GT2 RS (Manthey) | 2:31 | n/a | 2018 | C | n/a | None |

Production-car record at Spa: Pagani Huayra BC Roadster 2:23.081 (2020); a Praga Bohema is reported at 2:21.42 (single
secondary source). Neither car is in the sims.

## 6. Other tracks in the sims

| Track | Real-world data found | Status |
|---|---|---|
| Laguna Seca | Production-car record: Czinger 21C HDF 1:22.30 (Dec 2025), not in sims | Official records page not read (rate limited). Needs a retry. |
| Monza | GT3 race laps 1:44.278 (Tommaso Mosca, 2025 GT Open) and 1:48.118 (Le Mans Cup); sources disagree | C: unresolved |
| Suzuka, Red Bull Ring, Imola, Paul Ricard, Fuji, Watkins Glen, COTA, Brands Hatch, Donington, Oulton Park, Road Atlanta, Kyalami, Mugello, Zandvoort, Vallelunga, Magione | Nothing usable found in this pass | Not yet researched |

Search results for these mostly returned simulator leaderboards, which we must not mix in with real times.

---

## Sim cars with no sensible real-world match

- **AC Formula cars** (Ferrari F2004, SF70H, Lotus 72D, Maserati 250F) and **EVO F2004 / SF-25 / Dallara EXP**: the real
  F1 Nordschleife times are on the old 22.835 km GP layout, which neither sim has (Lauda 6:58.6 in 1975).
- **Porsche 919 Hybrid (AC)**: the famous 5:19.546 (Timo Bernhard, 2018) is the stripped-down *919 Hybrid Evo*, not the
  race car. Fine as "the all-time Nordschleife record", not as a like-for-like.
- **Group C / prototypes** (Mazda 787B, Mercedes C9, Maserati MC12 GT1, Glickenhaus SCG003): no real Nordschleife
  times found. The Porsche 956 (Bellof 6:11.13, 1983) is the Group C benchmark but not in the sims.
- **Mercedes 190E Evo II, Audi TT VLN, Alfa 155 V6, Audi Sport Quattro, Lancia Delta Integrale, Peugeot 205 T16, Porsche 935, 964, F40, NSX-R, Supra, Skyline R34, Mazda RX-7 and MX-5, Honda S2000, Caterham 485, Abarth 695/595, Dallara Stradale, Lotus Emira/Exige, Lamborghini STO/Countach, Ferrari Daytona SP3/288 GTO/FXX K, Maserati Alfieri, Giulia GTAm**: no solid Nordschleife time found in this pass. The STO has only a GP-circuit time, not the Nordschleife.
- **Rally (DR2, ACR)**: out of scope.

## Design decisions so far (agreed, nothing built)

- **Scope per challenge**: a challenge locks to either a *category* (GT3, GT4, Cup, GTE, LMP1) or one *specific car*.
  Road cars are always specific-car challenges, because the `Road` class spans 40 s on the Nordschleife.
- **Headline challenges** are well-known records tied to a specific car, including race cars on the Nordschleife
  (e.g. the 919 Evo 5:19.5; the sim's 919 Hybrid is the nearest car, so label it as such).
- **Layout lock**: a lap counts only on the exact layout the real time was set on (stored in the challenge definition).
- **Result**: beating the real time is the big reward. Landing within a tolerance of it counts as a pass ("pro level").
  The tolerance (a percentage, maybe per class) is still to be decided.
- **Rewards (design numbers, not built)**: reaching pro level (within 3% of the pro time) pays +300 XP and +300 coins the
  first time; beating the pro pays +2,000 XP, +1,500 coins and a "Pro slayer" sticker the first time. For scale, the
  existing economy pays 50 XP for a personal best and 150 XP for a track record (`crates/tt-core/rewards.json`, 100 XP per
  level), so these are much bigger and may need trimming before they ship.
- **Only accepted attempts count**: a lap counts toward a challenge only if the driver had opened that challenge first
  (challenge mode on). Laps driven outside challenge mode never count, even if track, layout and car match.
- **Where times live**: every lap is still an ordinary leaderboard lap. A challenge attempt is a link from that lap to
  the challenge, recorded when the lap completes while the challenge is active and the lap matches the lock
  (track, layout, car or category) and is a valid timed lap. Store the link in its own table (lap id, challenge id),
  not as another column on `laps`.
- **Explicit exit only**: challenge mode ends only when someone chooses to exit it. It is not cleared by the game closing or
  by a timeout, so another driver can take the seat and keep taking the challenge on. This means the active challenge is held
  by the seat, and each lap is credited to whoever is seated when it completes (check against the seat switcher when building).
- **Invalid setup is shown, not hidden**: if the car, track or layout is wrong, the challenge widget says so and shows the
  expected car, track and layout. Those laps stay normal laps and do not count.
- **Per player, with an office view**: progress belongs to each driver, and everyone's best attempt at a challenge is
  visible office-wide.
- **Challenge mode**: the driver opens a challenge, the app switches to a challenge mode for that driver, and a special
  widget replaces the usual ones, comparing the live lap with the real benchmark.

## Open items for the next research pass

1. Bathurst 12 Hour pole/fastest laps for 2023 to 2025, per GT3 model (the best same-car-class match we have).
2. Nürburgring GmbH's own class record table (fetch the official page; secondary lists disagree on classes).
3. Re-read the Wikipedia Nordschleife page from character 200,000 (not yet read), plus the racing list page, for the Cup cars,
   GT4 and the open-wheel entries.
4. Laguna Seca official records (retry after rate limit), Suzuka, Monza, Red Bull Ring GT3 qualifying from official timing.
5. Fill the road-car gaps (STO, Emira, Exige, GR86 layout check) from Sport Auto / Evo / Auto Bild originals.
6. Decide the data shape (track + layout + class + real car + driver + time + confidence + source URL) once we know which rows we keep.

## Sources

- [Wikipedia: Nürburgring lap times](https://en.wikipedia.org/wiki/N%C3%BCrburgring_lap_times) (production, non-series, competition tables)
- [Oversteer48: Nürburgring lap record by car type](https://oversteer48.com/nurburgring-lap-record/)
- [FastestLaps: Hyundai i30 N](https://fastestlaps.com/tests/gtkll64dc0l8), [Toyota GR86](https://fastestlaps.com/tests/rid9shvnlrd8), [VW Golf GTI Clubsport](https://fastestlaps.com/tests/sgusir5z5z0k), [Alpine A110](https://fastestlaps.com/tests/effacksn67gv)
- [V8 Sleuth: Bathurst lap records (2021)](https://www.v8sleuth.com.au/?p=40342)
- [Supercars: unrestricted AMG at Bathurst](https://supercars.com/news/unrestricted-mercedes-amg-hits-new-heights-in-bathurst)
- [GTPlanet: Brabham BT62 Bathurst](https://www.gtplanet.net/?p=89018)
- [Oversteer48: Spa lap records](https://oversteer48.com/spa-francorchamps-lap-record/)
- [Carscoops: Pagani Huayra BC Roadster at Spa](https://www.carscoops.com/2020/09/pagani-huayra-bc-roadster-sets-production-car-lap-record-at-spa-beating-mclaren-senna/)
- [Oversteer48: Monza lap records](https://oversteer48.com/monza-lap-records/)
- [WeatherTech Raceway official records](https://weathertechraceway.com/pages/official-track-records) (not read; rate limited)
