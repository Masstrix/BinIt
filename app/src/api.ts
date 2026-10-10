// Client for the TimeTrial local server. The desktop window, the overlay and
// office browsers all use this; only the base URL differs.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

export type DriverId = number;

export interface Driver {
  id: DriverId;
  name: string;
  color: string;
  createdAt: number;
}

export interface Combo {
  game: string;
  track: string;
  layout: string;
  car: string;
}

export interface Lap extends Combo {
  id: number;
  driverId: DriverId | null;
  sessionKind: string;
  lapNumber: number;
  timeMs: number;
  valid: boolean;
  sectorsMs: number[];
  recordedAt: number;
}

export interface Prize {
  place: string;
  prize: string;
}

export interface Challenge {
  id: number;
  name: string;
  game: string;
  track: string;
  layout: string;
  car: string | null;
  startsAt: number;
  endsAt: number | null;
  validOnly: boolean;
  maxLaps: number | null;
  prizes: Prize[];
  createdAt: number;
}

export type NewChallenge = Omit<Challenge, "id" | "createdAt" | "startsAt"> & { startsAt?: number | null };

export interface LeaderboardQuery {
  game: string;
  track: string;
  layout: string;
  car: string | null;
  from?: number | null;
  to?: number | null;
  includeInvalid?: boolean;
  maxLaps?: number | null;
}

export interface LeaderboardEntry {
  position: number;
  driverId: DriverId | null;
  lapId: number;
  timeMs: number;
  gapMs: number;
  car: string;
  lapCount: number;
  setAt: number;
}

export interface SessionView extends Combo {
  gameName: string;
  sessionKind: string;
}

export interface LiveView {
  driving: boolean;
  currentLapMs: number;
  lapValid: boolean;
  lapProgress: number;
}

export interface Status {
  game: string | null;
  gameName: string | null;
  connected: boolean;
  session: SessionView | null;
  seat: DriverId | null;
  live: LiveView | null;
  overlayEnabled: boolean;
  overlayFocusOnly: boolean;
}

export interface ChallengeStanding {
  challengeId: number;
  challengeName: string;
  position: number | null;
  previousPosition: number | null;
  gapToLeaderMs: number | null;
}

export interface LapResult {
  lap: Lap;
  personalBest: boolean;
  comboRecord: boolean;
  challenges: ChallengeStanding[];
}

export interface ServerInfo {
  port: number;
  lanEnabled: boolean;
  urls: string[];
}

export type AppEvent =
  | { type: "gameStatus"; game: string | null; gameName: string | null; connected: boolean }
  | { type: "session"; session: SessionView | null }
  | { type: "seatChanged"; driverId: DriverId | null }
  | { type: "driversChanged" }
  | { type: "lapRecorded"; result: LapResult }
  | { type: "lapsChanged" }
  | { type: "challengesChanged" }
  | { type: "live"; live: LiveView }
  | { type: "overlayLayoutChanged"; game: string }
  | { type: "overlaySettings"; enabled: boolean; focusOnly: boolean }
  | { type: "resync" };

// ---- transport ----------------------------------------------------------------

export const isTauri = "__TAURI_INTERNALS__" in window;
const BASE = isTauri || location.port === "1420" ? "http://127.0.0.1:7878" : "";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  status: () => request<Status>("GET", "/status"),
  server: () => request<ServerInfo>("GET", "/server"),
  setLan: (enabled: boolean) => request<boolean>("PUT", "/settings/lan", { enabled }),
  drivers: () => request<Driver[]>("GET", "/drivers"),
  addDriver: (name: string, color?: string, seat = false) =>
    request<Driver>("POST", "/drivers", { name, color, seat }),
  updateDriver: (id: DriverId, name: string, color: string) =>
    request<Driver>("PUT", `/drivers/${id}`, { name, color }),
  setSeat: (driverId: DriverId | null) => request<DriverId | null>("PUT", "/seat", { driverId }),
  recentLaps: (limit = 20) => request<Lap[]>("GET", `/laps/recent?limit=${limit}`),
  claimLap: (lapId: number, driverId: DriverId | null) => request<null>("POST", `/laps/${lapId}/claim`, { driverId }),
  combos: (game?: string) => request<Combo[]>("GET", `/combos${game ? `?game=${encodeURIComponent(game)}` : ""}`),
  leaderboard: (q: LeaderboardQuery) => request<LeaderboardEntry[]>("POST", "/leaderboard", q),
  challenges: () => request<Challenge[]>("GET", "/challenges"),
  createChallenge: (c: NewChallenge) => request<Challenge>("POST", "/challenges", c),
  deleteChallenge: (id: number) => request<null>("DELETE", `/challenges/${id}`),
  endChallenge: (id: number) => request<null>("POST", `/challenges/${id}/end`),
  challengeLeaderboard: (id: number) => request<LeaderboardEntry[]>("GET", `/challenges/${id}/leaderboard`),
  overlayLayout: (game: string) => request<unknown | null>("GET", `/overlay/layout/${game}`),
  setOverlayLayout: (game: string, layout: unknown) => request<null>("PUT", `/overlay/layout/${game}`, layout),
  setOverlayEnabled: (enabled: boolean) => request<boolean>("PUT", "/overlay/enabled", { enabled }),
  setOverlayFocusOnly: (enabled: boolean) => request<boolean>("PUT", "/overlay/focus-only", { enabled }),
  resetOverlayLayout: (game: string) => request<null>("DELETE", `/overlay/layout/${game}`),
};

