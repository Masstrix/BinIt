// Presentational overlay widgets. The real overlay feeds them live data; the layout
// editor renders the same components, scaled down, as its preview.

import { useCallback, useEffect, useState, type HTMLAttributes, type ReactNode } from "react";
import { api, type LiveTiming, useAppEvent, useAppState, useCurrentChallenge, useDriverMap, useFetch, type AppEvent, type LeaderboardEntry } from "../api";
import { lapKind, lapTime, trackName } from "../format";
import { WIDGETS, type WidgetId } from "../overlayLayout";
import { Crown, Helmet } from "./Helmet";

const card = {
  borderRadius: 18,
  background: "rgba(13,18,36,0.85)",
  border: "1px solid rgba(169,174,255,0.25)",
} as const;

export interface OverlayData {
  driverName: string;
  driverColor: string;
  pbMs: number | null;
  challengeName: string | null;
  position: number | null;
  gapMs: number | null;
  top3: { name: string; color: string; timeMs: number }[];
  /** "Mount Panorama · GP" style label for the track leaderboard. */
  comboLabel: string | null;
  /** Top 5 on the current track + car, plus the seated driver's row if outside it. */
  comboTop: { position: number; name: string; color: string; timeMs: number; gapMs: number; isSeat: boolean }[];
  timing: LiveTiming | null;
  outLap: boolean;
}

/** Everything the widgets show, from live app state. */
export function useOverlayData(): OverlayData {
  const { status } = useAppState();
  const drivers = useDriverMap();
  const seat = status?.seat != null ? drivers.get(status.seat) : undefined;
  const session = status?.session ?? null;
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
    return { name: d?.name ?? "Guest", color: d?.color ?? "#9AA3C7", timeMs: e.timeMs };
  };
  const ranked = (e: LeaderboardEntry) => ({
    ...named(e),
    position: e.position,
    gapMs: e.gapMs,
    isSeat: seat != null && e.driverId === seat.id,
  });
  const comboTop = (comboBoard ?? []).slice(0, 5).map(ranked);
  if (pb && pb.position > 5) comboTop.push(ranked(pb));
  return {
    driverName: seat?.name ?? "Guest",
    driverColor: seat?.color ?? "#9AA3C7",
    pbMs: pb?.timeMs ?? null,
    challengeName: challenge?.name ?? null,
    position: standing?.position ?? null,
    gapMs: standing?.gapMs ?? null,
    top3: board.slice(0, 3).map(named),
    comboLabel: session ? `${trackName(session.track, session.layout)}` : null,
    comboTop,
    timing: status?.live?.driving ? status.live.timing : null,
    outLap: !!(status?.live?.driving && status.live.outLap),
  };
}

/** Example data so the layout editor always shows what every widget looks like. */
export const MOCK_DATA: OverlayData = {
  driverName: "Sam",
  driverColor: "#FF9F6B",
  pbMs: 102318,
  challengeName: "Imola Hot Lap Week",
  position: 2,
  gapMs: 204,
  top3: [
    { name: "Jess", color: "#4FC3FF", timeMs: 102114 },
    { name: "Sam", color: "#FF9F6B", timeMs: 102318 },
    { name: "Priya", color: "#FF7AC6", timeMs: 102870 },
  ],
  comboLabel: "Imola · GP",
  comboTop: [
    { position: 1, name: "Jess", color: "#4FC3FF", timeMs: 102114, gapMs: 0, isSeat: false },
    { position: 2, name: "Sam", color: "#FF9F6B", timeMs: 102318, gapMs: 204, isSeat: true },
    { position: 3, name: "Priya", color: "#FF7AC6", timeMs: 102870, gapMs: 756, isSeat: false },
    { position: 4, name: "Tom", color: "#4BE3A6", timeMs: 103555, gapMs: 1441, isSeat: false },
    { position: 5, name: "Alex", color: "#FFC93C", timeMs: 104020, gapMs: 1906, isSeat: false },
  ],
  timing: {
    deltaMs: -142,
    reference: "PB",
    currentSector: 2,
    sectors: [
      { timeMs: 33902, deltaMs: -215, status: "purple" },
      { timeMs: 38546, deltaMs: 73, status: "green" },
      { timeMs: null, deltaMs: null, status: "current" },
    ],
  },
  outLap: false,
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
      return data.comboTop.length > 0;
    case "timing":
      return data.timing !== null || data.outLap;
    default:
      return true;
  }
}

/** Extra props per widget element: the layout editor uses this to make each one draggable. */
export type ItemProps = (w: WidgetId) => HTMLAttributes<HTMLElement>;

