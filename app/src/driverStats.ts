// Turns a driver's laps into the numbers and series behind their progress page.

import type { Lap } from "./api";
import { carName, trackName } from "./format";

/** A proper timed lap: valid, and not an out, in or partial lap. These are the ones that count as progress. */
export const isTimed = (l: Lap) => l.valid && l.untimedReason === null;

export const comboKey = (l: Pick<Lap, "game" | "track" | "layout" | "car">) => `${l.game}|${l.track}|${l.layout}|${l.car}`;

export interface ComboLaps {
  key: string;
  game: string;
  track: string;
  layout: string;
  car: string;
  /** Timed laps, oldest first. */
  laps: Lap[];
  /** Every attempt on this combo, cut laps included. */
  attempts: number;
  best: number;
  lastAt: number;
}

/** Track + car combinations a driver has at least one timed lap on, most recently driven first. */
export function groupCombos(all: Lap[]): ComboLaps[] {
  const map = new Map<string, ComboLaps>();
  for (const l of all) {
    const k = comboKey(l);
    let g = map.get(k);
    if (!g) {
      g = { key: k, game: l.game, track: l.track, layout: l.layout, car: l.car, laps: [], attempts: 0, best: Infinity, lastAt: 0 };
      map.set(k, g);
    }
    if (l.untimedReason === null || l.untimedReason === "cut") g.attempts++;
    if (isTimed(l)) {
      g.laps.push(l);
      g.best = Math.min(g.best, l.timeMs);
    }
    g.lastAt = Math.max(g.lastAt, l.recordedAt);
  }
  return [...map.values()].filter((g) => g.laps.length > 0).sort((a, b) => b.lastAt - a.lastAt);
}

/** The fastest time so far after each lap. */
export function runningBest(laps: Lap[]): number[] {
  let best = Infinity;
  return laps.map((l) => (best = Math.min(best, l.timeMs)));
}

const dayStart = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export interface Day {
  start: number;
  laps: Lap[];
  best: number;
}

/** Laps grouped by the calendar day they were set. */
export function byDay(laps: Lap[]): Day[] {
  const days = new Map<number, Day>();
  for (const l of laps) {
    const s = dayStart(l.recordedAt);
    const d = days.get(s) ?? { start: s, laps: [], best: Infinity };
    d.laps.push(l);
    d.best = Math.min(d.best, l.timeMs);
    days.set(s, d);
  }
  return [...days.values()].sort((a, b) => a.start - b.start);
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export interface Progress {
  first: number;
  best: number;
  /** How much faster the best is than the first lap (ms, positive = improved). */
  gained: number;
  gainedPct: number;
  /** Average of the first few laps and of the latest few, for a feel of everyday pace. */
  earlyAvg: number | null;
  recentAvg: number | null;
}

export function progressOf(laps: Lap[]): Progress | null {
  if (laps.length === 0) return null;
  const first = laps[0].timeMs;
  const best = Math.min(...laps.map((l) => l.timeMs));
  const n = Math.min(5, Math.floor(laps.length / 2));
  return {
    first,
    best,
    gained: first - best,
    gainedPct: first > 0 ? ((first - best) / first) * 100 : 0,
    earlyAvg: n >= 2 ? mean(laps.slice(0, n).map((l) => l.timeMs)) : null,
    recentAvg: n >= 2 ? mean(laps.slice(-n).map((l) => l.timeMs)) : null,
  };
}

export interface SectorProgress {
  index: number;
  first: number;
  best: number;
  gained: number;
}

/** Per sector: the first time recorded and the best since. Only laps split into the same number of sectors count. */
export function sectorProgress(laps: Lap[]): SectorProgress[] {
  const split = laps.filter((l) => l.sectorsMs.length > 0);
  if (split.length === 0) return [];
  const n = split[split.length - 1].sectorsMs.length;
  const same = split.filter((l) => l.sectorsMs.length === n);
  return Array.from({ length: n }, (_, i) => {
    const first = same[0].sectorsMs[i];
    const best = Math.min(...same.map((l) => l.sectorsMs[i]));
    return { index: i, first, best, gained: first - best };
  });
}

// ---- speed score tiers ------------------------------------------------------------------------

export interface Tier {
  key: "front" | "quick" | "mid" | "learning" | "unrated";
  label: string;
  /** Plain-words meaning, shown on the page. */
  blurb: string;
  color: string;
}

/** Groups drivers by their speed score (100 minus their average % gap to the fastest on shared tracks). */
export function tierOf(score: number | null | undefined): Tier {
  if (score === null || score === undefined) {
    return { key: "unrated", label: "Not rated yet", blurb: "Needs a lap on a track and car someone else has driven.", color: "var(--muted)" };
  }
  if (score >= 99) return { key: "front", label: "Front runners", blurb: "Within 1% of the fastest, or the fastest.", color: "var(--gold)" };
  if (score >= 97) return { key: "quick", label: "Quick", blurb: "Within 3% of the fastest.", color: "var(--mint)" };
  if (score >= 93) return { key: "mid", label: "Mid-pack", blurb: "Within 7% of the fastest.", color: "var(--peri-1)" };
  return { key: "learning", label: "Finding their pace", blurb: "More than 7% off the fastest so far.", color: "var(--peach)" };
}

/** The tier for a key, for headings. */
export const tierByKey = (key: Tier["key"]): Tier => tierOf(key === "unrated" ? null : { front: 100, quick: 98, mid: 95, learning: 90 }[key]);

export const TIER_ORDER: Tier["key"][] = ["front", "quick", "mid", "learning", "unrated"];

// ---- plain-words summary --------------------------------------------------------------------------

export interface Summary {
  tone: "great" | "good" | "steady" | "slower" | "new";
  headline: string;
  points: string[];
}

const MS_DAY = 86_400_000;

function whenWords(ms: number, now: number): string {
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(ms).setHours(0, 0, 0, 0)) / MS_DAY);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : days < 14 ? `${days} days ago` : `${Math.round(days / 7)} weeks ago`;
}

