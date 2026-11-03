import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, useAppState, useFetch, type DriverId, type LapSummary } from "../api";
import { Dropdown } from "../components/Dropdown";
import { GameIcon } from "../components/GameIcon";
import { Helmet } from "../components/Helmet";
import { carName, gameName, km, spanText, trackName } from "../format";

// ---- the numbers ------------------------------------------------------------------------------------

/** A lap that counts: a timed lap or a cut one. Out, in and partial laps aren't laps a driver chose to drive. */
export const isAttempt = (l: LapSummary) => l.valid || l.untimedReason === null || l.untimedReason === "cut";
const isClean = (l: LapSummary) => l.valid && l.untimedReason === null;

export interface Totals {
  laps: number;
  clean: number;
  cut: number;
  timeMs: number;
  distanceM: number;
  /** Time over the laps that have a distance, for an honest average speed. */
  timeWithDistanceMs: number;
  topKmh: number | null;
  spins: number;
  drifts: number;
  /** Laps whose spins are known. */
  physicsLaps: number;
}

export function totals(laps: LapSummary[]): Totals {
  const t: Totals = { laps: 0, clean: 0, cut: 0, timeMs: 0, distanceM: 0, timeWithDistanceMs: 0, topKmh: null, spins: 0, drifts: 0, physicsLaps: 0 };
  for (const l of laps) {
    if (!isAttempt(l)) continue;
    t.laps++;
    if (isClean(l)) t.clean++;
    else t.cut++;
    t.timeMs += l.timeMs;
    if (l.distanceM != null) {
      t.distanceM += l.distanceM;
      t.timeWithDistanceMs += l.timeMs;
    }
    if (l.topKmh != null) t.topKmh = Math.max(t.topKmh ?? 0, l.topKmh);
    if (l.spins != null) {
      t.physicsLaps++;
      t.spins += l.spins;
      t.drifts += l.drifts ?? 0;
    }
  }
  return t;
}

export const avgKmh = (t: Totals) => (t.timeWithDistanceMs > 0 ? t.distanceM / 1000 / (t.timeWithDistanceMs / 3_600_000) : null);
/** Spins per 10 laps, over laps where spins are known. */
export const spinRate = (t: Totals) => (t.physicsLaps > 0 ? (t.spins / t.physicsLaps) * 10 : null);
export const cleanPct = (t: Totals) => (t.laps > 0 ? Math.round((t.clean / t.laps) * 100) : null);

export type Range = "7" | "30" | "90" | "all";
const RANGES: { key: Range; label: string }[] = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "all", label: "All time" },
];

export type Unit = "day" | "week" | "month";
const DAY = 86_400_000;

function bucketStart(ms: number, unit: Unit): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  if (unit === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  if (unit === "month") d.setDate(1);
  return d.getTime();
}

function nextBucket(start: number, unit: Unit): number {
  const d = new Date(start);
  if (unit === "day") d.setDate(d.getDate() + 1);
  else if (unit === "week") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d.getTime();
}

export function bucketLabel(start: number, unit: Unit, long = false): string {
  const d = new Date(start);
  if (unit === "month") return d.toLocaleDateString(undefined, { month: long ? "long" : "short", year: "numeric" });
  const day = d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return unit === "week" ? (long ? `Week of ${day}` : day) : long ? d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : day;
}

export interface Bucket {
  start: number;
  t: Totals;
}

/** Laps grouped into days, weeks or months (whichever keeps the chart readable), with empty ones filled in. */
export function buckets(laps: LapSummary[], from: number, to: number): { unit: Unit; list: Bucket[] } {
  const span = to - from;
  const unit: Unit = span <= 31 * DAY ? "day" : span <= 26 * 7 * DAY ? "week" : "month";
  const groups = new Map<number, LapSummary[]>();
  for (const l of laps) {
    const s = bucketStart(l.recordedAt, unit);
    groups.set(s, [...(groups.get(s) ?? []), l]);
  }
  const list: Bucket[] = [];
  for (let s = bucketStart(from, unit); s <= to; s = nextBucket(s, unit)) list.push({ start: s, t: totals(groups.get(s) ?? []) });
  return { unit, list };
}

interface ComboRow {
  key: string;
  game: string;
  track: string;
  layout: string;
  car: string;
  t: Totals;
  lastAt: number;
}

