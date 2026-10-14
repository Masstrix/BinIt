// Client for the Bin It local server. The desktop window, the overlay and
// office browsers all use this; only the base URL differs.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

export type DriverId = number;

export interface Driver {
  id: DriverId;
  name: string;
  color: string;
  createdAt: number;
}

/** How quick a driver is compared with the others on the tracks and cars they share. */
export interface DriverRating {
  driverId: DriverId;
  /** 100 minus their average % gap to the fastest driver; null until they share a combination with someone. */
  score: number | null;
  combos: number;
  fastestOn: number;
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
  /** Why it isn't timed: "cut" | "outLap" | "inLap" | "partial" (null when timed, or older cut laps). */
  untimedReason: string | null;
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
  /** Sector times of the ranked lap (empty for laps recorded before sector timing). */
  sectorsMs: number[];
  /** The driver's best time in each sector over all their valid laps on this board. */
  bestSectorsMs: (number | null)[];
}

export interface CatLayout {
  /** "" = the default layout. */
  name: string;
  seen: boolean;
  hasMap: boolean;
}

export interface CatTrack {
  name: string;
  country: string | null;
  aliases: string[];
  kind: "circuit" | "rally" | string;
  layouts: CatLayout[];
  seen: boolean;
}

export interface CatCar {
  name: string;
  brand: string | null;
  class: string | null;
  aliases: string[];
  seen: boolean;
}

/** Every track and car known for a game, driven or not. `seen` = confirmed in the game. */
export interface Catalogue {
  game: string;
  tracks: CatTrack[];
  cars: CatCar[];
}

/** A track outline learned from telemetry: [x, z] world metres in driving order. */
export interface TrackMapData {
  game: string;
  track: string;
  layout: string;
  points: [number, number][];
  /** Display orientation: degrees clockwise (0/90/180/270), after mirroring left/right. */
  rotate: number;
  mirror: boolean;
  /** False for a rally stage: a path from the start to a different finish. */
  closed: boolean;
}

/** About Bin It: shown in the desktop app. */
export interface About {
  name: string;
  version: string;
  /** Goes up on every build of this checkout, so two copies can be told apart. */
  buildNumber: number;
  /** "release" for the installed app, "development" for a dev build. */
  build: "release" | "development";
  os: string;
  webview: string | null;
  dataDir: string | null;
  dbBytes: number | null;
  port: number;
  lanEnabled: boolean;
  counts: { drivers: number; laps: number; timedLaps: number; tracedLaps: number; challenges: number; schemaVersion: number; createdWith: string | null; previousVersion: string | null };
}

/** Where an update is up to, as the small update window shows it. */
export type UpdateStage =
  | { stage: "checking" }
  | { stage: "downloading"; version: string; downloaded: number; total: number | null }
  | { stage: "installing"; version: string }
  | { stage: "failed"; message: string }
  | { stage: "starting" };

/** Whether there's a newer Bin It, and how an update is going (kept by the desktop app). */
export interface UpdateStatus {
  current: string;
  /** "installed" updates itself; "portable" can only link to the download; "development" never updates. */
  kind: "installed" | "portable" | "development";
  latest: { version: string; notes: string | null } | null;
  checking: boolean;
  /** When a check last worked (ms since the epoch). */
  lastChecked: number | null;
  error: string | null;
  /** Set while an update is being installed. */
  stage: UpdateStage | null;
}

/** Which laps a cleanup touches (desktop app only). */
export interface LapFilter {
  game: string;
  track: string;
  /** null = every layout */
  layout: string | null;
  /** null = every car */
  car: string | null;
  forgetMap: boolean;
}

export interface SessionView extends Combo {
  gameName: string;
  sessionKind: string;
  sectorCount: number;
  /** Sector boundaries as fractions of the lap: [0, ..., 1]. */
  boundaries: number[];
}

/** Pedals 0..1, steering -1 (left)..1 (right), gear 0 = neutral and negative = reverse. */
export interface LiveInputs {
  throttle: number;
  brake: number;
  clutch: number;
  handbrake: number;
  steering: number;
  gear: number;
  speedKmh: number;
  rpm: number;
}

export type OverlayShow = "always" | "drivingPaused" | "driving";
export type GamePhase = "menu" | "driving" | "paused" | "replay";

/** A time penalty to pin on a map: where the car was when the game added it, and how much it added. */
export interface PenaltyPin {
  /** The stage clock just before it landed, ms. */
  atMs: number;
  addedMs: number;
  /** How far along the stage, 0..1. */
  progress: number;
  /** World position (x, z) in the map's coordinates; null when the game didn't report one. */
  position: [number, number] | null;
}

