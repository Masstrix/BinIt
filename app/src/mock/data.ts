// Deterministic fixtures for the dev-only mock server (see ./server.ts). Nothing here ships in a release build.

import type { Catalogue, Challenge, Combo, Driver, Lap, TrackMapData } from "../api";

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
  { id: 2, name: "Jess", color: "#2FA8FF", look: { shell: "holo", decal: "star", decalAt: "top", number: 12 }, createdAt: NOW - 29 * DAY },
  { id: 3, name: "Priya", color: "#FF5FA2", look: { shell: "nightsky", decal: "moon", stripe: "twin", number: 5 }, createdAt: NOW - 20 * DAY },
  { id: 4, name: "Tom", color: "#23C98A", look: { shell: "inferno", decal: "flame", number: 33 }, createdAt: NOW - 12 * DAY },
  { id: 5, name: "Alex", color: "#9B7BFF", look: { decal: "bolt", stripe: "band", number: 88 }, createdAt: NOW - 3 * DAY },
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
    createdAt: NOW - 6 * DAY,
  },
  {
    id: 2, name: "Brands Hatch Sprint", game: "acevo", track: "Brands Hatch", layout: "GP", car: CARS[0],
    startsAt: NOW - 20 * DAY, endsAt: NOW - 13 * DAY, validOnly: true, maxLaps: 10,
    prizes: [{ place: "1st", prize: "Lunch" }], createdAt: NOW - 21 * DAY,
  },
];

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
export const SHOP_ITEMS: { slot: "shell" | "decal" | "stripe"; id: string; price: number; minLevel: number }[] = [
  ...[["sunset", 150, 1], ["ocean", 150, 1], ["ember", 150, 1], ["lagoon", 180, 1], ["aurora", 320, 3], ["rally", 420, 3], ["holo", 1500, 5], ["gold", 2000, 9], ["nightsky", 1200, 5], ["inferno", 1500, 5], ["nebula", 1800, 7], ["glacier", 1200, 5]].map(([id, price, minLevel]) => ({ slot: "shell" as const, id: id as string, price: price as number, minLevel: minLevel as number })),
  ...[["flame", 0, 1], ["bolt", 0, 1], ["star", 40, 1], ["chequer", 40, 1], ["heart", 60, 1], ["flag", 80, 1], ["moon", 80, 1], ["wing", 160, 2], ["crown", 250, 6], ["skull", 300, 3]].map(([id, price, minLevel]) => ({ slot: "decal" as const, id: id as string, price: price as number, minLevel: minLevel as number })),
  ...[["centre", 0, 1], ["twin", 20, 1], ["band", 20, 1], ["chequer", 100, 2]].map(([id, price, minLevel]) => ({ slot: "stripe" as const, id: id as string, price: price as number, minLevel: minLevel as number })),
];
