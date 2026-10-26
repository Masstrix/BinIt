// Presentational overlay widgets. The real overlay feeds them live data; the layout
// editor renders the same components, scaled down, as its preview.

import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { api, isTauri, type LiveTiming, useAppEvent, useAppState, useCurrentChallenge, useDriverMap, useFetch, type AppEvent, type LeaderboardEntry } from "../api";
import { lapKind, lapTime, trackName } from "../format";
import { words } from "../vocab";
import { orientationFor, styleOf, WIDGETS, type Anchor, type Orientation, type OverlayLayout, type WidgetId } from "../overlayLayout";
import { BASE, gapText as ladderGap, place, room } from "./GapLadder";
import { Helmet } from "./Helmet";
import { QrCode } from "./QrCode";

const card = {
  borderRadius: 24,
  background: "var(--panel)",
  boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
  // Text on an overlay is never something to select or drag.
  userSelect: "none",
  WebkitUserSelect: "none",
} as const;

export interface OverlayData {
  driverName: string;
  driverColor: string;
  pbMs: number | null;
  challengeName: string | null;
  position: number | null;
  gapMs: number | null;
  top3: { name: string; color: string; timeMs: number }[];
  /** The running challenge's top five (and the driver's own row when outside them), for the podium + list style. */
  challengeTop: { position: number; name: string; color: string; timeMs: number; gapMs: number; isSeat: boolean; driverId?: number | null }[];
  /** When the running challenge ends (null = no end). */
  challengeEndsAt: number | null;
  /** "Mount Panorama · GP" style label for the track leaderboard. */
  comboLabel: string | null;
  /** The game being played, so the wording can follow it (laps or stages). */
  game: string | null;
  /** Top 5 on the current track + car, plus the seated driver's row if outside it. */
  comboTop: { position: number; name: string; color: string; timeMs: number; gapMs: number; isSeat: boolean; driverId?: number | null }[];
  timing: LiveTiming | null;
  /** The running lap clock, for when there's no reference lap to show a delta against. */
  lapMs: number;
  /** The game has invalidated the lap in progress (a cut): it won't be timed. */
  lapInvalid: boolean;
  /** "driverChange" when the seat changed hands mid-lap. */
  lapVoidReason: string | null;
  outLap: boolean;
  /** Address phones on the network can open (null when sharing is off or there is no network). */
  url: string | null;
}

/** Everything the widgets show, from live app state. */
export function useOverlayData(): OverlayData {
  const { status, online } = useAppState();
  const drivers = useDriverMap();
  const seat = status?.seat != null ? drivers.get(status.seat) : undefined;
  const session = status?.session ?? null;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    api.server().then((s) => setUrl(s.urls[0] ?? null)).catch(() => setUrl(null));
  }, [online]);
  // Only a challenge for exactly this track + car; otherwise challenge widgets hide.
  const { challenge, board } = useCurrentChallenge(true);
  const comboBoard = useFetch(
    session ? () => api.leaderboard({ game: session.game, track: session.track, layout: session.layout, car: session.car }) : null,
    [session?.game, session?.track, session?.layout, session?.car],
  );
  const pb = seat ? comboBoard?.find((e) => e.driverId === seat.id) : undefined;
  const standing = seat ? board.find((e) => e.driverId === seat.id) : undefined;
  const named = (e: LeaderboardEntry) => {
    const d = e.driverId != null ? drivers.get(e.driverId) : undefined;
    return { name: d?.name ?? "Guest", color: d?.color ?? "#8F99B3", timeMs: e.timeMs, driverId: e.driverId };
  };
  const ranked = (e: LeaderboardEntry) => ({
    ...named(e),
    position: e.position,
    gapMs: e.gapMs,
    isSeat: seat != null && e.driverId === seat.id,
  });
  const comboTop = (comboBoard ?? []).slice(0, 5).map(ranked);
  if (pb && pb.position > 5) comboTop.push(ranked(pb));
  const challengeTop = board.slice(0, 5).map(ranked);
  if (standing && standing.position > 5) challengeTop.push(ranked(standing));
  return {
    driverName: seat?.name ?? "Guest",
    driverColor: seat?.color ?? "#8F99B3",
    pbMs: pb?.timeMs ?? null,
    challengeName: challenge?.name ?? null,
    position: standing?.position ?? null,
    gapMs: standing?.gapMs ?? null,
    top3: board.slice(0, 3).map(named),
    challengeTop,
    challengeEndsAt: challenge?.endsAt ?? null,
    comboLabel: session ? `${trackName(session.track, session.layout)}` : null,
    game: session?.game ?? null,
    comboTop,
    timing: status?.live?.driving ? status.live.timing : null,
    lapMs: status?.live?.currentLapMs ?? 0,
    lapInvalid: !!(status?.live?.driving && !status.live.outLap && !status.live.lapValid),
    lapVoidReason: status?.live?.voidReason ?? null,
    outLap: !!(status?.live?.driving && status.live.outLap),
    url,
  };
}