export interface LiveView {
  driving: boolean;
  /** What the game is doing: in a menu, driving, paused on track, or watching a replay. */
  phase: GamePhase;
  currentLapMs: number;
  lapValid: boolean;
  /** From the pits or a spawn point: not a timed attempt. */
  outLap: boolean;
  /** Why this lap won't be timed apart from a cut: "driverChange" (the seat changed hands mid-lap). */
  voidReason: string | null;
  /** Time penalties the game has added so far in this stage run, to pin on the live map. */
  penalties: PenaltyPin[];
  /** Why this lap or stage can't teach the track's map while one is being learned, if it can't. */
  mapSpoiled: "penalty" | "joinedLate" | "invalid" | null;
  lapProgress: number;
  /** Car position in world metres [x, z]; null when the game doesn't report it. */
  position: [number, number] | null;
  inputs: LiveInputs | null;
  timing: LiveTiming | null;
}

export type SectorStatus = "purple" | "green" | "yellow" | "current" | "pending";

export interface LiveTiming {
  deltaMs: number | null;
  reference: string | null;
  currentSector: number;
  /** deltaMs: sector time minus the reference lap's (negative = faster). */
  sectors: { timeMs: number | null; deltaMs: number | null; status: SectorStatus }[];
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
  /** When widgets are drawn: always, everywhere except menus, or only while driving. */
  overlayShow: OverlayShow;
}

export interface ChallengeStanding {
  challengeId: number;
  challengeName: string;
  position: number | null;
  previousPosition: number | null;
  gapToLeaderMs: number | null;
}

/** A driver's best lap in a challenge, for replaying it against the others. */
export interface ReplayEntry {
  position: number;
  driverId: DriverId | null;
  lapId: number;
  timeMs: number;
  /** Elapsed ms at each 0.5% of the lap; null for laps recorded before timing traces existed. */
  profile: number[] | null;
  /** Time penalties taken in that run, to pin on the map. */
  penalties: PenaltyPin[];
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
  | { type: "mapsChanged" }
  | { type: "live"; live: LiveView }
  | { type: "overlayLayoutChanged"; game: string }
  | { type: "overlaySettings"; enabled: boolean; focusOnly: boolean; show: OverlayShow }
  | { type: "updateChanged"; update: UpdateStatus }
  | { type: "resync" };

// ---- transport ----------------------------------------------------------------

export const isTauri = "__TAURI_INTERNALS__" in window;

/** Opens the latest installer or portable exe (or the release page) in the browser. Desktop app only. */
export function openDownload(what: "installer" | "portable" | "release") {
  return import("@tauri-apps/api/core").then(({ invoke }) => invoke("open_download", { what }));
}
// Dev server (:1420): call the API on whatever host served the page, so a phone opening
// http://<pc>:1420 reaches the PC's server rather than itself.
const BASE = isTauri ? "http://127.0.0.1:7878" : location.port === "1420" ? `http://${location.hostname}:7878` : "";

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
  driverRatings: () => request<DriverRating[]>("GET", "/drivers/ratings"),
  /** Every lap a driver has recorded, oldest first. */
  driverLaps: (id: DriverId) => request<Lap[]>("GET", `/drivers/${id}/laps`),
  recentLaps: (limit = 20) => request<Lap[]>("GET", `/laps/recent?limit=${limit}`),
  claimLap: (lapId: number, driverId: DriverId | null) => request<null>("POST", `/laps/${lapId}/claim`, { driverId }),
  combos: (game?: string) => request<Combo[]>("GET", `/combos${game ? `?game=${encodeURIComponent(game)}` : ""}`),
  catalogue: (game: string) => request<Catalogue>("GET", `/catalogue?game=${encodeURIComponent(game)}`),
  /** Rows of [progress, elapsedMs, speedKmh, throttle, brake, clutch, steering, gear], or null. */
  lapPenalties: (lapId: number) => request<PenaltyPin[]>("GET", `/laps/${lapId}/penalties`),
  lapTrace: (lapId: number) => request<{ lapId: number; points: number[][] } | null>("GET", `/laps/${lapId}/trace`),
  /** Version, data folder and database counts. Desktop app only. */
  about: () => request<About>("GET", "/admin/about"),
  countLaps: (f: LapFilter) => request<number>("POST", "/admin/laps/count", f),
  deleteLaps: (f: LapFilter) => request<number>("POST", "/admin/laps/delete", f),
  setMapView: (m: { game: string; track: string; layout: string; rotate: number; mirror: boolean }) => request<null>("PUT", "/maps/view", m),
  sectorBoundaries: (game: string, track: string, layout: string) =>
    request<number[] | null>("GET", `/sectors?game=${encodeURIComponent(game)}&track=${encodeURIComponent(track)}&layout=${encodeURIComponent(layout)}`),
  learningPath: () => request<[number, number][]>("GET", "/learning"),
  trackMaps: (game: string) => request<TrackMapData[]>("GET", `/maps?game=${encodeURIComponent(game)}`),
  leaderboard: (q: LeaderboardQuery) => request<LeaderboardEntry[]>("POST", "/leaderboard", q),
  challenges: () => request<Challenge[]>("GET", "/challenges"),
  createChallenge: (c: NewChallenge) => request<Challenge>("POST", "/challenges", c),
  deleteChallenge: (id: number) => request<null>("DELETE", `/challenges/${id}`),
  endChallenge: (id: number) => request<null>("POST", `/challenges/${id}/end`),
  challengeLeaderboard: (id: number) => request<LeaderboardEntry[]>("GET", `/challenges/${id}/leaderboard`),
  challengeReplay: (id: number) => request<ReplayEntry[]>("GET", `/challenges/${id}/replay`),
  overlayLayout: (game: string) => request<unknown | null>("GET", `/overlay/layout/${game}`),
  setOverlayLayout: (game: string, layout: unknown) => request<null>("PUT", `/overlay/layout/${game}`, layout),
  setOverlayEnabled: (enabled: boolean) => request<boolean>("PUT", "/overlay/enabled", { enabled }),
  setOverlayShow: (mode: OverlayShow) => request<string>("PUT", "/overlay/show", { mode }),
  setOverlayFocusOnly: (enabled: boolean) => request<boolean>("PUT", "/overlay/focus-only", { enabled }),
  resetOverlayLayout: (game: string) => request<null>("DELETE", `/overlay/layout/${game}`),
  update: () => request<UpdateStatus>("GET", "/update"),
  checkForUpdate: () => request<UpdateStatus>("POST", "/update/check"),
  /** Bin It on the PC closes, updates and starts again. */
  installUpdate: () => request<UpdateStatus>("POST", "/update/install"),
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
  /** Whether the desktop app has found a newer version (null until known). */
  update: UpdateStatus | null;
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
    update: null,
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

