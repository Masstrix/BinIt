// Per-game overlay layouts: which widgets sit in which screen section.

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { api, useAppEvent, type AppEvent } from "./api";

export type WidgetId = "driver" | "pb" | "challenge" | "standings" | "toasts";
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
  standings: { label: "Challenge top 3", description: "Mini podium for the running challenge", compact: false },
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
export function anchorStyle(a: Anchor): CSSProperties {
  const [v, h] = a.split("-") as ["top" | "middle" | "bottom", "left" | "center" | "right"];
  const style: CSSProperties = { position: "absolute", display: "flex", flexDirection: "column", gap: 10 };
  if (v === "top") style.top = "2.5%";
  if (v === "bottom") style.bottom = "3%";
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
  if (v === "bottom") style.flexDirection = "column-reverse";
  return style;
}

export interface GameProfile {
  key: string;
  name: string;
  /** Where the game draws its own HUD (approximate, default HUD). Empty = not mapped yet. */
  hud: { label: string; box: Box }[];
  defaults: OverlayLayout;
}

const standard: OverlayLayout = {
  version: 1,
  sections: { "top-center": ["driver", "pb", "challenge"], "bottom-left": ["toasts"] },
  voice: true,
};

export const GAME_PROFILES: GameProfile[] = [
  {
    key: "acevo",
    name: "AC EVO",
    hud: [
      { label: "Position / lap", box: { x: 2, y: 3, w: 19, h: 13 } },
      { label: "Session timer", box: { x: 82, y: 3, w: 16, h: 10 } },
      { label: "Track map", box: { x: 2, y: 33, w: 12, h: 24 } },
      { label: "Dash / tacho / delta", box: { x: 74, y: 75, w: 24, h: 22 } },
    ],
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

export function hudConflict(profile: GameProfile, anchor: Anchor): string | null {
  const zone = profile.hud.find((z) => overlaps(z.box, ANCHOR_BOX[anchor]));
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

/** Removes a widget from wherever it is, then (optionally) adds it to a section. */
export function moveWidget(layout: OverlayLayout, widget: WidgetId, to: Anchor | null): OverlayLayout {
  const sections: OverlayLayout["sections"] = {};
  for (const a of ANCHORS) {
    const items = (layout.sections[a] ?? []).filter((w) => w !== widget);
    if (items.length) sections[a] = items;
  }
  if (to) sections[to] = [...(sections[to] ?? []), widget];
  return { ...layout, sections };
}
