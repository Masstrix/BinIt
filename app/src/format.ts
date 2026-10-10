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

export function prettify(id: string): string {
  if (!id.includes("_") && /[A-Z ]/.test(id)) return id;
  return id
    .replace(/^ks_/, "")
    .split("_")
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

export type LapKind = "timed" | "cut" | "outLap" | "inLap" | "partial";

/** What kind of lap this was. Older invalid laps (before reasons existed) count as cuts. */
export function lapKind(lap: { valid: boolean; untimedReason: string | null }): LapKind {
  if (lap.valid) return "timed";
  const r = lap.untimedReason;
  return r === "outLap" || r === "inLap" || r === "partial" ? r : "cut";
}

/** Short badge text for laps that aren't timed. Only "cut" is a failed attempt. */
export const LAP_BADGE: Record<Exclude<LapKind, "timed">, { text: string; className: string; title: string }> = {
  cut: { text: "CUT", className: "chip cut", title: "Flagged by the game (track limits)" },
  outLap: { text: "OUT LAP", className: "chip plain", title: "Started from the pits, not timed" },
  inLap: { text: "IN LAP", className: "chip plain", title: "Ended in the pit lane, not timed" },
  partial: { text: "PARTIAL", className: "chip plain", title: "TimeTrial joined mid-lap, not timed" },
};

const GAME_NAMES: Record<string, string> = { acevo: "AC EVO", ac: "Assetto Corsa", acc: "ACC", dr2: "DiRT Rally 2.0", wrc: "EA WRC" };

export function gameName(key: string): string {
  return GAME_NAMES[key] ?? key;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
