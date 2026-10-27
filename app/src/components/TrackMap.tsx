import { useEffect, useMemo, useRef, useState } from "react";
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

/**
 * The angle (degrees, in the map's own x-right, z-down drawing space) an arrow must turn to point the way a car faces.
 * `heading` is the game's yaw in degrees, where the car travels along (-sin, cos) in world (x, z); the map's chosen
 * mirror and rotation apply to that direction like they do to every point.
 */
export function arrowAngle(heading: number, rotate: number, mirror: boolean): number {
  const h = (heading * Math.PI) / 180;
  const [dx, dz] = orient([-Math.sin(h), Math.cos(h)], rotate, mirror);
  return (Math.atan2(dz, dx) * 180) / Math.PI;
}

/** A car drawn as an arrow, `u` map units to a screen pixel or so, pointing along `deg` (see `arrowAngle`). */
function CarArrow({ at, deg, u, color }: { at: [number, number]; deg: number; u: number; color: string }) {
  const pts = [[5.4, 0], [-3.6, 3.8], [-1.6, 0], [-3.6, -3.8]].map(([x, z]) => `${x * u},${z * u}`).join(" ");
  return (
    <g transform={`translate(${at[0]} ${at[1]}) rotate(${deg})`}>
      <polygon points={pts} fill={color} stroke="#fff" strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </g>
  );
}

/** The framing of a camera view as plain numbers, so one can be blended into another. */
interface Pose {
  /** The centre of what is in view, in map units, and its size. */
  cx: number;
  cz: number;
  w: number;
  h: number;
  /** How far the map is turned (degrees) about the pivot. */
  deg: number;
  px: number;
  pz: number;
  /** Map units to about two screen pixels, and the outline's thickness. */
  u: number;
  line: number;
}

const VIEW_MS = 450;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
/** Sizes blend on a log scale, so a zoom looks like an even zoom rather than a lurch at the start. */
const mixLog = (a: number, b: number, t: number) => Math.exp(mix(Math.log(a), Math.log(b), t));
const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Glides from the framing the map was showing to `target` whenever `key` changes (a new zoom, turning on or off with the
 * car), and shows `target` as it is the rest of the time, so a car being followed is never held back. Turns take the short
 * way round. Nothing moves for people who ask their system for reduced motion.
 */
function useEasedPose(target: Pose | undefined, key: string): Pose | undefined {
  const [, redraw] = useState(0);
  const s = useRef<{ key: string; from: Pose | null; start: number; shown: Pose | undefined }>({ key, from: null, start: 0, shown: undefined });
  const now = performance.now();
  if (s.current.key !== key) {
    s.current.key = key;
    s.current.from = target && s.current.shown && !reducedMotion() ? s.current.shown : null;
    s.current.start = now;
  }
  let shown = target;
  if (target && s.current.from) {
    const t = Math.min(1, (now - s.current.start) / VIEW_MS);
    if (t >= 1) {
      s.current.from = null;
    } else {
      const f = s.current.from;
      const e = ease(t);
      const turn = ((((target.deg - f.deg) % 360) + 540) % 360) - 180;
      shown = {
        cx: mix(f.cx, target.cx, e),
        cz: mix(f.cz, target.cz, e),
        w: mixLog(f.w, target.w, e),
        h: mixLog(f.h, target.h, e),
        deg: f.deg + turn * e,
        px: mix(f.px, target.px, e),
        pz: mix(f.pz, target.pz, e),
        u: mixLog(f.u, target.u, e),
        line: mix(f.line, target.line, e),
      };
    }
  }
  s.current.shown = shown;
  const animating = s.current.from !== null;
  useEffect(() => {
    if (!animating) return;
    const id = requestAnimationFrame(() => redraw((n) => n + 1));
    return () => cancelAnimationFrame(id);
  });
  return shown;
}

