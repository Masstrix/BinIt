import { useEffect, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent } from "react";
import { isTauri, useAppState } from "../api";
import {
  ANCHORS,
  GAME_PROFILES,
  WIDGETS,
  anchorBox,
  anchorStyle,
  hudConflict,
  moveWidget,
  useOverlayLayout,
  type Anchor,
  type WidgetId,
} from "../overlayLayout";
import { OverlayFocusToggle, OverlayShowPicker, OverlayToggle } from "./OverlayToggle";
import {
  LeaderboardCard,
  QrCard,
  MOCK_DATA,
  MOCK_TOAST,
  SectionWidgets,
  StandingsCard,
  StripCard,
  TimingCard,
  ToastCard,
  type ItemProps,
} from "./OverlayWidgets";

// Preview at the shape of this PC's screen (e.g. 21:9 ultrawide), since overlay positions
// are % of the screen. Browsers on other devices fall back to 16:9.
const ASPECT = isTauri ? Math.min(32 / 9, Math.max(4 / 3, screen.width / screen.height)) : 16 / 9;
const VIRTUAL_H = 1080;
const VIRTUAL_W = Math.round(VIRTUAL_H * ASPECT);

const ANCHOR_NAMES: Record<Anchor, string> = {
  "top-left": "Top left",
  "top-center": "Top centre",
  "top-right": "Top right",
  "middle-left": "Middle left",
  "middle-right": "Middle right",
  "bottom-left": "Bottom left",
  "bottom-center": "Bottom centre",
  "bottom-right": "Bottom right",
};

const WIDGET_ORDER = Object.keys(WIDGETS) as WidgetId[];