function byCombo(laps: LapSummary[]): ComboRow[] {
  const m = new Map<string, { row: Omit<ComboRow, "t">; laps: LapSummary[] }>();
  for (const l of laps) {
    if (!isAttempt(l)) continue;
    const key = `${l.game}|${l.track}|${l.layout}|${l.car}`;
    const e = m.get(key) ?? { row: { key, game: l.game, track: l.track, layout: l.layout, car: l.car, lastAt: 0 }, laps: [] };
    e.laps.push(l);
    e.row.lastAt = Math.max(e.row.lastAt, l.recordedAt);
    m.set(key, e);
  }
  return [...m.values()].map((e) => ({ ...e.row, t: totals(e.laps) })).sort((a, b) => b.t.laps - a.t.laps || b.lastAt - a.lastAt);
}

export const one = (v: number | null, digits = 0) => (v == null ? "–" : v.toFixed(digits));
export const hours = (ms: number) => ms / 3_600_000;
export const timeText = (ms: number) => {
  const s = spanText(ms);
  return `${s.value} ${s.unit}`;
};

// ---- the page ---------------------------------------------------------------------------------------

/** The laps (oldest first) inside a range and game, and where the range starts. Ranges start no earlier than the
 * first lap, so a newcomer's 90 days aren't weeks of nothing. */
export function windowOf(all: LapSummary[], range: Range, game: string): { laps: LapSummary[]; from: number; now: number } {
  const now = Date.now();
  const inGame = all.filter((l) => game === "all" || l.game === game);
  const first = inGame.length ? Math.min(...inGame.map((l) => l.recordedAt)) : now;
  const from = range === "all" ? first : Math.max(now - (Number(range) - 1) * DAY, first);
  return { laps: inGame.filter((l) => l.recordedAt >= bucketStart(from, "day")), from, now };
}

/** The time range and game, in one row above the charts. */
export function Filters({ range, onRange, game, onGame, games }: { range: Range; onRange: (r: Range) => void; game: string; onGame: (g: string) => void; games: string[] }) {
  return (
    <div className="bd-filters">
      <div className="seg" role="group" aria-label="Time range">
        {RANGES.map((r) => (
          <button key={r.key} type="button" aria-pressed={range === r.key} onClick={() => onRange(r.key)}>{r.label}</button>
        ))}
      </div>
      {games.length > 1 && (
        <Dropdown
          variant="pill"
          label="Game"
          value={game}
          onChange={onGame}
          options={[{ value: "all", label: "All games" }, ...games.map((g) => ({ value: g, label: gameName(g), icon: <GameIcon game={g} size={18} /> }))]}
        />
      )}
    </div>
  );
}

