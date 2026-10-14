import { useEffect, useState } from "react";
import { api, useAppState, useDriverMap, useTrackMaps } from "../api";
import { findMap } from "../catalogueItems";
import { carName, lapTime, trackName } from "../format";
import type { SectorStatus } from "../api";
import { Helmet } from "./Helmet";
import { words } from "../vocab";
import { penaltyPins, TrackMap } from "./TrackMap";

/**
 * Where the car is on track right now. Shown to anyone watching (including office
 * browsers on the LAN). Until the track's map has been learned from a clean lap it
 * shows lap progress instead.
 */
const SECTOR_COLOURS: Record<SectorStatus, string> = {
  purple: "#C38BFF",
  green: "#4BE3A6",
  yellow: "#FFC93C",
  current: "#EEF0FF",
  pending: "#3A4672",
};

const deltaText = (ms: number) => `${ms <= 0 ? "-" : "+"}${(Math.abs(ms) / 1000).toFixed(3)}`;

/**
 * The path driven so far while the map is still being learned. The app records it (so it survives a page
 * refresh and shows to anyone who opens the page mid-lap); this just asks for it every moment or two.
 */
function useLearningPath(active: boolean, key: string): [number, number][] {
  const [path, setPath] = useState<{ key: string; points: [number, number][] }>({ key: "", points: [] });
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const load = () =>
      api.learningPath().then((points) => !stop && setPath({ key, points })).catch(() => {});
    load();
    const t = setInterval(load, 1500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [active, key]);
  return path.key === key ? path.points : [];
}

export function LiveMap() {
  const { status } = useAppState();
  const drivers = useDriverMap();
  const session = status?.session ?? null;
  const live = status?.live ?? null;
  const w = words(session?.game);
  const maps = useTrackMaps(session?.game ?? null);
  const map = session ? findMap(maps, session.track, session.layout) : undefined;
  const learned = useLearningPath(!!session && !!live?.driving && !map, session ? `${session.game}|${session.track}|${session.layout}|${session.car}` : "");
  if (!session || !live?.driving) return null;

  const setView = (patch: { rotate?: number; mirror?: boolean }) =>
    map && api.setMapView({ game: map.game, track: map.track, layout: map.layout, rotate: map.rotate, mirror: map.mirror, ...patch });
  // Sector colours follow the live timing: purple = fastest anyone, green = this driver's best, yellow = slower.
  const timing = live.timing;
  const sectorColours = timing ? timing.sectors.map((x) => SECTOR_COLOURS[x.status]) : session.boundaries.slice(1).map(() => SECTOR_COLOURS.pending);
  const driver = status?.seat != null ? drivers.get(status.seat) : undefined;

  return (
    <section className="card livemap" aria-label="Live map">
      <div className="head" style={{ alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <Helmet color={driver?.color ?? "#9AA3C7"} size={40} seed={driver?.id} />
          <div style={{ minWidth: 0 }}>
            <div className="label" style={{ color: "var(--peach)" }}>{w.rally ? "Live on the stage" : "Live on track"}</div>
            <h2 style={{ marginTop: 2, overflowWrap: "anywhere" }}>{driver?.name ?? "Guest"}</h2>
          </div>
        </div>
        <span className="chip plain mono" style={{ fontSize: 16, ...(!live.outLap && !live.lapValid ? { background: "rgba(255,107,138,0.18)", color: "#FF8BA3" } : {}) }}>
          {live.outLap ? `Out ${w.lap}` : !live.lapValid ? <><s style={{ opacity: 0.7 }}>{lapTime(live.currentLapMs)}</s>&nbsp;{live.voidReason === "driverChange" ? "Driver changed" : "Invalid"}</> : lapTime(live.currentLapMs)}
        </span>
      </div>
      <div className="livemap-frame">
        {map ? (
          <TrackMap points={map.points} position={live.position} rotate={map.rotate} mirror={map.mirror} closed={map.closed} stroke={5} pins={penaltyPins(live.penalties, map)}
            sectors={session.boundaries.length > 2 ? { boundaries: session.boundaries, colors: sectorColours, active: timing?.currentSector } : undefined} label={`${trackName(session.track, session.layout)} live map`} />
        ) : (
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 10, width: "min(320px, 100%)", height: "100%", minHeight: 0 }}>
            {learned.length > 8 && (
              <div style={{ flex: 1, minHeight: 0 }}>
                <TrackMap points={learned} position={live.position} closed={false} stroke={5} pins={penaltyPins(live.penalties, { points: learned, closed: false })} label={`${trackName(session.track, session.layout)} map being drawn`} />
              </div>
            )}
            {live.mapSpoiled ? (
              <span className="map-spoiled" role="status">
                <strong>This {w.lap} won't teach the map.</strong>{" "}
                {live.mapSpoiled === "penalty"
                  ? `A penalty was taken, so we can't tell how far off the ${w.track} the car went.`
                  : live.mapSpoiled === "joinedLate"
                    ? `It was already under way when Bin It started watching.`
                    : `It isn't a valid ${w.lap}.`}{" "}
                Start a clean {w.lap} from the beginning to learn it.
              </span>
            ) : (
              <span className="muted">Learning this {w.track}. Finish one clean {w.lap} and its map is kept.</span>
            )}
            <div style={{ height: 10, borderRadius: 5, background: "var(--panel-3)", overflow: "hidden" }}>
              <div style={{ width: `${Math.round(live.lapProgress * 100)}%`, height: "100%", background: "var(--violet)" }} />
            </div>
          </div>
        )}
      </div>
      {timing && (
        <div className="sector-row" aria-label="Sector times">
          {timing.sectors.map((x, i) => (
            <div key={i} className="sector-card" data-now={i === timing.currentSector || undefined}>
              <span className="sector-bar" style={{ background: SECTOR_COLOURS[x.status], opacity: x.status === "pending" ? 0.6 : 1 }} />
              <div className="sector-head">
                <span className="label">S{i + 1}</span>
                {i === timing.currentSector && <span className="chip plain">Now</span>}
              </div>
              <span className="mono sector-time">{x.timeMs ? (x.timeMs / 1000).toFixed(3) : "-.---"}</span>
              <span className="mono sector-delta" style={{ color: x.deltaMs === null ? "var(--muted)" : x.deltaMs <= 0 ? "var(--mint)" : "var(--red)" }}>
                {x.deltaMs === null ? " " : deltaText(x.deltaMs)}
              </span>
            </div>
          ))}
        </div>
      )}
      {map && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="filter-pill" onClick={() => setView({ rotate: (map.rotate + 90) % 360 })}>Rotate</button>
          <button type="button" className="filter-pill" onClick={() => setView({ mirror: !map.mirror })}>Flip</button>
          <span className="muted" style={{ fontSize: 13 }}>Turn the map to how you expect it. Saved for this {w.track}.</span>
          <span className="muted" style={{ fontSize: 13, marginLeft: "auto" }}>
            <span style={{ color: SECTOR_COLOURS.purple }}>■</span> fastest <span style={{ color: SECTOR_COLOURS.green }}>■</span> their best <span style={{ color: SECTOR_COLOURS.yellow }}>■</span> slower
          </span>
        </div>
      )}
      <span className="muted" style={{ fontSize: 14 }}>{trackName(session.track, session.layout)} · {carName(session.car)}</span>
    </section>
  );
}
