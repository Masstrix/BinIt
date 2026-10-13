import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { api, useAppState, useFetch, type Driver } from "../api";
import { ago, carName, LAP_BADGE, lapKind, lapTime } from "../format";
import { Helmet } from "./Helmet";
import { Picker, type PickerItem } from "./Picker";
import { TrackFilters, trackKey, useTrackSelection } from "./TrackFilters";

const THROTTLE = "#4BE3A6";
const BRAKE = "#FF6B8A";
const LAP_A = "#A9AEFF";
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
function parseTrace(rows: number[][] | undefined): Pt[] {
  if (!rows) return [];
  const out: Pt[] = [];
  let max = -1;
  for (const [p, t, speed, throttle, brake, , steer, gear] of rows) {
    if (out.length === 0 && p > 0.5) continue;
    if (p < max) continue;
    max = p;
    out.push({ p, t, speed, throttle, brake, steer, gear });
  }
  return out;
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

/** The sample nearest to a point on the lap. */
function nearest(pts: Pt[], p: number): Pt | null {
  if (pts.length === 0) return null;
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].p <= p) lo = mid;
    else hi = mid;
  }
  return Math.abs(pts[lo].p - p) <= Math.abs(pts[hi].p - p) ? pts[lo] : pts[hi];
}

const W = 1000;
const STEPS = 400;

/** An SVG path through the points, `y` already in the chart's 0..h. */
function path(pts: Pt[], y: (q: Pt) => number, step = false): string {
  let d = "";
  let prevY = 0;
  pts.forEach((q, i) => {
    const x = (q.p * W).toFixed(1);
    const yy = y(q);
    if (i === 0) d += `M${x} ${yy.toFixed(1)}`;
    else if (step && yy !== prevY) d += `H${x}V${yy.toFixed(1)}`;
    else if (!step) d += `L${x} ${yy.toFixed(1)}`;
    prevY = yy;
  });
  if (step && pts.length) d += `H${(pts[pts.length - 1].p * W).toFixed(1)}`;
  return d;
}

/** Driver name, falling back to "Guest" for unclaimed laps. */
function who(drivers: Driver[], id: number | null): Driver | undefined {
  return id == null ? undefined : drivers.find((d) => d.id === id);
}

/** A lap the page can show, from the recent-laps list or the leaderboard. */
interface Candidate extends LapInfo {
  game: string;
  track: string;
  layout: string;
  /** A valid, timed lap (not cut, out, in...). */
  timed: boolean;
  /** Shown small on its card: "P1 best", "CUT"... */
  note?: string;
}

/**
 * A recorded lap on the track picked above (the same pick as the Leaderboard), drawn as speed,
 * pedals, steering and gear around the lap. By default it is laid over the fastest lap in the same
 * car, with the running time gap, so you can see where time goes. Drag (or hover) across the charts
 * to read any point. `lapId` comes from the address (#/telemetry/lap/<id>), so a leaderboard row can link here.
 */
