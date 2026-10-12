import type { ReactNode } from "react";
import { api, useFetch, type Catalogue, type TrackMapData } from "../api";
import { countryName, findMap, TrackThumb } from "../catalogueItems";
import { fold } from "./Picker";
import { TrackMap } from "./TrackMap";
import { SECTOR_PURPLE, gameName, lapTime, prettify } from "../format";

/** One colour per sector, in lap order, so the map and its legend agree. */
const SECTOR_HUES = ["#4FC3FF", "#FF9F6B", "#FF7AC6", "#4BE3A6", "#FFC93C", "#B18CFF"];

/**
 * The selected track, front and centre: where it is, which layout, what's been driven on it, and
 * its map with the sectors coloured in. `children` is the period switch (it filters what the
 * numbers below mean, so it lives with the title).
 */
export function TrackHero({
  game,
  track,
  layout,
  catalogue,
  maps,
  car,
  drivers,
  laps,
  idealMs = null,
  live,
  children,
}: {
  game: string;
  track: string;
  layout: string;
  catalogue: Catalogue | null;
  maps: TrackMapData[];
  /** The picked car, or null for any car. */
  car: string | null;
  drivers: number;
  laps: number;
  /** Every sector's fastest time on this board added together, when there is one. */
  idealMs?: number | null;
  /** Someone driving this very track right now: shown as a dot on the map. */
  live?: { name: string; position: [number, number] } | null;
  children?: ReactNode;
}) {
  const map = findMap(maps, track, layout);
  const boundaries = useFetch(() => api.sectorBoundaries(game, track, layout), [game, track, layout]);
  const sectorCount = boundaries && boundaries.length > 2 ? boundaries.length - 1 : 0;
  const colors = Array.from({ length: sectorCount }, (_, i) => SECTOR_HUES[i % SECTOR_HUES.length]);

  const cat = catalogue?.game === game ? catalogue.tracks.find((t) => fold(t.name) === fold(track)) : undefined;
  const country = countryName(cat?.country ?? null);
  const carInfo = car && catalogue?.game === game ? catalogue.cars.find((c) => c.name === car) : undefined;

  return (
    <section className="card track-hero" aria-label="Selected track">
      <div className="th-info">
        <div className="label">{[gameName(game), country].filter(Boolean).join(" · ")}</div>
        <h2 className="th-name">{prettify(track)}</h2>
        <div className="th-layout">{layout ? prettify(layout) : "Default layout"}</div>
        <div className="th-chips">
          <span className="chip plain">{car ?? "Any car"}</span>
          {carInfo?.class && <span className="chip plain">{carInfo.class}</span>}
          <span className="chip plain">{drivers} {drivers === 1 ? "driver" : "drivers"}</span>
          <span className="chip plain">{laps} {laps === 1 ? "lap" : "laps"}</span>
        </div>
        {idealMs !== null && (
          <div className="th-stat" title="Every sector's fastest time on this board added together">
            <span className="label">Ideal lap</span>
            <span className="mono th-stat-value" style={{ color: SECTOR_PURPLE }}>{lapTime(idealMs)}</span>
            <span className="th-stat-note">best sectors, combined</span>
          </div>
        )}
        {children}
      </div>

      <div className="th-map">
        <div className="th-frame">
          {map ? (
            <TrackMap
              points={map.points}
              rotate={map.rotate}
              mirror={map.mirror}
              stroke={6}
              position={live?.position ?? null}
              sectors={sectorCount ? { boundaries: boundaries!, colors } : undefined}
              label={`${prettify(track)} map`}
            />
          ) : (
            <div className="th-nomap">
              <div style={{ width: 120, height: 80 }}><TrackThumb kind={cat?.kind} /></div>
              <span className="muted">The map appears after one clean lap here.</span>
            </div>
          )}
        </div>
        {map && (
          <div className="th-legend">
            {colors.map((c, i) => (
              <span key={i} className="lb-key"><i style={{ background: c, width: 14, height: 4, borderRadius: 2 }} />Sector {i + 1}</span>
            ))}
            <span className="lb-key"><i style={{ background: "var(--mint)", borderRadius: "50%" }} />Start / finish</span>
            {live && <span className="lb-key"><i style={{ background: "var(--peach)", borderRadius: "50%" }} />{live.name} on track now</span>}
          </div>
        )}
      </div>
    </section>
  );
}
