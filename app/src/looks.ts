// What a driver's helmet can look like. The catalogue is data only; `Helmet` renders a `Look`.
// Prices and level gates live on the server (crates/tt-core/src/shop.rs); the ids here must match.

export type Rarity = "common" | "rare" | "epic" | "legendary";

/** What a driver has equipped. Every field is optional: an empty look is the plain helmet in the driver's colour. */
export interface Look {
  /** A gradient shell (`SHELLS` id). Without one the shell is the driver's solid colour. */
  shell?: string;
  /** A decal (`DECALS` id) and where it sits. */
  decal?: string;
  decalAt?: "side" | "top" | "chin";
  /** One of `DECAL_COLOURS`; white when absent. */
  decalColor?: string;
  /** A stripe over the crown (`STRIPES` id). */
  stripe?: string;
  /** Race number, 1 to 99, printed on the side. */
  number?: number;
  /** The default eyes (`FACES` id) shown when the driver is just sitting there. */
  face?: string;
}

export interface Shell {
  id: string;
  name: string;
  rarity: Rarity;
  /** Two or three gradient stops, top-left to bottom-right. */
  stops: string[];
}

export interface Decal {
  id: string;
  name: string;
  rarity: Rarity;
  /** Path in a 24 by 24 box, filled. */
  path: string;
}

export interface Stripe {
  id: string;
  name: string;
  rarity: Rarity;
  /** SVG paths drawn in the helmet's 48 by 48 box: `width` is the stroke width, `dash` an optional dash pattern. */
  paths: string[];
  width: number;
  dash?: string;
}

export const RARITY_COLOR: Record<Rarity, string> = { common: "#A9B2CA", rare: "#4DA3FF", epic: "#B07CFF", legendary: "#FFC93C" };

export const SHELLS: Shell[] = [
  { id: "sunset", name: "Sunset", rarity: "rare", stops: ["#FF8A4C", "#FF5F7E", "#C2409B"] },
  { id: "ocean", name: "Ocean", rarity: "rare", stops: ["#4DA3FF", "#2FE6C8"] },
  { id: "ember", name: "Ember", rarity: "rare", stops: ["#FFC93C", "#FF8A4C"] },
  { id: "lagoon", name: "Lagoon", rarity: "rare", stops: ["#14B8C4", "#23C98A", "#FFE48A"] },
  { id: "aurora", name: "Aurora", rarity: "epic", stops: ["#2FE6C8", "#5B8BFF", "#B07CFF"] },
  { id: "rally", name: "Rally", rarity: "epic", stops: ["#0A1F44", "#5BC0FF", "#E4231F"] },
  { id: "holo", name: "Holo", rarity: "legendary", stops: ["#FFE48A", "#8BE9FF", "#E7A6FF"] },
  { id: "gold", name: "Gold leaf", rarity: "legendary", stops: ["#FFE48A", "#FFC93C", "#B8750F"] },
  { id: "nightsky", name: "Night sky", rarity: "legendary", stops: ["#0B1026", "#1B2A6B", "#5B3FD4", "#B07CFF"] },
  { id: "inferno", name: "Inferno", rarity: "legendary", stops: ["#FFE48A", "#FF8A1F", "#E4231F", "#6B0F1A"] },
  { id: "nebula", name: "Nebula", rarity: "legendary", stops: ["#2A1B6B", "#C2409B", "#FF8A4C", "#FFE48A"] },
  { id: "glacier", name: "Glacier", rarity: "legendary", stops: ["#E8F7FF", "#8BE9FF", "#4DA3FF", "#2A3F8F"] },
  { id: "galaxy", name: "Galaxy", rarity: "legendary", stops: ["#04020D", "#150A33", "#3B1B8C", "#7A3FD6"] },
];

