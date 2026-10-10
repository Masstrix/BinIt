import { useEffect, useRef, useState, type DragEvent } from "react";
import { useAppState } from "../api";
import {
  ANCHORS,
  ANCHOR_BOX,
  GAME_PROFILES,
  WIDGETS,
  anchorStyle,
  hudConflict,
  moveWidget,
  useOverlayLayout,
  type Anchor,
  type WidgetId,
} from "../overlayLayout";
import { OverlayToggle } from "./OverlayToggle";
import { SectionWidgets, useOverlayData } from "./OverlayWidgets";

const VIRTUAL_W = 1920;
const VIRTUAL_H = 1080;

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

type DragPayload = { kind: "widget"; widget: WidgetId } | { kind: "section"; anchor: Anchor };

/** Drag widgets into screen sections, per game. Saves instantly; the overlay updates live. */
export function OverlayEditor() {
  const { status } = useAppState();
  const overlayOn = status?.overlayEnabled ?? true;
  const [game, setGame] = useState(status?.game ?? "acevo");
  const { layout, save, reset, custom, profile } = useOverlayLayout(game);
  const data = useOverlayData();

  const [selected, setSelected] = useState<WidgetId | null>(null);
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [over, setOver] = useState<Anchor | "palette" | null>(null);

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
  const conflicts = usedSections.map((a) => ({ a, hud: hudConflict(profile, a) })).filter((c) => c.hud);

  const apply = (payload: DragPayload, to: Anchor | null) => {
    if (payload.kind === "widget") return save(moveWidget(layout, payload.widget, to));
    if (to === payload.anchor) return;
    let next = layout;
    for (const w of layout.sections[payload.anchor] ?? []) next = moveWidget(next, w, to);
    save(next);
  };

  const dragProps = (payload: DragPayload) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData("text/plain", JSON.stringify(payload));
      e.dataTransfer.effectAllowed = "move";
      setDragging(payload);
      setSelected(null);
    },
    onDragEnd: () => {
      setDragging(null);
      setOver(null);
    },
  });

  const dropProps = (target: Anchor | "palette") => ({
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setOver(target);
    },
    onDragLeave: () => setOver((o) => (o === target ? null : o)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOver(null);
      setDragging(null);
      try {
        apply(JSON.parse(e.dataTransfer.getData("text/plain")) as DragPayload, target === "palette" ? null : target);
      } catch {
        /* not ours */
      }
    },
  });

  const placing = !!dragging || !!selected;

  return (
    <section className="card" aria-label="Overlay layout">
      <div className="head" style={{ alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 20 }}>Overlay layout</h2>
          <OverlayToggle />
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
        style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", borderRadius: 18, overflow: "hidden", background: "#2B3138" }}
      >
        {/* Scaled render of the real overlay at 1920x1080. */}
        <div style={{ position: "absolute", left: 0, top: 0, width: VIRTUAL_W, height: VIRTUAL_H, transform: `scale(${scale})`, transformOrigin: "0 0", pointerEvents: "none" }}>
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
                font: "600 26px var(--font-body)",
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
              <div key={a} style={anchorStyle(a)}>
                <SectionWidgets items={items} data={data} toast={null} preview />
              </div>
            );
          })}
        </div>

        {/* Interactive drop zones, in screen %. */}
        {ANCHORS.map((a) => {
          const b = ANCHOR_BOX[a];
          const items = layout.sections[a] ?? [];
          const hud = hudConflict(profile, a);
          const isOver = over === a;
          return (
            <div
              key={a}
              {...dropProps(a)}
              {...(items.length ? dragProps({ kind: "section", anchor: a }) : {})}
              role="button"
              tabIndex={0}
              aria-label={`${ANCHOR_NAMES[a]}${items.length ? `: ${items.map((w) => WIDGETS[w].label).join(", ")}` : ", empty"}${selected ? `. Place ${WIDGETS[selected].label} here` : ""}`}
              onClick={() => {
                if (selected) {
                  save(moveWidget(layout, selected, a));
                  setSelected(null);
                }
              }}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && selected) {
                  e.preventDefault();
                  save(moveWidget(layout, selected, a));
                  setSelected(null);
                }
              }}
              style={{
                position: "absolute",
                left: `${b.x}%`,
                top: `${b.y}%`,
                width: `${b.w}%`,
                height: `${b.h}%`,
                borderRadius: 10,
                cursor: selected ? "pointer" : items.length ? "grab" : "default",
                border: placing ? `2px dashed ${isOver ? "#fff" : hud ? "rgba(255,107,138,0.9)" : "rgba(169,174,255,0.7)"}` : "2px solid transparent",
                background: isOver ? (hud ? "rgba(255,107,138,0.25)" : "rgba(106,88,245,0.3)") : placing ? "rgba(13,18,36,0.25)" : "transparent",
                display: "flex",
                alignItems: a.startsWith("bottom") ? "flex-start" : "flex-end",
                justifyContent: "center",
                padding: 4,
                transition: "background .1s",
              }}
            >
              {placing && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 6px", borderRadius: 6, background: "rgba(13,18,36,0.8)", color: hud ? "#FFB3C3" : "var(--text-2)", whiteSpace: "nowrap" }}>
                  {hud ? `${ANCHOR_NAMES[a]} · game HUD` : ANCHOR_NAMES[a]}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div
        {...dropProps("palette")}
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 10, padding: 10, borderRadius: 18, background: over === "palette" ? "rgba(106,88,245,0.18)" : "var(--panel-2)", border: `2px dashed ${dragging ? "var(--line)" : "transparent"}` }}
        aria-label="Widgets. Drop here to hide one."
      >
        {(Object.keys(WIDGETS) as WidgetId[]).map((w) => {
          const at = where(w);
          const isSel = selected === w;
          return (
            <button
              key={w}
              {...dragProps({ kind: "widget", widget: w })}
              onClick={() => setSelected(isSel ? null : w)}
              aria-pressed={isSel}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 2,
                padding: "10px 12px",
                borderRadius: 14,
                textAlign: "left",
                cursor: "grab",
                background: isSel ? "rgba(106,88,245,0.25)" : "var(--panel)",
                border: `2px solid ${isSel ? "var(--violet)" : "var(--line)"}`,
                opacity: at ? 1 : 0.7,
              }}
            >
              <span style={{ display: "flex", width: "100%", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontWeight: 700 }}>{WIDGETS[w].label}</span>
                <span className={`chip ${at ? "pb" : "plain"}`} style={{ padding: "2px 8px" }}>{at ? ANCHOR_NAMES[at] : "Hidden"}</span>
              </span>
              <span className="muted" style={{ fontSize: 13 }}>{WIDGETS[w].description}</span>
            </button>
          );
        })}
      </div>

      <span className="muted" style={{ fontSize: 13 }}>
        {selected
          ? `Click a section in the preview to place ${WIDGETS[selected].label}, or drop it back here to hide it. Esc to cancel.`
          : "Drag widgets into a section of the screen (or click one, then click a section). Drag a section to move everything in it. Drop on this list to hide."}
      </span>

      {!overlayOn && (
        <span style={{ fontSize: 13, color: "var(--peach)" }}>
          The overlay is off, so nothing is drawn over the game. F8 still switches drivers (with the spoken name).
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
          Say the driver's name when it changes
        </label>
        <button className="btn ghost" disabled={!custom} onClick={reset}>Reset {profile.name} to default</button>
      </div>
    </section>
  );
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
