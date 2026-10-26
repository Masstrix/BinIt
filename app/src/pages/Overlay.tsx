import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { api, isTauri, useAppEvent, useAppState, type AppEvent, type Driver } from "../api";
import { Helmet } from "../components/Helmet";
import { MOCK_DATA, MOCK_TOAST, SectionWidgets, TOAST_KEYFRAMES, useLapToasts, useOverlayData } from "../components/OverlayWidgets";
import { useDevOverlay } from "../devOverlay";
import { ANCHORS, anchorStyle, useOverlayLayout } from "../overlayLayout";

export function Overlay() {
  const { status, drivers } = useAppState();
  // Dev builds can draw the overlay for a chosen game with example data, with no game running (see the editor).
  const [devGame] = useDevOverlay();
  const game = devGame ?? status?.game ?? "acevo";
  const { layout, profile } = useOverlayLayout(game);
  const live = useOverlayData();
  const data = devGame ? MOCK_DATA : live;
  const liveToast = useLapToasts(live.pbMs);
  const toast = devGame ? MOCK_TOAST : liveToast;
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const keyHandler = useRef<(key: string) => void>(() => {});
  const switcherOpenRef = useRef(false);
  switcherOpenRef.current = switcherOpen;

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);

  // F8 and the switcher's keys arrive from the desktop app as events, so the game keeps
  // focus. In a plain browser (preview) the same keys come from the page itself.
  useEffect(() => {
    if (!isTauri) {
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "F8") setSwitcherOpen((o) => !o);
        else if (switcherOpenRef.current) {
          e.preventDefault();
          keyHandler.current(e.key.length === 1 ? e.key.toLowerCase() : e.key);
        }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
    const unlisten: (() => void)[] = [];
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<boolean>("switcher", (e) => setSwitcherOpen(e.payload)).then((u) => unlisten.push(u));
      listen<string>("switcher-key", (e) => keyHandler.current(e.payload)).then((u) => unlisten.push(u));
    });
    return () => unlisten.forEach((u) => u());
  }, []);
  const closeSwitcher = useCallback(() => {
    setSwitcherOpen(false);
    if (isTauri) import("@tauri-apps/api/core").then(({ invoke }) => invoke("close_switcher"));
  }, []);

  // Spoken confirmation, so switching works even when the overlay can't be seen.
  const driversRef = useRef(drivers);
  driversRef.current = drivers;
  useAppEvent(
    useCallback(
      (e: AppEvent) => {
        if (e.type !== "seatChanged" || !layout.voice || !("speechSynthesis" in window)) return;
        const d = driversRef.current.find((x) => x.id === e.driverId);
        speechSynthesis.cancel();
        speechSynthesis.speak(new SpeechSynthesisUtterance(d ? `${d.name} is driving` : "Guest is driving"));
      },
      [layout.voice],
    ),
  );

  // The few widgets that can be clicked (live timing) tell the desktop app where they are, so it lets the mouse
  // through to them and nowhere else.
  useEffect(() => {
    if (!isTauri) return;
    let last = "";
    const send = (rects: number[][]) => import("@tauri-apps/api/core").then(({ invoke }) => invoke("set_hit_regions", { rects })).catch(() => {});
    const report = () => {
      const rects = [...document.querySelectorAll<HTMLElement>("[data-hit]")].map((e) => {
        const r = e.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height];
      });
      const key = JSON.stringify(rects.map((r) => r.map(Math.round)));
      if (key !== last) {
        last = key;
        send(rects);
      }
    };
    report();
    const t = window.setInterval(report, 300);
    return () => {
      window.clearInterval(t);
      send([]);
    };
  }, []);

  // Widgets only appear in the phases the player chose: not over the game's menus unless asked to.
  const phase = status?.live?.phase ?? "menu";
  const mode = status?.overlayShow ?? "drivingPaused";
  const phaseOk = mode === "always" || phase === "driving" || (mode === "drivingPaused" && phase === "paused");
  const showWidgets = devGame != null || ((status?.connected || !isTauri) && (phaseOk || !isTauri));

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", pointerEvents: "none", fontFamily: "var(--font-body)", userSelect: "none", WebkitUserSelect: "none", cursor: "default" }}>
      {showWidgets &&
        ANCHORS.map((a) => {
          const items = layout.sections[a];
          if (!items?.length) return null;
          return (
            <div key={a} style={anchorStyle(a, profile)}>
              <SectionWidgets items={items} data={data} toast={toast} preview={devGame != null} anchor={a} styles={layout.styles} />
            </div>
          );
        })}

      {switcherOpen && <Switcher onClose={closeSwitcher} keyHandler={keyHandler} />}
      <style>{TOAST_KEYFRAMES}</style>
    </div>
  );
}