export const DECALS: Decal[] = [
  { id: "flame", name: "Flame", rarity: "common", path: "M12 2C12 7 17 9 17 14a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-7 1-11z" },
  { id: "bolt", name: "Bolt", rarity: "common", path: "M13 2L5 14h6l-1 8 8-12h-6z" },
  { id: "star", name: "Star", rarity: "common", path: "M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.7 6.7 19.6l1.1-6L3.4 9.4l6-.8z" },
  { id: "chequer", name: "Chequer", rarity: "common", path: "M3 3h6v6H3zM15 3h6v6h-6zM9 9h6v6H9zM3 15h6v6H3zM15 15h6v6h-6z" },
  { id: "heart", name: "Heart", rarity: "common", path: "M12 21s-8-5.2-8-11a4.6 4.6 0 0 1 8-3 4.6 4.6 0 0 1 8 3c0 5.8-8 11-8 11z" },
  { id: "flag", name: "Flag", rarity: "rare", path: "M5 21V3h2v2h11l-2.5 4.5L18 14H7v7z" },
  { id: "moon", name: "Moon", rarity: "rare", path: "M20 14.5A8.5 8.5 0 1 1 9.5 4 7 7 0 0 0 20 14.5z" },
  { id: "wing", name: "Wing", rarity: "rare", path: "M2 14C6 14 9 9 14 7c-1 3-1 5 0 7 3-1 6-4 8-8-1 7-6 14-14 14-3 0-5-1-6-4z" },
  { id: "crown", name: "Crown", rarity: "epic", path: "M2 7l5 4 5-8 5 8 5-4-2 12H4z" },
  { id: "skull", name: "Skull", rarity: "epic", path: "M12 2a8 8 0 0 0-8 8c0 3 1.5 4.6 3 5.6V19h2v-2h2v2h2v-2h2v2h2v-3.4c1.5-1 3-2.6 3-5.6a8 8 0 0 0-8-8zM9 11a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z" },
];

export interface Face {
  id: string;
  name: string;
  rarity: Rarity;
  /** The mood `Helmet` draws for it (see Eyes in Helmet.tsx). */
  mood: string;
}

export const FACES: Face[] = [
  { id: "chill", name: "Chill", rarity: "common", mood: "idle" },
  { id: "focus", name: "Focus", rarity: "common", mood: "focus" },
  { id: "happy", name: "Happy", rarity: "common", mood: "happy" },
  { id: "cheeky", name: "Cheeky", rarity: "common", mood: "wink" },
  { id: "sleepy", name: "Sleepy", rarity: "common", mood: "sleepy" },
  { id: "wide", name: "Wide eyed", rarity: "common", mood: "wide" },
  { id: "angry", name: "Fired up", rarity: "rare", mood: "angry" },
  { id: "peaked", name: "Peaked", rarity: "rare", mood: "peaked" },
  { id: "stars", name: "Starstruck", rarity: "rare", mood: "stars" },
  { id: "hearts", name: "Hearts", rarity: "rare", mood: "hearts" },
  { id: "cash", name: "Cash", rarity: "epic", mood: "cash" },
];

export const STRIPES: Stripe[] = [
  { id: "centre", name: "Centre", rarity: "common", paths: ["M17.5 13 C23 10 31 9.8 37.5 12.6"], width: 2.8 },
  { id: "twin", name: "Twin", rarity: "common", paths: ["M17.2 12.4 C23 9.4 31 9.2 37.4 12", "M17.2 16 C23 13 31 12.8 38 15.6"], width: 1.6 },
  { id: "band", name: "Band", rarity: "common", paths: ["M17.5 13.4 C23 10 31 9.8 37.5 12.6"], width: 5.4 },
  { id: "chequer", name: "Chequer", rarity: "rare", paths: ["M17.5 13 C23 10 31 9.8 37.5 12.6"], width: 3.6, dash: "2 2" },
];

/** The colours a decal can be painted (free); the first is the default. Same list as the server's. */
export const DECAL_COLOURS: [string, string][] = [
  ["#FFFFFF", "White"], ["#14162B", "Black"], ["#FF5D5D", "Red"], ["#FF9F6B", "Orange"], ["#FFC93C", "Yellow"],
  ["#4FD39A", "Green"], ["#4FC3FF", "Sky"], ["#B79BFF", "Violet"], ["#FF7AC6", "Pink"],
];

export const shellById = (id?: string) => SHELLS.find((s) => s.id === id);
export const decalById = (id?: string) => DECALS.find((d) => d.id === id);
export const faceById = (id?: string) => FACES.find((f) => f.id === id);
export const stripeById = (id?: string) => STRIPES.find((s) => s.id === id);

/** Where a decal sits on the helmet, as a translate and a scale of its 24 by 24 box. */
export const DECAL_AT: Record<NonNullable<Look["decalAt"]>, { x: number; y: number; s: number }> = {
  side: { x: 12, y: 16.5, s: 0.45 },
  top: { x: 22, y: 7.5, s: 0.4 },
  chin: { x: 26, y: 29.5, s: 0.35 },
};
