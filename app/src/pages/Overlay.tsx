import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { api, isTauri, useAppEvent, useAppState, useCurrentChallenge, useDriverMap, useFetch, type AppEvent } from "../api";
import { Helmet } from "../components/Helmet";
import { lapTime } from "../format";

type Box = Pick<CSSProperties, "left" | "right" | "top" | "bottom" | "width" | "height" | "transform">;

export interface OverlayProfile {
  name: string;
  /** Where the game draws its own HUD (approximate), so our widgets stay clear. */
  hud: { label: string; box: Box }[];
  strip: Box;
  toasts: Box;
}

// Positions are % of the screen. Mapped from the game's default HUD layout.
export const OVERLAY_PROFILES: Record<string, OverlayProfile> = {
  acevo: {
    name: "AC EVO",
    hud: [
      { label: "Position / lap", box: { left: "2%", top: "3%", width: "19%", height: "13%" } },
      { label: "Session timer", box: { right: "2%", top: "3%", width: "16%", height: "10%" } },
      { label: "Track map", box: { left: "2%", top: "33%", width: "12%", height: "24%" } },
      { label: "Dash / tacho / delta", box: { right: "2%", bottom: "3%", width: "24%", height: "22%" } },
    ],
    strip: { left: "50%", top: "2.5%", transform: "translateX(-50%)" },
    toasts: { left: "2%", bottom: "3%" },
  },
};

interface Toast {
  id: number;
  tone: "pb" | "record" | "lead" | "cut" | "lap";
  title: string;
  detail: string;
}

const TOAST_MS = 4000;
const TONES: Record<Toast["tone"], { bg: string; fg: string; badge: string }> = {
  pb: { bg: "#4BE3A6", fg: "#062A1C", badge: "PB" },
  record: { bg: "#FFC93C", fg: "#2A1F00", badge: "REC" },
  lead: { bg: "#FF9F6B", fg: "#2A1406", badge: "P1" },
  cut: { bg: "#FF6B8A", fg: "#2A0610", badge: "CUT" },
  lap: { bg: "#151C33", fg: "#EEF0FF", badge: "LAP" },
};

export function Overlay() {
  const { status } = useAppState();
  const drivers = useDriverMap();
  const seat = status?.seat != null ? drivers.get(status.seat) : undefined;
  const session = status?.session ?? null;
  const profile = OVERLAY_PROFILES[status?.game ?? "acevo"] ?? OVERLAY_PROFILES.acevo;
  const { challenge, board } = useCurrentChallenge();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);

  const comboBoard = useFetch(
    session ? () => api.leaderboard({ game: session.game, track: session.track, layout: session.layout, car: session.car }) : null,
    [session?.game, session?.track, session?.layout, session?.car],
  );
  const pb = seat ? comboBoard?.find((e) => e.driverId === seat.id) : undefined;
  const standing = seat ? board.find((e) => e.driverId === seat.id) : undefined;

  // F8 arrives from the desktop app as a Tauri event. In a plain browser (preview), F8 works locally.
  useEffect(() => {
    if (!isTauri) {
      const onKey = (e: KeyboardEvent) => e.key === "F8" && setSwitcherOpen((o) => !o);
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) =>
      listen<boolean>("switcher", (e) => setSwitcherOpen(e.payload)).then((u) => (unlisten = u)),
    );
    return () => unlisten?.();
  }, []);

  const closeSwitcher = useCallback(() => {
    setSwitcherOpen(false);
    if (isTauri) import("@tauri-apps/api/core").then(({ invoke }) => invoke("close_switcher"));
  }, []);

  const onEvent = useCallback(
    (e: AppEvent) => {
      if (e.type !== "lapRecorded") return;
      const r = e.result;
      const name = r.lap.driverId != null ? drivers.get(r.lap.driverId)?.name ?? "Guest" : "Guest";
      const s = r.challenges[0];
      const moved = s?.position != null && s.position !== s.previousPosition ? ` · up to P${s.position}` : "";
      let t: Omit<Toast, "id">;
      if (!r.lap.valid) t = { tone: "cut", title: `${lapTime(r.lap.timeMs)} not counted`, detail: "Lap was cut or started in the pits" };
      else if (r.comboRecord) t = { tone: "record", title: `Track record ${lapTime(r.lap.timeMs)}`, detail: `${name} is the fastest ever here${moved}` };
      else if (s?.position === 1 && s.previousPosition !== 1) t = { tone: "lead", title: `${name} takes the crown`, detail: `${lapTime(r.lap.timeMs)} in ${s.challengeName}` };
      else if (r.personalBest) t = { tone: "pb", title: `New PB ${lapTime(r.lap.timeMs)}`, detail: s?.position ? `P${s.position} in ${s.challengeName}` : `Nice one, ${name}` };
      else t = { tone: "lap", title: lapTime(r.lap.timeMs), detail: pb ? `PB is ${lapTime(pb.timeMs)}` : name };
      setToast({ ...t, id: Date.now() });
    },
    [drivers, pb],
  );
  useAppEvent(onEvent);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const showStrip = status?.connected || !isTauri;

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", pointerEvents: "none", fontFamily: "var(--font-body)" }}>
      {showStrip && (
        <div
          style={{
            position: "absolute",
            ...profile.strip,
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "8px 16px 8px 8px",
            borderRadius: 18,
            background: "rgba(13,18,36,0.85)",
            border: "1px solid rgba(169,174,255,0.25)",
            whiteSpace: "nowrap",
          }}
        >
          <Helmet color={seat?.color ?? "#9AA3C7"} size={40} />
          <span style={{ font: "800 18px var(--font-display)" }}>{seat?.name ?? "Guest"}</span>
          <span style={{ width: 1, height: 28, background: "var(--line)" }} />
          <StripStat label="PB" value={lapTime(pb?.timeMs)} color="var(--mint)" />
          {challenge && (
            <StripStat
              label="CHALLENGE"
              value={standing ? `P${standing.position}` : "—"}
              extra={standing && standing.gapMs > 0 ? `+${(standing.gapMs / 1000).toFixed(3)}` : undefined}
            />
          )}
          <span className="kbd" style={{ background: "var(--line)", color: "var(--text-2)" }}>F8</span>
        </div>
      )}

      {toast && (
        <div
          key={toast.id}
          style={{
            position: "absolute",
            ...profile.toasts,
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "12px 20px 12px 12px",
            borderRadius: 20,
            background: TONES[toast.tone].bg,
            color: TONES[toast.tone].fg,
            animation: `tt-toast ${TOAST_MS}ms ease forwards`,
          }}
        >
          <span style={{ width: 46, height: 46, borderRadius: 14, background: "#0D1224", color: TONES[toast.tone].bg === "#151C33" ? "#EEF0FF" : TONES[toast.tone].bg, display: "grid", placeItems: "center", font: "800 13px var(--font-display)" }}>
            {TONES[toast.tone].badge}
          </span>
          <span style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ font: "800 17px var(--font-display)" }}>{toast.title}</span>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{toast.detail}</span>
          </span>
        </div>
      )}

      {switcherOpen && <Switcher onClose={closeSwitcher} />}

      <style>{`@keyframes tt-toast { 0% { opacity: 0; transform: translateY(12px); } 6% { opacity: 1; transform: none; } 88% { opacity: 1; } 100% { opacity: 0; } }`}</style>
    </div>
  );
}

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

