import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { api, useAppState, useFetch, useTrackMaps, type AidsMax, type Driver, type Lap, type LapSlides, type LiveAids, type TraceRow } from "../api";
import { ElectronicsGauges } from "./ElectronicsGauges";
import { findMap } from "../catalogueItems";
import { usePersistedState } from "../persist";
import { ago, carName, lapKind, lapTime } from "../format";
import { cap, words, type Words } from "../vocab";
import { Dropdown, type DropdownOption } from "./Dropdown";
import { Helmet } from "./Helmet";
import { TrackFilters, trackKey, useTrackSelection } from "./TrackFilters";
import { GapLadder } from "./GapLadder";
import { cameraAt, MapViewControls, pointAlong, TrackMap, useMapView } from "./TrackMap";
import { Signed } from "./Signed";

const THROTTLE = "#4fd39a";
const BRAKE = "#ff7a92";
const LAP_A = "#c9c9ff";
const LAP_B = "#FFC93C";

/** One sample of a recorded lap: where on the lap, when, and what the driver was doing. */
interface Pt {
  p: number;
  t: number;
  speed: number;
  throttle: number;
  brake: number;
  steer: number;
  gear: number;
  /** World position (metres) and heading (degrees), when the lap's trace recorded them. */
  x: number | null;
  z: number | null;
  heading: number | null;
  /** Heading minus the direction of travel, degrees: positive = the nose is turned right of where the car is going. */
  slip: number | null;
  /** What the aids and brake balance were set to, and the turbo boost, when the lap's trace recorded them. */
  tc: number | null;
  abs: number | null;
  bias: number | null;
  diffP: number | null;
  diffC: number | null;
  limiter: boolean | null;
  boost: number | null;
}

/** What the page shows about a lap, from the recent-laps list or the leaderboard. */
interface LapInfo {
  id: number;
  driverId: number | null;
  timeMs: number;
  sectorsMs: number[];
  at: number;
  car: string;
}

/**
 * The trace rows from `/laps/{id}/trace` as points along the lap. Progress has to rise through the
 * lap; samples from before the line (still reading ~100% from the previous lap) or glitches that
 * step backwards are dropped.
 */
/** "3 drifts · 12.4 s (longest 5.1 s, up to 34°) · 1 spin" */
function slidesText(s: LapSlides): string {
  const parts: string[] = [];
  if (s.drifts > 0) parts.push(`${s.drifts} ${s.drifts === 1 ? "drift" : "drifts"} · ${(s.driftMs / 1000).toFixed(1)} s (longest ${(s.longestMs / 1000).toFixed(1)} s, up to ${Math.round(s.peakSlipDeg)}°)`);
  if (s.spins > 0) parts.push(`${s.spins} ${s.spins === 1 ? "spin" : "spins"}`);
  return parts.join(" · ");
}

function parseTrace(rows: TraceRow[] | undefined): Pt[] {
  if (!rows) return [];
  const out: Pt[] = [];
  let max = -1;
  for (const [p, t, speed, throttle, brake, , steer, gear, x, z, heading, slip, tc, abs, bias, diffP, diffC, limiter, boost] of rows) {
    if (out.length === 0 && p > 0.5) continue;
    if (p < max) continue;
    max = p;
    out.push({ p, t, speed, throttle, brake, steer, gear, x, z, heading, slip, tc: tc ?? null, abs: abs ?? null, bias: bias ?? null, diffP: diffP ?? null, diffC: diffC ?? null, limiter: limiter ?? null, boost: boost ?? null });
  }
  return smoothProgress(out);
}

/** Half-width (ms) of the window the progress correction is averaged over. */
const SETTLE_MS = 500;

/**
 * Steadies where the car is at each moment. The game's track position and its lap clock don't tick
 * together: now and then the position misses an update and catches up on the next (about 1 sample in
 * 50 on a lap, and the speed it implies is often 10–20 km/h off), so plotted against time the car
 * stalls and lurches. That's sub-pixel on the whole track but a visible bob on a zoomed map.
 *
 * The recorded speed is smooth, so: integrate it into distance, scale that to the lap's own start and
 * finish progress, then pull it towards the recorded progress averaged over about a second. Short
 * term the movement comes from the speed, long term the position from the progress, so it can't drift.
 */
function smoothProgress(pts: Pt[]): Pt[] {
  const n = pts.length;
  if (n < 3) return pts;
  // Distance (m) travelled by each sample, from the speed.
  const s = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const dt = Math.max(0, pts[i].t - pts[i - 1].t) / 1000;
    s[i] = s[i - 1] + ((pts[i].speed + pts[i - 1].speed) / 2 / 3.6) * dt;
  }
  const span = pts[n - 1].p - pts[0].p;
  if (!(s[n - 1] > 0) || !(span > 0)) return pts;
  const k = span / s[n - 1];
  // Progress the speed alone gives, and how far the recorded progress sits from it.
  const q = Array.from(s, (d) => pts[0].p + d * k);
  const off = pts.map((x, i) => x.p - q[i]);
  // Average that offset over a window of time either side (a running sum, so it stays fast).
  const out: Pt[] = new Array(n);
  let lo = 0;
  let hi = 0;
  let sum = 0;
  let prev = -Infinity;
  for (let i = 0; i < n; i++) {
    while (hi < n && pts[hi].t <= pts[i].t + SETTLE_MS) sum += off[hi++];
    while (pts[lo].t < pts[i].t - SETTLE_MS) sum -= off[lo++];
    // Never backwards, and never outside the lap's recorded range.
    const p = Math.min(pts[n - 1].p, Math.max(prev, pts[0].p, q[i] + sum / (hi - lo)));
    prev = p;
    out[i] = { ...pts[i], p };
  }
  return out;
}

/**
 * Where a lap's car was `clockMs` into it, and which way it faced, from the trace's own readings (null when the lap
 * was recorded without them). The heading is blended the short way round, so it doesn't swing through 360 degrees.
 */
function carAt(pts: Pt[], clockMs: number): { position: [number, number]; heading: number | null } | null {
  if (pts.length === 0) return null;
  let lo = 0;
  let hi = pts.length - 1;
  if (clockMs <= pts[0].t) hi = lo;
  else if (clockMs >= pts[hi].t) lo = hi;
  else {
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].t <= clockMs) lo = mid;
      else hi = mid;
    }
  }
  const a = pts[lo];
  const b = pts[hi];
  if (a.x === null || a.z === null || b.x === null || b.z === null) return null;
  const f = b.t === a.t ? 0 : Math.min(1, Math.max(0, (clockMs - a.t) / (b.t - a.t)));
  let heading: number | null = null;
  if (a.heading !== null && b.heading !== null) {
    const turn = ((((b.heading - a.heading) % 360) + 540) % 360) - 180;
    heading = a.heading + turn * f;
  }
  return { position: [a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f], heading };
}

/** Linear lookup of `key` → `val` over points sorted by `key`. */
function lookup(pts: Pt[], key: "p" | "t", x: number, val: (q: Pt) => number): number {
  if (pts.length === 0) return 0;
  if (x <= pts[0][key]) return val(pts[0]);
  const last = pts[pts.length - 1];
  if (x >= last[key]) return val(last);
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid][key] <= x) lo = mid;
    else hi = mid;
  }
  const a = pts[lo];
  const b = pts[hi];
  const f = b[key] === a[key] ? 0 : (x - a[key]) / (b[key] - a[key]);
  return val(a) + (val(b) - val(a)) * f;
}

/**
 * The readings at a point of the lap, glided between the two samples either side of it. The trace holds one sample
 * every 50 ms, so reading the nearest one makes dials and numbers step 20 times a second while a replay plays at 60.
 * Numbers are blended; things that are not (the gear, the aids, the limiter) come from the nearer sample.
 */