/** "sam o'neil" -> "Sam O'neil": names typed in-game can't use Shift. */
function titleCase(s: string) {
  return s.replace(/(^|[\s-])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());
}

function Switcher({ onClose, keyHandler }: { onClose: () => void; keyHandler: RefObject<(key: string) => void> }) {
  const { drivers, status } = useAppState();
  const [name, setName] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Most recently added first, so regulars and newcomers are both near the top.
  const list: Driver[] = [...drivers].sort((a, b) => b.createdAt - a.createdAt).slice(0, 9);

  const pick = useCallback(
    async (d: Driver) => {
      await api.setSeat(d.id);
      onClose();
    },
    [onClose],
  );

  const add = useCallback(async () => {
    try {
      await api.addDriver(titleCase(name.trim()), undefined, true);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [name, onClose]);

  keyHandler.current = (key: string) => {
    setError(null);
    if (key === "Escape") return onClose();
    if (key === "Enter") {
      if (name.trim()) add();
      else if (list[highlight]) pick(list[highlight]);
      return;
    }
    if (key === "Backspace") return setName((n) => n.slice(0, -1));
    // Number keys pick a driver, unless a name is being typed.
    if (/^[1-9]$/.test(key) && !name) {
      const d = list[Number(key) - 1];
      if (d) pick(d);
      return;
    }
    const cols = 5;
    if (key === "ArrowRight") return setHighlight((h) => Math.min(list.length - 1, h + 1));
    if (key === "ArrowLeft") return setHighlight((h) => Math.max(0, h - 1));
    if (key === "ArrowDown") return setHighlight((h) => Math.min(list.length - 1, h + cols));
    if (key === "ArrowUp") return setHighlight((h) => Math.max(0, h - cols));
    if (/^[a-z0-9 \-]$/.test(key) && name.length < 32) setName((n) => n + key);
  };

  const typed = titleCase(name);

  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(8,10,20,0.55)", display: "grid", placeItems: "center", pointerEvents: "auto" }} onClick={onClose}>
      <div role="dialog" aria-label="Who's driving" className="card" style={{ width: "min(760px, 92vw)", gap: 18 }} onClick={(e) => e.stopPropagation()}>
        <div className="head">
          <h2 style={{ fontSize: 26 }}>Who's driving?</h2>
          <span className="muted" style={{ fontSize: 14 }}>Number to pick · type a new name · Esc to close</span>
        </div>
        {list.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 10 }}>
            {list.map((d, i) => {
              const active = d.id === status?.seat;
              const lit = i === highlight && !name;
              return (
                <button
                  key={d.id}
                  className="driver-btn"
                  aria-pressed={active}
                  style={{ position: "relative", borderColor: lit ? "var(--peri-1)" : active ? d.color : "transparent", background: lit ? "var(--panel-3)" : undefined }}
                  onClick={() => pick(d)}
                >
                  <span className="mono" style={{ position: "absolute", left: 10, top: 8, fontSize: 12, color: "var(--muted)" }}>{i + 1}</span>
                  <Helmet color={d.color} size={52} seed={d.id} />
                  <span className="name">{d.name}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="add-bar" style={{ gap: 12 }}>
          <span style={{ paddingLeft: 8, fontWeight: 600, whiteSpace: "nowrap" }}>New driver</span>
          <div
            aria-live="polite"
            style={{ flex: 1, minHeight: 48, display: "flex", alignItems: "center", padding: "0 16px", borderRadius: 14, border: `2px solid ${name ? "var(--violet)" : "var(--line)"}`, background: "var(--bg)", fontSize: 18, fontWeight: 700 }}
          >
            {typed ? (
              <>
                {typed}
                <span style={{ width: 2, height: 22, background: "var(--peri-1)", marginLeft: 2, animation: "tt-caret 1s steps(1) infinite" }} />
              </>
            ) : (
              <span className="muted" style={{ fontWeight: 500, fontSize: 16 }}>Just start typing, then Enter</span>
            )}
          </div>
          {name && <span className="kbd" style={{ background: "var(--violet)", color: "var(--violet-ink)" }}>Enter</span>}
        </div>
        {error && <span className="error">{error}</span>}
      </div>
      <style>{`@keyframes tt-caret { 50% { opacity: 0; } }`}</style>
    </div>
  );
}