/** Tracks a CSS media query (phones, touch screens). */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setMatches(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

/** Where on the screen a widget goes: a 3 x 3 grid of big tap targets, the middle one hides it. */
function PositionPicker({ widget, at, onPick }: { widget: WidgetId; at: Anchor | null; onPick: (to: Anchor | null) => void }) {
  const cells: (Anchor | "hide")[] = ["top-left", "top-center", "top-right", "middle-left", "hide", "middle-right", "bottom-left", "bottom-center", "bottom-right"];
  return (
    <div className="ed-positions" role="group" aria-label={`Where ${WIDGETS[widget].label} goes`}>
      {cells.map((c) =>
        c === "hide" ? (
          <button key={c} type="button" className="ed-pos hide" aria-pressed={at === null} onClick={() => onPick(null)}>
            Hide
          </button>
        ) : (
          <button key={c} type="button" className="ed-pos" aria-pressed={at === c} aria-label={ANCHOR_NAMES[c]} title={ANCHOR_NAMES[c]} onClick={() => onPick(c)}>
            <span aria-hidden="true" />
          </button>
        ),
      )}
    </div>
  );
}

interface DropTarget {
  anchor: Anchor;
  index: number;
  /** Insertion marker in frame px: a vertical bar between strip items, else horizontal. */
  bar: { x: number; y: number; w: number; h: number } | null;
}

/**
 * Per-game overlay layout. Drag each widget (from the tray or the preview) into a section;
 * where you drop it inside the section sets its order. Saves instantly and the in-game
 * overlay updates live. The preview always uses example data.
 */
export function OverlayEditor() {
  const { status } = useAppState();
  const overlayOn = status?.overlayEnabled ?? true;
  const [game, setGame] = useState(status?.game ?? "acevo");
  const { layout, save, reset, custom, profile } = useOverlayLayout(game);

  const [selected, setSelected] = useState<WidgetId | null>(null);
  const [dragging, setDragging] = useState<WidgetId | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const [overTray, setOverTray] = useState(false);
  // Touch (and pen) dragging: the browser's own drag and drop does not fire on touch screens.
  const [ghost, setGhost] = useState<{ w: WidgetId; x: number; y: number } | null>(null);
  const tray = useRef<HTMLDivElement>(null);
  const compact = useMediaQuery("(max-width: 640px)");
  const touch = useMediaQuery("(pointer: coarse), (max-width: 640px)");

  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / VIRTUAL_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const where = (w: WidgetId): Anchor | null => ANCHORS.find((a) => layout.sections[a]?.includes(w)) ?? null;
  const usedSections = ANCHORS.filter((a) => layout.sections[a]?.length);
  const conflicts = usedSections.map((a) => ({ a, hud: hudConflict(profile, a, layout.sections[a]) })).filter((c) => c.hud);

  /** The section under (or nearest to) a point, and where in its order the widget would go. */
  const targetAt = (clientX: number, clientY: number, moving: WidgetId | null): DropTarget | null => {
    const el = frame.current;
    if (!el) return null;
    const f = el.getBoundingClientRect();
    const px = ((clientX - f.left) / f.width) * 100;
    const py = ((clientY - f.top) / f.height) * 100;
    let anchor = ANCHORS[0];
    let best = Infinity;
    for (const a of ANCHORS) {
      const b = anchorBox(a, profile);
      const dx = Math.max(b.x - px, 0, px - (b.x + b.w));
      const dy = Math.max(b.y - py, 0, py - (b.y + b.h));
      const d = dx * dx + dy * dy;
      if (d < best) {
        best = d;
        anchor = a;
      }
    }

    // Widgets already in that section, in order, minus the one being moved.
    const nodes = [...el.querySelectorAll<HTMLElement>(`[data-anchor="${anchor}"] [data-widget]`)].filter(
      (n) => n.dataset.widget !== moving,
    );
    let index = 0;
    for (const n of nodes) {
      const r = n.getBoundingClientRect();
      const before = clientY > r.bottom || (clientY >= r.top && clientX > r.left + r.width / 2);
      if (before) index++;
    }

    let bar: DropTarget["bar"] = null;
    const ref = nodes[index] ?? nodes[nodes.length - 1];
    if (ref) {
      const r = ref.getBoundingClientRect();
      const inStrip = WIDGETS[ref.dataset.widget as WidgetId]?.compact;
      const after = index >= nodes.length;
      if (inStrip) {
        const x = after ? r.right + 6 : r.left - 8;
        bar = { x: x - f.left, y: r.top - f.top - 4, w: 3, h: r.height + 8 };
      } else {
        const y = after ? r.bottom + 4 : r.top - 6;
        bar = { x: r.left - f.left, y: y - f.top, w: r.width, h: 3 };
      }
    }
    return { anchor, index, bar };
  };

  const place = (w: WidgetId, to: Anchor | null, index?: number) => {
    save(moveWidget(layout, w, to, index));
    setSelected(null);
  };

  const startDrag = (w: WidgetId) => (e: DragEvent) => {
    e.stopPropagation();
    e.dataTransfer.setData("text/plain", w);
    e.dataTransfer.effectAllowed = "move";
    setDragging(w);
    setSelected(null);
  };
  const endDrag = () => {
    setDragging(null);
    setTarget(null);
    setOverTray(false);
  };

  const touchDown = (w: WidgetId) => (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === "mouse") return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Not capturable (e.g. a synthetic event): dragging still works while the pointer stays over this element.
    }
    setDragging(w);
    setSelected(null);
    setGhost({ w, x: e.clientX, y: e.clientY });
  };
  const insideTray = (x: number, y: number) => {
    const r = tray.current?.getBoundingClientRect();
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };
  const touchMove = (e: PointerEvent<HTMLElement>) => {
    if (!ghost) return;
    setGhost({ ...ghost, x: e.clientX, y: e.clientY });
    const overTrayNow = insideTray(e.clientX, e.clientY);
    setOverTray(overTrayNow);
    const f = frame.current?.getBoundingClientRect();
    const inFrame = !!f && e.clientX >= f.left && e.clientX <= f.right && e.clientY >= f.top && e.clientY <= f.bottom;
    setTarget(!overTrayNow && inFrame ? targetAt(e.clientX, e.clientY, ghost.w) : null);
  };
  const touchUp = (cancelled: boolean) => (e: PointerEvent<HTMLElement>) => {
    if (!ghost) return;
    if (!cancelled) {
      if (insideTray(e.clientX, e.clientY)) place(ghost.w, null);
      else if (target) place(ghost.w, target.anchor, target.index);
    }
    setGhost(null);
    endDrag();
  };
  const touchHandlers = (w: WidgetId) => ({
    onPointerDown: touchDown(w),
    onPointerMove: touchMove,
    onPointerUp: touchUp(false),
    onPointerCancel: touchUp(true),
  });

  /** Makes each widget in the preview individually draggable. */
  const itemProps: ItemProps = (w) => ({
    draggable: true,
    onDragStart: startDrag(w),
    onDragEnd: endDrag,
    ...touchHandlers(w),
    className: `ed-item${dragging === w ? " is-dragging" : ""}`,
    title: `${WIDGETS[w].label}: drag to move`,
  });

  const frameDragOver = (e: DragEvent) => {
    if (!dragging) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const t = targetAt(e.clientX, e.clientY, dragging);
    if (t?.anchor !== target?.anchor || t?.index !== target?.index || t?.bar?.x !== target?.bar?.x || t?.bar?.y !== target?.bar?.y) setTarget(t);
  };
  const frameDrop = (e: DragEvent) => {
    e.preventDefault();
    const w = (e.dataTransfer.getData("text/plain") || dragging) as WidgetId;
    const t = targetAt(e.clientX, e.clientY, w);
    if (w in WIDGETS && t) place(w, t.anchor, t.index);
    endDrag();
  };
  const frameClick = (e: MouseEvent) => {
    if (!selected) return;
    const t = targetAt(e.clientX, e.clientY, selected);
    if (t) place(selected, t.anchor, t.index);
  };

  const showZones = !!dragging || !!selected;

  return (
    <section className="card" aria-label="Overlay layout">
      <div className="head" style={{ alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 20 }}>Overlay layout</h2>
          <OverlayToggle />
          <OverlayFocusToggle />
          <OverlayShowPicker />
        </div>
        <div className="segmented" role="group" aria-label="Game" style={{ flexWrap: "wrap" }}>
          {GAME_PROFILES.map((p) => (
            <button key={p.key} aria-pressed={game === p.key} onClick={() => setGame(p.key)}>
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={frame}
        onDragOver={frameDragOver}
        onDragLeave={(e) => {
          if (!frame.current?.contains(e.relatedTarget as Node)) setTarget(null);
        }}
        onDrop={frameDrop}
        onClick={frameClick}
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: `${VIRTUAL_W} / ${VIRTUAL_H}`,
          borderRadius: 18,
          overflow: "hidden",
          background: "#2B3138",
          cursor: selected ? "copy" : undefined,
        }}
      >
        {/* Section outlines while placing, under the widgets. */}
        {showZones &&
          ANCHORS.map((a) => {
            const b = anchorBox(a, profile);
            const hud = hudConflict(profile, a);
            const active = target?.anchor === a;
            return (
              <div
                key={a}
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: `${b.x}%`,
                  top: `${b.y}%`,
                  width: `${b.w}%`,
                  height: `${b.h}%`,
                  borderRadius: 10,
                  border: `2px dashed ${active ? "#fff" : hud ? "rgba(255,107,138,0.9)" : "rgba(169,174,255,0.6)"}`,
                  background: active ? (hud ? "rgba(255,107,138,0.22)" : "rgba(106,88,245,0.28)") : "rgba(13,18,36,0.2)",
                  display: "flex",
                  alignItems: a.startsWith("bottom") ? "flex-start" : "flex-end",
                  justifyContent: "center",
                  padding: 4,
                  pointerEvents: "none",
                  zIndex: 1,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 6px", borderRadius: 6, background: "rgba(13,18,36,0.8)", color: hud ? "#FFB3C3" : "var(--text-2)", whiteSpace: "nowrap" }}>
                  {hud ? `${ANCHOR_NAMES[a]} · game HUD` : ANCHOR_NAMES[a]}
                </span>
              </div>
            );
          })}

        {/* Scaled render of the real overlay widgets (example data). */}
        <div style={{ position: "absolute", left: 0, top: 0, width: VIRTUAL_W, height: VIRTUAL_H, transform: `scale(${scale})`, transformOrigin: "0 0", zIndex: 2, pointerEvents: "none" }}>
          <GameBackdrop />
          {profile.hud.map((z) => (
            <div
              key={z.label}
              style={{
                position: "absolute",
                left: `${z.box.x}%`,
                top: `${z.box.y}%`,
                width: `${z.box.w}%`,
                height: `${z.box.h}%`,
                border: "4px dashed rgba(255,107,138,0.85)",
                background: "rgba(255,107,138,0.14)",
                borderRadius: 14,
                display: "grid",
                placeItems: "center",
                color: "#FFD0DA",
                font: "600 24px var(--font-body)",
                textAlign: "center",
              }}
            >
              {z.label}
            </div>
          ))}
          {ANCHORS.map((a) => {
            const items = layout.sections[a];
            if (!items?.length) return null;
            return (
              <div key={a} data-anchor={a} style={{ ...anchorStyle(a, profile), pointerEvents: "auto" }}>
                <SectionWidgets items={items} data={MOCK_DATA} toast={null} preview itemProps={itemProps} />
              </div>
            );
          })}
        </div>

        {/* Where the widget will land. */}
        {dragging && target?.bar && (
          <div
            aria-hidden="true"
            style={{ position: "absolute", left: target.bar.x, top: target.bar.y, width: target.bar.w, height: target.bar.h, background: "#fff", borderRadius: 2, boxShadow: "0 0 0 2px var(--violet)", zIndex: 3, pointerEvents: "none" }}
          />
        )}
      </div>

      <div
        ref={tray}
        className="ed-tray"
        onDragOver={(e) => {
          if (!dragging) return;
          e.preventDefault();
          setOverTray(true);
          setTarget(null);
        }}
        onDragLeave={() => setOverTray(false)}
        onDrop={(e) => {
          e.preventDefault();
          const w = (e.dataTransfer.getData("text/plain") || dragging) as WidgetId;
          if (w in WIDGETS) place(w, null);
          endDrag();
        }}
        aria-label="Widgets. Drop a widget here to hide it."
        style={{
          padding: 10,
          borderRadius: 18,
          background: overTray ? "rgba(106,88,245,0.18)" : "var(--panel-2)",
          border: `2px dashed ${dragging ? "var(--line)" : "transparent"}`,
        }}
      >
        {WIDGET_ORDER.map((w) => {
          const at = where(w);
          const isSel = selected === w;
          return (
            <div
              key={w}
              draggable
              onDragStart={startDrag(w)}
              onDragEnd={endDrag}
              className="ed-card"
              style={{
                cursor: "grab",
                background: isSel ? "rgba(106,88,245,0.22)" : "var(--panel)",
                border: `2px solid ${isSel ? "var(--violet)" : "var(--line)"}`,
                opacity: dragging === w ? 0.4 : 1,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="ed-handle" aria-hidden="true" title="Drag to the preview" {...touchHandlers(w)}>⠿</span>
                  {WIDGETS[w].label}
                </span>
                <button
                  className={`chip ${at ? "pb" : "plain"}`}
                  style={{ border: "none", padding: "3px 8px" }}
                  onClick={() => setSelected(isSel ? null : w)}
                  aria-pressed={isSel}
                  title={isSel ? "Cancel" : "Place with a click instead of dragging"}
                >
                  {isSel ? "Click a spot…" : at ? ANCHOR_NAMES[at] : "Hidden"}
                </button>
              </div>
              <div className="ed-preview" style={{ pointerEvents: "none" }}>
                <div style={{ zoom: compact ? (w === "leaderboard" ? 0.9 : w === "standings" ? 0.95 : 0.85) : w === "leaderboard" ? 0.42 : w === "standings" ? 0.5 : 0.62 }}>
                  <WidgetPreview w={w} />
                </div>
              </div>
              <span className="muted" style={{ fontSize: 12 }}>{WIDGETS[w].description}</span>
              {touch && <PositionPicker widget={w} at={at} onPick={(to) => place(w, to)} />}
            </div>
          );
        })}
      </div>

      {selected && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }} role="group" aria-label={`Place ${WIDGETS[selected].label}`}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Place {WIDGETS[selected].label} in:</span>
          {ANCHORS.map((a) => (
            <button key={a} className="chip plain" style={{ border: "none", minHeight: 32 }} onClick={() => place(selected, a)}>
              {ANCHOR_NAMES[a]}
            </button>
          ))}
          <button className="chip cut" style={{ border: "none", minHeight: 32 }} onClick={() => place(selected, null)}>
            Hide
          </button>
        </div>
      )}

      {ghost && (
        <div className="ed-ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden="true">
          {WIDGETS[ghost.w].label}
        </div>
      )}

      <span className="muted" style={{ fontSize: 13 }}>
        {touch ? "On a touch screen: pick a spot on each widget's grid below, or press and drag a widget (or its handle) onto the preview. " : ""}
        Drag widgets from the tray onto the screen, and drag them around the preview to move or reorder them. Drop one back on the tray to hide it.
        The preview uses example data. In game, challenge widgets only appear when a challenge is running for that track and car.
      </span>

      {!overlayOn && (
        <span style={{ fontSize: 13, color: "var(--peach)" }}>
          The overlay is off, so nothing is drawn over the game. F8 still switches drivers. Turn on the spoken name below to hear who was picked.
        </span>
      )}
      {profile.hud.length === 0 && (
        <span style={{ fontSize: 13, color: "var(--peach)" }}>The HUD for {profile.name} isn't mapped yet, so there's no overlap warning for this game.</span>
      )}
      {conflicts.map((c) => (
        <span key={c.a} style={{ fontSize: 13, color: "#FF8BA3" }}>
          {ANCHOR_NAMES[c.a]} overlaps the game's {c.hud?.toLowerCase()}.
        </span>
      ))}
      {usedSections.length > 2 && (
        <span style={{ fontSize: 13, color: "var(--peach)" }}>
          {usedSections.length} sections in use. Games already show a lot, so two is usually plenty.
        </span>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, justifyContent: "space-between" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 600 }}>
          <button className="toggle" role="switch" aria-checked={layout.voice} onClick={() => save({ ...layout, voice: !layout.voice })} />
          Speak the driver's name out loud when it changes (Windows voice)
        </label>
        <button className="btn ghost" disabled={!custom} onClick={reset}>Reset {profile.name} to default</button>
      </div>
    </section>
  );
}