function sampleAt(pts: Pt[], p: number): Pt | null {
  if (pts.length === 0) return null;
  if (p <= pts[0].p) return pts[0];
  const last = pts[pts.length - 1];
  if (p >= last.p) return last;
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].p <= p) lo = mid;
    else hi = mid;
  }
  const a = pts[lo];
  const b = pts[hi];
  const f = b.p === a.p ? 0 : (p - a.p) / (b.p - a.p);
  const near = f < 0.5 ? a : b;
  const mixN = (x: number, y: number) => x + (y - x) * f;
  const mixO = (x: number | null, y: number | null) => (x !== null && y !== null ? mixN(x, y) : near === a ? x : y);
  return {
    ...near,
    p,
    t: mixN(a.t, b.t),
    speed: mixN(a.speed, b.speed),
    throttle: mixN(a.throttle, b.throttle),
    brake: mixN(a.brake, b.brake),
    steer: mixN(a.steer, b.steer),
    x: mixO(a.x, b.x),
    z: mixO(a.z, b.z),
    slip: mixO(a.slip, b.slip),
    boost: mixO(a.boost, b.boost),
  };
}

const W = 1000;
/** Points on the fixed grid the time gap is worked out on. */
const GRID = 2000;

/** An SVG path through the points: `x` maps a point on the lap across the chart, `y` is already in its 0..h. */
function path(pts: Pt[], x: (p: number) => number, y: (q: Pt) => number, step = false): string {
  let d = "";
  let prevY = 0;
  pts.forEach((q, i) => {
    const px = x(q.p).toFixed(1);
    const yy = y(q);
    if (i === 0) d += `M${px} ${yy.toFixed(1)}`;
    else if (step && yy !== prevY) d += `H${px}V${yy.toFixed(1)}`;
    else if (!step) d += `L${px} ${yy.toFixed(1)}`;
    prevY = yy;
  });
  if (step && pts.length) d += `H${x(pts[pts.length - 1].p).toFixed(1)}`;
  return d;
}

/** Driver name, falling back to "Guest" for unclaimed laps. */
function who(drivers: Driver[], id: number | null): Driver | undefined {
  return id == null ? undefined : drivers.find((d) => d.id === id);
}

/** A timed lap on the selected track. */
interface TrackLap extends LapInfo {
  /** Driver and car: laps are picked by this pairing first, its fastest lap by default. */
  pair: string;
}

/** One driver in one car on this track: their laps, fastest first. */
interface Pair {
  key: string;
  driverId: number | null;
  car: string;
  laps: TrackLap[];
}

const pairKey = (driverId: number | null, car: string) => `${driverId ?? "guest"}|${car}`;

/** A lap choice within a pairing: its fastest lap (skipping `not`), or a specific lap. */
type LapChoice = "best" | number;

function choose(pair: Pair | undefined, lap: LapChoice, not?: number): TrackLap | null {
  if (!pair) return null;
  if (lap !== "best") return pair.laps.find((l) => l.id === lap) ?? null;
  return pair.laps.find((l) => l.id !== not) ?? null;
}

/**
 * A recorded lap on the track picked above (the same pick as the Leaderboard), drawn as speed,
 * pedals, steering and gear around the lap, laid over another lap with the running time gap.
 * Laps are chosen by driver and car, which means that pairing's fastest lap unless a specific one is
 * picked. Only timed laps are offered: cut, out and in laps aren't recorded for analysis.
 * `lapId` comes from the address (#/telemetry/lap/<id>), so a leaderboard row can link here.
 */
