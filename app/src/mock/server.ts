// A tiny in-memory stand-in for the Bin It server, for UI work without the app or a game running.
// Turn it on in dev with `?mock` on the page URL (`?mock=0` turns it off). See src/api.ts.

import type {
  About, AppEvent, Challenge, Combo, Driver, Lap, LapResult, LeaderboardEntry, LeaderboardQuery, LiveView, OverlayShow,
  ReplayEntry, ServerInfo, SessionView, Status, UpdateStatus,
} from "../api";
import { CHALLENGES, DRIVERS, LAPS, MAPS, NOW, TRACKS, catalogue, key } from "./data";

const drivers: Driver[] = DRIVERS.map((d) => ({ ...d }));
const laps: Lap[] = LAPS.map((l) => ({ ...l }));
const challenges: Challenge[] = CHALLENGES.map((c) => ({ ...c }));
let nextId = Math.max(...laps.map((l) => l.id)) + 1;

const imola = TRACKS[0];
const session: SessionView = {
  game: imola.game, gameName: "AC EVO", track: imola.track, layout: imola.layout, car: imola.cars[0], sessionKind: "practice",
  sectorCount: 3, boundaries: [0, 0.31, 0.7, 1],
};
const settings = { seat: 1 as number | null, overlayEnabled: true, overlayFocusOnly: true, overlayShow: "drivingPaused" as OverlayShow, lan: true };

// ---- events -----------------------------------------------------------------------

let listener: ((e: AppEvent) => void) | null = null;
const emit = (e: AppEvent) => listener?.(e);

/** Called once by the store instead of opening a WebSocket. Returns what to do on "connected". */
export function connectMock(handle: (e: AppEvent) => void) {
  listener = handle;
  startTicker();
}

// ---- the car going round Imola ---------------------------------------------------------

const LAP_MS = 102_318;
let lapStart = Date.now() - 31_000;
let ticker: ReturnType<typeof setInterval> | null = null;

function liveView(): LiveView {
  const ms = Date.now() - lapStart;
  const p = Math.min(ms / LAP_MS, 1);
  const map = MAPS[0].points;
  const pt = map[Math.min(map.length - 1, Math.floor(p * map.length))];
  const corner = Math.sin(p * Math.PI * 2 * 9);
  const sector = p < 0.31 ? 0 : p < 0.7 ? 1 : 2;
  return {
    driving: true, phase: "driving", currentLapMs: ms, lapValid: true, outLap: false, voidReason: null, lapProgress: p,
    position: [pt[0], pt[1]],
    inputs: {
      throttle: corner > -0.4 ? 1 : 0.2, brake: corner < -0.6 ? 0.8 : 0, clutch: 0, handbrake: 0, steering: Math.sin(p * Math.PI * 2 * 9 + 1) * 0.5,
      gear: 3 + Math.round(Math.abs(corner) * 3), speedKmh: Math.round(150 + 90 * corner), rpm: Math.round(6500 + 1500 * corner),
    },
    timing: {
      deltaMs: Math.round(Math.sin(p * 6) * 380 - 82), reference: "Sam's best", currentSector: sector,
      sectors: [
        { timeMs: p > 0.31 ? 31_402 : null, deltaMs: p > 0.31 ? -40 : null, status: p > 0.31 ? "green" : "current" },
        { timeMs: p > 0.7 ? 40_118 : null, deltaMs: p > 0.7 ? -210 : null, status: p > 0.7 ? "purple" : p > 0.31 ? "current" : "pending" },
        { timeMs: null, deltaMs: null, status: p > 0.7 ? "current" : "pending" },
      ],
    },
  };
}

function startTicker() {
  if (ticker) return;
  ticker = setInterval(() => {
    if (Date.now() - lapStart >= LAP_MS) finishLap();
    emit({ type: "live", live: liveView() });
  }, 200);
}

