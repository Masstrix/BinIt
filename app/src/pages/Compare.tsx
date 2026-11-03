import { useMemo, useState } from "react";
import { api, useAppState, useFetch, type Driver, type DriverId, type LapSummary } from "../api";
import { Helmet } from "../components/Helmet";
import { ago, km, spanText } from "../format";
import {
  BarChart,
  ChartCard,
  Filters,
  Kpi,
  avgKmh,
  buckets,
  cleanPct,
  isAttempt,
  one,
  spinRate,
  timeText,
  totals,
  windowOf,
  type Range,
  type Totals,
} from "./Breakdown";

interface Row {
  driver: Driver;
  t: Totals;
  lastAt: number;
}

type SortKey = "name" | "laps" | "clean" | "cut" | "cleanPct" | "distance" | "time" | "top" | "avg" | "spins" | "last";

const SORT_VALUE: Record<SortKey, (r: Row) => number | string | null> = {
  name: (r) => r.driver.name.toLowerCase(),
  laps: (r) => r.t.laps,
  clean: (r) => r.t.clean,
  cut: (r) => r.t.cut,
  cleanPct: (r) => cleanPct(r.t),
  distance: (r) => r.t.distanceM,
  time: (r) => r.t.timeMs,
  top: (r) => r.t.topKmh,
  avg: (r) => avgKmh(r.t),
  spins: (r) => spinRate(r.t),
  last: (r) => r.lastAt,
};

const COLUMNS: { key: SortKey; label: string; title?: string }[] = [
  { key: "name", label: "Driver" },
  { key: "laps", label: "Laps", title: "Timed and cut laps" },
  { key: "clean", label: "Clean" },
  { key: "cut", label: "Cut" },
  { key: "cleanPct", label: "Clean %" },
  { key: "distance", label: "Distance" },
  { key: "time", label: "Time" },
  { key: "top", label: "Top", title: "Top speed, km/h" },
  { key: "avg", label: "Avg", title: "Average speed, km/h" },
  { key: "spins", label: "Spins / 10", title: "Spins per 10 laps, where the game reports physics" },
  { key: "last", label: "Last drove" },
];

