import { useEffect, useMemo, useRef, useState } from "react";
import type { PenaltyPin } from "../api";
import { usePersistedState } from "../persist";

/**
 * A track outline from learned telemetry (world [x, z] metres), optionally with a dot for
 * the car. Scales to its container; world z grows downward on screen, because the game's axes are mirrored compared to a normal map view (a left turn must look like a left turn).
 */
/** Applies the chosen orientation: mirror left/right, then rotate clockwise on screen (z down). */
export function orient([x, z]: [number, number], rotate: number, mirror: boolean): [number, number] {
  if (mirror) x = -x;
  switch (((rotate % 360) + 360) % 360) {
    case 90: return [-z, x];
    case 180: return [-x, -z];
    case 270: return [z, -x];
    default: return [x, z];
  }
}

export function TrackMap({
  points: rawPoints,
  position: rawPosition,
  rotate = 0,
  mirror = false,
  closed = true,
  stroke = 3,
  label,
  sectors,
  markers,
  pins,
  camera,
  corner,
}: {
  points: [number, number][];
  rotate?: number;
  mirror?: boolean;
  /** A circuit comes back to its start. A rally stage does not: drawn open, with a finish marker. */
  closed?: boolean;
  /** Car position in the same world coordinates. */
  position?: [number, number] | null;
  /** Outline thickness in CSS pixels. */
  stroke?: number;
  label?: string;
  /** Colour the outline by sector: boundaries as lap fractions `[0, ..., 1]` and one colour per sector. */
  sectors?: { boundaries: number[]; colors: string[]; active?: number };
  /** Extra cars to draw (drawn in order, so put the one that should sit on top last). */
  markers?: { position: [number, number]; color: string; faded?: boolean }[];
  /** Time penalties to pin on the map, in the same world coordinates: a pin where it happened, with how much it added. */
  pins?: { position: [number, number]; addedMs: number; color?: string }[];
  /**
   * How to frame the map (world coordinates, like the markers). `zoom` above 1 follows `at` (a car)
   * that much closer, filling the frame. `heading` turns the map so travel from `from` to `to` points
   * up the screen; at zoom 1 the whole track stays in view while it turns. Without a camera the whole
   * track is shown the right way up, as before.
   */
  camera?: { at: [number, number]; zoom: number; heading?: { from: [number, number]; to: [number, number] } | null };
  /**
   * With a camera: the size (screen pixels) of something sitting over the map's top right corner, like
   * its controls. The track is fitted, and a followed car centred, clear of it: below it or beside it,
   * whichever leaves the track bigger. The map still draws underneath.
   */
  corner?: { w: number; h: number };
}) {
  const points = useMemo(() => rawPoints.map((p) => orient(p, rotate, mirror)), [rawPoints, rotate, mirror]);
  const position = rawPosition ? orient(rawPosition, rotate, mirror) : null;
  const geo = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of points) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const span = Math.max(maxX - minX, maxZ - minZ, 1);
    const pad = span * 0.06;
    return {
      unit: span / 100,
      box: `${minX - pad} ${minZ - pad} ${maxX - minX + pad * 2} ${maxZ - minZ + pad * 2}`,
      d: points.map(([x, z], i) => `${i ? "L" : "M"}${x} ${z}`).join("") + (closed ? "Z" : ""),
      start: points[0],
      end: points[points.length - 1],
      // The track's own extent, without the margin `box` adds.
      bounds: { minX, maxX, minZ, maxZ },
    };
  }, [points, closed]);

  // One path per sector, cut from the outline at the boundaries (the map has one point per 1/N of the lap).
  const segments = useMemo(() => {
    if (!sectors || sectors.boundaries.length < 2) return null;
    const n = points.length;
    return sectors.boundaries.slice(0, -1).map((from, i) => {
      const a = Math.round(from * n);
      const b = Math.max(a + 1, Math.round(sectors.boundaries[i + 1] * n));
      const pts = Array.from({ length: b - a + 1 }, (_, k) => points[closed ? (a + k) % n : Math.min(a + k, n - 1)]);
      return pts.map(([x, z], k) => `${k ? "L" : "M"}${x} ${z}`).join("");
    });
  }, [sectors, points, closed]);

  // With a camera the map works in screen pixels: it measures its frame, so a zoom is that many times
  // the magnification of the whole-track view on this screen (the same on a phone and a PC), dots keep
  // one size on screen at any zoom, and the track gets wider as you zoom in, a little less than the zoom
  // so it stays a line rather than a slab.
  const svgRef = useRef<SVGSVGElement>(null);
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!camera) return;
    const el = svgRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setFrame((f) => (f && f.w === r.width && f.h === r.height ? f : { w: r.width, h: r.height }));
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [!camera]);

  const view = useMemo(() => {
    const plain = { box: geo.box, turn: undefined as string | undefined, deg: 0, fit: "xMidYMid meet", u: geo.unit, line: stroke };
    if (!camera) return plain;
    let deg = 0;
    if (camera.heading) {
      const [fx, fz] = orient(camera.heading.from, rotate, mirror);
      const [tx, tz] = orient(camera.heading.to, rotate, mirror);
      if (tx !== fx || tz !== fz) deg = -90 - (Math.atan2(tz - fz, tx - fx) * 180) / Math.PI;
    }
    const zoom = Math.max(1, camera.zoom);
    const line = stroke * Math.pow(zoom, 0.7);
    // Not measured yet (first paint): the whole track, as without a camera.
    if (!frame) return { ...plain, line };
    const { minX, maxX, minZ, maxZ } = geo.bounds;
    const tw = Math.max(maxX - minX, 1);
    const th = Math.max(maxZ - minZ, 1);
    // The clear part of the frame, below or beside whatever covers the corner (whichever fits the
    // track bigger), less a small margin round the track.
    const margin = 14;
    const fits = (corner ? [{ t: corner.h, r: 0 }, { t: 0, r: corner.w }] : [{ t: 0, r: 0 }]).map(({ t: ct, r: cr }) => {
      const aw = Math.max(40, frame.w - cr - 2 * margin);
      const ah = Math.max(40, frame.h - ct - 2 * margin);
      // Pixels per map unit for the whole track in that space (turned, it needs room for any angle).
      const whole = deg && zoom <= 1 ? Math.min(aw, ah) / Math.hypot(tw, th) : Math.min(aw / tw, ah / th);
      return { ct, cr, whole };
    });
    const best = fits.reduce((x, y) => (y.whole > x.whole ? y : x));
    const whole = best.whole;
    const [t, r, b, l] = [best.ct + margin, best.cr + margin, margin, margin];
    const scale = whole * zoom;
    // Dots are sized in screen pixels: u is about 2.2 px.
    const u = 2.2 / scale;
    // What sits at the middle of the clear space: the track's middle, or the followed car.
    const [mx, mz] = zoom <= 1 ? [(minX + maxX) / 2, (minZ + maxZ) / 2] : orient(camera.at, rotate, mirror);
    const x0 = mx - (l - margin + (frame.w - l - r + 2 * margin) / 2) / scale;
    const z0 = mz - (t - margin + (frame.h - t - b + 2 * margin) / 2) / scale;
    return {
      box: `${x0} ${z0} ${frame.w / scale} ${frame.h / scale}`,
      turn: deg ? `rotate(${deg} ${mx} ${mz})` : undefined,
      deg,
      fit: "xMidYMid meet",
      u,
      line,
    };
  }, [camera, geo, rotate, mirror, frame, stroke, corner?.w, corner?.h]);
  const u = view.u;
  const line = view.line;

  return (
    <svg ref={svgRef} viewBox={view.box} width="100%" height="100%" role="img" aria-label={label ?? "Track map"} preserveAspectRatio={view.fit} style={{ display: "block" }}>
      <g transform={view.turn}>
      <path d={geo.d} fill="none" stroke="var(--line)" strokeWidth={line + 4} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {segments ? (
        segments.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={sectors!.colors[i] ?? "var(--peri-1)"}
            strokeWidth={i === sectors!.active ? line + 2 : line}
            strokeLinejoin="round"
            strokeLinecap="butt"
            vectorEffect="non-scaling-stroke"
          />
        ))
      ) : (
        <path d={geo.d} fill="none" stroke="var(--peri-1)" strokeWidth={line} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      )}
      {segments &&
        sectors!.boundaries.slice(1, -1).map((b, i) => {
          const p = points[closed ? Math.round(b * points.length) % points.length : Math.min(Math.round(b * points.length), points.length - 1)];
          return <circle key={i} cx={p[0]} cy={p[1]} r={u * 1.3} fill="#EEF0FF" />;
        })}
      <circle cx={geo.start[0]} cy={geo.start[1]} r={u * 1.8} fill="var(--mint)" />
      {!closed && <circle cx={geo.end[0]} cy={geo.end[1]} r={u * 1.8} fill="var(--peach)" />}
      {markers?.map((m, i) => {
        const [mx, mz] = orient(m.position, rotate, mirror);
        return (
          <g key={i} opacity={m.faded ? 0.55 : 1}>
            <circle cx={mx} cy={mz} r={u * 3} fill={m.color} stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
      {pins?.map((pin, i) => {
        const [px, pz] = orient(pin.position, rotate, mirror);
        const r = u * 2.8;
        const colour = pin.color ?? "var(--red)";
        // A teardrop pin with its tip on the spot, kept upright whatever way the map is turned.
        return (
          <g key={`pin${i}`} transform={view.deg ? `rotate(${-view.deg} ${px} ${pz})` : undefined}>
            <path
              d={`M${px} ${pz} L${px - r * 0.78} ${pz - r * 1.55} A${r} ${r} 0 1 1 ${px + r * 0.78} ${pz - r * 1.55} Z`}
              fill={colour}
              stroke="#fff"
              strokeWidth={1.5}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={px} cy={pz - r * 2.1} r={r * 0.34} fill="#fff" />
            <text
              x={px + r * 1.35}
              y={pz - r * 1.6}
              fontSize={u * 6.2}
              fontWeight={700}
              fill="#fff"
              stroke="#0B1020"
              strokeWidth={3}
              paintOrder="stroke"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            >
              {`+${Number.isInteger(pin.addedMs / 1000) ? pin.addedMs / 1000 : (pin.addedMs / 1000).toFixed(1)}s`}
            </text>
          </g>
        );
      })}
      {position && (
        <>
          <circle cx={position[0]} cy={position[1]} r={u * 4.5} fill="var(--peach)" opacity={0.3} />
          <circle cx={position[0]} cy={position[1]} r={u * 2.4} fill="var(--peach)" stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </>
      )}
      </g>
    </svg>
  );
}

/**
 * Penalty pins for a run, ready for `TrackMap`'s `pins`: each where the car was when it was given (or, if the
 * game gave no position, where its progress puts it on the outline). With `until` only those given by that
 * stage clock (ms), so a replay drops them as it reaches them and they stay once dropped.
 */
export function penaltyPins(penalties: PenaltyPin[] | undefined, map: { points: [number, number][]; closed: boolean } | undefined, color?: string, until?: number) {
  return (penalties ?? []).flatMap((p) => {
    if (until !== undefined && p.atMs > until) return [];
    const position = p.position ?? (map ? pointAlong(map.points, map.closed, p.progress) : null);
    return position ? [{ position, addedMs: p.addedMs, color }] : [];
  });
}

/** A position on a map's evenly spaced outline (a point per 1/N of the lap), `p` from 0 to 1. */
export function pointAlong(points: [number, number][], closed: boolean, p: number): [number, number] | null {
  const n = points.length;
  if (n < 2 || !Number.isFinite(p)) return null;
  if (!closed) {
    const pos = Math.min(Math.max(p, 0), 1) * (n - 1);
    const i = Math.min(Math.floor(pos), n - 2);
    const f = pos - i;
    return [points[i][0] + (points[i + 1][0] - points[i][0]) * f, points[i][1] + (points[i + 1][1] - points[i][1]) * f];
  }
  const pos = (((p % 1) + 1) % 1) * n;
  const i = Math.floor(pos) % n;
  const f = pos - Math.floor(pos);
  const a = points[i];
  const c = points[(i + 1) % n];
  return [a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f];
}

/** How close a map follows the car: 1 is the whole track. */
export const MAP_ZOOMS = [1, 2, 4, 8] as const;
export type MapZoom = (typeof MAP_ZOOMS)[number];

/**
 * How the viewer likes a map framed: zoom (the whole track, or following the car) and whether the map turns
 * so the car heads up the screen. Remembered by this browser.
 *
 * Each map widget (`scope`: "analysis", "challenge") keeps its own choice, so framing one doesn't change the
 * others. A widget can be set to follow the shared view instead (`linked`), which every linked widget reads
 * and writes together.
 */
export function useMapView(scope: string) {
  const [linked, setLinked] = usePersistedState(`map.${scope}.linked`, false, (v) => typeof v === "boolean");
  const [ownZoom, setOwnZoom] = usePersistedState<MapZoom>(`map.${scope}.zoom`, 1, (v) => MAP_ZOOMS.some((z) => z === v));
  const [ownCarUp, setOwnCarUp] = usePersistedState(`map.${scope}.carUp`, false, (v) => typeof v === "boolean");
  const [sharedZoom, setSharedZoom] = usePersistedState<MapZoom>("map.zoom", 1, (v) => MAP_ZOOMS.some((z) => z === v));
  const [sharedCarUp, setSharedCarUp] = usePersistedState("map.carUp", false, (v) => typeof v === "boolean");
  return linked
    ? { zoom: sharedZoom, setZoom: setSharedZoom, carUp: sharedCarUp, setCarUp: setSharedCarUp, linked, setLinked }
    : { zoom: ownZoom, setZoom: setOwnZoom, carUp: ownCarUp, setCarUp: setOwnCarUp, linked, setLinked };
}

/**
 * The camera for a car `p` (0..1) round the lap under a `useMapView` choice. The heading comes from the
 * outline a little behind and ahead of the car, so the map turns smoothly through corners.
 */
export function cameraAt(points: [number, number][], closed: boolean, p: number, view: { zoom: number; carUp: boolean }) {
  const at = pointAlong(points, closed, p);
  if (!at) return undefined;
  const reach = Math.max(2 / points.length, 0.006);
  const from = pointAlong(points, closed, closed ? p - reach : Math.max(0, p - reach));
  const to = pointAlong(points, closed, closed ? p + reach : Math.min(1, p + reach));
  return { at, zoom: view.zoom, heading: view.carUp && from && to ? { from, to } : null };
}

/** The zoom choice and the car-up switch, for a row above a map. */
export function MapViewControls({ view }: { view: ReturnType<typeof useMapView> }) {
  return (
    <div className="map-view" role="group" aria-label="Map view">
      <div className="segmented" role="group" aria-label="Map zoom">
        {MAP_ZOOMS.map((z) => (
          <button key={z} type="button" aria-pressed={view.zoom === z} onClick={() => view.setZoom(z)} title={z === 1 ? "The whole track" : `${z}× closer, following the car`}>
            {z === 1 ? "Whole" : `${z}×`}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="icon-btn map-view-turn"
        aria-pressed={view.linked}
        onClick={() => view.setLinked(!view.linked)}
        title={view.linked ? "Using the view shared with other maps (tap for this map's own)" : "This map's own view (tap to share one view across maps)"}
        aria-label={view.linked ? "Map view is shared with other maps" : "Map view is just for this map"}
      >
        {/* Two chain links: joined when the view is shared. */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
          <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
        </svg>
      </button>
      <button
        type="button"
        className="icon-btn map-view-turn"
        aria-pressed={view.carUp}
        onClick={() => view.setCarUp(!view.carUp)}
        title={view.carUp ? "Turning with the car (tap for a fixed map)" : "Fixed map (tap to turn with the car)"}
        aria-label={view.carUp ? "Map turns with the car" : "Map stays fixed"}
      >
        {/* A compass needle: points up when the map turns with the car, sideways when it's fixed. */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ transform: view.carUp ? undefined : "rotate(-45deg)", transition: "transform .2s" }}>
          <path d="M12 2l5 12h-10z" />
          <path d="M12 22l-5-8h10z" opacity="0.35" />
        </svg>
      </button>
    </div>
  );
}