export function LapAnalysis({ lapId }: { lapId: number | null }) {
  const { drivers } = useAppState();
  const sel = useTrackSelection();
  const { selected, car } = sel;
  const w = words(selected?.game);
  // Every driver's laps (so nothing is missed however old), plus recent ones for guest laps.
  const driverIds = drivers.map((d) => d.id);
  const own = useFetch(driverIds.length ? () => Promise.all(driverIds.map((id) => api.driverLaps(id))) : () => Promise.resolve([]), [driverIds.join(",")]);
  const recent = useFetch(() => api.recentLaps(200), []);
  const [compare, setCompare] = useState<{ pair: string; lap: LapChoice } | null>(null);

  const all = useMemo(() => {
    const out = new Map<number, Lap>();
    for (const l of [...(own ?? []).flat(), ...(recent ?? [])]) out.set(l.id, l);
    return [...out.values()].filter((l) => lapKind(l) === "timed" && l.timeMs > 0);
  }, [own, recent]);

  // A linked lap moves the track pick to its track, once. Picking another track after that lets go
  // of the link (back to #/telemetry), rather than snapping back to the linked lap's track.
  const linked = lapId != null ? all.find((l) => l.id === lapId) : undefined;
  const followed = useRef<number | null>(null);
  const here = selected ? trackKey(selected) : null;
  useEffect(() => {
    if (lapId == null) {
      followed.current = null;
      return;
    }
    if (!linked || !here) return;
    const onIt = trackKey(linked) === here;
    if (followed.current !== linked.id) {
      followed.current = linked.id;
      if (!onIt) sel.chooseTrack(trackKey(linked));
    } else if (!onIt) {
      location.replace("#/telemetry");
    }
  }, [lapId, linked?.id, here]);
  // The comparison belongs to the track and car it was picked on.
  useEffect(() => setCompare(null), [here, car]);

  const pairs = useMemo(() => {
    const out = new Map<string, Pair>();
    if (!selected) return [];
    for (const l of all) {
      if (trackKey(l) !== trackKey(selected) || (car && l.car !== car)) continue;
      const key = pairKey(l.driverId, l.car);
      const p = out.get(key) ?? { key, driverId: l.driverId, car: l.car, laps: [] };
      p.laps.push({ id: l.id, driverId: l.driverId, timeMs: l.timeMs, sectorsMs: l.sectorsMs, at: l.recordedAt, car: l.car, pair: key });
      out.set(key, p);
    }
    const list = [...out.values()];
    list.forEach((p) => p.laps.sort((x, y) => x.timeMs - y.timeMs));
    return list.sort((x, y) => x.laps[0].timeMs - y.laps[0].timeMs);
  }, [all, selected && trackKey(selected), car]);
  const pairOf = (key: string) => pairs.find((p) => p.key === key);

  // This lap: the linked one, else the fastest lap of whoever drove here last.
  const lastDriven = [...pairs].sort((x, y) => Math.max(...y.laps.map((l) => l.at)) - Math.max(...x.laps.map((l) => l.at)))[0];
  const lap = (lapId != null ? pairs.flatMap((p) => p.laps).find((l) => l.id === lapId) : undefined) ?? lastDriven?.laps[0] ?? null;
  const lapPair = lap ? pairOf(lap.pair) : undefined;
  const lapChoice: LapChoice = lap && lapPair?.laps[0].id === lap.id ? "best" : (lap?.id ?? "best");

  // Compared with: by default the fastest other pairing in the same car, else this pairing's next-best lap.
  const auto = (() => {
    if (!lap) return null;
    const rival = pairs.find((p) => p.key !== lap.pair && p.car === lap.car);
    return rival ? { pair: rival.key, lap: "best" as LapChoice } : { pair: lap.pair, lap: "best" as LapChoice };
  })();
  const cmp = compare ?? auto;
  const other = cmp && cmp.pair ? choose(pairOf(cmp.pair), cmp.lap, lap?.id) : null;

  const traceA = useFetch(lap ? () => api.lapTrace(lap.id) : null, [lap?.id]);
  const traceB = useFetch(other ? () => api.lapTrace(other.id) : null, [other?.id]);
  const a = useMemo(() => parseTrace(traceA?.points), [traceA]);
  const b = useMemo(() => parseTrace(traceB?.points), [traceB]);

  const name = (id: number | null) => who(drivers, id)?.name ?? "Guest";
  const pairItems: DropdownOption<string>[] = pairs.map((p) => {
    const d = who(drivers, p.driverId);
    return {
      value: p.key,
      label: `${name(p.driverId)} · ${carName(p.car)}`,
      hint: `Fastest ${lapTime(p.laps[0].timeMs)} · ${p.laps.length} ${p.laps.length === 1 ? w.lap : w.laps}`,
      icon: <Helmet color={d?.color ?? "#5b6578"} look={d?.look} size={30} seed={d?.id} />,
    };
  });
  // A pairing's laps for the dropdown: fastest first, each with when it was set.
  const lapOptions = (p: Pair | undefined, not?: number) => [
    { value: "best", label: `Fastest ${w.lap}`, hint: p ? lapTime(p.laps.find((l) => l.id !== not)?.timeMs) : undefined },
    ...(p?.laps ?? []).filter((l) => l.id !== not).map((l) => ({ value: String(l.id), label: lapTime(l.timeMs), hint: ago(l.at) })),
  ];
  const sectorsCard =
    lap && other && lap.sectorsMs.length > 0 && other.sectorsMs.length === lap.sectorsMs.length ? <Sectors a={lap} b={other} rally={w.rally} /> : null;
  // What each lap slid: at the bottom of the page, above the replay dock, where it reads as a summary of the laps above.
  const slidesNote =
    lap && (traceA?.slides || (other && traceB?.slides)) ? (
      <section className="card la-slides" aria-label="Sliding">
        <span className="label">Sliding</span>
        {traceA?.slides && <span><b style={{ color: LAP_A }}>●</b> {name(lap.driverId)}: {slidesText(traceA.slides)}</span>}
        {other && traceB?.slides && <span><b style={{ color: LAP_B }}>●</b> {name(other.driverId)}: {slidesText(traceB.slides)}</span>}
      </section>
    ) : null;
  const go = (id: number) => {
    location.hash = `#/telemetry/lap/${id}`;
  };

  if (sel.tracks.length === 0) return <div className="empty">{recent === null ? "Loading…" : "Nothing recorded yet. Once someone finishes a lap or a stage, you can look through it here."}</div>;

  return (
    <>
      <TrackFilters sel={sel} />
      {!lap ? (
        <div className="empty">{own === null || recent === null ? `Loading ${w.laps}…` : `No timed ${w.laps} here with this car yet.`}</div>
      ) : (
        <>
          <section className="la-laps" aria-label={cap(w.laps)}>
            <LapCard
              w={w}
              color={LAP_A}
              title={`Whose ${w.lap}?`}
              info={lap}
              driver={who(drivers, lap.driverId)}
              vs={other ?? undefined}
              pairValue={lap.pair}
              pairItems={pairItems}
              onPair={(v) => {
                const p = pairOf(v);
                if (p) go(p.laps[0].id);
                setCompare(null);
              }}
              lapValue={lapChoice === "best" ? "best" : String(lapChoice)}
              lapOptions={lapOptions(lapPair)}
              onLap={(v) => go(v === "best" ? lapPair!.laps[0].id : Number(v))}
            />
            <LapCard
              w={w}
              color={LAP_B}
              title="Compare with"
              info={other}
              driver={other ? who(drivers, other.driverId) : undefined}
              pairValue={cmp?.pair ?? ""}
              pairItems={pairItems.filter((i) => i.value !== lap.pair || (lapPair?.laps.length ?? 0) > 1)}
              anyLabel="No comparison"
              onPair={(v) => setCompare({ pair: v, lap: "best" })}
              lapValue={cmp?.lap === undefined || cmp.lap === "best" ? "best" : String(cmp.lap)}
              lapOptions={cmp?.pair ? lapOptions(pairOf(cmp.pair), cmp.pair === lap.pair ? lap.id : undefined) : []}
              onLap={(v) => cmp && setCompare({ pair: cmp.pair, lap: v === "best" ? "best" : Number(v) })}
            />
          </section>

          {traceA === null ? (
            <div className="empty">This {w.lap} has no input recording (the game didn't send it, or it was recorded before Bin It kept them).</div>
          ) : (
            <Traces a={a} b={other && traceB ? b : []} lapA={lap} lapB={other} nameA={name(lap.driverId)} nameB={other ? name(other.driverId) : ""} maxA={traceA ? traceA.aidsMax : null} maxB={other && traceB ? traceB.aidsMax : null} w={w} where={selected!} after={slidesNote}>
              {sectorsCard}
            </Traces>
          )}

          {traceA === null && sectorsCard}
          {traceA === null && slidesNote}
        </>
      )}
    </>
  );
}

/**
 * One of the two laps, in its colour. The card is the control: the driver side opens the
 * driver-and-car picker, the time opens that pairing's laps (its fastest, or a specific one).
 * With no lap (nothing to compare with), the whole card is a "compare with" button.
 */
function LapCard({
  w,
  color,
  title,
  info,
  driver,
  vs,
  pairValue,
  pairItems,
  anyLabel,
  onPair,
  lapValue,
  lapOptions,
  onLap,
}: {
  w: Words;
  color: string;
  title: string;
  info: LapInfo | null;
  driver?: Driver;
  vs?: LapInfo;
  pairValue: string;
  pairItems: DropdownOption<string>[];
  anyLabel?: string;
  onPair: (v: string) => void;
  lapValue: string;
  lapOptions: { value: string; label: string; hint?: string }[];
  onLap: (v: string) => void;
}) {
  const diff = info && vs ? info.timeMs - vs.timeMs : null;
  const chevron = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
  return (
    <div className={`la-lap${info ? "" : " empty-lap"}`} style={{ borderColor: color }}>
      <Dropdown label={title} value={pairValue} options={anyLabel ? [{ value: "", label: anyLabel }, ...pairItems] : pairItems} onChange={onPair} className="la-lap-who">
        {info ? (
          <>
            <Helmet color={driver?.color ?? "#5b6578"} look={driver?.look} size={40} seed={driver?.id} />
            <span className="la-lap-text">
              <span className="la-lap-name"><i style={{ background: color }} />{driver?.name ?? "Guest"}{chevron}</span>
              <span className="muted" style={{ fontSize: 12 }}>{carName(info.car)} · {ago(info.at)}</span>
            </span>
          </>
        ) : (
          <span className="la-lap-name"><i style={{ background: color }} />Compare with another {w.lap}…</span>
        )}
      </Dropdown>
      {info && (
        <Dropdown label={cap(w.lap)} value={lapValue} options={lapOptions} onChange={onLap} className="la-lap-time">
          <span className="la-lap-kind">{lapValue === "best" ? "Fastest" : `Picked ${w.lap}`}{chevron}</span>
          <span className="mono la-lap-clock">{lapTime(info.timeMs)}</span>
          {diff !== null && (
            <span className="mono" style={{ fontSize: 12, color: diff > 0 ? BRAKE : diff < 0 ? THROTTLE : "var(--muted)" }} title="Against the comparison lap">
              {diff === 0 ? "same time" : <Signed text={`${diff > 0 ? "+" : "−"}${(Math.abs(diff) / 1000).toFixed(3)}`} />}
            </span>
          )}
        </Dropdown>
      )}
    </div>
  );
}

/** The part of the lap in view, as fractions of it. */
interface Span {
  lo: number;
  hi: number;
}

const WHOLE: Span = { lo: 0, hi: 1 };
/** The narrowest view: 2% of a lap. */
const MIN_SPAN = 0.02;
/** Gap chart scales, in seconds: the smallest that fits what's in view. */
const GAP_SCALES = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 60];
/** Replay speeds. */
const SPEEDS = [1, 2, 4] as const;
/** How far (px) a finger moves sideways before it counts as a swipe rather than a tap or a scroll. */
const SWIPE_PX = 8;

/**
 * `s` no narrower than MIN_SPAN nor wider than the lap. Normally kept inside the lap; `centred` lets
 * it run half its width past either end, so its centre (the reading point on a phone, and the car
 * during a replay) can reach the start and the finish.
 */
function clampSpan(s: Span, centred = false): Span {
  const w = Math.min(1, Math.max(MIN_SPAN, s.hi - s.lo));
  const lo = centred ? Math.min(1 - w / 2, Math.max(-w / 2, s.lo)) : w >= 1 ? 0 : Math.min(1 - w, Math.max(0, s.lo));
  return { lo, hi: lo + w };
}

/** A view of width `w` centred on `c`. */
const around = (c: number, w: number): Span => ({ lo: c - w / 2, hi: c + w / 2 });

/** Zoom by `factor` (<1 in, >1 out) keeping the point `at` where it is on screen. */
function zoomAt(s: Span, at: number, factor: number, centred = false): Span {
  const w = s.hi - s.lo;
  const nw = Math.min(1, Math.max(MIN_SPAN, w * factor));
  const f = (at - s.lo) / w;
  return clampSpan({ lo: at - f * nw, hi: at - f * nw + nw }, centred);
}

