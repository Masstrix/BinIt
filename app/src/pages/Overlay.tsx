import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { api, isTauri, useAppEvent, useAppState, type AppEvent, type Driver } from "../api";
import { CelebrationView, CentreSwitch, isCentre, useCelebrations } from "../components/Celebrations";
import { Helmet } from "../components/Helmet";
import { MOCK_DATA, SectionWidgets, withDevClimb, withDevLive, TOAST_KEYFRAMES, useLapToasts, useOverlayData } from "../components/OverlayWidgets";
import { useDevCelebrate, useDevOverlay } from "../devOverlay";
import { fx } from "../fx";
import { ANCHORS, anchorStyle, useOverlayLayout } from "../overlayLayout";

export function Overlay() {
  const { status, drivers } = useAppState();
  // Dev builds can draw the overlay for a chosen game with example data, with no game running (see the editor).
  const [devGame] = useDevOverlay();
  const game = devGame ?? status?.game ?? "acevo";
  const { layout, profile } = useOverlayLayout(game);
  const live = useOverlayData();
  // Development only: the editor's "Rank" buttons move Tom up the example standings so the motion can be seen.
  const [devClimb, setDevClimb] = useState(0);
  useDevCelebrate(
    useCallback((kind: string) => {
      if (kind === "rankUp") setDevClimb((n) => Math.min(2, n + 1));
      else if (kind === "rankReset") setDevClimb(0);
    }, []),
  );
  // Development only: with the gap tower on its live mode, the example lap runs so the tower can be watched.
  const [devClock, setDevClock] = useState(0);
  useEffect(() => {
    if (!devGame || layout.towerMode !== "live") return;
    const t0 = performance.now();
    const id = window.setInterval(() => setDevClock((performance.now() - t0) / 1000), 150);
    return () => window.clearInterval(id);
  }, [devGame, layout.towerMode]);
  const data = devGame ? (layout.towerMode === "live" ? withDevLive(withDevClimb(MOCK_DATA, devClimb), devClock) : withDevClimb(MOCK_DATA, devClimb)) : live;
  // In the dev overlay a quiet pop-up played from the editor shows over the example one.
  const toast = useLapToasts(live.pbMs);
  const celebration = useCelebrations();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const fxCanvas = useRef<HTMLCanvasElement>(null);
  // The particle layer: one transparent canvas under the widgets.
  useEffect(() => {
    fx.attach(fxCanvas.current);
    const onResize = () => fx.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      fx.attach(null);
    };
  }, []);
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
    // Listening is asynchronous: if this effect is torn down before a listener is ready (React runs every effect twice
    // in development), that listener must be dropped as soon as it arrives. Otherwise two are left and every key,
    // an arrow press in the picker for one, is handled twice.
    let gone = false;
    const unlisten: (() => void)[] = [];
    const keep = (u: () => void) => (gone ? u() : unlisten.push(u));
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<boolean>("switcher", (e) => setSwitcherOpen(e.payload)).then(keep);
      listen<string>("switcher-key", (e) => keyHandler.current(e.payload)).then(keep);
    });
    return () => {
      gone = true;
      unlisten.forEach((u) => u());
    };
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

  // Clicking the driver on the strip opens the same picker as F8.
  const openSwitcher = useCallback(() => {
    if (isTauri) import("@tauri-apps/api/core").then(({ invoke }) => invoke("open_switcher")).catch(() => {});
    else setSwitcherOpen(true);
  }, []);

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

  // Celebrations ride in the Pop-ups widget, wherever that sits. Taking the Pop-ups widget out turns them off.
  const hasPopups = ANCHORS.some((a) => layout.sections[a]?.includes("toasts"));
  const centre = showWidgets && hasPopups && isCentre(celebration) ? celebration : null;
  // Taking the lead is its own moment, apart from the lap: it sits just above the middle, not in the Pop-ups slot.
  const lead = showWidgets && hasPopups && celebration?.kind === "lead" ? celebration : null;
  // Who the new leader is clear of: the next place on the running challenge's board.
  const next = data.challengeTop.find((r) => r.position === 2);
  const second = next ? { name: next.name, gapMs: next.gapMs } : null;
  const slotCelebration = showWidgets && hasPopups && celebration && !centre && !lead ? celebration : null;

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", pointerEvents: "none", fontFamily: "var(--font-body)", userSelect: "none", WebkitUserSelect: "none", cursor: "default" }}>
      {centre && <CentreSwitch key={centre.id} c={centre} />}
      {lead && (
        <div style={{ position: "absolute", left: 0, right: 0, top: "30%", display: "flex", justifyContent: "center" }}>
          <CelebrationView key={lead.id} c={lead} layout="pill" ahead={second} />
        </div>
      )}
      {showWidgets &&
        ANCHORS.map((a) => {
          const items = layout.sections[a];
          if (!items?.length) return null;
          return (
            <div key={a} style={anchorStyle(a, profile, layout.margins)}>
              <SectionWidgets items={items} data={data} toast={toast} celebration={slotCelebration} preview={devGame != null} anchor={a} styles={layout.styles} towerMode={layout.towerMode} onDriverClick={openSwitcher} />
            </div>
          );
        })}

      {/* The particles drift over the pop-up that made them (and, briefly, whatever is near it). */}
      <canvas id="tt-fx" ref={fxCanvas} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />
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
      // Registering never takes the seat (someone may be mid-lap): the new driver lands first, Enter again to drive.
      await api.addDriver(titleCase(name.trim()));
      setName("");
      setHighlight(0);
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
  const seated = list.find((d) => d.id === status?.seat);

  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(8,10,20,0.6)", backdropFilter: "blur(6px)", display: "grid", placeItems: "center", pointerEvents: "auto", animation: "tt-fade 160ms ease-out" }} onClick={onClose}>
      <div
        role="dialog"
        aria-label="Who's driving"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(780px, 92vw)",
          display: "flex",
          flexDirection: "column",
          gap: 20,
          padding: 28,
          borderRadius: 36,
          background: "linear-gradient(180deg, color-mix(in srgb, var(--violet) 14%, var(--panel)) 0%, var(--panel) 120px)",
          boxShadow: "0 30px 80px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.06)",
          animation: "tt-pop 220ms cubic-bezier(.2,.9,.3,1.2)",
          userSelect: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Helmet color={seated?.color ?? "#8f99b3"} look={seated?.look} size={56} seed={seated?.id} mood="happy" round />
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ font: "800 30px/1.1 var(--font-display)", letterSpacing: "-0.03em" }}>Who's driving?</span>
            <span className="muted" style={{ fontSize: 14 }}>{seated ? `${seated.name} has the seat right now` : "Nobody has the seat"}</span>
          </span>
          <span style={{ display: "flex", gap: 6, alignItems: "center", flex: "none", color: "var(--muted)", fontSize: 12 }}>
            <span className="kbd">1-9</span> pick
            <span className="kbd">Esc</span> close
          </span>
        </div>
        {list.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 12 }}>
            {list.map((d, i) => {
              const active = d.id === status?.seat;
              const lit = i === highlight && !name;
              return (
                <button
                  key={d.id}
                  className="driver-btn tt-driver"
                  aria-pressed={active}
                  style={{
                    position: "relative",
                    padding: "16px 8px 12px",
                    gap: 8,
                    borderRadius: 26,
                    borderColor: lit ? "var(--peri-1)" : active ? d.color : "transparent",
                    background: lit ? "var(--panel-3)" : active ? `color-mix(in srgb, ${d.color} 14%, var(--panel-2))` : undefined,
                    boxShadow: lit ? "0 0 0 4px color-mix(in srgb, var(--peri-1) 22%, transparent)" : active ? `0 0 24px color-mix(in srgb, ${d.color} 30%, transparent)` : undefined,
                    animation: `tt-pop 240ms ${i * 28}ms cubic-bezier(.2,.9,.3,1.2) backwards`,
                  }}
                  onClick={() => pick(d)}
                >
                  <span className="kbd" style={{ position: "absolute", left: 10, top: 10 }}>{i + 1}</span>
                  {active && (
                    <span style={{ position: "absolute", right: 10, top: 10, font: "800 9px var(--font-mono)", letterSpacing: "0.08em", padding: "3px 7px", borderRadius: 999, background: d.color, color: "#10121a" }}>DRIVING</span>
                  )}
                  <span style={{ marginTop: 14 }}>
                    <Helmet color={d.color} look={d.look} size={68} seed={d.id} mood={active ? "happy" : lit ? "focus" : "idle"} round />
                  </span>
                  <span className="name" style={{ fontSize: 15 }}>{d.name}</span>
                </button>
              );
            })}
          </div>
        )}
        <div
          style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 12px 10px 20px", borderRadius: 24, background: "var(--panel-2)", boxShadow: name ? "inset 0 0 0 2px var(--violet)" : "inset 0 0 0 1px var(--line)" }}
        >
          <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>New here?</span>
          <div aria-live="polite" style={{ flex: 1, minWidth: 0, minHeight: 44, display: "flex", alignItems: "center", fontSize: 20, fontWeight: 800 }}>
            {typed ? (
              <>
                {typed}
                <span style={{ width: 2, height: 24, background: "var(--peri-1)", marginLeft: 2, animation: "tt-caret 1s steps(1) infinite" }} />
              </>
            ) : (
              <span className="muted" style={{ fontWeight: 500, fontSize: 16 }}>Just start typing your name</span>
            )}
          </div>
          {name ? (
            <span className="kbd" style={{ background: "var(--violet)", color: "var(--violet-ink)", padding: "6px 10px" }}>Enter to add</span>
          ) : (
            <span className="muted" style={{ fontSize: 12 }}>Adding someone won't take the seat</span>
          )}
        </div>
        {error && <span className="error">{error}</span>}
      </div>
      <style>{`@keyframes tt-caret { 50% { opacity: 0; } } @keyframes tt-pop { from { opacity: 0; transform: translateY(10px) scale(.94); } to { opacity: 1; transform: none; } } @keyframes tt-fade { from { opacity: 0; } to { opacity: 1; } } .tt-driver { transition: transform 120ms, background 120ms; } .tt-driver:hover { transform: translateY(-3px); }`}</style>
    </div>
  );
}