export function TrackMap({
  points: rawPoints,
  position: rawPosition,
  heading,
  rotate = 0,
  mirror = false,
  closed = true,
  stroke = 3,
  label,
  sectors,
  markers,
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
  /** Which way that car faces, degrees (the game's yaw). Given, the car is drawn as an arrow instead of a dot. */
  heading?: number | null;
  /** Outline thickness in CSS pixels. */
  stroke?: number;
  label?: string;
  /** Colour the outline by sector: boundaries as lap fractions `[0, ..., 1]` and one colour per sector. */
  sectors?: { boundaries: number[]; colors: string[]; active?: number };
  /** Extra cars to draw (drawn in order, so put the one that should sit on top last). */
  markers?: { position: [number, number]; color: string; faded?: boolean; heading?: number | null }[];
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
      // The whole-track view's size in map units, for working out how many pixels a map unit is.
      boxW: maxX - minX + pad * 2,
      boxH: maxZ - minZ + pad * 2,
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
  }, []);

  const view = useMemo(() => {
    const plain = { box: geo.box, turn: undefined as string | undefined, fit: "xMidYMid meet", u: geo.unit, line: stroke, pose: undefined as Pose | undefined };
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
    const w = frame.w / scale;
    const h = frame.h / scale;
    const pose: Pose = { cx: x0 + w / 2, cz: z0 + h / 2, w, h, deg, px: mx, pz: mz, u, line };
    return {
      box: `${x0} ${z0} ${w} ${h}`,
      turn: deg ? `rotate(${deg} ${mx} ${mz})` : undefined,
      fit: "xMidYMid meet",
      u,
      line,
      pose: pose as Pose | undefined,
    };
  }, [camera, geo, rotate, mirror, frame, stroke, corner?.w, corner?.h]);
  // A new zoom, or turning with the car on or off, glides in rather than jumping.
  const eased = useEasedPose(view.pose, `${camera?.zoom ?? 0}|${camera?.heading ? 1 : 0}|${corner ? 1 : 0}`);
  const shown = eased
    ? { box: `${eased.cx - eased.w / 2} ${eased.cz - eased.h / 2} ${eased.w} ${eased.h}`, turn: `rotate(${eased.deg} ${eased.px} ${eased.pz})` as string | undefined, u: eased.u, line: eased.line }
    : view;
  const u = shown.u;
  // Cars drawn as arrows are the same size on the screen in every view: about 2 px to a unit, however far the map is
  // zoomed or however big its frame is (the dots and markers keep their sizes relative to the track, as before).
  const au = camera ? shown.u : frame ? 2.2 / Math.min(frame.w / geo.boxW, frame.h / geo.boxH) : geo.unit * 0.3;
  const line = shown.line;

  return (
    <svg ref={svgRef} viewBox={shown.box} width="100%" height="100%" role="img" aria-label={label ?? "Track map"} preserveAspectRatio={view.fit} style={{ display: "block" }}>
      <g transform={shown.turn}>
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
          return <circle key={i} cx={p[0]} cy={p[1]} r={u * 1.3} fill="#e8ebf4" />;
        })}
      <circle cx={geo.start[0]} cy={geo.start[1]} r={u * 1.8} fill="var(--mint)" />
      {!closed && <circle cx={geo.end[0]} cy={geo.end[1]} r={u * 1.8} fill="var(--peach)" />}
      {markers?.map((m, i) => {
        const [mx, mz] = orient(m.position, rotate, mirror);
        return (
          <g key={i} opacity={m.faded ? 0.55 : 1}>
            {m.heading != null && Number.isFinite(m.heading) ? (
              <CarArrow at={[mx, mz]} deg={arrowAngle(m.heading, rotate, mirror)} u={au * 0.8} color={m.color} />
            ) : (
              <circle cx={mx} cy={mz} r={u * 3} fill={m.color} stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            )}
          </g>
        );
      })}
      {position && (
        <>
          {heading != null && Number.isFinite(heading) ? (
            <>
              <circle cx={position[0]} cy={position[1]} r={au * 3.4} fill="var(--peach)" opacity={0.25} />
              <CarArrow at={position} deg={arrowAngle(heading, rotate, mirror)} u={au * 0.8} color="var(--peach)" />
            </>
          ) : (
            <>
              <circle cx={position[0]} cy={position[1]} r={u * 4.5} fill="var(--peach)" opacity={0.3} />
              <circle cx={position[0]} cy={position[1]} r={u * 2.4} fill="var(--peach)" stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            </>
          )}
        </>
      )}
      </g>
    </svg>
  );
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
 * How the viewer likes replay maps framed: zoom (the whole track, or following the car) and whether
 * the map turns so the car heads up the screen. Remembered by this browser and shared by every replay map.
 */
export function useMapView() {
  const [zoom, setZoom] = usePersistedState<MapZoom>("map.zoom", 1, (v) => MAP_ZOOMS.some((z) => z === v));
  const [carUp, setCarUp] = usePersistedState("map.carUp", false, (v) => typeof v === "boolean");
  return { zoom, setZoom, carUp, setCarUp };
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