/** One driver's driving at a glance: how much, how clean, how far, how fast and how often they spin, over time. */
export function BreakdownPage({ id }: { id: DriverId }) {
  const { drivers } = useAppState();
  const driver = drivers.find((d) => d.id === id);
  const all = useFetch<LapSummary[]>(() => api.driverBreakdown(id), [id]);
  const [range, setRange] = useState<Range>("30");
  const [game, setGame] = useState<string>("all");

  const games = useMemo(() => [...new Set((all ?? []).map((l) => l.game))], [all]);
  const view = useMemo(() => {
    const { laps, from, now } = windowOf(all ?? [], range, game);
    return { laps, t: totals(laps), b: buckets(laps.filter(isAttempt), from, now), combos: byCombo(laps) };
  }, [all, range, game]);

  const back = <a href="#/drivers" className="back-link">← Drivers</a>;
  if (!driver) return <>{back}<div className="empty">That driver isn't here (anymore).</div></>;
  if (!all) return <>{back}<div className="empty">Loading…</div></>;

  const { t, b } = view;
  const avg = avgKmh(t);
  const rate = spinRate(t);
  const time = spanText(t.timeMs);
  const missingDistance = t.laps - view.laps.filter((l) => isAttempt(l) && l.distanceM != null).length;
  const unitWord = b.unit === "day" ? "day" : b.unit === "week" ? "week" : "month";

  return (
    <>
      {back}
      <div className="head" style={{ alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
          <Helmet color={driver.color} look={driver.look} size={64} seed={driver.id} />
          <div style={{ minWidth: 0 }}>
            <h1 style={{ overflowWrap: "anywhere" }}>{driver.name}</h1>
            <span className="muted">Driver breakdown · <a href={`#/you/${id}`}>profile</a> · <a href={`#/you/${id}/stats`}>stats</a> · <a href="#/drivers/compare">compare everyone</a></span>
          </div>
        </div>
      </div>

      <Filters range={range} onRange={setRange} game={game} onGame={setGame} games={games} />

      {t.laps === 0 ? (
        <div className="empty">No laps {range === "all" ? "yet" : "in this time"}. {range !== "all" && "Try a longer range."}</div>
      ) : (
        <>
          <section className="stats-group" aria-label="Totals">
            <div className="bd-kpis">
              <Kpi label="Time driven" value={time.value} unit={time.unit} note={`over ${t.laps.toLocaleString()} laps`} big />
              <Kpi label="Distance" value={t.distanceM ? km(t.distanceM) : "–"} unit={t.distanceM ? "km" : ""} note={missingDistance > 0 ? `${missingDistance} laps unmeasured` : "every lap measured"} big />
              <Kpi label="Total laps" value={t.laps.toLocaleString()} note="timed and cut" big />
              <Kpi label="Clean laps" value={t.clean.toLocaleString()} note={`${cleanPct(t)}% clean`} swatch="var(--mint)" />
              <Kpi label="Cut laps" value={t.cut.toLocaleString()} note={`${100 - (cleanPct(t) ?? 100)}% cut`} swatch="var(--red)" />
              <Kpi label="Top speed" value={one(t.topKmh)} unit={t.topKmh != null ? "km/h" : ""} note={t.topKmh == null ? "needs a lap trace" : "fastest moment"} />
              <Kpi label="Average speed" value={one(avg)} unit={avg != null ? "km/h" : ""} note="distance ÷ time" />
              <Kpi label="Spin rate" value={one(rate, 1)} unit={rate != null ? "/ 10 laps" : ""} note={rate == null ? "game reports no physics" : `${t.spins.toLocaleString()} spins in all`} />
            </div>
          </section>

          <ChartCard title="Laps, clean and cut" sub={`Laps each ${unitWord}. Cut laps sit on top of clean ones.`} legend={[["Clean", "var(--mint)"], ["Cut", "var(--red)"]]}>
            <BarChart
              buckets={b.list}
              unit={b.unit}
              series={[
                { label: "Clean", color: "var(--mint)", value: (x) => x.clean },
                { label: "Cut", color: "var(--red)", value: (x) => x.cut },
              ]}
              format={(v) => `${Math.round(v)}`}
              extra={(x) => (x.laps ? `${cleanPct(x)}% clean` : "")}
            />
          </ChartCard>

          <div className="bd-two">
            <ChartCard title="Distance" sub={`Kilometres each ${unitWord}.`}>
              <BarChart buckets={b.list} unit={b.unit} series={[{ label: "Distance", color: "var(--violet)", value: (x) => x.distanceM / 1000 }]} format={(v) => (Number.isInteger(v) || v >= 100 ? v.toFixed(0) : v.toFixed(1))} suffix=" km" />
            </ChartCard>
            <ChartCard title="Time on track" sub={`Hours each ${unitWord}.`}>
              <BarChart buckets={b.list} unit={b.unit} series={[{ label: "Time", color: "var(--peri-2)", value: (x) => hours(x.timeMs) }]} format={(v) => v.toFixed(1)} suffix=" h" tip={(x) => timeText(x.timeMs)} />
            </ChartCard>
          </div>

          <div className="bd-two">
            <ChartCard title="Speed" sub={`Top and average speed each ${unitWord}, km/h.`} legend={[["Top", "var(--gold)"], ["Average", "var(--peri-1)"]]}>
              <LineChart
                buckets={b.list}
                unit={b.unit}
                series={[
                  { label: "Top", color: "var(--gold)", value: (x) => x.topKmh },
                  { label: "Average", color: "var(--peri-1)", value: (x) => avgKmh(x) },
                ]}
                format={(v) => v.toFixed(0)}
                suffix=" km/h"
              />
            </ChartCard>
            <ChartCard title="Spin rate" sub={`Spins per 10 laps each ${unitWord}. Lower is tidier.`}>
              <LineChart buckets={b.list} unit={b.unit} series={[{ label: "Spins per 10 laps", color: "var(--peach)", value: (x) => spinRate(x) }]} format={(v) => v.toFixed(1)} zero extra={(x) => (x.physicsLaps ? `${x.spins} spins in ${x.physicsLaps} laps` : "")} />
            </ChartCard>
          </div>

          <section className="card" aria-label="By track and car">
            <h2>By track and car</h2>
            <div className="bd-table-wrap">
              <table className="bd-table">
                <thead>
                  <tr>
                    <th>Track and car</th>
                    <th>Laps</th>
                    <th>Clean</th>
                    <th>Cut</th>
                    <th>Clean %</th>
                    <th>Distance</th>
                    <th>Time</th>
                    <th>Top</th>
                    <th>Avg</th>
                    <th>Spins</th>
                  </tr>
                </thead>
                <tbody>
                  {view.combos.map((c) => (
                    <tr key={c.key}>
                      <td>
                        <span className="bd-combo">
                          <GameIcon game={c.game} size={20} />
                          <span>
                            <b>{trackName(c.track, c.layout)}</b>
                            <span className="muted">{carName(c.car)}</span>
                          </span>
                        </span>
                      </td>
                      <td className="mono">{c.t.laps}</td>
                      <td className="mono">{c.t.clean}</td>
                      <td className="mono">{c.t.cut}</td>
                      <td>
                        <span className="bd-clean-bar" title={`${cleanPct(c.t)}% clean`}>
                          <span style={{ width: `${cleanPct(c.t)}%` }} />
                        </span>
                        <span className="mono">{cleanPct(c.t)}%</span>
                      </td>
                      <td className="mono">{c.t.distanceM ? `${km(c.t.distanceM)} km` : "–"}</td>
                      <td className="mono">{timeText(c.t.timeMs)}</td>
                      <td className="mono">{one(c.t.topKmh)}</td>
                      <td className="mono">{one(avgKmh(c.t))}</td>
                      <td className="mono">{c.t.physicsLaps ? c.t.spins : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <details className="card bd-numbers">
            <summary>Every {unitWord} as numbers</summary>
            <div className="bd-table-wrap">
              <table className="bd-table">
                <thead>
                  <tr>
                    <th>{unitWord[0].toUpperCase() + unitWord.slice(1)}</th>
                    <th>Laps</th>
                    <th>Clean</th>
                    <th>Cut</th>
                    <th>Distance</th>
                    <th>Time</th>
                    <th>Top</th>
                    <th>Avg</th>
                    <th>Spins / 10</th>
                  </tr>
                </thead>
                <tbody>
                  {[...b.list].reverse().filter((x) => x.t.laps > 0).map((x) => (
                    <tr key={x.start}>
                      <td>{bucketLabel(x.start, b.unit, true)}</td>
                      <td className="mono">{x.t.laps}</td>
                      <td className="mono">{x.t.clean}</td>
                      <td className="mono">{x.t.cut}</td>
                      <td className="mono">{x.t.distanceM ? `${km(x.t.distanceM)} km` : "–"}</td>
                      <td className="mono">{timeText(x.t.timeMs)}</td>
                      <td className="mono">{one(x.t.topKmh)}</td>
                      <td className="mono">{one(avgKmh(x.t))}</td>
                      <td className="mono">{one(spinRate(x.t), 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <p className="stats-foot">
            Laps are timed laps and cut laps; out, in and partial laps aren't counted. Top speed comes from each lap's recorded trace, and average speed is distance over time on the laps that have a distance.
            Spins are counted where the game reports physics; laps without that are left out of the spin rate rather than counted as zero.
          </p>
        </>
      )}
    </>
  );
}

export function Kpi({ label, value, unit, note, big, swatch }: { label: string; value: string; unit?: string; note?: string; big?: boolean; swatch?: string }) {
  return (
    <div className={`stats-cell${big ? " bd-kpi-big" : ""}`}>
      <span className="stats-label">
        {swatch && <i className="bd-swatch" style={{ background: swatch }} aria-hidden="true" />}
        {label}
      </span>
      <span className="stats-value">{value}{unit && <small> {unit}</small>}</span>
      <span className="stats-note">{note ?? ""}</span>
    </div>
  );
}

export function ChartCard({ title, sub, legend, children }: { title: string; sub: string; legend?: [string, string][]; children: ReactNode }) {
  return (
    <section className="card bd-chart" aria-label={title}>
      <div className="bd-chart-head">
        <div>
          <h3>{title}</h3>
          <span className="muted" style={{ fontSize: 13 }}>{sub}</span>
        </div>
        {legend && (
          <div className="bd-legend">
            {legend.map(([l, c]) => (
              <span key={l}><i className="bd-swatch" style={{ background: c }} aria-hidden="true" />{l}</span>
            ))}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

// ---- charts -----------------------------------------------------------------------------------------

/** The chart's own width in CSS pixels, so text stays its real size at any width. A callback ref, so it follows
 * whichever element is mounted (the empty state or the plot). */
export function useWidth() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w] as const;
}

/** Round axis steps: 1, 2 or 5 times a power of ten, about four of them. */
function niceMax(max: number): { top: number; step: number } {
  if (max <= 0) return { top: 1, step: 0.25 };
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw)!;
  return { top: Math.ceil(max / step) * step, step };
}

interface Series {
  label: string;
  color: string;
}

const H = 220;
const PAD = { l: 44, r: 12, t: 12, b: 28 };

/** Which bucket labels fit along the bottom without crowding. */
function tickEvery(n: number, plotW: number) {
  return Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 64))));
}

export function Tooltip({ x, w, title, rows }: { x: number; w: number; title: string; rows: { label: string; color?: string; value: string }[] }) {
  const left = Math.min(Math.max(x, 90), w - 90);
  return (
    <div className="bd-tip" style={{ left }} role="status">
      <b>{title}</b>
      {rows.map((r) => (
        <span key={r.label}>
          {r.color && <i className="bd-swatch" style={{ background: r.color }} aria-hidden="true" />}
          {r.label}
          <span className="mono">{r.value}</span>
        </span>
      ))}
    </div>
  );
}

/** Bars per bucket, stacked when there is more than one series, with a hover tooltip per bar. */
export function BarChart({
  buckets: list,
  unit,
  series,
  format,
  suffix = "",
  tip,
  extra,
}: {
  buckets: Bucket[];
  unit: Unit;
  series: (Series & { value: (t: Totals) => number })[];
  format: (v: number) => string;
  suffix?: string;
  tip?: (t: Totals) => string;
  extra?: (t: Totals) => string;
}) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const sums = list.map((b) => series.reduce((a, s) => a + s.value(b.t), 0));
  const { top, step } = niceMax(Math.max(...sums, 0));
  const slot = plotW / list.length;
  const barW = Math.max(2, Math.min(36, slot * 0.7));
  const y = (v: number) => PAD.t + plotH - (v / top) * plotH;
  const every = tickEvery(list.length, plotW);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  return (
    <div className="bd-plot" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg width={W} height={H} role="img" aria-label={`${series.map((s) => s.label).join(" and ")} per ${unit}`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray={v === 0 ? undefined : "3 5"} />
            <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" className="bd-axis">{format(v)}</text>
          </g>
        ))}
        {list.map((b, i) => {
          const cx = PAD.l + slot * (i + 0.5);
          let base = 0;
          const segs = series
            .map((s) => ({ s, v: s.value(b.t) }))
            .filter((x) => x.v > 0)
            .map((x, k, arr) => {
              const y0 = y(base);
              base += x.v;
              const y1 = y(base);
              const isTop = k === arr.length - 1;
              // A 2px gap of background between stacked segments; only the top segment gets rounded ends.
              const h = Math.max(1, y0 - y1 - (k > 0 ? 2 : 0));
              const r = isTop ? Math.min(4, barW / 2, h) : 0;
              const yTop = y1;
              const d = `M${cx - barW / 2} ${yTop + h}V${yTop + r}${r ? `q0 -${r} ${r} -${r}` : ""}H${cx + barW / 2 - r}${r ? `q${r} 0 ${r} ${r}` : ""}V${yTop + h}Z`;
              return <path key={x.s.label} d={d} fill={x.s.color} opacity={hover === null || hover === i ? 1 : 0.55} />;
            });
          return (
            <g key={b.start}>
              {segs}
              {i % every === 0 && (
                <text x={cx} y={H - 8} textAnchor="middle" className="bd-axis">{bucketLabel(b.start, unit)}</text>
              )}
              <rect x={cx - slot / 2} y={PAD.t} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <Tooltip
          x={PAD.l + slot * (hover + 0.5)}
          w={W}
          title={bucketLabel(list[hover].start, unit, true)}
          rows={[
            ...series.map((s) => ({ label: s.label, color: series.length > 1 ? s.color : undefined, value: tip ? tip(list[hover].t) : `${format(s.value(list[hover].t))}${suffix}` })),
            ...(extra?.(list[hover].t) ? [{ label: extra(list[hover].t), value: "" }] : []),
          ]}
        />
      )}
    </div>
  );
}

/** Lines through the buckets that have a value (a gap where there were no laps), with a crosshair and tooltip. */
export function LineChart({
  buckets: list,
  unit,
  series,
  format,
  suffix = "",
  zero,
  extra,
}: {
  buckets: Bucket[];
  unit: Unit;
  series: (Series & { value: (t: Totals) => number | null })[];
  format: (v: number) => string;
  suffix?: string;
  /** Start the axis at zero (a rate), rather than fitting the values (a speed). */
  zero?: boolean;
  extra?: (t: Totals) => string;
}) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const values = series.map((s) => list.map((b) => (b.t.laps ? s.value(b.t) : null)));
  const flat = values.flat().filter((v): v is number => v != null);
  if (flat.length === 0) return <div className="empty" ref={ref}>Nothing recorded for this yet.</div>;

  const hiRaw = Math.max(...flat);
  const loRaw = zero ? 0 : Math.min(...flat);
  const spread = Math.max(hiRaw - loRaw, zero ? 0.5 : 10);
  const { step } = niceMax(spread);
  const lo = zero ? 0 : Math.floor((loRaw - step * 0.5) / step) * step;
  const hi = Math.ceil((hiRaw + (zero ? 0 : step * 0.25)) / step) * step || step;
  const slot = plotW / list.length;
  const x = (i: number) => PAD.l + slot * (i + 0.5);
  const y = (v: number) => PAD.t + plotH - ((v - lo) / (hi - lo)) * plotH;
  const every = tickEvery(list.length, plotW);
  const ticks: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);

  return (
    <div className="bd-plot" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg width={W} height={H} role="img" aria-label={`${series.map((s) => s.label).join(" and ")} per ${unit}`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray={v === lo ? undefined : "3 5"} />
            <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" className="bd-axis">{format(v)}</text>
          </g>
        ))}
        {list.map((b, i) =>
          i % every === 0 ? <text key={b.start} x={x(i)} y={H - 8} textAnchor="middle" className="bd-axis">{bucketLabel(b.start, unit)}</text> : null,
        )}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + plotH} stroke="var(--muted)" strokeWidth="1" />}
        {series.map((s, si) => {
          // Break the line where a bucket has no value, so an empty week isn't drawn as a trend.
          let d = "";
          let pen = false;
          values[si].forEach((v, i) => {
            if (v == null) {
              pen = false;
              return;
            }
            d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
            pen = true;
          });
          return (
            <g key={s.label}>
              <path d={d} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {values[si].map((v, i) =>
                v == null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 5 : 3.5} fill={s.color} stroke="var(--panel)" strokeWidth="2" />,
              )}
            </g>
          );
        })}
        {list.map((b, i) => (
          <rect key={b.start} x={x(i) - slot / 2} y={PAD.t} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
        ))}
      </svg>
      {hover !== null && (
        <Tooltip
          x={x(hover)}
          w={W}
          title={bucketLabel(list[hover].start, unit, true)}
          rows={
            list[hover].t.laps === 0
              ? [{ label: "No laps", value: "" }]
              : [
                  ...series.map((s, si) => ({ label: s.label, color: series.length > 1 ? s.color : undefined, value: values[si][hover] == null ? "–" : `${format(values[si][hover]!)}${suffix}` })),
                  ...(extra?.(list[hover].t) ? [{ label: extra(list[hover].t), value: "" }] : []),
                ]
          }
        />
      )}
    </div>
  );
}