/** The points inside the view, plus one either side so lines run to the edges. */
function inView<T extends { p: number }>(pts: T[], s: Span): T[] {
  if (s.lo <= 0 && s.hi >= 1) return pts;
  let i = 0;
  while (i < pts.length && pts[i].p < s.lo) i++;
  let j = i;
  while (j < pts.length && pts[j].p <= s.hi) j++;
  return pts.slice(Math.max(0, i - 1), Math.min(pts.length, j + 1));
}

/**
 * Both laps on one 0..1 scale from the start line to the finish, pinned there: 0 s at the start and
 * the lap time at the finish. Games report progress a hair after the line on a circuit (and only
 * between about 2% and 95% of a rally stage), so the recorded span is stretched to fill it.
 */
function fit(a: Pt[], aTime: number, b: Pt[], bTime: number): [Pt[], Pt[]] {
  const laps = [a, b].filter((x) => x.length > 1);
  if (laps.length === 0) return [a, b];
  let lo = Math.min(...laps.map((x) => x[0].p));
  let hi = Math.max(...laps.map((x) => x[x.length - 1].p));
  if (lo < 0.01) lo = 0;
  if (hi > 0.99) hi = 1;
  const size = hi - lo || 1;
  const norm = (pts: Pt[], time: number) => {
    if (pts.length < 2) return pts;
    const out = pts.map((q) => ({ ...q, p: Math.min(1, Math.max(0, (q.p - lo) / size)) }));
    if (out[0].p > 0 || out[0].t > 0) out.unshift({ ...out[0], p: 0, t: 0 });
    const last = out[out.length - 1];
    if (last.p < 1) out.push({ ...last, p: 1, t: Math.max(last.t, time) });
    return out;
  };
  return [norm(a, aTime), norm(b, bTime)];
}

/** Where (0..1) a lap is after `t` ms. */
const progressAt = (pts: Pt[], t: number) => lookup(pts, "t", t, (q) => q.p);
/** How long (ms) a lap took to reach a point. */
const elapsedAt = (pts: Pt[], p: number) => lookup(pts, "p", Math.min(1, Math.max(0, p)), (q) => q.t);
const clamp01 = (p: number) => Math.min(1, Math.max(0, p));

/**
 * Stacked charts against distance through the lap, sharing one reading point and one zoom, with the
 * track map above them.
 *
 * With a mouse the reading point follows the pointer (press and drag to hold it). On a touch screen
 * it is fixed at the centre of the view, and a sideways swipe moves the lap under it: a tap or an
 * up-and-down scroll never moves it. Zoom with the dock under the charts, Ctrl/⌘ + wheel or a
 * trackpad pinch, or two fingers. A replay keeps the car at the centre when zoomed (always on a
 * touch screen) and the charts scroll under it; moving the view while it plays seeks the replay.
 */