function StripStat({ label, value, color, extra }: { label: string; value: string; color?: string; extra?: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
      <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>{label}</span>
      <span className="mono" style={{ fontSize: 16, color }}>
        {value} {extra && <span style={{ color: "var(--peach)" }}>{extra}</span>}
      </span>
    </span>
  );
}

/** Driver / PB / challenge position, merged into one slim strip when they share a section. */
export function StripCard({ items, data, itemProps }: { items: WidgetId[]; data: OverlayData; itemProps?: ItemProps }) {
  return (
    <div style={{ ...card, display: "flex", alignItems: "center", gap: 14, padding: items[0] === "driver" ? "8px 16px 8px 8px" : "8px 16px", whiteSpace: "nowrap" }}>
      {items.map((w, i) => (
        <span key={w} style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {i > 0 && <span style={{ width: 1, height: 28, background: "var(--line)" }} />}
          <span data-widget={w} {...itemProps?.(w)} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {w === "driver" && (
              <>
                <Helmet color={data.driverColor} size={40} />
                <span style={{ font: "800 18px var(--font-display)" }}>{data.driverName}</span>
                <span className="kbd" style={{ background: "var(--line)", color: "var(--text-2)" }}>F8</span>
              </>
            )}
            {w === "pb" && <StripStat label="PB" value={lapTime(data.pbMs)} color="var(--mint)" />}
            {w === "challenge" && (
              <StripStat
                label="CHALLENGE"
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

export function StandingsCard({ data }: { data: OverlayData }) {
  return (
    <div style={{ ...card, padding: "10px 14px", minWidth: 230, display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ font: "800 13px var(--font-display)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {data.challengeName ?? "No challenge running"}
      </span>
      {data.top3.length === 0 && <span className="muted" style={{ fontSize: 13 }}>No laps yet</span>}
      {data.top3.map((r, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
          <span style={{ width: 16, fontWeight: 800, color: i === 0 ? "var(--gold)" : "var(--text-2)" }}>{i + 1}</span>
          {i === 0 ? <Crown size={14} /> : <span style={{ width: 14 }} />}
          <span style={{ flex: 1, fontWeight: 600 }}>{r.name}</span>
          <span className="mono" style={{ fontSize: 14, color: i === 0 ? "var(--gold)" : undefined }}>{lapTime(r.timeMs)}</span>
        </span>
      ))}
    </div>
  );
}

const SECTOR_COLOURS = { purple: "#C38BFF", green: "#4BE3A6", yellow: "#FFC93C", current: "#EEF0FF", pending: "#2A3456" };

/** Delta to the reference lap plus one bar per sector (purple / green / yellow). */
export function TimingCard({ data }: { data: OverlayData }) {
  const t = data.timing;
  if (data.outLap || !t) {
    return data.outLap ? (
      <div style={{ ...card, padding: "10px 14px", minWidth: 240, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: 1, color: "var(--muted)" }}>OUT LAP</span>
        <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>TIMING STARTS AT THE LINE</span>
      </div>
    ) : null;
  }
  const d = t.deltaMs;
  return (
    <div style={{ ...card, padding: "10px 14px", minWidth: 240, display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <span className="mono" style={{ fontSize: 24, color: deltaColour(d) }}>{deltaText(d)}</span>
        <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>{t.reference ? `VS ${t.reference.toUpperCase()}` : "NO REFERENCE"}</span>
      </span>
      <span style={{ display: "flex", gap: 4 }}>
        {t.sectors.map((s, i) => (
          <span key={i} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ height: 8, borderRadius: 4, background: SECTOR_COLOURS[s.status], opacity: s.status === "current" ? 0.5 : 1 }} />
            <span className="mono" style={{ fontSize: 11, lineHeight: 1.2, textAlign: "center", color: s.timeMs ? "var(--text)" : "var(--muted)" }}>
              {s.timeMs ? (s.timeMs / 1000).toFixed(3) : `S${i + 1}`}
            </span>
            {s.deltaMs !== null && (
              <span className="mono" style={{ fontSize: 10, lineHeight: 1.1, textAlign: "center", color: deltaColour(s.deltaMs) }}>{deltaText(s.deltaMs)}</span>
            )}
          </span>
        ))}
      </span>
    </div>
  );
}

function deltaColour(ms: number | null) {
  return ms === null ? "var(--muted)" : ms <= 0 ? "#4BE3A6" : "#FF6B8A";
}

function deltaText(ms: number | null) {
  return ms === null ? "--.---" : `${ms <= 0 ? "-" : "+"}${(Math.abs(ms) / 1000).toFixed(3)}`;
}

/** Top of the leaderboard for what's being driven right now, independent of challenges. */
export function LeaderboardCard({ data }: { data: OverlayData }) {
  return (
    <div style={{ ...card, padding: "10px 14px", minWidth: 260, display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <span style={{ font: "800 13px var(--font-display)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {data.comboLabel ?? "Leaderboard"}
        </span>
        <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>THIS CAR</span>
      </span>
      {data.comboTop.length === 0 && <span className="muted" style={{ fontSize: 13 }}>{data.comboLabel ? "No laps yet. Set the first!" : "Waiting for a session"}</span>}
      {data.comboTop.map((r, i) => (
        <span key={`${r.position}-${r.name}`} style={{ display: "contents" }}>
          {i === 5 && <span style={{ height: 1, background: "var(--line)", margin: "2px 0" }} />}
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 14,
              padding: "2px 6px",
              margin: "0 -6px",
              borderRadius: 8,
              background: r.isSeat ? "rgba(255,159,107,0.18)" : undefined,
            }}
          >
            <span style={{ width: 18, fontWeight: 800, color: r.position === 1 ? "var(--gold)" : "var(--text-2)" }}>{r.position}</span>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: r.color, flex: "none" }} />
            <span style={{ flex: 1, fontWeight: r.isSeat ? 800 : 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
            <span className="mono" style={{ fontSize: 12, color: "var(--muted)", width: 58, textAlign: "right" }}>
              {r.gapMs ? `+${(r.gapMs / 1000).toFixed(3)}` : ""}
            </span>
            <span className="mono" style={{ fontSize: 14, color: r.position === 1 ? "var(--gold)" : undefined }}>{lapTime(r.timeMs)}</span>
          </span>
        </span>
      ))}
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
  pb: { bg: "#4BE3A6", fg: "#062A1C", badge: "PB" },
  record: { bg: "#FFC93C", fg: "#2A1F00", badge: "REC" },
  lead: { bg: "#FF9F6B", fg: "#2A1406", badge: "P1" },
  cut: { bg: "#FF6B8A", fg: "#2A0610", badge: "CUT" },
  lap: { bg: "#151C33", fg: "#EEF0FF", badge: "LAP" },
  out: { bg: "#232D52", fg: "#EEF0FF", badge: "OUT" },
  in: { bg: "#232D52", fg: "#EEF0FF", badge: "IN" },
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
        padding: "12px 20px 12px 12px",
        borderRadius: 20,
        background: tone.bg,
        color: tone.fg,
        whiteSpace: "nowrap",
        animation: animate ? `tt-toast ${TOAST_MS}ms ease forwards` : undefined,
      }}
    >
      <span style={{ width: 46, height: 46, borderRadius: 14, background: "#0D1224", color: tone.fg === "#EEF0FF" ? "#A9AEFF" : tone.bg, display: "grid", placeItems: "center", font: "800 13px var(--font-display)" }}>
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
      else if (kind === "partial") t = { tone: "lap", title: `${lapTime(r.lap.timeMs)} not timed`, detail: "TimeTrial joined part-way through the lap" };
      else if (kind === "cut") t = { tone: "cut", title: `${lapTime(r.lap.timeMs)} not counted`, detail: "Lap was cut (track limits)" };
      else if (r.comboRecord) t = { tone: "record", title: `Track record ${lapTime(r.lap.timeMs)}`, detail: `${name} is the fastest ever here${moved}` };
      else if (s?.position === 1 && s.previousPosition !== 1) t = { tone: "lead", title: `${name} takes the crown`, detail: `${lapTime(r.lap.timeMs)} in ${s.challengeName}` };
      else if (r.personalBest) t = { tone: "pb", title: `New PB ${lapTime(r.lap.timeMs)}`, detail: s?.position ? `P${s.position} in ${s.challengeName}` : `Nice one, ${name}` };
      else t = { tone: "lap", title: lapTime(r.lap.timeMs), detail: pbMs ? `PB is ${lapTime(pbMs)}` : name };
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
}: {
  items: WidgetId[];
  data: OverlayData;
  toast: Toast | null;
  preview?: boolean;
  itemProps?: ItemProps;
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
        if (g === "standings") return wrap(g, <StandingsCard data={data} />);
        if (g === "timing") return wrap(g, <TimingCard data={data} />);
        if (g === "leaderboard") return wrap(g, <LeaderboardCard data={data} />);
        const shown = toast ?? (preview ? MOCK_TOAST : null);
        return shown ? wrap(g, <ToastCard toast={shown} animate={!preview} />) : null;
      })}
    </>
  );
}
