// Turns the catalogue + learned maps into Picker items, shared by every track/car selector.

import type { CatTrack, Catalogue, Combo, TrackMapData } from "./api";
import { TrackMap } from "./components/TrackMap";
import type { PickerItem } from "./components/Picker";
import { fold } from "./components/Picker";
import { carName, trackName } from "./format";

export const trackValue = (track: string, layout: string) => `${track}|${layout}`;

export function splitTrackValue(v: string): { track: string; layout: string } {
  const i = v.lastIndexOf("|");
  return { track: v.slice(0, i), layout: v.slice(i + 1) };
}

/** Looks up a learned map by track + layout, ignoring case and accents. */
export function findMap(maps: TrackMapData[], track: string, layout: string): TrackMapData | undefined {
  const t = fold(track);
  const l = fold(layout);
  return maps.find((m) => fold(m.track) === t && fold(m.layout) === l);
}

const COUNTRIES = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "region" }) : null;

export function countryName(code: string | null): string | undefined {
  if (!code) return undefined;
  try {
    return COUNTRIES?.of(code) ?? code;
  } catch {
    return code;
  }
}

export function TrackThumb({ map, kind }: { map?: TrackMapData; kind?: string }) {
  if (map) return <TrackMap points={map.points} rotate={map.rotate} mirror={map.mirror} closed={map.closed} stroke={2.5} label={`${trackName(map.track, map.layout)} map`} />;
  return (
    <svg viewBox="0 0 48 36" width="100%" height="100%" aria-hidden="true" style={{ opacity: 0.45 }}>
      {kind === "rally" ? (
        <path d="M6 28c8-2 6-12 14-12s6 10 14 8 6-14 8-14" fill="none" stroke="var(--peri-3)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="1 5" />
      ) : (
        <path d="M10 26c-5-6 0-16 10-14 8 2 8 8 16 6 6-1 8 6 2 9-8 4-20 5-28-1z" fill="none" stroke="var(--peri-3)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="1 5" />
      )}
    </svg>
  );
}

/** One item per track + layout the catalogue knows, driven or not. */
export function trackItems(cat: Catalogue | null, maps: TrackMapData[]): PickerItem[] {
  if (!cat) return [];
  const items: PickerItem[] = [];
  for (const t of cat.tracks) {
    const layouts = t.layouts.length ? t.layouts : [{ name: "", seen: t.seen, hasMap: false }];
    for (const l of layouts) items.push(trackItem(t, l.name, l.seen, maps));
  }
  return items;
}

/** Only the track + layouts that have laps (leaderboards; values are `game|track|layout`), with the catalogue's search words and maps. */
export function drivenTrackItems(combos: Combo[], cat: Catalogue | null, maps: TrackMapData[]): PickerItem[] {
  const seen = new Set<string>();
  const items: PickerItem[] = [];
  for (const c of combos) {
    const v = `${c.game}|${c.track}|${c.layout}`;
    if (seen.has(v)) continue;
    seen.add(v);
    const t = cat?.game === c.game ? cat.tracks.find((t) => fold(t.name) === fold(c.track)) : undefined;
    const item = trackItem(t ?? { name: c.track, country: null, aliases: [], kind: "circuit", layouts: [], seen: true }, c.layout, true, maps);
    // Match laps by the spelling they were recorded with.
    items.push({ ...item, value: v, label: trackName(c.track, c.layout) });
  }
  return items;
}

function trackItem(t: CatTrack, layout: string, seen: boolean, maps: TrackMapData[]): PickerItem {
  const country = countryName(t.country);
  return {
    value: trackValue(t.name, layout),
    label: trackName(t.name, layout),
    sub: country,
    note: seen ? undefined : "Not driven yet",
    search: [...t.aliases, country, t.country, t.kind === "rally" ? "rally stage" : "circuit"].filter(Boolean).join(" "),
    tag: country,
    visual: <TrackThumb map={findMap(maps, t.name, layout)} kind={t.kind} />,
  };
}

export function CarBadge({ brand, name }: { brand?: string | null; name: string }) {
  const text = brand || name;
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span className="car-badge" style={{ background: `hsl(${h} 55% 32%)`, borderColor: `hsl(${h} 60% 50%)` }} aria-hidden="true">
      {text.trim().slice(0, 2).toUpperCase()}
    </span>
  );
}

export function carItems(cat: Catalogue | null, opts: { only?: Set<string> } = {}): PickerItem[] {
  if (!cat) return [];
  return cat.cars
    .filter((c) => !opts.only || opts.only.has(c.name))
    .map((c) => ({
      value: c.name,
      label: carName(c.name),
      sub: [c.brand, c.class].filter(Boolean).join(" · ") || undefined,
      note: c.seen ? undefined : "Not driven yet",
      search: [c.name, ...c.aliases, c.brand, c.class].filter(Boolean).join(" "),
      tag: c.class ?? undefined,
      group: c.brand ?? undefined,
      visual: <CarBadge brand={c.brand} name={carName(c.name)} />,
    }));
}
