// Deterministic fixtures for the dev-only mock server (see ./server.ts). Nothing here ships in a release build.

import type { Catalogue, Challenge, Combo, Driver, Lap, ProBest, ProChallenge, TrackMapData } from "../api";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Fixed "now" so reloads look the same; the server moves time on itself. */
export const NOW = Date.now();

/** Small seeded PRNG so every reload produces the same laps. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DRIVERS: Driver[] = [
  { id: 1, name: "Sam", color: "#FF8A4C", look: { shell: "aurora", decal: "flame", stripe: "centre", number: 7 }, createdAt: NOW - 30 * DAY },
  { id: 2, name: "Jess", color: "#2FA8FF", look: { shell: "holo", decal: "star", decalAt: "top", number: 12, face: "stars" }, createdAt: NOW - 29 * DAY },
  { id: 3, name: "Priya", color: "#FF5FA2", look: { shell: "galaxy", decal: "moon", stripe: "twin", number: 5 }, createdAt: NOW - 20 * DAY },
  { id: 4, name: "Tom", color: "#23C98A", look: { shell: "inferno", decal: "flame", number: 33 }, createdAt: NOW - 12 * DAY },
  { id: 5, name: "Alex", color: "#9B7BFF", look: { decal: "bolt", stripe: "band", number: 88, face: "sleepy" }, createdAt: NOW - 3 * DAY },
];

export const CARS = ["Porsche 911 GT3 R (992)", "Ferrari 296 GT3", "BMW M4 GT3"];

interface TrackDef {
  game: string;
  track: string;
  layout: string;
  country: string;
  kind: "circuit" | "rally";
  /** Reference lap in ms for the quickest driver in the first car. */
  baseMs: number;
  cars: string[];
  /** Shape of the generated outline. */
  shape: { k1: number; a1: number; k2: number; a2: number; phase: number; stretch: number };
}

export const TRACKS: TrackDef[] = [
  { game: "acevo", track: "Imola", layout: "GP", country: "IT", kind: "circuit", baseMs: 102_114, cars: CARS, shape: { k1: 2, a1: 0.28, k2: 5, a2: 0.1, phase: 0.4, stretch: 1.35 } },
  { game: "acevo", track: "Brands Hatch", layout: "GP", country: "GB", kind: "circuit", baseMs: 105_798, cars: CARS.slice(0, 2), shape: { k1: 3, a1: 0.32, k2: 4, a2: 0.12, phase: 1.3, stretch: 1.1 } },
  { game: "acevo", track: "Monza", layout: "GP", country: "IT", kind: "circuit", baseMs: 107_402, cars: CARS.slice(1), shape: { k1: 2, a1: 0.42, k2: 6, a2: 0.05, phase: 2.2, stretch: 1.7 } },
  { game: "dr2", track: "Wales Sweet Lamb", layout: "", country: "GB", kind: "rally", baseMs: 214_320, cars: ["Subaru Impreza 1995"], shape: { k1: 2, a1: 0.5, k2: 3, a2: 0.2, phase: 0.9, stretch: 1.5 } },
];

/** How much slower than the quickest each driver typically is, in ms. */
const SKILL: Record<number, number> = { 1: 204, 2: 0, 3: 756, 4: 1441, 5: 2300 };

export const key = (c: Combo) => `${c.game}|${c.track}|${c.layout}|${c.car}`;