function Traces({
  a: rawA,
  b: rawB,
  lapA,
  lapB,
  nameA,
  nameB,
  maxA,
  maxB,
  w,
  where,
  children,
  after,
}: {
  a: Pt[];
  b: Pt[];
  lapA: LapInfo;
  lapB: LapInfo | null;
  /** Who drove each lap, for telling them apart on the charts. */
  nameA: string;
  nameB: string;
  /** How far each aid goes on the car each lap was driven in. */
  maxA: AidsMax | null;
  maxB: AidsMax | null;
  w: Words;
  where: { game: string; track: string; layout: string };
  /** More of the page (the sector times), shown above the dock so the dock stays the page's last thing. */
  children?: ReactNode;
  /** What goes under those and the live cards, still above the dock (the sliding summary). */
  after?: ReactNode;
}) {
  const [a, b] = useMemo(() => fit(rawA, lapA.timeMs, rawB, lapB?.timeMs ?? 0), [rawA, rawB, lapA.timeMs, lapB?.timeMs]);
  const touch = useMemo(() => !!window.matchMedia?.("(pointer: coarse)").matches, []);
  const [cursor, setCursor] = useState<number | null>(null);
  const [span, setSpanRaw] = useState<Span>(WHOLE);
  const box = useRef<HTMLDivElement>(null);
  const hasB = b.length > 0;
  // Older laps, and games that don't give the car's heading, have no slip to show.
  const hasSlip = a.some((q) => q.slip !== null) || b.some((q) => q.slip !== null);
  const width = span.hi - span.lo;
  const zoomed = width < 0.999;
  const centre = (span.lo + span.hi) / 2;
  const X = (p: number) => ((p - span.lo) / width) * W;

  // Replay: one clock for both laps.
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = usePersistedState<(typeof SPEEDS)[number]>("analysis.speed", 1, (v) => SPEEDS.some((s) => s === v));
  const [clockMs, setClockMs] = useState(0);
  const clock = useRef({ last: 0, t: 0 });
  const length = Math.max(lapA.timeMs, hasB && lapB ? lapB.timeMs : 0);
  // The view is centred on the reading point on a touch screen, and on the car while a zoomed replay plays.
  const centred = touch || (playing && zoomed);

  const live = useRef({ span, playing, centred, a });
  live.current = { span, playing, centred, a };

  const seekTo = (ms: number) => {
    clock.current.t = Math.min(Math.max(ms, 0), length);
    setClockMs(clock.current.t);
  };
  /** Change the view. While a centred replay plays, that's also a seek: the car goes to the new centre. */
  const view = (s: Span) => {
    const cur = live.current;
    const next = clampSpan(s, cur.centred);
    setSpanRaw(next);
    if (cur.playing && cur.centred) seekTo(elapsedAt(cur.a, (next.lo + next.hi) / 2));
  };

  // A new lap starts on the whole of it, stopped.
  useEffect(() => {
    setSpanRaw(WHOLE);
    setPlaying(false);
    seekTo(0);
    setCursor(null);
  }, [lapA.id]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    clock.current.last = performance.now();
    const tick = (now: number) => {
      const dt = now - clock.current.last;
      clock.current.last = now;
      const next = Math.min(length, clock.current.t + dt * speed);
      clock.current.t = next;
      setClockMs(next);
      // Keep the car at the centre of a zoomed view: the charts scroll under it.
      const cur = live.current;
      if (cur.centred) {
        const c = progressAt(cur.a, next);
        setSpanRaw(clampSpan(around(c, cur.span.hi - cur.span.lo), true));
      }
      if (next >= length) {
        setCursor(progressAt(cur.a, next));
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, length]);

  /** The reading point: the car during a replay, else the view's centre on a touch screen, else the mouse. */
  const shown = playing ? progressAt(a, clockMs) : touch ? clamp01(centre) : cursor;

  const play = () => {
    if (playing) {
      setCursor(progressAt(a, clock.current.t));
      setPlaying(false);
      return;
    }
    const from = touch ? clamp01(centre) : cursor;
    if (clock.current.t >= length && from === null) seekTo(0);
    else if (from !== null && from < 0.999) seekTo(elapsedAt(a, from));
    else if (clock.current.t >= length) seekTo(0);
    setPlaying(true);
  };
  const restart = () => {
    seekTo(0);
    setCursor(0);
    if (touch || zoomed) setSpanRaw(clampSpan(around(0, width), true));
    setPlaying(true);
  };

  // Pointer → point on the lap, in the current view.
  const at = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    // Not laid out (zero width, e.g. mid-reload): no point to read.
    if (!r || r.width <= 0) return null;
    return span.lo + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * width;
  };

  // Gestures on the charts. A mouse reads where it points (pressing and dragging pauses a replay and
  // seeks it). A finger only acts once it clearly moves sideways: then it drags the lap under the
  // centre line. Up-and-down is left to the page (the browser cancels the gesture and scrolls).
  // Two fingers pinch to zoom, around the centre on a touch screen.
  const fingers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ id: number; x: number; y: number; span: Span; swiping: boolean } | null>(null);
  const pinch = useRef<{ dist: number; span: Span } | null>(null);
  const readAt = (clientX: number) => {
    const p = at(clientX);
    setCursor(p);
    if (p !== null && playing) setPlaying(false);
    if (p !== null) seekTo(elapsedAt(a, p));
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") {
      readAt(e.clientX);
      return;
    }
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.current.size === 2) {
      const [f1, f2] = [...fingers.current.values()];
      pinch.current = { dist: Math.abs(f1.x - f2.x) || 1, span };
      gesture.current = null;
    } else if (fingers.current.size === 1) {
      gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, span, swiping: false };
    }
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") {
      if (e.buttons) readAt(e.clientX);
      else if (!playing) setCursor(at(e.clientX));
      return;
    }
    if (!fingers.current.has(e.pointerId)) return;
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && fingers.current.size === 2) {
      const [f1, f2] = [...fingers.current.values()];
      const start = pinch.current;
      const nw = Math.min(1, Math.max(MIN_SPAN, (start.span.hi - start.span.lo) * (start.dist / (Math.abs(f1.x - f2.x) || 1))));
      const c = (start.span.lo + start.span.hi) / 2;
      view(around(c, nw));
      return;
    }
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.swiping) {
      if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy)) return;
      g.swiping = true;
    }
    const r = box.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return;
    const shift = (-dx / r.width) * (g.span.hi - g.span.lo);
    view({ lo: g.span.lo + shift, hi: g.span.hi + shift });
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    fingers.current.delete(e.pointerId);
    if (fingers.current.size < 2) pinch.current = null;
    if (gesture.current?.id === e.pointerId) gesture.current = null;
  };

  // Ctrl/⌘ + wheel (a trackpad pinch arrives as this) zooms on a PC; a sideways scroll pans when zoomed.
  // Plain wheel is left alone so the page still scrolls.
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const s = live.current.span;
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const p = live.current.centred ? (s.lo + s.hi) / 2 : s.lo + ((e.clientX - r.left) / r.width) * (s.hi - s.lo);
        viewRef.current(zoomAt(s, p, Math.exp(e.deltaY * 0.003), live.current.centred));
      } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && s.hi - s.lo < 0.999) {
        e.preventDefault();
        const d = (e.deltaX / r.width) * (s.hi - s.lo);
        viewRef.current({ lo: s.lo + d, hi: s.hi + d });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const topSpeed = Math.max(50, ...a.map((q) => q.speed), ...b.map((q) => q.speed));
  const speedMax = Math.ceil(topSpeed / 50) * 50;
  const gearMax = Math.max(4, ...a.map((q) => q.gear), ...b.map((q) => q.gear));

  // Time gap of lap A over lap B on a fixed grid through the lap (fixed, so zooming and panning only
  // reveal it, never resample it): positive = A behind. 0 at the start, the lap time difference at the finish.
  const delta = useMemo(() => {
    if (!hasB || a.length < 2) return [] as { p: number; t: number }[];
    return Array.from({ length: GRID + 1 }, (_, i) => {
      const p = i / GRID;
      return { p, t: elapsedAt(a, p) - elapsedAt(b, p) };
    });
  }, [a, b, hasB]);
  const deltaView = inView(delta, span);
  const deltaMax = Math.max(0, ...deltaView.map((x) => Math.abs(x.t) / 1000));
  const deltaScale = GAP_SCALES.find((s) => s >= deltaMax) ?? GAP_SCALES[GAP_SCALES.length - 1];

  // Where each sector of lap A ends, as a point on the lap, and the sectors as spans.
  const sectorMarks = useMemo(() => {
    let t = 0;
    return lapA.sectorsMs.slice(0, -1).map((s) => {
      t += s;
      return progressAt(a, t);
    });
  }, [a, lapA.sectorsMs]);
  const sectors: Span[] = [0, ...sectorMarks].map((lo, i) => ({ lo, hi: sectorMarks[i] ?? 1 }));

  const atA = shown !== null ? sampleAt(a, shown) : null;
  // Lap B at the same point of the lap (the charts compare the same corner).
  const atB = shown !== null && hasB ? sampleAt(b, shown) : null;
  const atDelta = shown !== null && delta.length ? lookup(delta as unknown as Pt[], "p", shown, (q) => q.t) : null;
  // The electronics at the reading point, or as the lap started when nothing is being read, so the panels don't come and go.
  const hasAids = a.some((q) => q.tc !== null) || b.some((q) => q.tc !== null);
  const refA = atA ?? a[0] ?? null;
  const refB = hasB ? (atB ?? b[0] ?? null) : null;
  const aidsA = aidsOf(refA, maxA);
  const aidsB = aidsOf(refB, maxB);

  // The lines are drawn once for the whole lap (x = how far through it × W) and the view slides and
  // stretches them as one piece (`onLap`). Redrawing them from the first point in view each time made
  // dashed lines' dashes crawl as the view moved: a dash pattern starts where its line starts.
  // With two laps the pedals get a chart each (their height), so they never lie over one another.
  const ph = hasB ? 56 : 80;
  const lines = useMemo(() => {
    const L = (p: number) => p * W;
    const py = (v: number) => ph - 2 - v * (ph - 6);
    const gy = (d: number) => 35 - Math.max(-1, Math.min(1, d / 1000 / deltaScale)) * 33;
    const gap = delta.map((x, i) => `${i ? "L" : "M"}${L(x.p).toFixed(2)} ${gy(x.t).toFixed(1)}`).join("");
    return {
      gap,
      gapFill: delta.length ? `${gap}L${W} 35L0 35Z` : "",
      speedA: path(a, L, (q) => 128 - (q.speed / speedMax) * 124),
      speedB: path(b, L, (q) => 128 - (q.speed / speedMax) * 124),
      thrA: path(a, L, (q) => py(q.throttle)),
      thrB: path(b, L, (q) => py(q.throttle)),
      brkA: path(a, L, (q) => py(q.brake)),
      brkB: path(b, L, (q) => py(q.brake)),
      steerA: path(a, L, (q) => 30 + q.steer * 28),
      steerB: path(b, L, (q) => 30 + q.steer * 28),
      gearA: path(a, L, (q) => 48 - (Math.max(0, q.gear) / gearMax) * 44, true),
      gearB: path(b, L, (q) => 48 - (Math.max(0, q.gear) / gearMax) * 44, true),
    };
  }, [a, b, delta, deltaScale, speedMax, gearMax, ph]);
  // Whole-lap drawing → the view: stretch by 1 / width, slide so the view's start is at the left edge.
  const onLap = (children: ReactNode) => <g transform={`translate(${(-span.lo / width) * W} 0) scale(${1 / width} 1)`}>{children}</g>;

  const marks = (h: number) => (
    <>
      {/* Before the start and after the finish (a centred view can show them): shaded. */}
      {span.lo < 0 && <rect x={0} y={0} width={X(0)} height={h} fill="var(--panel-2)" opacity="0.7" />}
      {span.hi > 1 && <rect x={X(1)} y={0} width={W - X(1)} height={h} fill="var(--panel-2)" opacity="0.7" />}
      {sectorMarks.map((p, i) => (
        <line key={i} x1={X(p)} x2={X(p)} y1={0} y2={h} stroke="var(--line)" strokeWidth="1" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
      ))}
      {shown !== null && <line x1={X(shown)} x2={X(shown)} y1={0} y2={h} stroke={touch ? "var(--text)" : "var(--text-2)"} strokeWidth={touch ? 1.5 : 1} vectorEffect="non-scaling-stroke" />}
    </>
  );
  const line = (d: string, color: string, dashed = false, width = 2) => (
    <path d={d} fill="none" stroke={color} strokeWidth={width} strokeDasharray={dashed ? "5 4" : undefined} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
  );
  const pct = (p: number) => `${Math.round(p * 100)}%`;
  // Where both laps are in time: the replay clock, else lap A's time at the reading point.
  const nowMs = playing ? clockMs : shown !== null ? elapsedAt(a, shown) : 0;
  // An axis label at a fraction across the charts: centred on it, or kept inside at either edge.
  const axisAt = (f: number) => ({ left: `${f * 100}%`, transform: f < 0.04 ? "none" : f > 0.96 ? "translateX(-100%)" : "translateX(-50%)" });
  const inside = (p: number, margin = 0.06) => p > span.lo + width * margin && p < span.hi - width * margin;

  return (
    <>
      <MiniMap
        where={where}
        w={w}
        a={a}
        b={hasB ? b : null}
        clockMs={nowMs}
        span={{ lo: clamp01(span.lo), hi: clamp01(span.hi) }}
        sectorMarks={sectorMarks}
      />

      <section className="card la-traces" aria-label={`${cap(w.lap)} traces`}>
        {/* Always the same cells, the same size: values change in place, dashes when there's nothing to read. */}
        <div className="la-readout" aria-live="off">
          <Read label={cap(w.lap)} value={shown !== null ? pct(shown) : null} chars={4} />
          <Read label="Speed" pair a={atA && `${Math.round(atA.speed)}`} b={hasB ? atB && `${Math.round(atB.speed)}` : undefined} chars={3} unit="km/h" />
          <Read label="Throttle" pair a={atA && `${Math.round(atA.throttle * 100)}`} b={hasB ? atB && `${Math.round(atB.throttle * 100)}` : undefined} chars={3} unit="%" />
          <Read label="Brake" pair a={atA && `${Math.round(atA.brake * 100)}`} b={hasB ? atB && `${Math.round(atB.brake * 100)}` : undefined} chars={3} unit="%" />
          <Read label="Gear" pair a={atA && gearText(atA.gear)} b={hasB ? atB && gearText(atB.gear) : undefined} chars={1} />
          {hasSlip && <Read label="Slip" pair a={atA && slipText(atA.slip)} b={hasB ? atB && slipText(atB.slip) : undefined} chars={4} unit="°" />}
          {hasB && (
            <Read
              label="Gap"
              value={atDelta !== null ? `${atDelta > 0 ? "+" : atDelta < 0 ? "−" : "±"}${(Math.abs(atDelta) / 1000).toFixed(3)}` : null}
              chars={7}
              color={atDelta !== null && atDelta > 0 ? BRAKE : THROTTLE}
            />
          )}
        </div>
        <span className="muted la-hint">
          {touch
            ? `Swipe sideways on the charts to move through the ${w.lap}. Pinch to zoom.`
            : `Point at the charts to read any part of the ${w.lap}. Ctrl + scroll (or pinch the trackpad) to zoom, double-click for the whole ${w.lap}.`}
        </span>

        <div
          ref={box}
          className={`la-charts${touch ? " touch" : ""}`}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse" && !playing && !e.buttons) setCursor(null);
          }}
          onDoubleClick={() => view(WHOLE)}
        >
          {hasB && (
            <Chart label="Gap" hint={`±${deltaScale}s · up = losing time`} h={70} what={w.lap}>
              <line x1={0} x2={W} y1={35} y2={35} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              {onLap(
                <>
                  <path d={lines.gapFill} fill={LAP_A} opacity="0.12" />
                  {line(lines.gap, LAP_A)}
                </>,
              )}
              {marks(70)}
            </Chart>
          )}
          <Chart label="Speed" hint={`0–${speedMax} km/h`} h={130} what={w.lap}>
            {onLap(
              <>
                {/* Grid lines belong to the lap too, so their dots move with it. */}
                {[0.25, 0.5, 0.75].map((f) => (
                  <line key={f} x1={0} x2={W} y1={130 * f} y2={130 * f} stroke="var(--line)" strokeWidth="1" strokeDasharray="2 5" vectorEffect="non-scaling-stroke" />
                ))}
                {hasB && line(lines.speedB, LAP_B, false, 1.5)}
                {line(lines.speedA, LAP_A)}
              </>,
            )}
            {marks(130)}
          </Chart>
          {hasB ? (
            <>
              {/* One chart per lap, each tagged with whose it is, rather than two laps' pedals lying over each other. */}
              <Chart label="Throttle & brake" hint="0–100%" h={ph} what={w.lap} tag={{ color: LAP_A, text: `This ${w.lap} · ${nameA}` }}>
                {onLap(<>{line(lines.thrA, THROTTLE)}{line(lines.brkA, BRAKE)}</>)}
                {marks(ph)}
              </Chart>
              <Chart label="Throttle & brake" hint="0–100%" h={ph} what={w.lap} tag={{ color: LAP_B, text: `Comparison · ${nameB}` }}>
                {onLap(<>{line(lines.thrB, THROTTLE)}{line(lines.brkB, BRAKE)}</>)}
                {marks(ph)}
              </Chart>
            </>
          ) : (
            <Chart label="Throttle & brake" hint="0–100%" h={ph} what={w.lap}>
              {onLap(<>{line(lines.thrA, THROTTLE)}{line(lines.brkA, BRAKE)}</>)}
              {marks(ph)}
            </Chart>
          )}
          <Chart label="Steering" hint="left ↑ · right ↓" h={60} what={w.lap}>
            <line x1={0} x2={W} y1={30} y2={30} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            {onLap(
              <>
                {hasB && line(lines.steerB, LAP_B, false, 1.2)}
                {line(lines.steerA, LAP_A)}
              </>,
            )}
            {marks(60)}
          </Chart>
          <Chart label="Gear" hint={`1–${gearMax}`} h={50} what={w.lap}>
            {onLap(
              <>
                {hasB && line(lines.gearB, LAP_B, false, 1.2)}
                {line(lines.gearA, LAP_A)}
              </>,
            )}
            {marks(50)}
          </Chart>
          <div className="la-axis" aria-hidden="true">
            {/* Start and finish where they are when in view, else how far through the lap each edge is. */}
            {span.lo <= 0 ? <span style={axisAt(X(0) / W)}>Start</span> : <span style={axisAt(0)}>{pct(span.lo)}</span>}
            {sectorMarks.map((p, i) => (inside(p) ? <span key={i} style={axisAt(X(p) / W)}>S{i + 2}</span> : null))}
            {span.hi >= 1 ? <span style={axisAt(X(1) / W)}>Finish</span> : <span style={axisAt(1)}>{pct(span.hi)}</span>}
          </div>
        </div>

        <div className="trace-key">
          <span><i style={{ background: LAP_A }} />This {w.lap} · {nameA}</span>
          {hasB && <span><i style={{ background: LAP_B }} />Comparison · {nameB}</span>}
          <span><i style={{ background: THROTTLE }} />Throttle</span>
          <span><i style={{ background: BRAKE }} />Brake</span>
        </div>

      </section>

      {children}

      {/* How each car points against where it is going, and its electronics, at the point being read on the charts. Down
          here under the sector times, so the charts and the map above keep the screen. */}
      {(hasSlip || hasAids) && (
        <section className="card la-live" aria-label="Slip and electronics at this point of the lap">
          <span className="label">At the point you're reading</span>
          {hasSlip && <SlipDial a={atA ? atA.slip : null} b={hasB ? (atB ? atB.slip : null) : undefined} nameA={nameA} nameB={nameB} />}
          {hasAids && (
            <div className="la-aids" aria-label="Electronics at this point of the lap">
              {aidsA && <ElectronicsGauges aids={aidsA} boost={refA ? refA.boost : null} tag={hasB ? { color: LAP_A, text: `This ${w.lap} · ${nameA}` } : undefined} />}
              {hasB && aidsB && <ElectronicsGauges aids={aidsB} boost={refB ? refB.boost : null} tag={{ color: LAP_B, text: `Comparison · ${nameB}` }} />}
            </div>
          )}
        </section>
      )}

      {after}

      {/* The dock: replay controls, zoom and the timeline strip. It's the page's last element and sticks
          to the bottom of the screen, so it's in reach from the map, the charts and the sector times. */}
      <div className="la-dock" role="group" aria-label={`Replay and ${w.lap} timeline`}>
        <div className="la-zoom">
          <div className="la-play">
            <button className="icon-btn la-play-main" onClick={play} aria-label={playing ? "Pause" : "Play"} aria-pressed={playing}>
              {playing ? PAUSE_ICON : PLAY_ICON}
            </button>
            <button className="icon-btn" onClick={restart} aria-label="Play from the start" title="From the start">
              {START_ICON}
            </button>
            <button
              className="icon-btn la-speed"
              onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}
              aria-label={`Replay speed ${speed}x, tap to change`}
              title="Replay speed"
            >
              {speed}×
            </button>
            <span className="mono la-clock">
              {nowMs > 0 ? lapTime(Math.floor(Math.min(nowMs, length))) : "0:00.000"}
              <span className="muted"> / {lapTime(length)}</span>
            </span>
          </div>
          <div className="la-zoom-btns" role="group" aria-label="Zoom">
            <button className="icon-btn" onClick={() => view(WHOLE)} disabled={!zoomed} aria-label={`Show the whole ${w.lap}`} title={`The whole ${w.lap}`}>
              {ALL_ICON}
            </button>
            <button className="icon-btn" onClick={() => view(zoomAt(span, centred ? centre : (shown ?? centre), 2, centred))} disabled={!zoomed} aria-label="Zoom out">−</button>
            <button className="icon-btn" onClick={() => view(zoomAt(span, centred ? centre : (shown ?? centre), 0.5, centred))} disabled={width <= MIN_SPAN + 1e-6} aria-label="Zoom in">+</button>
          </div>
        </div>
        <Overview pts={a} sectors={sectors} span={span} cursor={shown} onSpan={view} what={w.lap} />
      </div>
    </>
  );
}