// ---- live store -------------------------------------------------------------------

export interface AppState {
  online: boolean;
  status: Status | null;
  drivers: Driver[];
  recentLaps: Lap[];
  challenges: Challenge[];
  /** Bumped whenever lap data changes, so leaderboards know to refetch. */
  lapsVersion: number;
  lastResult: LapResult | null;
}

type Listener = () => void;
type EventListener = (e: AppEvent) => void;

class Store {
  state: AppState = {
    online: false,
    status: null,
    drivers: [],
    recentLaps: [],
    challenges: [],
    lapsVersion: 0,
    lastResult: null,
  };
  private listeners = new Set<Listener>();
  private eventListeners = new Set<EventListener>();
  private started = false;

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    this.start();
    return () => this.listeners.delete(l);
  };

  onEvent(l: EventListener) {
    this.eventListeners.add(l);
    return () => {
      this.eventListeners.delete(l);
    };
  }

  private set(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private start() {
    if (this.started) return;
    this.started = true;
    this.connect();
  }

  async refreshAll() {
    const [status, drivers, recentLaps, challenges] = await Promise.all([
      api.status(),
      api.drivers(),
      api.recentLaps(),
      api.challenges(),
    ]);
    this.set({ status, drivers, recentLaps, challenges, lapsVersion: this.state.lapsVersion + 1 });
  }

  private connect() {
    const wsBase = BASE ? BASE.replace(/^http/, "ws") : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
    const ws = new WebSocket(`${wsBase}/api/events`);
    ws.onopen = () => {
      this.set({ online: true });
      this.refreshAll().catch(() => {});
    };
    ws.onmessage = (msg) => this.handle(JSON.parse(msg.data) as AppEvent);
    ws.onclose = () => {
      this.set({ online: false });
      setTimeout(() => this.connect(), 1500);
    };
  }

  private handle(e: AppEvent) {
    const status = this.state.status;
    switch (e.type) {
      case "gameStatus":
        if (status) this.set({ status: { ...status, game: e.game, gameName: e.gameName, connected: e.connected } });
        break;
      case "session":
        if (status) this.set({ status: { ...status, session: e.session } });
        break;
      case "seatChanged":
        if (status) this.set({ status: { ...status, seat: e.driverId } });
        break;
      case "live":
        if (status) this.set({ status: { ...status, live: e.live } });
        break;
      case "overlaySettings":
        if (status) this.set({ status: { ...status, overlayEnabled: e.enabled, overlayFocusOnly: e.focusOnly } });
        break;
      case "driversChanged":
        api.drivers().then((drivers) => this.set({ drivers }));
        break;
      case "lapRecorded":
        this.set({ lastResult: e.result, lapsVersion: this.state.lapsVersion + 1 });
        api.recentLaps().then((recentLaps) => this.set({ recentLaps }));
        break;
      case "lapsChanged":
        this.set({ lapsVersion: this.state.lapsVersion + 1 });
        api.recentLaps().then((recentLaps) => this.set({ recentLaps }));
        break;
      case "challengesChanged":
        api.challenges().then((challenges) => this.set({ challenges, lapsVersion: this.state.lapsVersion + 1 }));
        break;
      case "resync":
        this.refreshAll().catch(() => {});
        break;
    }
    this.eventListeners.forEach((l) => l(e));
  }
}

export const store = new Store();

export function useAppState(): AppState {
  return useSyncExternalStore(store.subscribe, () => store.state);
}

export function useAppEvent(handler: EventListener) {
  useEffect(() => store.onEvent(handler), [handler]);
}

export function useDriverMap(): Map<DriverId, Driver> {
  const { drivers } = useAppState();
  return useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);
}

/** Fetches whenever `deps` change or lap data changes. */
export function useFetch<T>(fetcher: (() => Promise<T>) | null, deps: unknown[]): T | null {
  const { lapsVersion } = useAppState();
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    if (!fetcher) {
      setData(null);
      return;
    }
    let cancelled = false;
    fetcher()
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData(null));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, lapsVersion]);
  return data;
}

export function isActive(c: Challenge, now = Date.now()) {
  return c.startsAt <= now && (c.endsAt === null || now < c.endsAt);
}

export function challengeMatches(c: Challenge, combo: Combo) {
  return c.game === combo.game && c.track === combo.track && c.layout === combo.layout && (c.car === null || c.car === combo.car);
}

/** The active challenge for what's being driven right now (or any active one). */
export function useCurrentChallenge() {
  const { challenges, status } = useAppState();
  const session = status?.session ?? null;
  const active = challenges.filter((c) => isActive(c));
  const challenge = (session && active.find((c) => challengeMatches(c, session))) || active[0] || null;
  const board = useFetch(challenge ? () => api.challengeLeaderboard(challenge.id) : null, [challenge?.id]);
  return { challenge, board: board ?? [] };
}
