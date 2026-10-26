import { useMemo, useState } from "react";
import { api, useAppState, useFetch, type Lap } from "../api";
import { Helmet } from "../components/Helmet";
import { Picker, type PickerItem } from "../components/Picker";
import { byDay, groupCombos, progressOf, runningBest, sectorProgress, summarize, tierOf, type ComboLaps } from "../driverStats";
import { carName, lapTime, trackName } from "../format";
import { Signed } from "../components/Signed";

const secs = (ms: number) => (ms / 1000).toFixed(3);
const dayLabel = (ms: number) => new Date(ms).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

/** How a driver has improved over time: best lap on each track and car, lap by lap and day by day. */
export function DriverProgress({ id }: { id: number }) {
  const { drivers, status } = useAppState();
  const driver = drivers.find((d) => d.id === id);
  const laps = useFetch(() => api.driverLaps(id), [id]);
  const rating = (useFetch(() => api.driverRatings(), []) ?? []).find((r) => r.driverId === id);
  const combos = useMemo(() => groupCombos(laps ?? []), [laps]);
  const [picked, setPicked] = useState<string | null>(null);

  if (!driver) {
    return (
      <>
        <a href="#/drivers" className="back-link">← Drivers</a>
        <div className="empty">That driver isn't here (anymore).</div>
      </>
    );
  }

  const current = combos.find((c) => c.key === picked) ?? combos[0] ?? null;
  const all = laps ?? [];
  const firstLapAt = all.length ? all[0].recordedAt : null;
  const items: PickerItem[] = combos.map((c) => ({
    value: c.key,
    label: trackName(c.track, c.layout),
    sub: `${carName(c.car)} · ${c.laps.length} ${c.laps.length === 1 ? "lap" : "laps"} · best ${lapTime(c.best)}`,
    search: c.car,
  }));

  return (
    <>
      <a href="#/drivers" className="back-link">← Drivers</a>
      <div className="head" style={{ alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
          <Helmet color={driver.color} size={64} seed={driver.id} />
          <div style={{ minWidth: 0 }}>
            <h1 style={{ overflowWrap: "anywhere" }}>{driver.name}</h1>
            <span className="muted">{status?.seat === driver.id ? "In the seat now" : "Progress over time"}</span>
          </div>
        </div>
      </div>

      {laps === null ? (
        <div className="empty">Loading…</div>
      ) : combos.length === 0 ? (
        <div className="empty">No timed laps yet. Once {driver.name} sets a few, their progress shows up here.</div>
      ) : (
        <>
          <HowTheyreDoing summary={summarize(combos, rating)} />

          <div className="stat-tiles">
            {rating?.score != null && (
              <div className="stat-tile">
                <span className="label">Speed score</span>
                <span className="mono">{rating.score.toFixed(1)}</span>
                <span className="muted" style={{ fontSize: 13, color: tierOf(rating.score).color }}>{tierOf(rating.score).label}</span>
              </div>
            )}
            <Tile label="Laps recorded" value={String(all.length)} />
            <Tile label="Timed laps" value={String(combos.reduce((n, c) => n + c.laps.length, 0))} />
            <Tile label="Track + car combos" value={String(combos.length)} />
            <Tile label="Driving since" value={firstLapAt ? dayLabel(firstLapAt) : "—"} />
          </div>

          <section className="card" aria-label="Progress on a track">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", justifyContent: "space-between" }}>
              <h2>Progress</h2>
              <div style={{ flex: "1 1 280px", maxWidth: 520 }}>
                <Picker label="Track and car" title="Choose a track and car" value={current?.key ?? ""} items={items} onChange={setPicked} />
              </div>
            </div>
            {current && <ComboProgress combo={current} />}
          </section>
        </>
      )}
    </>
  );
}

const TONE_ICON: Record<string, string> = { great: "M5 15l5-6 4 4 5-8M15 5h4v4", good: "M5 15l5-6 4 4 5-8M15 5h4v4", steady: "M4 12h16M15 7l5 5-5 5", slower: "M5 9l5 6 4-4 5 8M15 19h4v-4", new: "M12 3l2.5 6 6.5.5-5 4.3 1.6 6.4L12 17l-5.6 3.2L8 13.8 3 9.5l6.5-.5z" };
const TONE_COLOR: Record<string, string> = { great: "var(--mint)", good: "var(--mint)", steady: "var(--peri-1)", slower: "var(--peach)", new: "var(--gold)" };

/** A few plain sentences on how the driver is doing overall. */
function HowTheyreDoing({ summary }: { summary: ReturnType<typeof summarize> }) {
  const color = TONE_COLOR[summary.tone];
  return (
    <section className="card how-doing" aria-label="How they're doing">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className="how-icon" style={{ color, borderColor: color }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={TONE_ICON[summary.tone]} />
          </svg>
        </span>
        <div>
          <div className="label">How they're doing</div>
          <div style={{ font: "800 22px var(--font-display)", color }}>{summary.headline}</div>
        </div>
      </div>
      <ul className="how-points">
        {summary.points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </section>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-tile">
      <span className="label">{label}</span>
      <span className="mono">{value}</span>
    </div>
  );
}

function ComboProgress({ combo }: { combo: ComboLaps }) {
  const laps = combo.laps;
  const progress = progressOf(laps);
  const days = byDay(laps);
  const sectors = sectorProgress(laps);
  const cut = combo.attempts - laps.length;

  return (
    <>
      <div className="muted" style={{ fontSize: 14 }}>
        {trackName(combo.track, combo.layout)} · {carName(combo.car)} · {laps.length} timed {laps.length === 1 ? "lap" : "laps"}
        {cut > 0 ? ` · ${cut} cut` : ""}
      </div>

      {progress && (
        <div className="stat-tiles">
          <Tile label="First timed lap" value={lapTime(progress.first)} />
          <Tile label="Personal best" value={lapTime(progress.best)} />
          <div className="stat-tile highlight">
            <span className="label">{progress.gained > 0 ? "Gained since the first lap" : "Since the first lap"}</span>
            <span className="mono" style={{ color: progress.gained > 0 ? "var(--mint)" : undefined }}>
              {progress.gained > 0 ? `-${secs(progress.gained)}s` : "first lap is the best"}
            </span>
            {progress.gained > 0 && <span className="muted" style={{ fontSize: 13 }}>{progress.gainedPct.toFixed(1)}% faster</span>}
          </div>
          {progress.earlyAvg !== null && progress.recentAvg !== null && (
            <div className="stat-tile">
              <span className="label">Everyday pace</span>
              <span className="mono">{lapTime(Math.round(progress.recentAvg))}</span>
              <span className="muted" style={{ fontSize: 13 }}>
                latest laps' average, was {lapTime(Math.round(progress.earlyAvg))} early on
              </span>
            </div>
          )}
        </div>
      )}

      <LapChart laps={laps} />

      {sectors.length > 0 && (
        <div>
          <h3 style={{ fontSize: 16 }}>Where the time came from</h3>
          <p className="muted" style={{ fontSize: 13, margin: "2px 0 8px" }}>Best time in each sector, and how much quicker that is than the first time recorded.</p>
          <div className="sector-row">
            {sectors.map((s) => (
              <div className="sector-card" key={s.index}>
                <div className="sector-head"><span className="label">S{s.index + 1}</span></div>
                <span className="mono sector-time">{secs(s.best)}</span>
                <span className="mono sector-delta" style={{ color: s.gained > 0 ? "var(--mint)" : "var(--muted)" }}>
                  {s.gained > 0 ? `-${secs(s.gained)}` : "same"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 style={{ fontSize: 16, marginBottom: 8 }}>Day by day</h3>
        <div className="list">
          {[...days].reverse().map((d, i, arr) => {
            // Compared with the day before it (arr is newest first).
            const earlier = arr[i + 1];
            const diff = earlier ? d.best - earlier.best : null;
            return (
              <div className="list-row" key={d.start}>
                <span className="grow">
                  <span style={{ fontWeight: 700 }}>{dayLabel(d.start)}</span>
                  <span className="muted" style={{ fontSize: 13 }}>{d.laps.length} {d.laps.length === 1 ? "lap" : "laps"}</span>
                </span>
                {diff !== null && diff !== 0 && (
                  <span className="mono" style={{ fontSize: 14, color: diff < 0 ? "var(--mint)" : "var(--muted)" }}>
                    <Signed text={`${diff < 0 ? "−" : "+"}${secs(Math.abs(diff))}`} />
                  </span>
                )}
                <span className="mono" style={{ fontWeight: 700 }}>{lapTime(d.best)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/** Every timed lap as a dot, with a line stepping down each time the personal best improves (faster is higher). */
function LapChart({ laps }: { laps: Lap[] }) {
  const W = 600;
  const H = 220;
  const pad = { l: 72, r: 14, t: 14, b: 30 };
  const times = laps.map((l) => l.timeMs);
  const best = Math.min(...times);
  const sorted = [...times].sort((a, b) => a - b);
  // Leave out the very slow laps (a spin, a lazy lap) so they don't squash everything else.
  const cap = Math.max(sorted[Math.floor(sorted.length * 0.9)] ?? best, best * 1.03);
  const lo = best - (cap - best) * 0.08;
  const hi = cap + (cap - best) * 0.08;
  const x = (i: number) => pad.l + (laps.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (laps.length - 1)) * (W - pad.l - pad.r));
  const y = (t: number) => pad.t + ((Math.min(t, hi) - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const pb = runningBest(laps);
  const step = laps.map((_, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(pb[i]).toFixed(1)}`).join("");
  const ticks = [lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1];

  // A label under the first lap of each new day.
  const dayMarks = laps
    .map((l, i) => ({ i, day: new Date(l.recordedAt).toDateString(), at: l.recordedAt }))
    .filter((m, k, arr) => k === 0 || m.day !== arr[k - 1].day);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="progress-chart" role="img" aria-label="Lap times over time">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray="3 5" />
          <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)" className="mono">{lapTime(Math.round(t))}</text>
        </g>
      ))}
      <path d={step} fill="none" stroke="var(--mint)" strokeWidth="2.5" strokeLinejoin="round" />
      {laps.map((l, i) => (
        <circle key={l.id} cx={x(i)} cy={y(l.timeMs)} r={l.timeMs === pb[i] && (i === 0 || pb[i] < pb[i - 1]) ? 5 : 3.5} fill={l.timeMs === pb[i] && (i === 0 || pb[i] < pb[i - 1]) ? "var(--gold)" : "var(--peri-1)"} opacity={l.timeMs > hi ? 0.5 : 1}>
          <title>{`Lap ${i + 1}: ${lapTime(l.timeMs)} · ${dayLabel(l.recordedAt)}`}</title>
        </circle>
      ))}
      {dayMarks.map((m) => (
        <text key={m.i} x={x(m.i)} y={H - 8} fontSize="11" fill="var(--muted)" textAnchor={m.i === 0 ? "start" : "middle"}>{dayLabel(m.at)}</text>
      ))}
    </svg>
  );
}