const PLAY_ICON = <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z" /></svg>;
const PAUSE_ICON = <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>;
const START_ICON = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 5v14M19 6l-9 6 9 6z" /></svg>;
/** The whole lap: arrows out to both ends. */
const ALL_ICON = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4" /></svg>;

/** One colour per sector, used on the overview strip and the map. */
const SECTOR_COLORS = ["#7EA8FF", "#4fd39a", "#FFB86B", "#b79bff", "#FF7DB0", "#6FE0E8"];

/**
 * The whole lap as a thin speed line over its sectors (each tinted and labelled), with the part in
 * view outlined. Drag the outline to move along the lap, drag its edges to widen or narrow it, or tap
 * elsewhere to jump there.
 */
function Overview({ pts, sectors, span, cursor, onSpan, what }: { pts: Pt[]; sectors: Span[]; span: Span; cursor: number | null; onSpan: (s: Span) => void; what: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: "move" | "lo" | "hi"; from: number; span: Span } | null>(null);
  const top = Math.max(50, ...pts.map((q) => q.speed));
  const frac = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return r.width > 0 ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : 0.5;
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    const r = ref.current!.getBoundingClientRect();
    if (r.width <= 0) return; // not laid out: nothing to grab
    const p = frac(e.clientX);
    const edge = 14 / r.width; // a finger-sized grab zone around each edge
    let mode: "move" | "lo" | "hi" = "move";
    let from = span;
    if (Math.abs(p - span.lo) < edge) mode = "lo";
    else if (Math.abs(p - span.hi) < edge) mode = "hi";
    else if (p < span.lo || p > span.hi) {
      // Jump: centre the view where you tapped, then drag from there.
      const w = span.hi - span.lo;
      from = clampSpan({ lo: p - w / 2, hi: p + w / 2 });
      onSpan(from);
    }
    drag.current = { mode, from: p, span: from };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Not a live pointer (nothing to capture): dragging still works while it stays on the strip.
    }
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = frac(e.clientX);
    const dx = p - d.from;
    if (d.mode === "move") onSpan({ lo: d.span.lo + dx, hi: d.span.hi + dx });
    else if (d.mode === "lo") onSpan({ lo: Math.min(p, d.span.hi - MIN_SPAN), hi: d.span.hi });
    else onSpan({ lo: d.span.lo, hi: Math.max(p, d.span.lo + MIN_SPAN) });
  };
  const up = () => {
    drag.current = null;
  };
  return (
    <div
      ref={ref}
      className="la-overview"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      role="slider"
      aria-label={`Part of the ${what} in view`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(((span.lo + span.hi) / 2) * 100)}
      aria-valuetext={`${Math.round(span.lo * 100)}% to ${Math.round(span.hi * 100)}%`}
      tabIndex={0}
      onKeyDown={(e) => {
        const step = (span.hi - span.lo) * 0.25;
        if (e.key === "ArrowLeft") onSpan({ lo: span.lo - step, hi: span.hi - step });
        else if (e.key === "ArrowRight") onSpan({ lo: span.lo + step, hi: span.hi + step });
        else return;
        e.preventDefault();
      }}
    >
      {sectors.length > 1 &&
        sectors.map((s, i) => (
          <span key={i} className="la-ov-sector" style={{ left: `${s.lo * 100}%`, width: `${(s.hi - s.lo) * 100}%`, ["--c" as string]: SECTOR_COLORS[i % SECTOR_COLORS.length] }}>
            <b>S{i + 1}</b>
          </span>
        ))}
      <svg viewBox={`0 0 ${W} 36`} preserveAspectRatio="none" width="100%" height="36" aria-hidden="true">
        <path d={path(pts, (p) => p * W, (q) => 34 - (q.speed / top) * 26)} fill="none" stroke={LAP_A} strokeWidth="1.2" opacity="0.8" vectorEffect="non-scaling-stroke" />
        {cursor !== null && <line x1={cursor * W} x2={cursor * W} y1={0} y2={36} stroke="var(--text)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
      </svg>
      {/* Dimmed outside the view, an outlined window inside it. */}
      <span className="la-ov-shade" style={{ left: 0, width: `${span.lo * 100}%` }} />
      <span className="la-ov-shade" style={{ left: `${span.hi * 100}%`, right: 0 }} />
      <span className="la-ov-window" style={{ left: `${span.lo * 100}%`, width: `${(span.hi - span.lo) * 100}%` }}>
        <i className="lo" />
        <i className="hi" />
      </span>
    </div>
  );
}

