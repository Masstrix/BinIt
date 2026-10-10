// Per-game overlay layouts: which widgets sit in which screen section.

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { api, useAppEvent, type AppEvent } from "./api";

export type WidgetId = "driver" | "pb" | "challenge" | "timing" | "standings" | "leaderboard" | "toasts";
export type Anchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export interface OverlayLayout {
  version: 1;
  sections: Partial<Record<Anchor, WidgetId[]>>;
  /** Say "Sam is driving" when the driver changes (works even when the overlay can't be seen). */
  voice: boolean;
}

export const WIDGETS: Record<WidgetId, { label: string; description: string; compact: boolean }> = {
  driver: { label: "Driver", description: "Helmet and name of who's in the seat", compact: true },
  pb: { label: "Personal best", description: "Their best lap on this track and car", compact: true },
  challenge: { label: "Challenge position", description: "P2 +0.204 in the running challenge", compact: true },
  timing: { label: "Live timing", description: "Delta to PB and a purple / green / yellow bar per sector", compact: false },
  standings: { label: "Challenge top 3", description: "Mini podium for the running challenge", compact: false },
  leaderboard: { label: "Track leaderboard", description: "Top 5 on this track and car, plus where the driver is", compact: false },
  toasts: { label: "Pop-ups", description: "New PB, record, new leader, cut lap. Shows for 4s", compact: false },
};

export const ANCHORS: Anchor[] = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

/** Rectangle in % of the screen. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The area a section roughly occupies, used for the editor preview and HUD-overlap warnings. */
export const ANCHOR_BOX: Record<Anchor, Box> = {
  "top-left": { x: 2, y: 3, w: 26, h: 16 },
  "top-center": { x: 35, y: 2.5, w: 30, h: 16 },
  "top-right": { x: 72, y: 3, w: 26, h: 16 },
  "middle-left": { x: 2, y: 38, w: 26, h: 24 },
  "middle-right": { x: 72, y: 38, w: 26, h: 24 },
  "bottom-left": { x: 2, y: 81, w: 26, h: 16 },
  "bottom-center": { x: 35, y: 81, w: 30, h: 16 },
  "bottom-right": { x: 72, y: 81, w: 26, h: 16 },
};

/** CSS to pin a section's content to its anchor on the real overlay. */
const DEFAULT_TOP = 2.5;
const DEFAULT_BOTTOM = 3;

/** Distance (% of screen height) from the top/bottom edge for a section in this game. */
function edgeOffset(a: Anchor, profile?: GameProfile): number {
  const v = a.split("-")[0];
  return profile?.edges?.[a] ?? (v === "bottom" ? DEFAULT_BOTTOM : DEFAULT_TOP);
}

/** The section's approximate area for this game, with its edge offset applied. */
export function anchorBox(a: Anchor, profile?: GameProfile): Box {
  const b = ANCHOR_BOX[a];
  const v = a.split("-")[0];
  if (v === "top") return { ...b, y: edgeOffset(a, profile) };
  if (v === "bottom") return { ...b, y: 100 - edgeOffset(a, profile) - b.h };
  return b;
}

export function anchorStyle(a: Anchor, profile?: GameProfile): CSSProperties {
  const [v, h] = a.split("-") as ["top" | "middle" | "bottom", "left" | "center" | "right"];
  const style: CSSProperties = { position: "absolute", display: "flex", flexDirection: "column", gap: 10 };
  if (v === "top") style.top = `${edgeOffset(a, profile)}%`;
  if (v === "bottom") style.bottom = `${edgeOffset(a, profile)}%`;
  if (v === "middle") style.top = "50%";
  if (h === "left") {
    style.left = "2%";
    style.alignItems = "flex-start";
  }
  if (h === "right") {
    style.right = "2%";
    style.alignItems = "flex-end";
  }
  if (h === "center") {
    style.left = "50%";
    style.alignItems = "center";
  }
  const tx = h === "center" ? "-50%" : "0";
  const ty = v === "middle" ? "-50%" : "0";
  if (tx !== "0" || ty !== "0") style.transform = `translate(${tx}, ${ty})`;
  return style;
}

export interface GameProfile {
  key: string;
  name: string;
  /** Where the game draws its own HUD (approximate, default HUD). Empty = not mapped yet. */
  hud: { label: string; box: Box }[];
  /** Per-section distance from the top/bottom edge (%), to clear fixed game UI. */
  edges?: Partial<Record<Anchor, number>>;
  defaults: OverlayLayout;
}

const standard: OverlayLayout = {
  version: 1,
  sections: { "top-center": ["driver", "pb", "challenge"], "bottom-left": ["toasts"] },
  // Off by default: handy when the overlay can't be seen (exclusive fullscreen), noisy otherwise.
  voice: false,
};