export function LapAnalysis({ lapId }: { lapId: number | null }) {
  const { drivers } = useAppState();
  const sel = useTrackSelection();
  const { selected, car } = sel;
  const recent = useFetch(() => api.recentLaps(200), []);
  const q = selected && { game: selected.game, track: selected.track, layout: selected.layout, car };
  const deps = [selected && trackKey(selected), car];
  // Each driver's best here (cut laps too, so any leaderboard row can be opened), and the valid board for "fastest".
  const bests = useFetch(q ? () => api.leaderboard({ ...q, includeInvalid: true }) : null, deps);
  const board = useFetch(q ? () => api.leaderboard({ ...q, includeInvalid: false }) : null, deps);
  const [compare, setCompare] = useState<string>("best");

  // A linked lap on another track moves the track pick to it.
  const linked = lapId != null ? (recent ?? []).find((l) => l.id === lapId) : undefined;
  useEffect(() => {
    if (linked && selected && trackKey(linked) !== trackKey(selected)) sel.chooseTrack(trackKey(linked));
  }, [linked?.id, selected && trackKey(selected)]);

  const candidates = useMemo(() => {
    const out = new Map<number, Candidate>();
    if (!selected) return out;
    for (const l of recent ?? []) {
      if (trackKey(l) !== trackKey(selected) || (car && l.car !== car)) continue;
      // Only full laps carry a trace.
      if (l.timeMs <= 0 || l.untimedReason === "partial" || l.untimedReason === "outLap") continue;
      const kind = lapKind(l);
      out.set(l.id, { id: l.id, driverId: l.driverId, timeMs: l.timeMs, sectorsMs: l.sectorsMs, at: l.recordedAt, car: l.car, game: l.game, track: l.track, layout: l.layout, timed: kind === "timed", note: kind === "timed" ? undefined : LAP_BADGE[kind].text });
    }
    const valid = new Set((board ?? []).map((e) => e.lapId));
    for (const e of bests ?? []) {
      const known = out.get(e.lapId);
      const base = known ?? { id: e.lapId, driverId: e.driverId, timeMs: e.timeMs, sectorsMs: e.sectorsMs, at: e.setAt, car: e.car, game: selected.game, track: selected.track, layout: selected.layout, timed: valid.has(e.lapId) };
      out.set(e.lapId, { ...base, note: base.timed ? `P${e.position} best` : base.note });
    }
    return out;
  }, [recent, bests, board, selected && trackKey(selected), car]);

  const byRecent = [...candidates.values()].sort((x, y) => y.at - x.at);
  const lap = (lapId != null ? candidates.get(lapId) : undefined) ?? byRecent[0] ?? null;
  // "Fastest": the quickest valid lap in the same car that isn't this one. Another driver's best from the
  // board, else (when this is the only driver's best) the quickest other valid lap in the list.
  const fromBoard = (board ?? []).find((e) => e.lapId !== lap?.id && e.car === lap?.car);
  const fastest: LapInfo | null = fromBoard
    ? { id: fromBoard.lapId, driverId: fromBoard.driverId, timeMs: fromBoard.timeMs, sectorsMs: fromBoard.sectorsMs, at: fromBoard.setAt, car: fromBoard.car }
    : (byRecent.filter((c) => c.id !== lap?.id && c.car === lap?.car && c.timed).sort((x, y) => x.timeMs - y.timeMs)[0] ?? null);
  const other: LapInfo | null = !lap || compare === "" ? null : compare === "best" ? fastest : (candidates.get(Number(compare)) ?? null);

  const traceA = useFetch(lap ? () => api.lapTrace(lap.id) : null, [lap?.id]);
  const traceB = useFetch(other ? () => api.lapTrace(other.id) : null, [other?.id]);
  const a = useMemo(() => parseTrace(traceA?.points), [traceA]);
  const b = useMemo(() => parseTrace(traceB?.points), [traceB]);

  const name = (id: number | null) => who(drivers, id)?.name ?? "Guest";
  const item = (c: Candidate): PickerItem => ({
    value: String(c.id),
    label: `${lapTime(c.timeMs)} · ${name(c.driverId)}`,
    sub: `${carName(c.car)} · ${ago(c.at)}`,
    note: c.note,
    search: name(c.driverId),
  });
  const pickLap = (v: string) => {
    location.hash = `#/telemetry/lap/${v}`;
    setCompare("best");
  };

  if (sel.tracks.length === 0) return <div className="empty">{recent === null ? "Loading laps…" : "No laps recorded yet. Once someone sets a lap, you can look through it here."}</div>;

  const compareItems: PickerItem[] = [
    ...(fastest ? [{ value: "best", label: `Fastest: ${lapTime(fastest.timeMs)} · ${name(fastest.driverId)}`, sub: `Best valid lap in the ${carName(fastest.car)}` }] : []),
    ...byRecent.filter((c) => c.id !== lap?.id).map(item),
  ];
  const compareValue = compare === "best" && !fastest ? "" : compare;

  return (
    <>
      <TrackFilters sel={sel} />
      {!lap ? (
        <div className="empty">{recent === null || bests === null ? "Loading laps…" : "No full laps here with this car yet."}</div>
      ) : (
        <>
          <section className="card la-pick" aria-label="Choose laps">
            <div className="la-pickers">
              <Picker label="Lap" title="Choose a lap" value={String(lap.id)} items={byRecent.map(item)} onChange={pickLap} />
              <Picker label="Compare with" title="Compare with" value={compareValue} items={compareItems} onChange={setCompare} anyLabel="No comparison" />
            </div>
            <div className="la-laps">
              <LapCard info={lap} color={LAP_A} driver={who(drivers, lap.driverId)} vs={other ?? undefined} />
              {other && <LapCard info={other} color={LAP_B} driver={who(drivers, other.driverId)} />}
            </div>
          </section>

          {traceA === null ? (
            <div className="empty">This lap has no input recording (the game didn't send it, or it was recorded before Bin It kept them).</div>
          ) : (
            <Traces a={a} b={other && traceB ? b : []} lapA={lap} />
          )}

          {other && lap.sectorsMs.length > 0 && other.sectorsMs.length === lap.sectorsMs.length && <Sectors a={lap} b={other} />}
        </>
      )}
    </>
  );
}

function LapCard({ info, color, driver, vs }: { info: LapInfo; color: string; driver?: Driver; vs?: LapInfo }) {
  const diff = vs ? info.timeMs - vs.timeMs : null;
  return (
    <div className="la-lap" style={{ borderColor: color }}>
      <Helmet color={driver?.color ?? "#5B6488"} size={40} seed={driver?.id} />
      <div className="la-lap-text">
        <span className="la-lap-name"><i style={{ background: color }} />{driver?.name ?? "Guest"}</span>
        <span className="muted" style={{ fontSize: 12 }}>{carName(info.car)} · {ago(info.at)}</span>
      </div>
      <div className="la-lap-time">
        <span className="mono">{lapTime(info.timeMs)}</span>
        {diff !== null && <span className="mono" style={{ fontSize: 12, color: diff > 0 ? BRAKE : diff < 0 ? THROTTLE : "var(--muted)" }} title="Against the comparison lap">{diff === 0 ? "same time" : `${diff > 0 ? "+" : "−"}${(Math.abs(diff) / 1000).toFixed(3)}`}</span>}
      </div>
    </div>
  );
}

/** Stacked charts against distance around the lap, sharing one cursor. */
function Traces({ a, b, lapA }: { a: Pt[]; b: Pt[]; lapA: LapInfo }) {
  const [cursor, setCursor] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const hasB = b.length > 0;

  const topSpeed = Math.max(50, ...a.map((q) => q.speed), ...b.map((q) => q.speed));
  const speedMax = Math.ceil(topSpeed / 50) * 50;
  const gearMax = Math.max(4, ...a.map((q) => q.gear), ...b.map((q) => q.gear));

  // Time gap of lap A over lap B at each point of the lap: positive = A behind.
  const delta = useMemo(() => {
    if (!hasB || a.length < 2) return [] as { p: number; d: number }[];
    const start = Math.max(a[0].p, b[0].p);
    const end = Math.min(a[a.length - 1].p, b[b.length - 1].p);
    const out: { p: number; d: number }[] = [];
    for (let i = 0; i <= STEPS; i++) {
      const p = start + ((end - start) * i) / STEPS;
      out.push({ p, d: lookup(a, "p", p, (q) => q.t) - lookup(b, "p", p, (q) => q.t) });
    }
    return out;
  }, [a, b, hasB]);
  const deltaMax = Math.max(0.2, ...delta.map((x) => Math.abs(x.d) / 1000));
  const deltaScale = deltaMax > 2 ? Math.ceil(deltaMax) : Math.ceil(deltaMax * 5) / 5;

  // Where each sector of lap A ends, as a point on the lap.
  const sectorMarks = useMemo(() => {
    let t = 0;
    return lapA.sectorsMs.slice(0, -1).map((s) => {
      t += s;
      return lookup(a, "t", t, (q) => q.p);
    });
  }, [a, lapA.sectorsMs]);

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    setCursor(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  };

  const atA = cursor !== null ? nearest(a, cursor) : null;
  const atB = cursor !== null && hasB ? nearest(b, cursor) : null;
  const atDelta = cursor !== null && delta.length ? lookup(delta.map((x) => ({ p: x.p, t: x.d }) as Pt), "p", cursor, (q) => q.t) : null;

  const marks = (h: number) => (
    <>
      {sectorMarks.map((p, i) => (
        <line key={i} x1={p * W} x2={p * W} y1={0} y2={h} stroke="var(--line)" strokeWidth="1" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
      ))}
      {cursor !== null && <line x1={cursor * W} x2={cursor * W} y1={0} y2={h} stroke="var(--text-2)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
    </>
  );
  const line = (d: string, color: string, dashed = false, width = 2) => (
    <path d={d} fill="none" stroke={color} strokeWidth={width} strokeDasharray={dashed ? "5 4" : undefined} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
  );

  return (
    <section className="card la-traces" aria-label="Lap traces">
      <div className="la-readout" aria-live="off">
        {cursor === null ? (
          <span className="muted">Drag across the charts to read any point of the lap.</span>
        ) : (
          <>
            <Read label="Lap" value={`${Math.round(cursor * 100)}%`} />
            <Read label="Speed" a={atA && `${Math.round(atA.speed)}`} b={atB && `${Math.round(atB.speed)}`} unit="km/h" />
            <Read label="Throttle" a={atA && `${Math.round(atA.throttle * 100)}`} b={atB && `${Math.round(atB.throttle * 100)}`} unit="%" />
            <Read label="Brake" a={atA && `${Math.round(atA.brake * 100)}`} b={atB && `${Math.round(atB.brake * 100)}`} unit="%" />
            <Read label="Gear" a={atA && gearText(atA.gear)} b={atB && gearText(atB.gear)} />
            {atDelta !== null && (
              <Read label="Gap" value={`${atDelta > 0 ? "+" : atDelta < 0 ? "−" : ""}${(Math.abs(atDelta) / 1000).toFixed(3)}`} color={atDelta > 0 ? BRAKE : THROTTLE} />
            )}
          </>
        )}
      </div>

      <div
        ref={box}
        className="la-charts"
        onPointerMove={move}
        onPointerDown={move}
        onPointerLeave={(e) => e.pointerType === "mouse" && setCursor(null)}
      >
        {hasB && (
          <Chart label="Gap" hint={`±${deltaScale}s · up = losing time`} h={70}>
            <line x1={0} x2={W} y1={35} y2={35} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            {(() => {
              const y = (d: number) => 35 - Math.max(-1, Math.min(1, d / 1000 / deltaScale)) * 33;
              const d = delta.map((x, i) => `${i ? "L" : "M"}${(x.p * W).toFixed(1)} ${y(x.d).toFixed(1)}`).join("");
              const fill = delta.length ? `${d}L${(delta[delta.length - 1].p * W).toFixed(1)} 35L${(delta[0].p * W).toFixed(1)} 35Z` : "";
              return (
                <>
                  <path d={fill} fill={LAP_A} opacity="0.12" />
                  {line(d, LAP_A)}
                </>
              );
            })()}
            {marks(70)}
          </Chart>
        )}
        <Chart label="Speed" hint={`0–${speedMax} km/h`} h={130}>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={0} x2={W} y1={130 * f} y2={130 * f} stroke="var(--line)" strokeWidth="1" strokeDasharray="2 5" vectorEffect="non-scaling-stroke" />
          ))}
          {hasB && line(path(b, (q) => 128 - (q.speed / speedMax) * 124), LAP_B, false, 1.5)}
          {line(path(a, (q) => 128 - (q.speed / speedMax) * 124), LAP_A)}
          {marks(130)}
        </Chart>
        <Chart label="Throttle & brake" hint="0–100%" h={80}>
          {hasB && line(path(b, (q) => 78 - q.throttle * 74), THROTTLE, true, 1.2)}
          {hasB && line(path(b, (q) => 78 - q.brake * 74), BRAKE, true, 1.2)}
          {line(path(a, (q) => 78 - q.throttle * 74), THROTTLE)}
          {line(path(a, (q) => 78 - q.brake * 74), BRAKE)}
          {marks(80)}
        </Chart>
        <Chart label="Steering" hint="left ↑ · right ↓" h={60}>
          <line x1={0} x2={W} y1={30} y2={30} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {hasB && line(path(b, (q) => 30 + q.steer * 28), LAP_B, false, 1.2)}
          {line(path(a, (q) => 30 + q.steer * 28), LAP_A)}
          {marks(60)}
        </Chart>
        <Chart label="Gear" hint={`1–${gearMax}`} h={50}>
          {hasB && line(path(b, (q) => 48 - (Math.max(0, q.gear) / gearMax) * 44, true), LAP_B, false, 1.2)}
          {line(path(a, (q) => 48 - (Math.max(0, q.gear) / gearMax) * 44, true), LAP_A)}
          {marks(50)}
        </Chart>
        <div className="la-axis" aria-hidden="true">
          <span>Start</span>
          {sectorMarks.map((p, i) => (
            <span key={i} style={{ left: `${p * 100}%` }}>S{i + 2}</span>
          ))}
          <span>Finish</span>
        </div>
      </div>

      <div className="trace-key">
        <span><i style={{ background: LAP_A }} />This lap</span>
        {hasB && <span><i style={{ background: LAP_B }} />Comparison (dashed pedals)</span>}
        <span><i style={{ background: THROTTLE }} />Throttle</span>
        <span><i style={{ background: BRAKE }} />Brake</span>
      </div>
    </section>
  );
}