/** Example data so the layout editor always shows what every widget looks like. */
export const MOCK_DATA: OverlayData = {
  driverName: "Sam",
  driverColor: "#FF8A4C",
  pbMs: 102318,
  challengeName: "Imola Hot Lap Week",
  position: 2,
  gapMs: 204,
  top3: [
    { name: "Jess", color: "#2FA8FF", timeMs: 102114 },
    { name: "Sam", color: "#FF8A4C", timeMs: 102318 },
    { name: "Priya", color: "#FF5FA2", timeMs: 102870 },
  ],
  challengeTop: [
    { position: 1, name: "Jess", color: "#2FA8FF", timeMs: 102114, gapMs: 0, isSeat: false },
    { position: 2, name: "Sam", color: "#FF8A4C", timeMs: 102318, gapMs: 204, isSeat: true },
    { position: 3, name: "Priya", color: "#FF5FA2", timeMs: 102870, gapMs: 756, isSeat: false },
    { position: 4, name: "Tom", color: "#4FD39A", timeMs: 103555, gapMs: 1441, isSeat: false },
    { position: 5, name: "Alex", color: "#FFC93C", timeMs: 104020, gapMs: 1906, isSeat: false },
  ],
  challengeEndsAt: Date.now() + (2 * 24 + 4) * 3600_000,
  comboLabel: "Imola · GP",
  game: "acevo",
  comboTop: [
    { position: 1, name: "Jess", color: "#2FA8FF", timeMs: 102114, gapMs: 0, isSeat: false },
    { position: 2, name: "Sam", color: "#FF8A4C", timeMs: 102318, gapMs: 204, isSeat: true },
    { position: 3, name: "Priya", color: "#FF5FA2", timeMs: 102870, gapMs: 756, isSeat: false },
    { position: 4, name: "Tom", color: "#4FD39A", timeMs: 103555, gapMs: 1441, isSeat: false },
    { position: 5, name: "Alex", color: "#FFC93C", timeMs: 104020, gapMs: 1906, isSeat: false },
  ],
  timing: {
    deltaMs: -142,
    reference: "PB",
    references: [
      { kind: "pb", label: "PB", deltaMs: -142 },
      { kind: "best", label: "Best", deltaMs: 61 },
    ],
    currentSector: 2,
    sectors: [
      { timeMs: 33902, deltaMs: -215, status: "purple" },
      { timeMs: 38546, deltaMs: 73, status: "green" },
      { timeMs: null, deltaMs: null, status: "current" },
    ],
  },
  lapMs: 71500,
  lapInvalid: false,
  lapVoidReason: null,
  outLap: false,
  url: "http://192.168.0.20:7878",
};

export const MOCK_TOAST: Toast = { id: 0, tone: "pb", title: "New PB 1:42.318", detail: "Up to P2 in Imola Hot Lap Week" };

/** Whether a widget has anything to show right now (the live overlay hides empty ones). */
export function hasContent(w: WidgetId, data: OverlayData): boolean {
  switch (w) {
    case "pb":
      return data.pbMs !== null;
    case "challenge":
    case "standings":
      return data.challengeName !== null;
    case "leaderboard":
    case "tower":
      return data.comboTop.length > 0;
    case "timing":
      return data.timing !== null || data.outLap;
    case "qr":
      return data.url !== null;
    default:
      return true;
  }
}

/** Extra props per widget element: the layout editor uses this to make each one draggable. */
export type ItemProps = (w: WidgetId) => HTMLAttributes<HTMLElement>;

/** Gold trophy that marks anything belonging to a challenge (same glyph as the app's nav and challenge pages). */
function Trophy({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}>
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3a3 3 0 0 1-3 4M7 5H4a3 3 0 0 0 3 4" />
    </svg>
  );
}

function StripStat({ label, value, color, extra, icon }: { label: string; value: string; color?: string; extra?: string; icon?: ReactNode }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
      <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>{icon}{label}</span>
      <span className="mono" style={{ fontSize: 16, color }}>
        {value} {extra && <span style={{ color: "var(--peach)" }}>{extra}</span>}
      </span>
    </span>
  );
}

/** Driver / PB / challenge position, merged into one slim strip when they share a section. */
export function StripCard({ items, data, itemProps }: { items: WidgetId[]; data: OverlayData; itemProps?: ItemProps }) {
  return (
    <div style={{ ...card, borderRadius: 999, display: "flex", alignItems: "center", gap: 14, padding: items[0] === "driver" ? "8px 18px 8px 8px" : "8px 20px", whiteSpace: "nowrap" }}>
      {items.map((w, i) => (
        <span key={w} style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {i > 0 && <span style={{ width: 1, height: 28, background: "var(--line)" }} />}
          <span data-widget={w} {...itemProps?.(w)} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {w === "driver" && (
              <>
                <Helmet color={data.driverColor} size={40} seed={data.driverName} mood={data.lapInvalid ? "binned" : "focus"} />
                <span style={{ font: "700 20px var(--font-display)", letterSpacing: "-0.02em" }}>{data.driverName}</span>
                <span className="kbd" style={{ background: "var(--line)", color: "var(--text-2)" }}>F8</span>
              </>
            )}
            {w === "pb" && <StripStat label="PB" value={lapTime(data.pbMs)} color="var(--mint)" />}
            {w === "challenge" && (
              <StripStat
                label="CHALLENGE"
                icon={<Trophy size={12} />}
                value={data.position ? `P${data.position}` : "—"}
                extra={data.gapMs ? `+${(data.gapMs / 1000).toFixed(3)}` : undefined}
              />
            )}
          </span>
        </span>
      ))}
    </div>
  );
}