/** One widget on its own, with example data, for the tray. */
function WidgetPreview({ w }: { w: WidgetId }) {
  if (WIDGETS[w].compact) return <StripCard items={[w]} data={MOCK_DATA} />;
  if (w === "standings") return <StandingsCard data={MOCK_DATA} />;
  if (w === "timing") return <TimingCard data={MOCK_DATA} />;
  if (w === "leaderboard") return <LeaderboardCard data={MOCK_DATA} />;
  if (w === "qr") return <QrCard data={MOCK_DATA} />;
  return <ToastCard toast={MOCK_TOAST} animate={false} />;
}

/** A rough cockpit-view backdrop so the preview reads as "over the game". */
function GameBackdrop() {
  return (
    <svg width={VIRTUAL_W} height={VIRTUAL_H} viewBox="0 0 1600 900" preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }} aria-hidden="true">
      <rect x="0" y="0" width="1600" height="420" fill="#4A5866" />
      <polygon points="620,420 980,420 1600,900 0,900" fill="#33373D" />
      <polygon points="0,420 620,420 0,900" fill="#3E5A3A" />
      <polygon points="1600,420 980,420 1600,900" fill="#3E5A3A" />
      <polygon points="640,420 660,420 140,900 60,900" fill="#C8CCD2" opacity="0.35" />
      <polygon points="940,420 960,420 1540,900 1460,900" fill="#C8CCD2" opacity="0.35" />
      <path d="M300 900 Q 800 580 1300 900" fill="#15171A" />
    </svg>
  );
}