  /** Takes the status a check or install request answered with (the event may come later). */
  setUpdate(update: UpdateStatus) {
    this.set({ update });
  }

  private connect() {
    const wsBase = BASE ? BASE.replace(/^http/, "ws") : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
    const ws = new WebSocket(`${wsBase}/api/events`);
    ws.onopen = () => {
      this.set({ online: true });
      this.refreshAll().catch(() => {});
      api.update().then((update) => this.set({ update }), () => {});
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
        if (status) this.set({ status: { ...status, overlayEnabled: e.enabled, overlayFocusOnly: e.focusOnly, overlayShow: e.show } });
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
      case "mapsChanged":
        this.set({ lapsVersion: this.state.lapsVersion + 1 });
        break;
      case "updateChanged":
        this.set({ update: e.update });
        break;
      case "resync":
        this.refreshAll().catch(() => {});
        api.update().then((update) => this.set({ update }), () => {});
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

export function useCatalogue(game: string | null): Catalogue | null {
  return useFetch(game ? () => api.catalogue(game) : null, [game]);
}

export function useTrackMaps(game: string | null): TrackMapData[] {
  return useFetch(game ? () => api.trackMaps(game) : null, [game]) ?? [];
}

export function isActive(c: Challenge, now = Date.now()) {
  return c.startsAt <= now && (c.endsAt === null || now < c.endsAt);
}

export function challengeMatches(c: Challenge, combo: Combo) {
  return c.game === combo.game && c.track === combo.track && c.layout === combo.layout && (c.car === null || c.car === combo.car);
}

/** The active challenge for what's being driven right now (or any active one). */
/** `strict`: only a challenge for exactly what's being driven (used by the overlay). */
export function useCurrentChallenge(strict = false) {
  const { challenges, status } = useAppState();
  const session = status?.session ?? null;
  const active = challenges.filter((c) => isActive(c));
  const matching = (session && active.find((c) => challengeMatches(c, session))) || null;
  const challenge = strict ? matching : matching || active[0] || null;
  const board = useFetch(challenge ? () => api.challengeLeaderboard(challenge.id) : null, [challenge?.id]);
  return { challenge, board: board ?? [] };
}