function Chart({ label, hint, h, children }: { label: string; hint: string; h: number; children: ReactNode }) {
  return (
    <div className="la-chart">
      <div className="la-chart-head">
        <span className="label">{label}</span>
        <span className="muted">{hint}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" width="100%" height={h} role="img" aria-label={`${label} through the lap`}>
        {children}
      </svg>
    </div>
  );
}

function Read({ label, value, a, b, unit, color }: { label: string; value?: string; a?: string | null; b?: string | null; unit?: string; color?: string }) {
  return (
    <div className="la-read">
      <span className="label">{label}</span>
      {value !== undefined ? (
        <span className="mono" style={{ color }}>{value}</span>
      ) : (
        <span className="mono">
          <span style={{ color: LAP_A }}>{a ?? "–"}</span>
          {b != null && <span style={{ color: LAP_B }}> / {b}</span>}
          {unit && <small> {unit}</small>}
        </span>
      )}
    </div>
  );
}

function gearText(g: number): string {
  return g < 0 ? "R" : g === 0 ? "N" : String(g);
}

/** Each sector of the two laps side by side. */
function Sectors({ a, b }: { a: LapInfo; b: LapInfo }) {
  return (
    <section className="card" aria-label="Sectors">
      <h2 style={{ marginBottom: 12 }}>Sectors</h2>
      <div className="la-sectors">
        {a.sectorsMs.map((s, i) => {
          const d = s - b.sectorsMs[i];
          return (
            <div key={i} className="la-sector">
              <span className="label">S{i + 1}</span>
              <span className="mono" style={{ color: LAP_A }}>{lapTime(s).replace(/^0:/, "")}</span>
              <span className="mono" style={{ color: LAP_B, fontSize: 13 }}>{lapTime(b.sectorsMs[i]).replace(/^0:/, "")}</span>
              <span className="mono" style={{ fontSize: 13, color: d > 0 ? BRAKE : d < 0 ? THROTTLE : "var(--muted)" }}>
                {d === 0 ? "—" : `${d > 0 ? "+" : "−"}${(Math.abs(d) / 1000).toFixed(3)}`}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