/** Everyone who has driven, side by side: who drives most, cleanest, fastest and tidiest, and the rig's activity over time. */
export function ComparePage() {
  const { drivers } = useAppState();
  const all = useFetch(() => api.allBreakdowns(), []);
  const [range, setRange] = useState<Range>("30");
  const [game, setGame] = useState<string>("all");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "time", desc: true });

  const byId = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);
  const games = useMemo(() => [...new Set((all ?? []).flatMap((d) => d.laps.map((l) => l.game)))], [all]);

  const view = useMemo(() => {
    const everyLap: LapSummary[] = (all ?? []).flatMap((d) => d.laps);
    // One window for everyone, so each driver is measured over the same days.
    const { from, now } = windowOf(everyLap, range, game);
    const rows: Row[] = [];
    const pooled: LapSummary[] = [];
    for (const d of all ?? []) {
      const driver = byId.get(d.driverId as DriverId);
      if (!driver) continue;
      const laps = d.laps.filter((l) => (game === "all" || l.game === game) && l.recordedAt >= from);
      const t = totals(laps);
      if (t.laps === 0) continue;
      pooled.push(...laps);
      rows.push({ driver, t, lastAt: Math.max(...laps.map((l) => l.recordedAt)) });
    }
    pooled.sort((a, b) => a.recordedAt - b.recordedAt);
    return { rows, t: totals(pooled), b: buckets(pooled.filter(isAttempt), from, now) };
  }, [all, byId, range, game]);

  const back = <a href="#/drivers" className="back-link">← Drivers</a>;
  if (!all) return <>{back}<div className="empty">Loading…</div></>;

  const { rows, t, b } = view;
  const time = spanText(t.timeMs);
  const fastest = [...rows].filter((r) => r.t.topKmh != null).sort((a, c) => c.t.topKmh! - a.t.topKmh!)[0];
  const rate = spinRate(t);
  const unitWord = b.unit === "day" ? "day" : b.unit === "week" ? "week" : "month";

  const sorted = [...rows].sort((a, c) => {
    const va = SORT_VALUE[sort.key](a);
    const vc = SORT_VALUE[sort.key](c);
    // Unknowns (a game with no physics, no trace) always go last, whichever way it's sorted.
    if (va == null || vc == null) return va == null ? (vc == null ? 0 : 1) : -1;
    const cmp = va < vc ? -1 : va > vc ? 1 : 0;
    return sort.desc ? -cmp : cmp;
  });
  const sortBy = (key: SortKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" }));

  return (
    <>
      {back}
      <div className="head" style={{ alignItems: "center" }}>
        <div>
          <h1>Everyone</h1>
          <span className="muted">How every driver drives, side by side. Open a driver for their own breakdown.</span>
        </div>
      </div>

      <Filters range={range} onRange={setRange} game={game} onGame={setGame} games={games} />

      {rows.length === 0 ? (
        <div className="empty">Nobody has driven {range === "all" ? "yet" : "in this time"}. {range !== "all" && "Try a longer range."}</div>
      ) : (
        <>
          <section className="stats-group" aria-label="Everyone's totals">
            <div className="bd-kpis">
              <Kpi label="Time driven" value={time.value} unit={time.unit} note={`by ${rows.length} ${rows.length === 1 ? "driver" : "drivers"}`} big />
              <Kpi label="Distance" value={t.distanceM ? km(t.distanceM) : "–"} unit={t.distanceM ? "km" : ""} note="all drivers together" big />
              <Kpi label="Total laps" value={t.laps.toLocaleString()} note="timed and cut" big />
              <Kpi label="Clean laps" value={t.clean.toLocaleString()} note={`${cleanPct(t)}% clean · ${t.cut.toLocaleString()} cut`} swatch="var(--mint)" big />
              <Kpi label="Top speed" value={one(t.topKmh)} unit={t.topKmh != null ? "km/h" : ""} note={fastest ? `by ${fastest.driver.name}` : "needs a lap trace"} />
              <Kpi label="Average speed" value={one(avgKmh(t))} unit={avgKmh(t) != null ? "km/h" : ""} note="distance ÷ time" />
              <Kpi label="Spin rate" value={one(rate, 1)} unit={rate != null ? "/ 10 laps" : ""} note={rate == null ? "game reports no physics" : `${t.spins.toLocaleString()} spins in all`} />
              <Kpi label="Most driven" value={[...rows].sort((a, c) => c.t.timeMs - a.t.timeMs)[0].driver.name} note={timeText([...rows].sort((a, c) => c.t.timeMs - a.t.timeMs)[0].t.timeMs)} />
            </div>
          </section>

          <div className="bd-ranks">
            <RankCard title="Time driven" rows={rows} value={(r) => r.t.timeMs} label={(r) => timeText(r.t.timeMs)} color="var(--peri-2)" />
            <RankCard title="Distance" rows={rows} value={(r) => r.t.distanceM / 1000} label={(r) => (r.t.distanceM ? `${km(r.t.distanceM)} km` : "–")} color="var(--violet)" />
            <RankCard title="Laps, clean and cut" rows={rows} value={(r) => r.t.laps} clean={(r) => r.t.clean} label={(r) => `${r.t.clean} + ${r.t.cut}`} legend />
            <RankCard title="Clean laps" sub="Share of laps with no cuts." rows={rows} value={(r) => cleanPct(r.t)} label={(r) => `${cleanPct(r.t)}%`} color="var(--mint)" max={100} />
            <RankCard title="Top speed" rows={rows} value={(r) => r.t.topKmh} label={(r) => `${one(r.t.topKmh)} km/h`} color="var(--gold)" />
            <RankCard title="Spin rate" sub="Spins per 10 laps. Lower is tidier, so tidiest is first." rows={rows} value={(r) => spinRate(r.t)} label={(r) => one(spinRate(r.t), 1)} color="var(--peach)" ascending />
          </div>

          <ChartCard title="Everyone's laps" sub={`Laps each ${unitWord}, all drivers together. Cut laps sit on top of clean ones.`} legend={[["Clean", "var(--mint)"], ["Cut", "var(--red)"]]}>
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

          <section className="card" aria-label="Every driver">
            <h2>Every driver</h2>
            <span className="muted" style={{ fontSize: 13 }}>Tap a column to sort by it, and a driver for their breakdown.</span>
            <div className="bd-table-wrap">
              <table className="bd-table bd-compare">
                <thead>
                  <tr>
                    {COLUMNS.map((c) => (
                      <th key={c.key} title={c.title} aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : undefined}>
                        <button type="button" onClick={() => sortBy(c.key)} data-active={sort.key === c.key || undefined}>
                          {c.label}
                          {sort.key === c.key && <span aria-hidden="true">{sort.desc ? " ↓" : " ↑"}</span>}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.driver.id} onClick={() => (location.hash = `#/drivers/${r.driver.id}`)}>
                      <td>
                        <a className="bd-who" href={`#/drivers/${r.driver.id}`} onClick={(e) => e.stopPropagation()}>
                          <Helmet color={r.driver.color} look={r.driver.look} size={30} seed={r.driver.id} />
                          <b>{r.driver.name}</b>
                        </a>
                      </td>
                      <td className="mono">{r.t.laps}</td>
                      <td className="mono">{r.t.clean}</td>
                      <td className="mono">{r.t.cut}</td>
                      <td>
                        <span className="bd-clean-bar" title={`${cleanPct(r.t)}% clean`}>
                          <span style={{ width: `${cleanPct(r.t)}%` }} />
                        </span>
                        <span className="mono">{cleanPct(r.t)}%</span>
                      </td>
                      <td className="mono">{r.t.distanceM ? `${km(r.t.distanceM)} km` : "–"}</td>
                      <td className="mono">{timeText(r.t.timeMs)}</td>
                      <td className="mono">{one(r.t.topKmh)}</td>
                      <td className="mono">{one(avgKmh(r.t))}</td>
                      <td className="mono">{one(spinRate(r.t), 1)}</td>
                      <td className="muted">{ago(r.lastAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <p className="stats-foot">
            Everyone is measured over the same days. Laps are timed laps and cut laps; out, in and partial laps aren't counted. Drivers with no laps in the range are left out, and
            a driver whose game reports no physics shows no spin rate rather than a perfect one.
          </p>
        </>
      )}
    </>
  );
}

/** Drivers ranked on one measure: a bar each from zero, the value written beside it. */
function RankCard({
  title,
  sub,
  rows,
  value,
  label,
  color,
  clean,
  max,
  ascending,
  legend,
}: {
  title: string;
  sub?: string;
  rows: Row[];
  value: (r: Row) => number | null;
  label: (r: Row) => string;
  color?: string;
  /** For the laps card: how much of the bar is clean (the rest is cut). */
  clean?: (r: Row) => number;
  max?: number;
  ascending?: boolean;
  legend?: boolean;
}) {
  const known = rows.filter((r) => value(r) != null).sort((a, c) => (ascending ? value(a)! - value(c)! : value(c)! - value(a)!));
  const unknown = rows.length - known.length;
  const top = max ?? Math.max(...known.map((r) => value(r)!), 0);
  return (
    <ChartCard title={title} sub={sub ?? ""} legend={legend ? [["Clean", "var(--mint)"], ["Cut", "var(--red)"]] : undefined}>
      {known.length === 0 ? (
        <div className="empty">Nothing recorded for this yet.</div>
      ) : (
        <ol className="bd-rank">
          {known.map((r) => {
            const v = value(r)!;
            const w = top > 0 ? (v / top) * 100 : 0;
            const c = clean ? clean(r) : null;
            return (
              <li key={r.driver.id} title={`${r.driver.name}: ${label(r)}`}>
                <a href={`#/drivers/${r.driver.id}`} className="bd-who">
                  <Helmet color={r.driver.color} look={r.driver.look} size={26} seed={r.driver.id} />
                  <span>{r.driver.name}</span>
                </a>
                <span className="bd-rank-track">
                  {c != null ? (
                    <span className="bd-rank-bar stacked" style={{ width: `${Math.max(w, 2)}%` }}>
                      <span style={{ flex: c, background: "var(--mint)" }} />
                      {v - c > 0 && <span style={{ flex: v - c, background: "var(--red)" }} />}
                    </span>
                  ) : (
                    <span className="bd-rank-bar" style={{ width: `${Math.max(w, 2)}%`, background: color }} />
                  )}
                </span>
                <span className="mono bd-rank-value">{label(r)}</span>
              </li>
            );
          })}
        </ol>
      )}
      {unknown > 0 && <span className="stats-note">{unknown} {unknown === 1 ? "driver has" : "drivers have"} nothing recorded for this</span>}
    </ChartCard>
  );
}
