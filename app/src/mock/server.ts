// A tiny in-memory stand-in for the Bin It server, for UI work without the app or a game running.
// Turn it on in dev with `?mock` on the page URL (`?mock=0` turns it off). See src/api.ts.

import { ApiError } from "../api";
import type {
  About, AppEvent, Awards, Challenge, Combo, Device, Driver, Lap, LapResult, LeaderboardEntry, LeaderboardQuery, LiveView, OverlayShow, Profile, ProfileBest,
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

// ---- paired phones ----------------------------------------------------------------------
// Jess already has a phone, so picking Jess on another one asks for a code: try that flow, and the
// "Phones" dialog on the Drivers page. Everyone else is free to claim.

interface MockDevice extends Device {
  token: string;
}
const devices: MockDevice[] = [{ id: 1, driverId: 2, token: "mock-jess-phone", label: "Pixel (Android phone)", createdAt: NOW - 6 * 86_400_000, lastSeen: NOW - 3_600_000 }];
let nextDevice = 2;
const pairCodes = new Map<number, { code: string; until: number }>();

/** In the mock, a wide window is "the PC" (can manage everyone) and a phone-sized one is a phone. */
const isLocal = () => !window.matchMedia("(max-width: 640px)").matches;
const callerDriver = (token?: string | null) => devices.find((d) => d.token === token)?.driverId ?? null;
const claimed = (id: number) => devices.some((d) => d.driverId === id);
function mayManage(id: number, token?: string | null) {
  if (!isLocal() && callerDriver(token) !== id) throw new ApiError("this driver belongs to another phone: do it on the PC or on their phone", undefined, 403);
}
const publicDevice = ({ token: _t, ...d }: MockDevice): Device => d;

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
      deltaMs: Math.round(Math.sin(p * 6) * 380 - 82), reference: "PB", currentSector: sector,
      references: [
        { kind: "pb", label: "PB", deltaMs: Math.round(Math.sin(p * 6) * 380 - 82) },
        { kind: "best", label: "Best", deltaMs: Math.round(Math.sin(p * 6) * 380 + 204) },
      ],
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
  const personalBest = own.every((l) => l.timeMs > timeMs);
  const awards: Awards = { xp: 10, coins: 1, levelUp: null, reasons: ["Clean lap"] };
  if (personalBest && own.length > 0) {
    awards.xp += 50;
    awards.coins += 5;
    awards.reasons.push("Personal best");
  }
  const result: LapResult = { lap, personalBest, comboRecord: false, challenges: [], awards };
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

// ---- XP and the profile (the same rules as tt-core/src/progress.rs, worked out from the laps) ----

const xpForLevel = (l: number) => (100 * (l - 1) * l) / 2;
const levelOf = (xp: number) => {
  let l = 1;
  while (xpForLevel(l + 1) <= xp) l++;
  return l;
};
const TITLES = ["Rookie", "Qualifier", "Regular", "Podium Regular", "Contender", "Veteran", "Veteran", "Ace", "Ace"];
const titleFor = (l: number) => TITLES[l - 1] ?? "Legend";

function driverProfile(id: number): Profile {
  const driver = drivers.find((d) => d.id === id)!;
  const mine = laps.filter((l) => l.driverId === id).sort((a, b) => a.recordedAt - b.recordedAt);
  let xp = 0;
  let coins = 0;
  const events: Profile["recent"] = [];
  const bestSoFar = new Map<string, number>();
  const give = (kind: string, x: number, c: number, lap: Lap) => {
    xp += x;
    coins += c;
    events.push({ id: events.length + 1, driverId: id, kind, xp: x, coins: c, lapId: lap.id, at: lap.recordedAt });
  };
  for (const l of mine) {
    if (!l.valid) continue;
    const k = key(l);
    const prev = bestSoFar.get(k);
    if (prev == null) give("first", 25, 2, l);
    give("lap", 10, 1, l);
    if (prev != null && l.timeMs < prev) give("pb", 50, 5, l);
    bestSoFar.set(k, Math.min(prev ?? Infinity, l.timeMs));
  }
  const valid = mine.filter((l) => l.valid);
  const attempts = mine.filter((l) => l.valid || l.untimedReason == null || l.untimedReason === "cut").length;
  const level = levelOf(xp);
  const best = new Map<string, { combo: Lap; ms: number }>();
  for (const l of laps) {
    if (!l.valid || l.driverId == null) continue;
    const k = `${key(l)}|${l.driverId}`;
    if (!best.has(k) || l.timeMs < best.get(k)!.ms) best.set(k, { combo: l, ms: l.timeMs });
  }
  const bests: ProfileBest[] = [...best.values()]
    .filter((b) => b.combo.driverId === id)
    .map((b) => {
      const rivals = [...best.values()].filter((o) => key(o.combo) === key(b.combo));
      return { game: b.combo.game, track: b.combo.track, layout: b.combo.layout, car: b.combo.car, timeMs: b.ms, position: 1 + rivals.filter((o) => o.ms < b.ms).length, of: rivals.length };
    });
  const tracks = new Set(valid.map((l) => `${l.game}|${l.track}|${l.layout}`)).size;
  const days = [...new Set(valid.map((l) => Math.floor(l.recordedAt / 86_400_000)))].sort((a, b) => a - b);
  let streak = 0;
  const today = Math.floor(Date.now() / 86_400_000);
  if (days.length && today - days[days.length - 1] <= 1) {
    streak = 1;
    for (let i = days.length - 1; i > 0 && days[i] - days[i - 1] === 1; i--) streak++;
  }
  const sticker = (sid: string, name: string, hint: string, earned: boolean) => ({ id: sid, name, hint, earned });
  return {
    driver, level, title: titleFor(level), nextTitle: titleFor(level + 1), xp, levelStartXp: xpForLevel(level), nextLevelXp: xpForLevel(level + 1), coins,
    attempts, cleanLaps: valid.length, cleanPercent: attempts ? Math.round((valid.length * 100) / attempts) : 100, tracks, streakDays: streak, bests,
    stickers: [
      sticker("first-lap", "First lap", "Set a clean lap", valid.length >= 1),
      sticker("ten-clean", "10 clean laps", "Ten laps with no cuts", valid.length >= 10),
      sticker("fifty-clean", "50 clean laps", "Fifty laps with no cuts", valid.length >= 50),
      sticker("explorer", "3 tracks", "Set a clean lap on three tracks", tracks >= 3),
      sticker("record", "Track record", "Hold the fastest lap on a track and car", bests.some((b) => b.position === 1 && b.of > 1)),
      sticker("streak", "3-day streak", "Drive three days in a row", streak >= 3),
      sticker("clean-sweep", "Clean sweep", "Ten attempts, none cut", attempts >= 10 && valid.length === attempts),
      sticker("regular", "Level 5", "Reach level 5", level >= 5),
    ],
    recent: events.slice(-8).reverse(),
  };
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
export async function mockRequest<T>(method: string, path: string, body?: any, token?: string | null): Promise<T> {
  await new Promise((r) => setTimeout(r, 30)); // so loading states are seen
  const url = new URL(path, "http://mock");
  const p = url.pathname;
  const q = url.searchParams;
  const m = (re: RegExp) => p.match(re);
  const ok = (v: unknown) => v as T;
  let r: RegExpMatchArray | null;

  if (p === "/status") return ok(status());
  if (p === "/me") return ok({ driver: drivers.find((d) => d.id === callerDriver(token)) ?? null, local: isLocal() });
  if (p === "/me/pair") {
    const d = drivers.find((x) => x.id === body.driverId);
    if (!d) throw new ApiError("no such driver", undefined, 400);
    if (claimed(d.id)) {
      const entry = pairCodes.get(d.id);
      if (!body.code) throw new ApiError("this driver already has a phone: ask for a pairing code", "codeNeeded", 403);
      if (!entry || entry.until < Date.now() || entry.code !== String(body.code).trim()) throw new ApiError("that code is wrong or has run out", "badCode", 403);
      pairCodes.delete(d.id);
    }
    const t = `mock-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    devices.push({ id: nextDevice++, driverId: d.id, token: t, label: isLocal() ? "Browser" : "Phone", createdAt: Date.now(), lastSeen: Date.now() });
    emit({ type: "driversChanged" });
    return ok({ token: t, driver: d });
  }
  if (p === "/me/logout") {
    const i = devices.findIndex((x) => x.token === token);
    if (i >= 0) devices.splice(i, 1);
    emit({ type: "driversChanged" });
    return ok(i >= 0);
  }
  if ((r = m(/^\/drivers\/(\d+)\/profile$/))) return ok(driverProfile(+r[1]));
  if ((r = m(/^\/drivers\/(\d+)\/pair-code$/))) {
    if (claimed(+r[1])) mayManage(+r[1], token);
    const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    const until = Date.now() + 5 * 60_000;
    pairCodes.set(+r[1], { code, until });
    return ok({ code, expiresAt: until });
  }
  if ((r = m(/^\/drivers\/(\d+)\/devices$/))) {
    mayManage(+r[1], token);
    if (method === "DELETE") {
      const before = devices.length;
      for (let i = devices.length - 1; i >= 0; i--) if (devices[i].driverId === +r[1]) devices.splice(i, 1);
      pairCodes.delete(+r[1]);
      emit({ type: "driversChanged" });
      return ok(before - devices.length);
    }
    return ok(devices.filter((d) => d.driverId === +r![1]).map(publicDevice));
  }
  if ((r = m(/^\/devices\/(\d+)$/)) && method === "DELETE") {
    const i = devices.findIndex((d) => d.id === +r![1]);
    if (i < 0) return ok(false);
    mayManage(devices[i].driverId, token);
    devices.splice(i, 1);
    emit({ type: "driversChanged" });
    return ok(true);
  }
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
    if (claimed(+r[1])) mayManage(+r[1], token);
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