export const GAME_PROFILES: GameProfile[] = [
  {
    key: "acevo",
    name: "AC EVO",
    // Default HUD, measured from an in-game screenshot (AC EVO 0.9). Players can move
    // AC EVO's HUD elements, so treat these as the defaults, not guarantees.
    hud: [
      { label: "Lap timing", box: { x: 0.5, y: 1.5, w: 8.5, h: 23.5 } },
      { label: "Session bar", box: { x: 40, y: 0, w: 21.5, h: 4.5 } },
      { label: "Delta bar", box: { x: 39, y: 18.5, w: 13, h: 4 } },
      { label: "Track map", box: { x: 1.5, y: 38, w: 10.5, h: 18.5 } },
      { label: "Function bar", box: { x: 0.5, y: 93.5, w: 16, h: 4 } },
      { label: "Dash, tyres & tacho", box: { x: 72, y: 72.5, w: 28, h: 27.5 } },
    ],
    // Start the top-centre section below the session bar (time / session / weather).
    edges: { "top-center": 6, "bottom-left": 8 },
    defaults: standard,
  },
  { key: "ac", name: "Assetto Corsa", hud: [], defaults: standard },
  { key: "acc", name: "ACC", hud: [], defaults: standard },
  { key: "dr2", name: "DiRT Rally 2.0", hud: [], defaults: { ...standard, sections: { "top-center": ["driver", "pb", "challenge"], "middle-left": ["toasts"] } } },
  { key: "wrc", name: "EA WRC", hud: [], defaults: { ...standard, sections: { "top-center": ["driver", "pb", "challenge"], "middle-left": ["toasts"] } } },
];

export function profileFor(game: string | null | undefined): GameProfile {
  return GAME_PROFILES.find((p) => p.key === game) ?? GAME_PROFILES[0];
}

export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Rough height (% of screen) of a section's content, for HUD-overlap warnings. */
function contentHeight(items: WidgetId[]): number {
  let h = 0;
  let inStrip = false;
  for (const w of items) {
    if (WIDGETS[w].compact) {
      if (!inStrip) h += 6.5;
      inStrip = true;
    } else {
      h += w === "timing" ? 11 : w === "standings" ? 13 : w === "leaderboard" ? 18 : 7.5;
      inStrip = false;
    }
  }
  return h + Math.max(0, items.length - 1) * 0.5;
}

/** The game HUD element a section's content would cover, if any. */
export function hudConflict(profile: GameProfile, anchor: Anchor, items: WidgetId[] = []): string | null {
  const box = anchorBox(anchor, profile);
  const v = anchor.split("-")[0];
  const h = items.length ? contentHeight(items) : box.h;
  const content: Box =
    v === "bottom" ? { ...box, y: box.y + box.h - h, h } : v === "middle" ? { ...box, y: 50 - h / 2, h } : { ...box, h };
  const zone = profile.hud.find((z) => overlaps(z.box, content));
  return zone?.label ?? null;
}

function sanitize(raw: unknown, fallback: OverlayLayout): OverlayLayout {
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Partial<OverlayLayout>;
  const seen = new Set<WidgetId>();
  const sections: OverlayLayout["sections"] = {};
  for (const a of ANCHORS) {
    const items = (r.sections?.[a] ?? []).filter((w): w is WidgetId => w in WIDGETS && !seen.has(w) && !!seen.add(w));
    if (items.length) sections[a] = items;
  }
  return { version: 1, sections, voice: r.voice ?? fallback.voice };
}

/** The saved layout for a game (or its default), kept live across windows. */
export function useOverlayLayout(game: string) {
  const profile = profileFor(game);
  const [layout, setLayout] = useState<OverlayLayout>(profile.defaults);
  const [custom, setCustom] = useState(false);

  const load = useCallback(() => {
    api
      .overlayLayout(game)
      .then((raw) => {
        setCustom(raw !== null);
        setLayout(sanitize(raw, profileFor(game).defaults));
      })
      .catch(() => {});
  }, [game]);

  useEffect(load, [load]);
  useAppEvent(
    useCallback(
      (e: AppEvent) => {
        if ((e.type === "overlayLayoutChanged" && e.game === game) || e.type === "resync") load();
      },
      [game, load],
    ),
  );

  const save = useCallback(
    (next: OverlayLayout) => {
      setLayout(next);
      setCustom(true);
      api.setOverlayLayout(game, next).catch(() => load());
    },
    [game, load],
  );

  const reset = useCallback(() => {
    api.resetOverlayLayout(game).then(load);
  }, [game, load]);

  return { layout, save, reset, custom, profile };
}

/**
 * Removes a widget from wherever it is, then (optionally) inserts it into a section at
 * `index` (counted without the widget itself; omitted = at the end).
 */
export function moveWidget(layout: OverlayLayout, widget: WidgetId, to: Anchor | null, index?: number): OverlayLayout {
  const sections: OverlayLayout["sections"] = {};
  for (const a of ANCHORS) {
    const items = (layout.sections[a] ?? []).filter((w) => w !== widget);
    if (items.length) sections[a] = items;
  }
  if (to) {
    const items = [...(sections[to] ?? [])];
    items.splice(index ?? items.length, 0, widget);
    sections[to] = items;
  }
  return { ...layout, sections };
}