/** One place in a ranking: used by the track leaderboard and the challenge list so they look alike. */
function RankRow({ position, name, color, seed, right, isSeat, rightColor }: { position: number; name: string; color: string; seed?: string | number; right: string; isSeat: boolean; rightColor?: string }) {
  const placeColour = position === 1 ? "#FFE14D" : position === 3 ? "#FF8A4C" : "var(--muted)";
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        minHeight: 36,
        padding: "0 8px",
        margin: "0 -8px",
        borderRadius: 12,
        background: isSeat ? "var(--tint)" : "transparent",
        color: isSeat ? "var(--peri-1)" : "var(--text)",
      }}
    >
      <span style={{ font: "600 12px var(--font-mono)", width: 14, color: isSeat ? "var(--peri-1)" : placeColour }}>{position}</span>
      <Helmet color={color} size={26} seed={seed ?? name} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: isSeat ? 700 : 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
      <span className="mono" style={{ fontSize: 13, color: rightColor }}>{right}</span>
    </span>
  );
}

/** "2d 04h" / "3h 12m": how long a challenge has left, short enough for a chip. */
function timeLeft(until: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((until - now) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${String(h).padStart(2, "0")}h` : `${h}h ${String(m).padStart(2, "0")}m`;
}

export function StandingsCard({ data, mode }: { data: OverlayData; mode?: string }) {
  const [, redraw] = useState(0);
  // The countdown only changes by the minute.
  useEffect(() => {
    if (data.challengeEndsAt == null) return;
    const t = window.setInterval(() => redraw((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, [data.challengeEndsAt]);
  const below = mode === "list" ? data.challengeTop.filter((r) => r.position > 3) : [];
  // Second, first, third, left to right: the winner's step is the tallest.
  const steps = [
    { place: 2, h: 34 },
    { place: 1, h: 48 },
    { place: 3, h: 24 },
  ];
  return (
    <div style={{ ...card, borderRadius: 28, padding: "12px 14px", width: 216, display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ flex: "none", width: 28, height: 28, borderRadius: 10, background: "rgba(255,201,60,0.15)", display: "grid", placeItems: "center" }}>
          <Trophy size={16} />
        </span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
          <span style={{ font: "500 9px var(--font-mono)", letterSpacing: "0.1em", color: "var(--muted)" }}>CHALLENGE</span>
          <span style={{ font: "700 13px var(--font-display)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {data.challengeName ?? "No challenge running"}
          </span>
        </span>
        {data.challengeEndsAt != null && (
          <span style={{ flex: "none", font: "500 10px var(--font-mono)", padding: "3px 7px", borderRadius: 999, background: "var(--panel-2)", color: "var(--muted)", whiteSpace: "nowrap" }}>
            {timeLeft(data.challengeEndsAt)}
          </span>
        )}
      </span>
      {data.top3.length === 0 ? (
        <span className="muted" style={{ fontSize: 13 }}>No {words(data.game).laps} yet</span>
      ) : (
        <span style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
          {steps.map(({ place, h }) => {
            const r = data.top3[place - 1];
            return (
              <span key={place} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                {r ? (
                  <>
                    <Helmet color={r.color} size={32} seed={r.name} />
                    <span style={{ fontSize: 11, fontWeight: 600, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                    <span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>{lapTime(r.timeMs)}</span>
                  </>
                ) : (
                  <span style={{ height: 32 }} />
                )}
                <span style={{ width: "100%", height: h, borderRadius: "12px 12px 0 0", background: r ? `${r.color}33` : "var(--panel-2)", display: "flex", justifyContent: "center", paddingTop: 4, font: "700 15px var(--font-display)" }}>
                  {place}
                </span>
              </span>
            );
          })}
        </span>
      )}
      {below.length > 0 && (
        <span style={{ display: "flex", flexDirection: "column", borderTop: "1px solid var(--line)", paddingTop: 6 }}>
          {below.map((r, i) => (
            <span key={`${r.position}-${r.name}`} style={{ display: "contents" }}>
              {i > 0 && r.position - below[i - 1].position > 1 && <span style={{ height: 1, background: "var(--line)", margin: "4px 0" }} />}
              <RankRow position={r.position} name={r.name} color={r.color} seed={r.driverId ?? r.name} right={`+${(r.gapMs / 1000).toFixed(3)}`} rightColor="var(--muted)" isSeat={r.isSeat} />
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

const SECTOR_COLOURS = { purple: "#B79BFF", green: "#4FD39A", yellow: "#FFC93C", current: "#E8EBF4", pending: "#262D3B" };

const CYCLE_MS = 6000;
/** After a hand switch while cycling, how long it stays before cycling carries on. */
const HOLD_MS = 15000;

/**
 * Which reference lap live timing is against. The style (PB, Leader or Cycle) is the starting point; clicking
 * the widget or a pill, or Ctrl+Shift+T in game, switches by hand. In a fixed style that stays until the style
 * changes; while cycling it holds for a while and then carries on.
 */
function useTimingReference(
  kinds: string[],
  mode: string | undefined,
): [string | undefined, () => void, (kind: string) => void, { ms: number; key: string; held: boolean } | null] {
  const [tick, setTick] = useState(0);
  const [held, setHeld] = useState<string | null>(null);
  const [seq, setSeq] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const list = kinds.join();
  useEffect(() => setHeld(null), [mode]);
  useEffect(() => {
    if (mode !== "cycle" || kinds.length < 2 || held) return;
    const t = window.setInterval(() => setTick((n) => n + 1), CYCLE_MS);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, list, held]);
  const base = mode === "cycle" && kinds.length > 1 ? kinds[tick % kinds.length] : mode === "best" && kinds.includes("best") ? "best" : kinds.includes("pb") ? "pb" : kinds[0];
  const shown = held && kinds.includes(held) ? held : base;

  const select = useCallback(
    (kind: string) => {
      setHeld(kind);
      setSeq((n) => n + 1);
      window.clearTimeout(timer.current);
      if (mode === "cycle") timer.current = window.setTimeout(() => setHeld(null), HOLD_MS);
    },
    [mode],
  );
  const next = useCallback(() => {
    if (kinds.length > 1) select(kinds[(kinds.indexOf(shown ?? "") + 1) % kinds.length]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, shown, select]);

  // Ctrl+Shift+T: the desktop app tells the overlay window (it cannot be clicked over a game).
  const nextRef = useRef(next);
  nextRef.current = next;
  useEffect(() => {
    if (!isTauri) return;
    let off: (() => void) | undefined;
    let gone = false;
    import("@tauri-apps/api/event").then(({ listen }) =>
      listen("timing-next", () => nextRef.current()).then((u) => {
        if (gone) u();
        else off = u;
      }),
    );
    return () => {
      gone = true;
      off?.();
    };
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // How long until the next automatic switch (or until cycling resumes after a hand switch), for the countdown ring.
  const wait = mode === "cycle" && kinds.length > 1 ? { ms: held ? HOLD_MS : CYCLE_MS, key: `${tick}|${held ?? "-"}|${seq}`, held: !!held } : null;
  return [shown, next, select, wait];
}

const REF_NAME: Record<string, string> = { pb: "PB", best: "Leader" };

/** A small ring that empties over `ms`: how long until live timing switches to the other lap (muted while a hand switch is held). */
function CountdownRing({ ms, held }: { ms: number; held: boolean }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" role="img" aria-label={held ? "Holding your choice" : "Switching soon"} style={{ flex: "none", alignSelf: "center" }}>
      <circle cx="9" cy="9" r={r} fill="none" stroke="var(--panel-3)" strokeWidth="2.5" />
      <circle cx="9" cy="9" r={r} fill="none" stroke={held ? "var(--muted)" : "var(--peri-1)"} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset="0" transform="rotate(-90 9 9)">
        <animate attributeName="stroke-dashoffset" from="0" to={c} dur={`${ms / 1000}s`} fill="freeze" />
      </circle>
    </svg>
  );
}

/** Delta to the reference lap plus one bar per sector (purple / green / yellow). */
export function TimingCard({ data, mode }: { data: OverlayData; mode?: string }) {
  const t = data.timing;
  const refs = t?.references ?? [];
  const [shown, , select, wait] = useTimingReference(refs.map((r) => r.kind), mode);
  if (data.outLap || !t) {
    return data.outLap ? (
      <div style={{ ...card, padding: "14px 18px", minWidth: 260, display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ font: "700 20px var(--font-display)", letterSpacing: "-0.02em" }}>Out lap</span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Timing starts at the line</span>
      </div>
    ) : null;
  }
  const current = refs.find((r) => r.kind === shown);
  const d = current ? current.deltaMs : t.deltaMs;
  const cut = data.lapInvalid;
  const several = refs.length > 1;
  return (
    <div
      style={{ ...card, borderRadius: 28, padding: "16px 18px", minWidth: 260, display: "flex", flexDirection: "column", gap: 10, ...(cut ? { boxShadow: "inset 0 0 0 1.5px rgba(255,122,146,0.7), 0 8px 30px rgba(0,0,0,0.35)", background: "#2A1420" } : {}) }}>
      {cut && (
        <span style={{ font: "500 11px var(--font-mono)", letterSpacing: "0.06em", color: "var(--red)" }}>
          {data.lapVoidReason === "driverChange" ? "DRIVER CHANGED" : `${words(data.game).lap.toUpperCase()} INVALID`} · WON'T COUNT
        </span>
      )}
      {refs.length > 0 && !cut && (
        <span style={{ display: "flex", gap: 6 }}>
          {refs.map((r) => {
            const on = r.kind === shown;
            const look = { flex: 1, textAlign: "center" as const, padding: "4px 0", borderRadius: 999, font: "500 11px var(--font-mono)", background: on ? "var(--tint)" : "var(--panel-2)", color: on ? "var(--peri-1)" : "var(--muted)" };
            // Only the pills can be clicked (and only when there is more than one lap to choose between).
            return several ? (
              <button
                key={r.kind}
                type="button"
                data-hit=""
                aria-pressed={on}
                title={`Show the delta against ${r.kind === "pb" ? "your PB" : "the fastest lap"}`}
                onClick={(e) => {
                  e.stopPropagation();
                  select(r.kind);
                }}
                style={{ ...look, border: 0, cursor: "pointer", pointerEvents: "auto" }}
              >
                {REF_NAME[r.kind] ?? r.label}
              </button>
            ) : (
              <span key={r.kind} style={look}>
                {REF_NAME[r.kind] ?? r.label}
              </span>
            );
          })}
          {wait && <CountdownRing key={wait.key} ms={wait.ms} held={wait.held} />}
        </span>
      )}
      <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, ...(cut ? { opacity: 0.55, textDecoration: "line-through" } : {}) }}>
        {t.reference ? (
          <span className="mono" style={{ font: "500 40px/1 var(--font-mono)", letterSpacing: "-0.08em", color: cut ? "var(--red)" : deltaColour(d) }}>{deltaText(d)}</span>
        ) : (
          // First lap on this track: nothing to compare against yet, so show the lap clock.
          <>
            <span className="mono" style={{ font: "500 40px/1 var(--font-mono)", letterSpacing: "-0.08em" }}>{lapTime(data.lapMs)}</span>
            <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>FIRST {words(data.game).lap.toUpperCase()}</span>
          </>
        )}
      </span>
      <span style={{ display: "flex", gap: 6 }}>
        {t.sectors.map((s, i) => (
          <span key={i} style={{ flex: 1, height: 10, borderRadius: 5, background: SECTOR_COLOURS[s.status], opacity: s.status === "current" ? 0.5 : 1 }} />
        ))}
      </span>
      <span style={{ display: "flex", justifyContent: "space-between", gap: 8, font: "500 11px var(--font-mono)", color: "var(--muted)" }}>
        {t.sectors.map((s, i) => (
          <span key={i}>
            S{i + 1} {s.timeMs ? (s.timeMs / 1000).toFixed(2) : "--"}
          </span>
        ))}
      </span>
    </div>
  );
}

function deltaColour(ms: number | null) {
  return ms === null ? "var(--muted)" : ms <= 0 ? "#4FD39A" : "#FF7A92";
}

function deltaText(ms: number | null) {
  return ms === null ? "--.---" : `${ms <= 0 ? "-" : "+"}${(Math.abs(ms) / 1000).toFixed(3)}`;
}

/**
 * The top few drivers on what's being driven, in the style of Gran Turismo's race monitor: a position tag,
 * the driver's colour, their name and the gap to the leader (the leader shows the time to beat). In a
 * column it is the tower down the side of the screen; in a row it runs along the top or bottom edge.
 * The seated driver is picked out, and appended after a break when outside the top few.
 */
export function GapTowerCard({ data, orientation = "vertical" }: { data: OverlayData; orientation?: Orientation }) {
  const rows = data.comboTop;
  const row = orientation === "horizontal";
  const gapText = (r: (typeof rows)[number]) => (r.position === 1 ? lapTime(r.timeMs) : `+${(r.gapMs / 1000).toFixed(3)}`);
  const tag = (r: (typeof rows)[number]) => (
    <span
      className="mono"
      style={{
        flex: "none",
        minWidth: 30,
        padding: "3px 10px 3px 7px",
        textAlign: "center",
        fontSize: 15,
        fontWeight: 800,
        clipPath: "polygon(0 0, 100% 0, 82% 100%, 0 100%)",
        background: r.position === 1 ? "var(--gold)" : "rgba(169,174,255,0.22)",
        color: r.position === 1 ? "#1B1530" : "var(--text)",
      }}
    >
      {r.position}
    </span>
  );
  const seatStyle = (r: (typeof rows)[number]) => (r.isSeat ? { background: "var(--tint)", color: "var(--peri-1)" } : {});
  return (
    <div
      style={{
        ...card,
        padding: 6,
        display: "flex",
        flexDirection: row ? "row" : "column",
        alignItems: "stretch",
        gap: 4,
        minWidth: row ? undefined : 190,
      }}
    >
      {rows.length === 0 && <span className="muted" style={{ fontSize: 13, padding: "4px 8px" }}>No {words(data.game).laps} yet</span>}
      {rows.map((r, i) => (
        <span key={`${r.position}-${r.name}`} style={{ display: "contents" }}>
          {i === 5 && <span style={row ? { width: 1, background: "var(--line)", margin: "2px 2px" } : { height: 1, background: "var(--line)", margin: "1px 4px" }} />}
          {row ? (
            <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 92, padding: "5px 8px", borderRadius: 12, ...seatStyle(r) }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {tag(r)}
                <span style={{ flex: 1, height: 4, borderRadius: 2, background: r.color }} />
              </span>
              <span style={{ fontSize: 14, fontWeight: r.isSeat ? 800 : 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 110 }}>{r.name}</span>
              <span className="mono" style={{ fontSize: 13, color: r.position === 1 ? "var(--gold)" : "var(--text-2)" }}>{gapText(r)}</span>
            </span>
          ) : (
            <span style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 8px 3px 3px", borderRadius: 12, ...seatStyle(r) }}>
              {tag(r)}
              <span style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: r.color, flex: "none" }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: r.isSeat ? 800 : 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
              <span className="mono" style={{ fontSize: 13, color: r.position === 1 ? "var(--gold)" : "var(--text-2)" }}>{gapText(r)}</span>
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * The same drivers as the tower, laid out by their gaps like the race monitor in Gran Turismo's B-spec: the
 * leader first, everyone else along a rail the gap they are behind takes (so a close fight is close and a
 * driver far back is far), with the gap to the driver ahead written between each pair. In a column it runs
 * down the rail; in a row it runs along it.
 */
export function GapMonitorCard({ data, orientation = "vertical" }: { data: OverlayData; orientation?: Orientation }) {
  const cars = [...data.comboTop].sort((a, b) => a.gapMs - b.gapMs);
  const row = orientation === "horizontal";
  const intervals = cars.slice(1).map((c, i) => c.gapMs - cars[i].gapMs);
  const size = Math.max(BASE, intervals.reduce((sum, ms) => sum + room(ms), 0));
  const at = place(intervals, size);
  const short = (name: string) => name.replace(/\s+/g, "").slice(0, 3).toUpperCase();
  // The rail is a fixed length, so the spacing is the same wherever the widget sits. The box round it is
  // measured to the edges of what is drawn (a helmet and its ring, the tags above or beside it, the gaps
  // below or beside), so the card's one padding is the same on every side whichever way the widget runs.
  const length = row ? 440 : 250;
  const along = row ? "left" : "top";
  const avatar = (c: (typeof cars)[number]) => (c.isSeat ? 32 : 28);
  // How far a helmet and its ring reach from its place on the rail, and how tall a tag is.
  const reachOf = (c: (typeof cars)[number]) => avatar(c) / 2 + (c.isSeat ? 4 : 2);
  const TAG_H = 17;
  const first = cars[0];
  const last = cars[cars.length - 1];
  // Along the rail the box ends at the helmets at its two ends (each its own reach: the seated driver's is
  // bigger); across it at the widest helmet, and in a row at the tallest tag above and the gap labels below.
  const startReach = first ? reachOf(first) : 0;
  const endReach = last ? reachOf(last) : 0;
  const sideReach = Math.max(0, ...cars.map(reachOf));
  const above = Math.max(0, ...cars.map((c) => avatar(c) / 2 + 6 + TAG_H));
  const mid = (i: number) => (at[i] + at[i + 1]) / 2;
  const px = (f: number) => startReach + f * length;
  // Where the rail runs across the box, and how big the box is. (A tag is about 34px wide: "5 ALE".)
  const railAt = row ? above : sideReach;
  const box = row
    ? { width: startReach + length + endReach, height: above + Math.max(sideReach, 20 + 14) }
    : { width: sideReach + Math.max(0, ...cars.map((c) => avatar(c) / 2)) + 8 + 34, height: startReach + length + endReach };
  return (
    <div style={{ ...card, padding: 16, display: "flex" }}>
      <div style={{ position: "relative", ...box }}>
        {/* The rail. */}
        <span
          style={
            row
              ? { position: "absolute", left: startReach, width: length, top: railAt - 1, height: 2, background: "var(--line)" }
              : { position: "absolute", top: startReach, height: length, left: railAt - 1, width: 2, background: "var(--line)" }
          }
        />
        {cars.slice(1).map((c, i) => (
          <span
            key={`gap-${c.position}-${c.name}`}
            className="mono"
            style={{
              position: "absolute",
              [along]: px(mid(i)),
              ...(row ? { top: railAt + 20, transform: "translateX(-50%)" } : { left: railAt + 20, transform: "translateY(-50%)" }),
              fontSize: 11,
              fontWeight: 600,
              color: "var(--muted)",
              whiteSpace: "nowrap",
            }}
          >
            {ladderGap(intervals[i])}
          </span>
        ))}
        {/* Back of the pack first so the front is drawn on top. */}
        {[...cars].reverse().map((c) => {
          const f = at[cars.indexOf(c)];
          const s = avatar(c);
          return (
            <span
              key={`${c.position}-${c.name}`}
              title={`${c.position}. ${c.name}`}
              style={{
                position: "absolute",
                [along]: px(f),
                ...(row ? { top: railAt, transform: "translate(-50%, -50%)" } : { left: railAt, transform: "translate(-50%, -50%)" }),
                width: s,
                height: s,
              }}
            >
              {/* The driver's own helmet, ringed in peach when it's the driver in the seat. */}
              <span
                style={{
                  display: "block",
                  borderRadius: s * 0.3,
                  boxShadow: c.isSeat ? "0 0 0 2px #161B24, 0 0 0 4px var(--violet)" : "0 0 0 2px #161B24",
                }}
              >
                <Helmet color={c.color} size={s} seed={c.driverId ?? c.name} />
              </span>
              <span
                className="mono"
                style={{
                  position: "absolute",
                  display: "flex",
                  alignItems: "baseline",
                  gap: 5,
                  fontSize: 13,
                  fontWeight: 800,
                  color: c.isSeat ? "var(--peach)" : c.color,
                  whiteSpace: "nowrap",
                  ...(row ? { bottom: "100%", left: "50%", transform: "translateX(-50%)", marginBottom: 6 } : { left: "100%", top: "50%", transform: "translateY(-50%)", marginLeft: 8 }),
                }}
              >
                <span style={{ fontSize: 11, color: c.position === 1 ? "var(--gold)" : "var(--muted)" }}>{c.position}</span>
                {short(c.name)}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** Always-visible QR code so anyone in the room can scan it to open Bin It on their phone. */
export function QrCard({ data }: { data: OverlayData }) {
  return (
    <div style={{ ...card, padding: 10, display: "flex", alignItems: "center", gap: 12 }}>
      <QrCode url={data.url} size={104} />
      <span style={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 130 }}>
        <span style={{ font: "800 13px var(--font-display)" }}>Scan to join</span>
        <span className="mono" style={{ fontSize: 10.5, color: "var(--muted)", overflowWrap: "anywhere" }}>{data.url?.replace("http://", "")}</span>
      </span>
    </div>
  );
}

/** Top of the leaderboard for what's being driven right now, independent of challenges. */
export function LeaderboardCard({ data }: { data: OverlayData }) {
  return (
    <div style={{ ...card, borderRadius: 28, padding: "14px 16px", width: 260, display: "flex", flexDirection: "column" }}>
      <span style={{ font: "500 11px var(--font-mono)", letterSpacing: "0.08em", textTransform: "uppercase", color: "#2FA8FF", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {data.comboLabel ?? "Leaderboard"}
      </span>
      {data.comboTop.length === 0 && (
        <span className="muted" style={{ fontSize: 13, marginTop: 8 }}>{data.comboLabel ? `No ${words(data.game).laps} yet. Set the first!` : "Waiting for a session"}</span>
      )}
      <span style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
        {data.comboTop.map((r, i) => (
          <span key={`${r.position}-${r.name}`} style={{ display: "contents" }}>
            {i === 5 && <span style={{ height: 1, background: "var(--line)", margin: "4px 0" }} />}
            <RankRow position={r.position} name={r.name} color={r.color} seed={r.driverId ?? r.name} right={lapTime(r.timeMs)} rightColor={r.position === 1 && !r.isSeat ? "var(--mint)" : undefined} isSeat={r.isSeat} />
          </span>
        ))}
      </span>
    </div>
  );
}

export interface Toast {
  id: number;
  tone: "pb" | "record" | "lead" | "cut" | "lap" | "out" | "in";
  title: string;
  detail: string;
}

export const TOAST_MS = 4000;
const TONES: Record<Toast["tone"], { bg: string; fg: string; badge: string }> = {
  pb: { bg: "#4FD39A", fg: "#04140D", badge: "PB" },
  record: { bg: "#B79BFF", fg: "#150B2E", badge: "REC" },
  lead: { bg: "#2A2B58", fg: "#C9C9FF", badge: "P1" },
  cut: { bg: "#FF7A92", fg: "#2A0610", badge: "CUT" },
  lap: { bg: "#161B24", fg: "#E8EBF4", badge: "LAP" },
  out: { bg: "#1E2430", fg: "#E8EBF4", badge: "OUT" },
  in: { bg: "#1E2430", fg: "#E8EBF4", badge: "IN" },
};

export function ToastCard({ toast, animate = true }: { toast: Toast; animate?: boolean }) {
  const tone = TONES[toast.tone];
  return (
    <div
      key={toast.id}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 24px 12px 12px",
        borderRadius: 999,
        background: tone.bg,
        color: tone.fg,
        boxShadow: "0 10px 34px rgba(0,0,0,0.4)",
        whiteSpace: "nowrap",
        animation: animate ? `tt-toast ${TOAST_MS}ms ease forwards` : undefined,
      }}
    >
      <span style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(0,0,0,0.16)", color: "inherit", display: "grid", placeItems: "center", font: "700 12px var(--font-mono)" }}>
        {tone.badge}
      </span>
      <span style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ font: "800 17px var(--font-display)" }}>{toast.title}</span>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{toast.detail}</span>
      </span>
    </div>
  );
}

export const TOAST_KEYFRAMES = `@keyframes tt-toast { 0% { opacity: 0; transform: translateY(12px); } 6% { opacity: 1; transform: none; } 88% { opacity: 1; } 100% { opacity: 0; } }`;

/** Turns recorded laps into pop-ups; each one clears itself after TOAST_MS. */
export function useLapToasts(pbMs: number | null): Toast | null {
  const drivers = useDriverMap();
  const [toast, setToast] = useState<Toast | null>(null);

  const onEvent = useCallback(
    (e: AppEvent) => {
      if (e.type !== "lapRecorded") return;
      const r = e.result;
      const name = r.lap.driverId != null ? drivers.get(r.lap.driverId)?.name ?? "Guest" : "Guest";
      const s = r.challenges[0];
      const moved = s?.position != null && s.position !== s.previousPosition ? ` · up to P${s.position}` : "";
      let t: Omit<Toast, "id">;
      const kind = lapKind(r.lap);
      if (kind === "outLap") t = { tone: "out", title: `Out lap ${lapTime(r.lap.timeMs)}`, detail: "Timing starts now. Good luck!" };
      else if (kind === "inLap") t = { tone: "in", title: `In lap ${lapTime(r.lap.timeMs)}`, detail: "Not timed" };
      else if (kind === "partial") t = { tone: "lap", title: `${lapTime(r.lap.timeMs)} not timed`, detail: `Bin It joined part-way through the ${words(r.lap.game).lap}` };
      else if (kind === "cut") t = { tone: "cut", title: `${lapTime(r.lap.timeMs)} not counted`, detail: "Lap was cut (track limits)" };
      else if (r.comboRecord) t = { tone: "record", title: `Track record ${lapTime(r.lap.timeMs)}`, detail: `${name} is the fastest ever here${moved}` };
      else if (s?.position === 1 && s.previousPosition !== 1) t = { tone: "lead", title: `${name} takes the crown`, detail: `${lapTime(r.lap.timeMs)} in ${s.challengeName}` };
      else if (r.personalBest) t = { tone: "pb", title: `New PB ${lapTime(r.lap.timeMs)}`, detail: s?.position ? `P${s.position} in ${s.challengeName}` : `Nice one, ${name}` };
      else t = { tone: "lap", title: lapTime(r.lap.timeMs), detail: pbMs ? `PB is ${lapTime(pbMs)}` : name };
      // What the lap earned, when it earned something.
      if (r.awards && r.awards.xp > 0) {
        t = { ...t, detail: `${t.detail} · +${r.awards.xp} XP${r.awards.levelUp ? ` · level ${r.awards.levelUp}!` : ""}` };
      }
      setToast({ ...t, id: Date.now() });
    },
    [drivers, pbMs],
  );
  useAppEvent(onEvent);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  return toast;
}

/**
 * Renders one section's widgets: compact ones merge into a strip, others stack.
 * Live (not preview), widgets with nothing to show are left out entirely.
 */
export function SectionWidgets({
  items,
  data,
  toast,
  preview = false,
  itemProps,
  anchor,
  styles,
}: {
  items: WidgetId[];
  data: OverlayData;
  toast: Toast | null;
  preview?: boolean;
  itemProps?: ItemProps;
  /** The section these sit in, for a widget (the gap tower) that lays itself out to suit its place. */
  anchor?: Anchor;
  /** The layout's chosen styles, for a widget that comes in more than one. */
  styles?: OverlayLayout["styles"];
}) {
  const visible = preview ? items : items.filter((w) => hasContent(w, data));
  const groups: (WidgetId[] | WidgetId)[] = [];
  for (const w of visible) {
    const last = groups[groups.length - 1];
    if (WIDGETS[w].compact && Array.isArray(last)) last.push(w);
    else groups.push(WIDGETS[w].compact ? [w] : w);
  }
  const wrap = (w: WidgetId, node: ReactNode) => (
    <div key={w} data-widget={w} {...itemProps?.(w)}>
      {node}
    </div>
  );
  return (
    <>
      {groups.map((g) => {
        if (Array.isArray(g)) return <StripCard key={g.join()} items={g} data={data} itemProps={itemProps} />;
        if (g === "standings") return wrap(g, <StandingsCard data={data} mode={styleOf({ styles }, "standings")} />);
        if (g === "timing") return wrap(g, <TimingCard data={data} mode={styleOf({ styles }, "timing")} />);
        if (g === "leaderboard") return wrap(g, <LeaderboardCard data={data} />);
        if (g === "tower") {
          const Tower = styleOf({ styles }, "tower") === "gaps" ? GapMonitorCard : GapTowerCard;
          return wrap(g, <Tower data={data} orientation={orientationFor(anchor)} />);
        }
        if (g === "qr") return wrap(g, <QrCard data={data} />);
        const shown = toast ?? (preview ? MOCK_TOAST : null);
        return shown ? wrap(g, <ToastCard toast={shown} animate={!preview} />) : null;
      })}
    </>
  );
}