function finishLap() {
  const timeMs = LAP_MS + Math.round((Math.random() - 0.4) * 1400);
  const own = settings.seat != null ? laps.filter((l) => l.driverId === settings.seat && key(l) === key(session) && l.valid) : [];
  const lap: Lap = {
    id: nextId++, ...pick(session), driverId: settings.seat, sessionKind: "practice", lapNumber: laps.filter((l) => l.driverId === settings.seat).length + 1,
    timeMs, valid: true, untimedReason: null, sectorsMs: [Math.round(timeMs * 0.31), Math.round(timeMs * 0.4), timeMs - Math.round(timeMs * 0.71)], recordedAt: Date.now(),
  };
  laps.push(lap);
  lapStart = Date.now();
  const result: LapResult = { lap, personalBest: own.every((l) => l.timeMs > timeMs), comboRecord: false, challenges: [] };
  emit({ type: "lapRecorded", result });
}

const pick = (c: Combo): Combo => ({ game: c.game, track: c.track, layout: c.layout, car: c.car });

// ---- queries ----------------------------------------------------------------------

function board(q: LeaderboardQuery): LeaderboardEntry[] {
  let pool = laps.filter(
    (l) => l.game === q.game && l.track === q.track && l.layout === q.layout && (q.car == null || l.car === q.car) &&
      !["outLap", "inLap", "partial"].includes(l.untimedReason ?? "") && (q.includeInvalid || l.valid) &&
      (q.from == null || l.recordedAt >= q.from) && (q.to == null || l.recordedAt < q.to),
  );
  if (q.maxLaps) {
    const seen = new Map<number | null, number>();
    pool = pool.filter((l) => {
      const n = (seen.get(l.driverId) ?? 0) + 1;
      seen.set(l.driverId, n);
      return n <= q.maxLaps!;
    });
  }
  const byDriver = new Map<number | null, Lap[]>();
  for (const l of pool) byDriver.set(l.driverId, [...(byDriver.get(l.driverId) ?? []), l]);
  const entries = [...byDriver.values()].map((ls) => {
    const best = ls.reduce((a, b) => (b.timeMs < a.timeMs ? b : a));
    const sectors = best.sectorsMs.map((_, i) => Math.min(...ls.filter((l) => l.valid).map((l) => l.sectorsMs[i] ?? Infinity)));
    return { best, count: ls.length, sectors: sectors.map((s) => (Number.isFinite(s) ? s : null)) };
  });
  entries.sort((a, b) => a.best.timeMs - b.best.timeMs);
  return entries.map((e, i) => ({
    position: i + 1, driverId: e.best.driverId, lapId: e.best.id, timeMs: e.best.timeMs, gapMs: e.best.timeMs - entries[0].best.timeMs, car: e.best.car,
    lapCount: e.count, setAt: e.best.recordedAt, sectorsMs: e.best.sectorsMs, bestSectorsMs: e.sectors,
  }));
}

/** Speed round the lap as a function of progress (0..1): the same shape for everyone, slightly different per lap. */
function speedAt(p: number, seed: number) {
  return 170 + 85 * Math.sin(p * Math.PI * 2 * 9 + seed * 0.3) + 25 * Math.sin(p * Math.PI * 2 * 23);
}

function profile(timeMs: number, seed: number, step = 0.005): number[] {
  const out: number[] = [0];
  let acc = 0;
  const raw: number[] = [];
  for (let p = step; p <= 1.0001; p += step) { acc += 1 / speedAt(p, seed); raw.push(acc); }
  for (const r of raw) out.push(Math.round((r / acc) * timeMs));
  return out;
}

function trace(lapId: number) {
  const lap = laps.find((l) => l.id === lapId);
  if (!lap) return null;
  const prof = profile(lap.timeMs, lapId, 0.0025);
  const points = prof.map((elapsed, i) => {
    const p = i * 0.0025;
    const s = speedAt(p, lapId);
    const slope = speedAt(p + 0.002, lapId) - s;
    return [p, elapsed, Math.round(s), slope >= -2 ? 1 : 0.15, slope < -6 ? Math.min(1, -slope / 30) : 0, 0, Math.sin(p * Math.PI * 2 * 9 + 1) * 0.5, Math.max(1, Math.min(6, Math.round(s / 45)))];
  });
  return { lapId, points };
}