function Switcher({ onClose }: { onClose: () => void }) {
  const { drivers, status } = useAppState();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // Most recently added first, so regulars and newcomers are both near the top.
  const list = [...drivers].sort((a, b) => b.createdAt - a.createdAt).slice(0, 9);

  const pick = useCallback(
    async (id: number) => {
      await api.setSeat(id);
      onClose();
    },
    [onClose],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (document.activeElement === input.current && name) return;
      const n = Number(e.key);
      if (n >= 1 && n <= list.length) {
        e.preventDefault();
        pick(list[n - 1].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list, name, onClose, pick]);

  const add = async () => {
    try {
      await api.addDriver(name, undefined, true);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(8,10,20,0.55)", display: "grid", placeItems: "center", pointerEvents: "auto" }} onClick={onClose}>
      <div role="dialog" aria-label="Who's driving" className="card" style={{ width: "min(760px, 92vw)", gap: 18 }} onClick={(e) => e.stopPropagation()}>
        <div className="head">
          <h2 style={{ fontSize: 26 }}>Who's driving?</h2>
          <span className="muted" style={{ fontSize: 14 }}>Press a number · Esc to close</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10 }}>
          {list.map((d, i) => {
            const active = d.id === status?.seat;
            return (
              <button key={d.id} className="driver-btn" aria-pressed={active} style={{ position: "relative", borderColor: active ? d.color : "transparent" }} onClick={() => pick(d.id)}>
                <span className="mono" style={{ position: "absolute", left: 10, top: 8, fontSize: 12, color: "var(--muted)" }}>{i + 1}</span>
                <Helmet color={d.color} size={52} />
                <span className="name">{d.name}</span>
              </button>
            );
          })}
        </div>
        <form
          className="add-bar"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) add();
          }}
        >
          <input
            ref={input}
            className="input"
            value={name}
            maxLength={32}
            onChange={(e) => setName(e.target.value)}
            placeholder="New driver? Type a name and hit Enter"
            aria-label="New driver name"
            autoFocus={list.length === 0}
            style={{ borderColor: "var(--violet)" }}
          />
        </form>
        {error && <span className="error">{error}</span>}
      </div>
    </div>
  );
}
