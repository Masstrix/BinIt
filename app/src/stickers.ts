import type { BookSticker, StickerRarity } from "./api";

/** How each rarity looks. The same ramp as the shop and the design canvas. */
export const RARITY: Record<StickerRarity, { label: string; color: string; from: string; to: string; pips: number }> = {
  common: { label: "COMMON", color: "#d3d8e4", from: "#d3d8e4", to: "#8f99b3", pips: 1 },
  rare: { label: "RARE", color: "#4da3ff", from: "#7dc0ff", to: "#3a86e8", pips: 2 },
  epic: { label: "EPIC", color: "#ec6fdb", from: "#f59be8", to: "#c24fd0", pips: 3 },
  legendary: { label: "LEGENDARY", color: "#ffc93c", from: "#ffe48a", to: "#f0a81a", pips: 4 },
};

/**
 * How each sticker is drawn (24 x 24, stroked). The server owns what exists and what it pays
 * (crates/tt-core/stickers.json); the app only knows how to draw each id, so the two id lists must match.
 */
const FLAG = "M5 21V4M5 4h12l-2 4 2 4H5";
const MEDAL = "M8 3h8l-2 6h-4zM12 9a5 5 0 1 0 0 10 5 5 0 0 0 0-10z";
const TRACK = "M4 20L9 4M20 20L15 4M12 6v2M12 11v2M12 16v2";
const CHECK = "M5 12.5l4.5 4.5L19 7";
const CROWN = "M3 8l4 4 5-7 5 7 4-4-2 11H5z";
const REMATCH = "M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5";
const STAR = "M12 3l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 17l-5.6 3 1.3-6.2L3 9.5l6.3-.7z";
export const STICKER_ICON: Record<string, string> = {
  "first-lap": FLAG,
  "ten-laps": "M4 12a8 8 0 1 1 3 6.2M4 19v-4h4",
  century: MEDAL,
  local: TRACK,
  "personal-best": "M12 8v5l3 2M9 2h6M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z",
  "purple-sector": "M13 2L5 14h6l-1 8 8-12h-6z",
  "on-the-pace": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 11.5h.01",
  "record-breaker": "M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-9z",
  entered: CHECK,
  "on-the-podium": MEDAL,
  crown: CROWN,
  reigning: "M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 14v4M8 21h8",
  "giant-killer": "M12 20V5M6 11l6-6 6 6M5 20h14",
  "tidy-lap": "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  "five-clean": CHECK,
  "smooth-operator": "M3 12c3-6 6-6 9 0s6 6 9 0",
  spotless: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  "rule-bender": "M6 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM6 14.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM8 9l12 9M8 15L20 6",
  tourist: TRACK,
  "world-tour": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  "garage-queen": "M4 16l1.5-5.5A2 2 0 0 1 7.4 9h9.2a2 2 0 0 1 1.9 1.5L20 16v3h-3v-2H7v2H4zM7 13h.01M17 13h.01",
  "switch-hitter": "M7 8h10a4 4 0 0 1 4 4v3a2 2 0 0 1-3.4 1.4L16 15H8l-1.6 1.4A2 2 0 0 1 3 15v-3a4 4 0 0 1 4-4zM8 10.5v3M6.5 12h3",
  rematch: REMATCH,
  streak: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  "lunch-break": "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5",
  "photo-finish": "M4 8h3l2-3h6l2 3h3v11H4zM12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z",
  sideways: "M5 20c4-1 5-5 7-8s5-4 8-4M9 20c4-1 5-5 7-8",
  "skid-marks": "M4 20L10 8M10 20L16 8M16 20L22 8",
  "tyre-fryer": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  "drift-king": CROWN,
  "handbrake-hero": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v6M12 16h.01",
  "spinning-top": REMATCH,
  "scenic-route": "M3 20l6-10 4 6 3-4 5 8z",
  "participation-trophy": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 14c1 2 2.5 3 4 3s3-1 4-3M9 9.5h.01M15 9.5h.01",
  "early-bird": "M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4zM16 11h2a2 2 0 0 1 0 4h-2M8 3v3M12 3v3",
  "night-owl": "M20 14A8 8 0 1 1 10 4a6.5 6.5 0 0 0 10 10z",
  "lucky-seven": "M6 5h12L10 20",
  "mirror-lap": "M12 3v18M7 8L3 12l4 4M17 8l4 4-4 4",
  "dead-heat": "M5 9h14M5 15h14",
  "wrong-way-round": "M7 20V9a4.5 4.5 0 0 1 9 0v6M12 11l4 4 4-4",
  "slow-and-steady": "M3 12h18M7 8v8M12 8v8M17 8v8",
  "friday-feeling": "M7 4h10l-1 16H8zM7 9h10",
  "one-more-go": "M17 3l4 4-4 4M21 7H8a4 4 0 0 0-4 4M7 21l-4-4 4-4M3 17h13a4 4 0 0 0 4-4",
  moonwalk: "M20 12H6M11 6l-6 6 6 6M20 5v14",
  marathon: "M7 8a4 4 0 1 0 0 8c4 0 6-8 10-8a4 4 0 1 1 0 8c-4 0-6-8-10-8z",
  "hat-trick": "M3 18h18M6 18V8h12v10M6 14h12",
  untouchable: "M5 21V10a7 7 0 0 1 14 0v11l-3-2-2 2-2-2-2 2-2-2zM9.5 10h.01M14.5 10h.01",
  perfectionist: "M12 3l9 9-9 9-9-9z",
  completionist: STAR,
};
const LOCK = "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5zM12 15v2";

export type StickerState = "earned" | "progress" | "locked" | "hidden";

export function stickerState(s: BookSticker): StickerState {
  if (s.earned) return "earned";
  if (s.hidden) return "hidden";
  return s.progress && s.progress.cur > 0 ? "progress" : "locked";
}

export function stickerPath(s: BookSticker): string {
  return s.hidden && !s.earned ? LOCK : (STICKER_ICON[s.id] ?? STAR);
}

export function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Where a sticker is up to, in a few words. */
export function stickerStatus(s: BookSticker): string {
  if (s.earned) return s.earnedAt ? `Earned · ${shortDate(s.earnedAt)}` : "Earned";
  if (s.hidden) return "Hidden";
  if (s.progress) return `${s.progress.cur.toLocaleString()} / ${s.progress.max.toLocaleString()}`;
  return s.detectable ? "Locked" : "Coming later";
}

/** What to show on the profile: the ones the driver chose, else their best earned (rarest, then newest). */
export function highlights(stickers: BookSticker[], pinned: string[]): BookSticker[] {
  const chosen = pinned.map((id) => stickers.find((s) => s.id === id && s.earned)).filter((s): s is BookSticker => !!s);
  if (chosen.length) return chosen;
  const rank = (s: BookSticker) => RARITY[s.rarity].pips;
  return stickers
    .filter((s) => s.earned)
    .sort((a, b) => rank(b) - rank(a) || (b.earnedAt ?? 0) - (a.earnedAt ?? 0))
    .slice(0, 3);
}