function makeLaps(): Lap[] {
  const laps: Lap[] = [];
  let id = 1;
  for (const [ti, t] of TRACKS.entries()) {
    for (const [ci, car] of t.cars.entries()) {
      for (const d of DRIVERS) {
        // Alex has only driven Brands Hatch; each driver sticks to a couple of cars.
        if (d.id === 5 && t.track !== "Brands Hatch") continue;
        if (t.kind === "rally" && d.id > 3) continue;
        if (ci > 0 && (d.id + ti + ci) % 3 === 0) continue;
        const r = rng(d.id * 1000 + ti * 100 + ci * 10 + 7);
        const count = 6 + Math.floor(r() * 9) - (d.id === 5 ? 2 : 0);
        const carPenalty = ci * 650;
        // Laps are spread over the last ten days, newest at the end.
        for (let n = 1; n <= count; n++) {
          const recordedAt = NOW - (10 - (n / count) * 9.8) * DAY - Math.floor(r() * 5 * HOUR);
          const cut = r() < 0.12;
          const outLap = n === 1 && r() < 0.5;
          const warm = Math.max(0, 5 - n) * 700; // early laps are slower
          const timeMs = Math.round(t.baseMs + carPenalty + SKILL[d.id] + warm + r() * 1800 + (cut ? -600 : 0));
          const s1 = Math.round(timeMs * (0.305 + r() * 0.01));
          const s2 = Math.round(timeMs * (0.395 + r() * 0.012));
          laps.push({
            id: id++,
            game: t.game,
            track: t.track,
            layout: t.layout,
            car,
            driverId: d.id,
            sessionKind: n % 7 === 0 ? "race" : "practice",
            lapNumber: n,
            timeMs: outLap ? timeMs + 22_000 : timeMs,
            valid: !cut && !outLap,
            untimedReason: outLap ? "outLap" : cut ? "cut" : null,
            sectorsMs: [s1, s2, timeMs - s1 - s2],
            recordedAt: Math.round(recordedAt),
          });
        }
      }
    }
  }
  // A couple of guest laps someone can claim.
  const imola = TRACKS[0];
  for (const [i, extra] of [1500, 2600].entries()) {
    laps.push({
      id: id++, game: imola.game, track: imola.track, layout: imola.layout, car: CARS[0], driverId: null, sessionKind: "practice",
      lapNumber: i + 1, timeMs: imola.baseMs + 900 + extra, valid: true, untimedReason: null,
      sectorsMs: [31_900, 41_300, imola.baseMs + 900 + extra - 73_200], recordedAt: NOW - (i + 1) * 40 * MIN,
    });
  }
  return laps.sort((a, b) => a.recordedAt - b.recordedAt);
}

export const LAPS: Lap[] = makeLaps();

export const CHALLENGES: Challenge[] = [
  {
    id: 1, name: "Imola Hot Lap Week", game: "acevo", track: "Imola", layout: "GP", car: null,
    startsAt: NOW - 5 * DAY, endsAt: NOW + 2 * DAY + 4 * HOUR, validOnly: true, maxLaps: null,
    prizes: [{ place: "1st", prize: "Coffee on the team" }, { place: "2nd", prize: "A biscuit of your choice" }, { place: "3rd", prize: "Bragging rights" }],
    rewardSize: "medium", createdAt: NOW - 6 * DAY,
  },
  {
    id: 2, name: "Brands Hatch Sprint", game: "acevo", track: "Brands Hatch", layout: "GP", car: CARS[0],
    startsAt: NOW - 20 * DAY, endsAt: NOW - 13 * DAY, validOnly: true, maxLaps: 10,
    prizes: [{ place: "1st", prize: "Lunch" }], rewardSize: "low", createdAt: NOW - 21 * DAY,
  },
];