/**
 * The track map with both cars where they are at the same moment of their laps, so the gap shows as
 * distance on track, and the part of the lap in view lit up. Play runs both laps from the line.
 */
function MiniMap({
  where,
  w,
  a,
  b,
  clockMs,
  span,
  sectorMarks,
}: {
  where: { game: string; track: string; layout: string };
  w: Words;
  a: Pt[];
  b: Pt[] | null;
  clockMs: number;
  span: Span;
  sectorMarks: number[];
}) {
  const maps = useTrackMaps(where.game);
  const found = findMap(maps, where.track, where.layout);
  // A map still being learned can have too few points to draw.
  const map = found && found.points.length >= 2 ? found : undefined;
  const pA = progressAt(a, clockMs);
  const pB = b ? progressAt(b, clockMs) : null;

  // The gap between the two cars: whoever is further round is in front, and the other is behind by
  // how long ago the front car was where it is now.
  const timeAt = (pts: Pt[], p: number) => lookup(pts, "p", p, (q) => q.t);
  const gapA = b && pB !== null && pB > pA ? Math.max(0, clockMs - timeAt(b, pA)) : 0;
  const gapB = b && pB !== null && pA > pB ? Math.max(0, clockMs - timeAt(a, pB)) : 0;

  // Light up the part in view; elsewhere dim. Sector ends are marked as dots by the map.
  const outline = useMemo(() => {
    const cuts = [...new Set([0, ...sectorMarks, span.lo, span.hi, 1].map((x) => Math.round(x * 10000) / 10000))].sort((x, y) => x - y);
    const colors = cuts.slice(0, -1).map((lo, i) => {
      const mid = (lo + cuts[i + 1]) / 2;
      return mid >= span.lo && mid <= span.hi ? "var(--peri-1)" : "#3A4270";
    });
    return { boundaries: cuts, colors };
  }, [sectorMarks.join(","), span.lo, span.hi]);

  // Zoom and turn the map as the viewer chose, following this lap's car.
  const mapView = useMapView();
  const carA = carAt(a, clockMs);
  const carB = b ? carAt(b, clockMs) : null;
  const outlineCamera = map ? cameraAt(map.points, map.closed, pA, mapView) : undefined;
  // Following the car means following where it really was, when the lap recorded that.
  const camera = outlineCamera && carA ? { ...outlineCamera, at: carA.position } : outlineCamera;

  return (
    <section className="card la-map" aria-label={`${cap(w.track)} map`}>
      {map ? (
        <div className="la-map-frame">
          {b && (
            <GapLadder
              cars={[
                { key: "b", color: LAP_B, name: "Comparison", gapMs: gapB },
                { key: "a", color: LAP_A, name: `This ${w.lap}`, gapMs: gapA },
              ]}
            />
          )}
          <div className="la-map-view">
            {/* The controls float over the top right; the map keeps the track clear of them. */}
            <MapViewControls view={mapView} />
            <TrackMap
              camera={camera}
              corner={{ w: 250, h: 48 }}
              points={map.points}
              rotate={map.rotate}
              mirror={map.mirror}
              closed={map.closed}
              stroke={3}
              label={`${cap(w.track)} map`}
              sectors={outline}
              markers={[
                { at: carB?.position ?? (b && pB !== null ? pointAlong(map.points, map.closed, pB) : null), heading: carB?.heading, color: LAP_B },
                { at: carA?.position ?? pointAlong(map.points, map.closed, pA), heading: carA?.heading, color: LAP_A },
              ].flatMap((m) => (m.at ? [{ position: m.at, heading: m.heading, color: m.color }] : []))}
            />
          </div>
        </div>
      ) : (
        <div className="empty" style={{ minHeight: 0 }}>Bin It hasn't learned this {w.track}'s map yet.</div>
      )}
    </section>
  );
}

