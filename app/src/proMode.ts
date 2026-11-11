// Pro-lap challenge mode, as the screens use it: does the game's setup match, and how far behind the pro is a lap in
// progress. The same rules as the server's lap matching (crates/tt-core/src/pro.rs), so the overlay and the Pro laps
// page agree with what actually counts.

import type { Catalogue, Combo, DriverId, LiveView, ProChallenge, ProEntry, Pay } from "./api";
import { carName, gameName, trackName } from "./format";

const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Whether `text` fits `pattern`, where `*` is "anything" and capitals, spaces and punctuation never matter. */
export function fits(pattern: string, text: string): boolean {
  const t = key(text);
  const parts = pattern.split("*").map(key);
  if (parts.length === 1) return parts[0] === t;
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!t.startsWith(first) || t.length < first.length + last.length || !t.endsWith(last)) return false;
  let rest = t.slice(first.length, t.length - last.length);
  for (const part of parts.slice(1, -1)) {
    const at = rest.indexOf(part);
    if (at < 0) return false;
    rest = rest.slice(at + part.length);
  }
  return true;
}

export interface SetupCheck {
  ok: boolean;
  /** What the game is running now, for display. */
  has: string;
}

/** What the game is running next to what the challenge needs (a tick or a cross for each). */
export interface Setup {
  game: SetupCheck;
  track: SetupCheck;
  layout: SetupCheck;
  car: SetupCheck;
  /** All four match: laps count. */
  ok: boolean;
}

export function setupFor(c: ProChallenge, session: Combo | null | undefined, catalogue: Catalogue | null): Setup | null {
  if (!session) return null;
  const sessionClass = catalogue?.cars.find((x) => x.name === session.car)?.class ?? null;
  const car = c.car ? session.car === c.car : !!c.class && sessionClass?.toLowerCase() === c.class.toLowerCase();
  const checks = {
    game: { ok: c.games.length === 0 || c.games.includes(session.game), has: gameName(session.game) },
    track: { ok: c.trackPatterns.some((p) => fits(p, session.track)), has: trackName(session.track) },
    layout: { ok: c.layouts.length === 0 || c.layouts.some((l) => fits(l, session.layout)), has: session.layout || "Default layout" },
    car: { ok: car, has: carName(session.car) },
  };
  return { ...checks, ok: checks.game.ok && checks.track.ok && checks.layout.ok && checks.car.ok };
}

/** What the pro's lap needs from a car, in words: the one car, or "Any GT3". */
export function carNeeded(c: Pick<ProChallenge, "car" | "class">): string {
  return c.car ? carName(c.car) : c.class ? `Any ${c.class}` : "Any car";
}

/** How the lap in progress stands against the pro lap. */
export interface ProLive {
  /** This lap minus where the pro would be by now: positive is behind. */
  gapMs: number;
  /** The lap time it is on course for, if the rest goes the way it has so far. */
  onPaceMs: number;
  /** Where the car is, and where the pro would be, as fractions of the lap. */
  progress: number;
  proProgress: number;
}

/**
 * The pro's lap is one time, not a trace, so where the pro "is" at this point of the lap is worked out: the driver's own
 * personal-best lap, scaled so it takes the pro's time (their shape of lap, the pro's pace). With no PB it is even
 * pace round the lap. Too early in the lap to say, or not on a timed lap, there is no figure.
 */
export function proLive(live: LiveView | null | undefined, proMs: number, pbMs: number | null): ProLive | null {
  if (!live || !live.driving || live.outLap || !live.lapValid || live.currentLapMs <= 0 || live.lapProgress < 0.02 || live.lapProgress >= 1) return null;
  const pbDelta = live.timing?.references?.find((r) => r.kind === "pb")?.deltaMs ?? null;
  const pbAt = pbDelta != null && pbMs ? live.currentLapMs - pbDelta : null;
  const proAt = pbAt != null && pbMs && pbAt > 0 ? pbAt * (proMs / pbMs) : proMs * live.lapProgress;
  if (proAt <= 0) return null;
  const gapMs = live.currentLapMs - proAt;
  return {
    gapMs,
    onPaceMs: proMs * (live.currentLapMs / proAt),
    progress: live.lapProgress,
    proProgress: Math.min(1, Math.max(0, live.lapProgress + gapMs / proMs)),
  };
}

export type ProStanding = "ahead" | "inRange" | "outOfRange";

export function standing(gapMs: number, proMs: number, limitMs: number): ProStanding {
  if (gapMs <= 0) return "ahead";
  return gapMs <= limitMs - proMs ? "inRange" : "outOfRange";
}

/** Where a gap sits on the range bar, 0 (far out of range) to 1 (level with the pro). The bar runs to 1.5x the pro-level gap. */
export function rangePosition(gapMs: number, proMs: number, limitMs: number): number {
  const span = Math.max(1, (limitMs - proMs) * 1.5);
  return Math.min(1, Math.max(0, 1 - gapMs / span));
}

export interface ProRow {
  driverId: DriverId;
  /** This driver's best counted lap minus the pro time. */
  gapMs: number;
  proLevel: boolean;
  beat: boolean;
  attempts: number;
}

/** The office against the pro: each driver's best counted lap on this challenge, best first. */
export function proRows(entry: Pick<ProEntry, "board" | "timeMs" | "limitMs">): ProRow[] {
  return [...entry.board]
    .sort((a, b) => a.timeMs - b.timeMs)
    .map((b) => ({ driverId: b.driverId, gapMs: b.timeMs - entry.timeMs, proLevel: b.timeMs <= entry.limitMs, beat: b.timeMs < entry.timeMs, attempts: b.attempts }));
}

/** What the overlay needs to draw pro mode. */
export interface ProOverlay {
  id: string;
  name: string;
  /** "Nordschleife · 911 GT3 RS (992)" style label for the header. */
  title: string;
  proMs: number;
  limitMs: number;
  driver: string;
  rewards: { proLevel: Pay; beat: Pay };
  /** The attempt now being driven (counted laps so far plus one). */
  attempt: number;
  bestMs: number | null;
  proLevelEarned: boolean;
  beatEarned: boolean;
  /** Null when the game is not running. */
  setup: Setup | null;
  need: { track: string; layout: string; car: string };
  live: ProLive | null;
  /** The running lap clock. */
  lapMs: number;
  rows: (ProRow & { name: string; color: string; isSeat: boolean })[];
  /** Lap length in metres when the map is known, to say how far behind the pro is. */
  lapLengthM: number | null;
}

export function lapLength(points: [number, number][] | undefined, closed: boolean): number | null {
  if (!points || points.length < 3) return null;
  let m = 0;
  for (let i = 1; i < points.length; i++) m += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  if (closed) m += Math.hypot(points[0][0] - points[points.length - 1][0], points[0][1] - points[points.length - 1][1]);
  return m;
}

/** "12.279" seconds with a sign. */
export function signedSeconds(ms: number): string {
  return `${ms < 0 ? "−" : "+"}${(Math.abs(ms) / 1000).toFixed(3)}`;
}