/** A few plain sentences on how a driver is doing overall: trend, standing, consistency and recency. */
export function summarize(combos: ComboLaps[], rating: { score: number | null; combos: number; fastestOn: number } | undefined, now = Date.now()): Summary {
  const timed = combos.reduce((n, c) => n + c.laps.length, 0);
  const points: string[] = [];

  if (rating?.score != null) {
    const gap = 100 - rating.score;
    const quickest = rating.fastestOn > 0 ? `, and quickest of everyone on ${rating.fastestOn} of ${rating.combos}` : "";
    points.push(
      rating.score >= 99.95
        ? `Quickest of everyone on every track and car they share${rating.combos > 1 ? ` (${rating.combos})` : ""}.`
        : `On average about ${gap < 1 ? gap.toFixed(1) : Math.round(gap)}% off the fastest drivers on the tracks and cars they share${quickest}.`,
    );
  }

  if (timed < 3) {
    points.unshift(`Only ${timed} timed ${timed === 1 ? "lap" : "laps"} so far. A few more and we can say how they're trending.`);
    return { tone: "new", headline: "Just getting started", points };
  }

  // Everyday pace: the latest laps against the first ones, on tracks driven enough to tell.
  const trends = combos
    .filter((c) => c.laps.length >= 4)
    .map((c) => ({ c, p: progressOf(c.laps)! }))
    .filter((t) => t.p.earlyAvg !== null && t.p.recentAvg !== null)
    .map((t) => ({ ...t, pct: ((t.p.earlyAvg! - t.p.recentAvg!) / t.p.earlyAvg!) * 100 }));
  const better = trends.filter((t) => t.pct > 0.3).length;
  const worse = trends.filter((t) => t.pct < -0.5).length;

  const gains = combos
    .filter((c) => c.laps.length >= 2)
    .map((c) => ({ c, p: progressOf(c.laps)! }))
    .filter((g) => g.p.gained > 0)
    .sort((a, b) => b.p.gainedPct - a.p.gainedPct);
  const top = gains[0];

  let tone: Summary["tone"] = "steady";
  let headline = "Holding steady";
  if (worse > better) {
    tone = "slower";
    headline = "A little off their pace lately";
  } else if (better > worse) {
    tone = better >= 2 || (top && top.p.gainedPct >= 1.5) ? "great" : "good";
    headline = tone === "great" ? "Getting quicker fast" : "Getting quicker";
  } else if (top && top.p.gainedPct >= 0.5) {
    tone = "good";
    headline = "Improving";
  }

  if (top) {
    points.push(`Most improved: ${trackName(top.c.track, top.c.layout)} in the ${carName(top.c.car)}, ${(top.p.gained / 1000).toFixed(3)}s quicker than their first lap (${top.p.gainedPct.toFixed(1)}%).`);
  }

  // Consistency on the track they've driven most: how many of the last few laps were close to their best.
  const main = [...combos].filter((c) => c.laps.length >= 5).sort((a, b) => b.laps.length - a.laps.length)[0];
  if (main) {
    const last = main.laps.slice(-8);
    const close = last.filter((l) => l.timeMs <= main.best * 1.015).length;
    const share = close / last.length;
    const how = share >= 0.75 ? "very consistent" : share >= 0.4 ? "fairly consistent" : "still finding consistency";
    points.push(`${how[0].toUpperCase()}${how.slice(1)}: ${close} of the last ${last.length} laps at ${trackName(main.track, main.layout)} were within 1.5% of their best.`);
  }

  const lastAt = Math.max(...combos.map((c) => c.lastAt));
  points.push(`Last drove ${whenWords(lastAt, now)}.`);
  return { tone, headline, points };
}
