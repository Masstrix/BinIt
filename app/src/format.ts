export function lapTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms <= 0) return "--:--.---";
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function gap(ms: number): string {
  if (ms === 0) return "—";
  return `+${(ms / 1000).toFixed(3)}`;
}

export function ago(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export function countdown(until: number, now = Date.now()): string {
  let s = Math.max(0, Math.floor((until - now) / 1000));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
  return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
}

/** "Mount Panorama" + "GP" -> "Mount Panorama · GP"; ids like "ks_imola" get prettified. */
export function trackName(track: string, layout?: string): string {
  const pretty = prettify(track);
  return layout ? `${pretty} · ${prettify(layout)}` : pretty;
}

/** A car's name for display: Assetto Corsa reports folder ids ("ks_porsche_911_gt3_r_2016"), other games real names. */
export function carName(car: string): string {
  return prettify(car);
}

export function prettify(id: string): string {
  if (!id.includes("_") && /[A-Z ]/.test(id)) return id;
  return id
    .replace(/^ks_/, "")
    .replace(/^layout_/, "")
    .split("_")
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

export type LapKind = "timed" | "cut" | "outLap" | "inLap" | "partial" | "driverChange";

/** What kind of lap this was. Older invalid laps (before reasons existed) count as cuts. */
export function lapKind(lap: { valid: boolean; untimedReason: string | null }): LapKind {
  if (lap.valid) return "timed";
  const r = lap.untimedReason;
  return r === "outLap" || r === "inLap" || r === "partial" || r === "driverChange" ? r : "cut";
}

/** Short badge text for laps that aren't timed. Only "cut" is a failed attempt. */
export const LAP_BADGE: Record<Exclude<LapKind, "timed">, { text: string; className: string; title: string }> = {
  cut: { text: "CUT", className: "chip cut", title: "Flagged by the game (track limits)" },
  outLap: { text: "OUT LAP", className: "chip plain", title: "Started from the pits, not timed" },
  inLap: { text: "IN LAP", className: "chip plain", title: "Ended in the pit lane, not timed" },
  partial: { text: "PARTIAL", className: "chip plain", title: "Bin It joined mid-lap, not timed" },
  driverChange: { text: "DRIVER CHANGE", className: "chip plain", title: "The driver changed during this lap, so it was not timed for anyone" },
};

/** Every game Bin It knows, by key. `ready`: it has an adapter, so laps can be recorded for it. */
export const GAMES = [
  { key: "acevo", name: "AC EVO", detail: "Laps · shared memory", ready: true },
  { key: "ac", name: "Assetto Corsa", detail: "Laps · shared memory", ready: true },
  { key: "dr2", name: "DiRT Rally 2.0", detail: "Stages · UDP telemetry", ready: false },
  { key: "acr", name: "Assetto Corsa Rally", detail: "Stages · shared memory", ready: true },
];

/** Keys of the games Bin It can record, in display order. */
export const SUPPORTED_GAMES = GAMES.filter((g) => g.ready).map((g) => g.key);

export function gameName(key: string): string {
  return GAMES.find((g) => g.key === key)?.name ?? key;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** "Today 17:00", "Tomorrow 13:00" or "Fri 17 Oct, 17:00". */
export function whenLabel(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - day.getTime()) / 86400000);
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}

/** Timing-screen colours: fastest sector on the board, and a driver's own best sector. */
export const SECTOR_PURPLE = "#C38BFF";
export const SECTOR_MINT = "#4BE3A6";

/** Fastest time for each sector across a board (null where nobody has one). */
export function bestSectors(board: { sectorsMs: number[] }[]): (number | null)[] {
  const count = Math.max(0, ...board.map((e) => e.sectorsMs.length));
  return Array.from({ length: count }, (_, i) => {
    const times = board.map((e) => e.sectorsMs[i]).filter((t): t is number => t > 0);
    return times.length ? Math.min(...times) : null;
  });
}

export function sectorColor(t: number | undefined, best: number | null, own: number | null | undefined): string {
  if (!(t !== undefined && t > 0)) return "var(--muted)";
  if (t === best) return SECTOR_PURPLE;
  if (own != null && t <= own) return SECTOR_MINT;
  return "var(--text-2)";
}

/**
 * Narrowest a leaderboard table can get before it scrolls sideways: the track sizes in its
 * `grid-template-columns` (a `minmax(160px, 1fr)` counts as 160) plus the column gaps and row padding.
 * Every row gets this same minimum, so the columns line up from one row to the next.
 */
export function gridMinWidth(cols: string, gap = 8, padding = 26): number {
  const tracks = cols.match(/minmax\([^)]*\)|\S+/g) ?? [];
  const sum = tracks.reduce((total, t) => total + Number(/(\d+(?:\.\d+)?)px/.exec(t)?.[1] ?? 0), 0);
  return Math.ceil(sum + gap * Math.max(0, tracks.length - 1) + padding);
}