function Chart({ label, hint, h, what, tag, children }: { label: string; hint: string; h: number; what: string; /** Whose lap this chart shows, when two charts show the same thing for two laps. */ tag?: { color: string; text: string }; children: ReactNode }) {
  return (
    <div className={`la-chart${tag ? " tagged" : ""}`} style={tag ? ({ "--tag": tag.color } as CSSProperties) : undefined}>
      <div className="la-chart-head">
        <span className="label">{label}</span>
        {tag && <span className="la-tag" style={{ color: tag.color }}><i style={{ background: tag.color }} />{tag.text}</span>}
        <span className="muted">{hint}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" width="100%" height={h} role="img" aria-label={`${label} through the ${what}`}>
        {children}
      </svg>
    </div>
  );
}

/**
 * One reading under the charts. Each value has a fixed width in characters (`chars`) and is right
 * aligned in it, so nothing shifts as the numbers change; with nothing to read it shows a dash.
 */
function Read({ label, value, a, b, chars, unit, color, pair = false }: { label: string; value?: string | null; a?: string | null; b?: string | null; chars: number; unit?: string; color?: string; pair?: boolean }) {
  // This lap's number is right aligned against the "/", the comparison's left aligned after it.
  const cell = (text: string | null | undefined, c?: string, align: "right" | "left" = "right") => (
    <span className="la-v" style={{ width: `${chars}ch`, textAlign: align, color: text ? c : "var(--muted)" }}>{text ? <Signed text={text} /> : "–"}</span>
  );
  return (
    <div className="la-read">
      {/* The unit sits with the label, so the numbers keep the whole width. */}
      <span className="label">
        {label}
        {unit && <small> {unit}</small>}
      </span>
      <span className="mono">
        {pair && b !== undefined ? (
          <>
            {cell(a, LAP_A)}
            <span className="la-sep">/</span>
            {cell(b, LAP_B, "left")}
          </>
        ) : (
          cell(pair ? a : value, pair ? LAP_A : color, "left")
        )}
      </span>
    </div>
  );
}

function gearText(g: number): string {
  return g < 0 ? "R" : g === 0 ? "N" : String(g);
}

/** The aids a lap had set at one of its samples, with how far each goes on that car; null when the lap didn't record them. */
function aidsOf(pt: Pt | null, max: AidsMax | null): LiveAids | null {
  if (!pt || !max || pt.tc === null || pt.abs === null || pt.bias === null || pt.diffP === null || pt.diffC === null) return null;
  return {
    tcLevel: pt.tc,
    tcMax: max.tcMax,
    absLevel: pt.abs,
    absMax: max.absMax,
    brakeBias: pt.bias,
    biasMin: max.biasMin,
    biasMax: max.biasMax,
    diffPowerLevel: pt.diffP,
    diffPowerMax: max.diffPowerMax,
    diffCoastLevel: pt.diffC,
    diffCoastMax: max.diffCoastMax,
    pitLimiter: !!pt.limiter,
  };
}

/** A slip angle for a readout: signed whole degrees, or nothing when the lap has none. */
function slipText(slip: number | null): string | null {
  if (slip === null) return null;
  const n = Math.round(slip);
  return n > 0 ? `+${n}` : String(n);
}

/** "23° right", "4° left", "0°". */
function slipWords(slip: number | null | undefined): string {
  if (slip === null || slip === undefined) return "–";
  const n = Math.round(slip);
  return `${Math.abs(n)}°${n === 0 ? "" : n > 0 ? " right" : " left"}`;
}

/**
 * How each car points against where it is going. Up is the direction of travel, so a car going where it points has its arrow
 * straight up; one with its nose turned to the right of its path (the tail stepping out the other way) has its arrow turned
 * right, and left the other way. Round the full circle for a spin. The comparison's arrow is the smaller one.
 */
function SlipDial({ a, b, nameA, nameB }: { a: number | null; b?: number | null; nameA: string; nameB: string }) {
  const arrow = (slip: number | null, color: string, len: number) =>
    slip === null ? null : (
      <g transform={`translate(50 50) rotate(${Math.max(-180, Math.min(180, slip))})`}>
        <polygon
          points={`0,${-len} ${len * 0.28},${len * 0.32} 0,${len * 0.12} ${-len * 0.28},${len * 0.32}`}
          fill={color}
          stroke="#fff"
          strokeWidth="1.2"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </g>
    );
  return (
    <div className="la-slip" role="group" aria-label="Slip angle against the direction of travel">
      <svg viewBox="0 0 100 100" width="104" height="104" aria-hidden="true">
        <circle cx="50" cy="50" r="44" fill="none" stroke="var(--line)" strokeWidth="2" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((d) => (
          <line key={d} x1="50" y1="7" x2="50" y2={d % 90 === 0 ? 14 : 11} stroke="var(--line)" strokeWidth="2" transform={`rotate(${d} 50 50)`} />
        ))}
        {/* The direction of travel: straight up. */}
        <line x1="50" y1="50" x2="50" y2="12" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="3 3" />
        {arrow(a, LAP_A, 36)}
        {b !== undefined && arrow(b, LAP_B, 27)}
      </svg>
      <div className="la-slip-text">
        <span className="label">Slip against the direction of travel</span>
        <span><b style={{ color: LAP_A }}>●</b> {nameA} <span className="mono">{slipWords(a)}</span></span>
        {b !== undefined && <span><b style={{ color: LAP_B }}>●</b> {nameB} <span className="mono">{slipWords(b)}</span></span>}
        <span className="muted" style={{ fontSize: 12 }}>Up is the way the car is going. An arrow turned right has its nose pointing right of that.</span>
      </div>
    </div>
  );
}

/** Each sector of the two laps side by side. */
function Sectors({ a, b, rally }: { a: LapInfo; b: LapInfo; rally: boolean }) {
  // Rally games call them splits.
  const title = rally ? "Splits" : "Sectors";
  return (
    <section className="card" aria-label={title}>
      <h2 style={{ marginBottom: 12 }}>{title}</h2>
      <div className="la-sectors">
        {a.sectorsMs.map((s, i) => {
          const d = s - b.sectorsMs[i];
          return (
            <div key={i} className="la-sector">
              <span className="label">S{i + 1}</span>
              <span className="mono" style={{ color: LAP_A }}>{lapTime(s).replace(/^0:/, "")}</span>
              <span className="mono" style={{ color: LAP_B, fontSize: 13 }}>{lapTime(b.sectorsMs[i]).replace(/^0:/, "")}</span>
              <span className="mono" style={{ fontSize: 13, color: d > 0 ? BRAKE : d < 0 ? THROTTLE : "var(--muted)" }}>
                {d === 0 ? "—" : <Signed text={`${d > 0 ? "+" : "−"}${(Math.abs(d) / 1000).toFixed(3)}`} />}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