function replay(id: number): ReplayEntry[] {
  const c = challenges.find((x) => x.id === id);
  if (!c) return [];
  return board({ game: c.game, track: c.track, layout: c.layout, car: c.car, from: c.startsAt, to: c.endsAt, includeInvalid: !c.validOnly, maxLaps: c.maxLaps }).map((e) => ({
    position: e.position, driverId: e.driverId, lapId: e.lapId, timeMs: e.timeMs, profile: profile(e.timeMs, e.lapId),
  }));
}

function ratings() {
  const combos = new Map<string, Map<number, number>>();
  for (const l of laps) {
    if (l.driverId == null || !l.valid) continue;
    const m = combos.get(key(l)) ?? new Map<number, number>();
    m.set(l.driverId, Math.min(m.get(l.driverId) ?? Infinity, l.timeMs));
    combos.set(key(l), m);
  }
  return drivers.map((d) => {
    let gaps: number[] = [];
    let fastest = 0;
    let mine = 0;
    for (const m of combos.values()) {
      if (!m.has(d.id)) continue;
      mine++;
      if (m.size < 2) continue;
      const best = Math.min(...m.values());
      gaps.push(((m.get(d.id)! - best) / best) * 100);
      if (m.get(d.id) === best) fastest++;
    }
    gaps = gaps.filter((g) => Number.isFinite(g));
    return { driverId: d.id, score: gaps.length ? Math.round((100 - gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10 : null, combos: mine, fastestOn: fastest };
  });
}

function status(): Status {
  return {
    game: session.game, gameName: session.gameName, connected: true, session, seat: settings.seat, live: liveView(),
    overlayEnabled: settings.overlayEnabled, overlayFocusOnly: settings.overlayFocusOnly, overlayShow: settings.overlayShow,
  };
}

const about: About = {
  name: "Bin It", version: "0.6.0", buildNumber: 0, build: "development", os: "Mock data", webview: null, dataDir: null, dbBytes: null, port: 7878, lanEnabled: true,
  counts: { drivers: drivers.length, laps: laps.length, timedLaps: laps.length, tracedLaps: 0, challenges: challenges.length, schemaVersion: 0, createdWith: null, previousVersion: null },
};
const update: UpdateStatus = { current: "0.6.0", kind: "development", latest: null, checking: false, lastChecked: NOW, error: null, stage: null };
const server: ServerInfo = { port: 7878, lanEnabled: true, urls: ["http://192.168.0.79:7878"] };

// ---- the router ----------------------------------------------------------------------

/** Answers a request the way the real server does (see the `api` object in src/api.ts for the shapes). */
export async function mockRequest<T>(method: string, path: string, body?: any): Promise<T> {
  await new Promise((r) => setTimeout(r, 30)); // so loading states are seen
  const url = new URL(path, "http://mock");
  const p = url.pathname;
  const q = url.searchParams;
  const m = (re: RegExp) => p.match(re);
  const ok = (v: unknown) => v as T;
  let r: RegExpMatchArray | null;

  if (p === "/status") return ok(status());
  if (p === "/server") return ok(server);
  if (p === "/settings/lan") { settings.lan = !!body?.enabled; return ok(settings.lan); }
  if (p === "/drivers/ratings") return ok(ratings());
  if (p === "/drivers" && method === "GET") return ok(drivers);
  if (p === "/drivers" && method === "POST") {
    const d: Driver = { id: Math.max(0, ...drivers.map((x) => x.id)) + 1, name: String(body.name).trim(), color: body.color ?? "#8B8BF5", createdAt: Date.now() };
    drivers.push(d);
    if (body.seat) settings.seat = d.id;
    emit({ type: "driversChanged" });
    if (body.seat) emit({ type: "seatChanged", driverId: d.id });
    return ok(d);
  }
  if ((r = m(/^\/drivers\/(\d+)\/laps$/))) return ok(laps.filter((l) => l.driverId === +r![1]));
  if ((r = m(/^\/drivers\/(\d+)$/)) && method === "PUT") {
    const d = drivers.find((x) => x.id === +r![1])!;
    d.name = body.name; d.color = body.color;
    emit({ type: "driversChanged" });
    return ok(d);
  }
  if (p === "/seat") { settings.seat = body.driverId; emit({ type: "seatChanged", driverId: settings.seat }); lapStart = Date.now(); return ok(settings.seat); }
  if (p === "/laps/recent") return ok([...laps].sort((a, b) => b.recordedAt - a.recordedAt).slice(0, +(q.get("limit") ?? 20)));
  if ((r = m(/^\/laps\/(\d+)\/claim$/))) { const l = laps.find((x) => x.id === +r![1]); if (l) l.driverId = body.driverId; emit({ type: "lapsChanged" }); return ok(null); }
  if ((r = m(/^\/laps\/(\d+)\/trace$/))) return ok(trace(+r[1]));
  if (p === "/combos") {
    const seen = new Map<string, Combo>();
    for (const l of laps) if (!q.get("game") || l.game === q.get("game")) seen.set(key(l), pick(l));
    return ok([...seen.values()]);
  }
  if (p === "/catalogue") return ok(catalogue(q.get("game") ?? "acevo"));
  if (p === "/maps" && method === "GET") return ok(MAPS.filter((x) => x.game === q.get("game")));
  if (p === "/maps/view") return ok(null);
  if (p === "/sectors") return ok([0, 0.31, 0.7, 1]);
  if (p === "/learning") return ok([]);
  if (p === "/leaderboard") return ok(board(body));
  if (p === "/challenges" && method === "GET") return ok(challenges);
  if (p === "/challenges" && method === "POST") {
    const c: Challenge = { ...body, id: Math.max(0, ...challenges.map((x) => x.id)) + 1, createdAt: Date.now(), startsAt: body.startsAt ?? Date.now() };
    challenges.push(c);
    emit({ type: "challengesChanged" });
    return ok(c);
  }
  if ((r = m(/^\/challenges\/(\d+)\/leaderboard$/))) {
    const c = challenges.find((x) => x.id === +r![1]);
    return ok(c ? board({ game: c.game, track: c.track, layout: c.layout, car: c.car, from: c.startsAt, to: c.endsAt, includeInvalid: !c.validOnly, maxLaps: c.maxLaps }) : []);
  }
  if ((r = m(/^\/challenges\/(\d+)\/replay$/))) return ok(replay(+r[1]));
  if ((r = m(/^\/challenges\/(\d+)\/end$/))) { const c = challenges.find((x) => x.id === +r![1]); if (c) c.endsAt = Date.now(); emit({ type: "challengesChanged" }); return ok(null); }
  if ((r = m(/^\/challenges\/(\d+)$/)) && method === "DELETE") { challenges.splice(challenges.findIndex((x) => x.id === +r![1]), 1); emit({ type: "challengesChanged" }); return ok(null); }
  if (m(/^\/overlay\/layout\//)) return ok(null);
  if (p === "/overlay/enabled") { settings.overlayEnabled = !!body.enabled; emit({ type: "overlaySettings", enabled: settings.overlayEnabled, focusOnly: settings.overlayFocusOnly, show: settings.overlayShow }); return ok(settings.overlayEnabled); }
  if (p === "/overlay/show") { settings.overlayShow = body.mode; emit({ type: "overlaySettings", enabled: settings.overlayEnabled, focusOnly: settings.overlayFocusOnly, show: settings.overlayShow }); return ok(body.mode); }
  if (p === "/overlay/focus-only") { settings.overlayFocusOnly = !!body.enabled; emit({ type: "overlaySettings", enabled: settings.overlayEnabled, focusOnly: settings.overlayFocusOnly, show: settings.overlayShow }); return ok(settings.overlayFocusOnly); }
  if (p === "/update" || p === "/update/check" || p === "/update/install") return ok(update);
  if (p === "/admin/about") return ok(about);
  if (p === "/admin/laps/count") return ok(0);
  if (p === "/admin/laps/delete") return ok(0);
  throw new Error(`Mock server has no route for ${method} ${p}`);
}