/** The pro-lap challenges, copied from crates/tt-core/pro_challenges.toml so the mock server can serve them. */
const pro = (c: Omit<ProChallenge, "games" | "marginPercent" | "limitMs" | "rewards" | "layouts" | "trackPatterns"> & { games?: string[] }): ProChallenge => ({
  games: ["acevo"], layouts: c.layout ? [c.layout] : [], trackPatterns: [c.track], marginPercent: 3, limitMs: Math.floor(c.timeMs * 1.03), rewards: { proLevel: { xp: 1000, coins: 800 }, beat: { xp: 3000, coins: 2000 } }, ...c,
});
export const PRO_CHALLENGES: ProChallenge[] = [
  pro({ id: "nord-992-gt3rs", name: "Nordschleife", track: "Nurburgring", layout: "Nordschleife", car: "Porsche 911 (992) GT3 RS", class: null, timeMs: 409328, driver: "Jörg Bergmeister", date: "2022-10", realCar: "Porsche 911 GT3 RS (992.1)", session: "Record attempt, full 20.832 km lap", confidence: "A", source: "Notarised record attempt", about: "In October 2022 Porsche took a standard 992 GT3 RS, the road car, round the full Nordschleife in 6:49.328 with Jörg Bergmeister driving. The run was timed and certified by a notary. A flying lap on warm tyres, so treat it as a target to approach.", art: "nordschleife-992-gt3-rs.jpg", artOffset: null, cardOffset: "53% 50%" }),
  pro({ id: "bathurst-gt3", name: "Mount Panorama", track: "Mount Panorama", layout: "GP", car: null, class: "GT3", timeMs: 121567, driver: "Shane van Gisbergen", date: "2016-02", realCar: "McLaren 650S GT3", session: "12 Hour race lap", confidence: "A", source: "Official timing", about: "The quickest restricted GT3 lap we have: Shane van Gisbergen's 2:01.567 in the 2016 Bathurst 12 Hour. The sim has no 650S, so any GT3 car can take it on.", art: "mount-panorama-650s-gt3.jpg", artOffset: null, cardOffset: "64% 50%" }),
  pro({ id: "monza-f2004", name: "Monza", track: "Monza", layout: "", car: "Ferrari F2004", class: null, timeMs: 80089, driver: "Rubens Barrichello", date: "2004-09", realCar: "Ferrari F2004", session: "2004 Italian Grand Prix, pole", confidence: "A", source: "Official qualifying result", about: "Rubens Barrichello's pole lap for the 2004 Italian Grand Prix in the same car: 1:20.089. One qualifying lap, so a low fuel load and fresh tyres.", art: "monza-ferrari-f2004.jpg", artOffset: null, cardOffset: "43% 50%" }),
  pro({ id: "laguna-gt3r", name: "Laguna Seca", track: "Laguna Seca", layout: "", games: ["acevo", "ac"], car: null, class: "GT3", timeMs: 83528, driver: "Matt Campbell", date: "2019-03", realCar: "Porsche 911 GT3 R (991)", session: "2019 California 8 Hours, pole shootout", confidence: "B", source: "Wikipedia qualifying table; the pole was about 0.37 s quicker", about: "Matt Campbell's lap in the Wright Motorsports Porsche 911 GT3 R, in the pole shootout for the 2019 California 8 Hours. Any GT3 car can take it on.", art: "laguna-seca-911-gt3-r.jpg", artOffset: null, cardOffset: "52% 50%" }),
  pro({ id: "brands-gt3", name: "Brands Hatch", track: "Brands Hatch", layout: "GP", games: ["acevo", "ac"], car: null, class: "GT3", timeMs: 82557, driver: "Raffaele Marciello", date: "", realCar: "Mercedes-AMG GT3 Evo", session: "GT3 lap listed for the Grand Prix circuit", confidence: "C", source: "Wikipedia circuit page", about: "Raffaele Marciello's 1:22.557 in a Mercedes-AMG GT3 Evo is the GT3 lap listed for Brands Hatch's Grand Prix circuit. Any GT3 car can take it on.", art: "brands-hatch-amg-gt3.jpg", artOffset: null, cardOffset: "56% 50%" }),
  pro({ id: "rbr-f1-2025-pole", name: "Red Bull Ring", track: "Red Bull Ring", layout: "", car: "Ferrari SF-25", class: null, timeMs: 63971, driver: "Lando Norris", date: "2025-06", realCar: "McLaren MCL39", session: "2025 Austrian Grand Prix, pole", confidence: "B", source: "RacingNews365 qualifying results", about: "Lando Norris's pole lap for the 2025 Austrian Grand Prix: 1:03.971. The sim has the Ferrari SF-25 from the same season, the closest car.", art: "red-bull-ring-mclaren-mcl39.jpg", artOffset: null, cardOffset: "58% 50%" }),
];

/** Some counted laps to start with: driver, time in ms past the pro, laps driven. */
export const PRO_BOARDS: Record<string, [number, number, number][]> = {
  "nord-992-gt3rs": [[2, 10542, 7], [1, 11612, 5], [4, 20154, 3], [3, 31672, 2]],
  "bathurst-gt3": [[4, 2330, 4]],
};

export function proBoard(c: ProChallenge, NOW_MS: number): ProBest[] {
  return (PRO_BOARDS[c.id] ?? []).map(([driverId, over, attempts], i) => ({ driverId, timeMs: c.timeMs + over, lapId: 9000 + i, at: NOW_MS - (i + 1) * 3 * HOUR, attempts }));
}

/** An outline from a wobbly closed curve: different per track, enough to look like circuits. */
function outline(shape: TrackDef["shape"], closed: boolean): [number, number][] {
  const pts: [number, number][] = [];
  const n = 360;
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    const r = 700 * (1 + shape.a1 * Math.sin(shape.k1 * th + shape.phase) + shape.a2 * Math.sin(shape.k2 * th - shape.phase));
    pts.push([Math.round(Math.cos(th) * r * shape.stretch), Math.round(Math.sin(th) * r)]);
  }
  return closed ? pts : pts.slice(0, 300);
}

export const MAPS: TrackMapData[] = TRACKS.map((t) => ({
  game: t.game, track: t.track, layout: t.layout, points: outline(t.shape, t.kind !== "rally"), rotate: 0, mirror: false, closed: t.kind !== "rally",
}));

export function catalogue(game: string): Catalogue {
  const tracks = TRACKS.filter((t) => t.game === game);
  const cars = [...new Set(tracks.flatMap((t) => t.cars))];
  return {
    game,
    tracks: tracks.map((t) => ({ name: t.track, country: t.country, aliases: [], kind: t.kind, seen: true, layouts: [{ name: t.layout, seen: true, hasMap: true }] })),
    cars: cars.map((c) => ({ name: c, brand: c.split(" ")[0], class: c.includes("GT3") ? "GT3" : "Rally", aliases: [], seen: true })),
  };
}

/** The shop's prices, copied from crates/tt-core/src/shop.rs so the mock server can sell things. */
export const SHOP_ITEMS: { slot: "shell" | "decal" | "stripe" | "face"; id: string; price: number; minLevel: number }[] = [
  ...[["sunset", 150, 1], ["ocean", 150, 1], ["ember", 150, 1], ["lagoon", 180, 1], ["aurora", 320, 3], ["rally", 420, 3], ["holo", 1500, 5], ["gold", 2000, 9], ["nightsky", 1200, 5], ["inferno", 1500, 5], ["nebula", 1800, 7], ["glacier", 1200, 5], ["galaxy", 1600, 6]].map(([id, price, minLevel]) => ({ slot: "shell" as const, id: id as string, price: price as number, minLevel: minLevel as number })),
  ...[["flame", 0, 1], ["bolt", 0, 1], ["star", 40, 1], ["chequer", 40, 1], ["heart", 60, 1], ["flag", 80, 1], ["moon", 80, 1], ["wing", 160, 2], ["crown", 250, 6], ["skull", 300, 3]].map(([id, price, minLevel]) => ({ slot: "decal" as const, id: id as string, price: price as number, minLevel: minLevel as number })),
  ...[["centre", 0, 1], ["twin", 20, 1], ["band", 20, 1], ["chequer", 100, 2]].map(([id, price, minLevel]) => ({ slot: "stripe" as const, id: id as string, price: price as number, minLevel: minLevel as number })),
  ...[["chill", 0, 1], ["focus", 0, 1], ["happy", 0, 1], ["cheeky", 20, 1], ["sleepy", 40, 1], ["wide", 40, 1], ["angry", 60, 1], ["peaked", 60, 1], ["stars", 150, 2], ["hearts", 150, 2], ["cash", 300, 4]].map(([id, price, minLevel]) => ({ slot: "face" as const, id: id as string, price: price as number, minLevel: minLevel as number })),
];
