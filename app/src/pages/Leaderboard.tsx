import { useEffect, useMemo, useState } from "react";
import { api, useAppState, useDriverMap, useFetch, type Combo } from "../api";
import { Dropdown } from "../components/Dropdown";
import { Helmet } from "../components/Helmet";
import { ago, gameName, gap, lapTime, trackName } from "../format";

type Period = "today" | "week" | "all";

function periodStart(p: Period): number | null {
  const d = new Date();
  if (p === "all") return null;
  d.setHours(0, 0, 0, 0);
  if (p === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d.getTime();
}

const PURPLE = "#C38BFF";
const MINT = "#4BE3A6";

const trackKey = (c: Pick<Combo, "game" | "track" | "layout">) => `${c.game}|${c.track}|${c.layout}`;

export function LeaderboardPage() {
  const { status } = useAppState();
  const driverMap = useDriverMap();
  const combos = useFetch(() => api.combos(), []) ?? [];

  const tracks = useMemo(() => {
    const seen = new Map<string, Combo>();
    combos.forEach((c) => seen.set(trackKey(c), c));
    return [...seen.values()];
  }, [combos]);

  const [track, setTrack] = useState<string | null>(null);
  const [car, setCar] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("all");
  const [includeInvalid, setIncludeInvalid] = useState(false);

  // Default to what's being driven right now, else the first track with laps.
  useEffect(() => {
    if (track || tracks.length === 0) return;
    const s = status?.session;
    const pick = (s && tracks.find((t) => trackKey(t) === trackKey(s))) || tracks[0];
    setTrack(trackKey(pick));
    setCar(s && trackKey(s) === trackKey(pick) ? s.car : null);
  }, [tracks, status?.session, track]);

  const selected = tracks.find((t) => trackKey(t) === track);
  const carsHere = combos.filter((c) => selected && trackKey(c) === trackKey(selected)).map((c) => c.car);

  const board =
    useFetch(
      selected
        ? () =>
            api.leaderboard({
              game: selected.game,
              track: selected.track,
              layout: selected.layout,
              car,
              from: periodStart(period),
              includeInvalid,
            })
        : null,
      [track, car, period, includeInvalid],
    ) ?? [];

  const records =
    useFetch(
      selected
        ? () =>
            Promise.all(
              carsHere.slice(0, 6).map(async (c) => {
                const top = await api.leaderboard({ game: selected.game, track: selected.track, layout: selected.layout, car: c });
                return { car: c, top: top[0] };
              }),
            )
        : null,
      [track, carsHere.join("|")],
    ) ?? [];

  const seat = status?.seat ?? null;

  // Fastest time for each sector on this board: purple, like a timing screen.
  const sectorCount = Math.max(0, ...board.map((e) => e.sectorsMs.length));
  const bestSectors = Array.from({ length: sectorCount }, (_, i) => {
    const times = board.map((e) => e.sectorsMs[i]).filter((t): t is number => t > 0);
    return times.length ? Math.min(...times) : null;
  });
  const cols = `56px minmax(160px, 1fr) 120px 72px ${bestSectors.map(() => "72px").join(" ")} 56px`;
  const idealMs = sectorCount > 0 && bestSectors.every((t) => t !== null) ? bestSectors.reduce((a, t) => a! + t!, 0)! : null;

  return (
    <>
      <div className="head" style={{ alignItems: "center" }}>
        <h1>Leaderboard</h1>
        <div className="segmented" role="group" aria-label="Period">
          {(["today", "week", "all"] as Period[]).map((p) => (
            <button key={p} aria-pressed={period === p} onClick={() => setPeriod(p)}>
              {p === "today" ? "Today" : p === "week" ? "This week" : "All time"}
            </button>
          ))}
        </div>
      </div>

      {tracks.length === 0 ? (
        <div className="empty">No laps recorded yet. Once someone finishes a lap it'll show up here.</div>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            {selected && <span className="filter-pill on">{gameName(selected.game)}</span>}
            <Dropdown
              variant="pill"
              label="Track"
              value={track ?? ""}
              options={tracks.map((t) => ({ value: trackKey(t), label: trackName(t.track, t.layout) }))}
              onChange={(v) => {
                setTrack(v);
                setCar(null);
              }}
            />
            <Dropdown
              variant="pill"
              label="Car"
              value={car ?? ""}
              options={[{ value: "", label: "Any car" }, ...carsHere.map((c) => ({ value: c, label: c }))]}
              onChange={(v) => setCar(v || null)}
            />
            <button className="filter-pill" aria-pressed={!includeInvalid} onClick={() => setIncludeInvalid(!includeInvalid)}>
              {!includeInvalid && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
              )}
              Valid laps only
            </button>
          </div>

          <div className="row" style={{ alignItems: "flex-start" }}>
            <section className="card lb" style={{ flex: "999 1 800px", minWidth: 0 }} aria-label="Leaderboard">
              {board.length === 0 ? (
                <div className="empty">No laps in this period.</div>
              ) : (
                <div className="lb-scroll">
                  <div className="lb-grid lb-head" style={{ gridTemplateColumns: cols }}>
                    <span style={{ textAlign: "center" }}>POS</span>
                    <span>DRIVER</span>
                    <span className="r">BEST LAP</span>
                    <span className="r">GAP</span>
                    {bestSectors.map((_, i) => (
                      <span key={i} className="r">S{i + 1}</span>
                    ))}
                    <span className="r">LAPS</span>
                  </div>
                  {board.map((e, idx) => {
                    const d = e.driverId != null ? driverMap.get(e.driverId) : undefined;
                    const color = d?.color ?? "#5B6488";
                    const top = idx === 0;
                    const podium = idx < 3;
                    const me = e.driverId != null && e.driverId === seat;
                    return (
                      <div
                        key={e.lapId}
                        className={`lb-grid lb-row${top ? " top" : podium ? " lb-podium" : ""}`}
                        style={{
                          gridTemplateColumns: cols,
                          ...(me && !top ? { background: `${color}1F`, borderColor: `${color}73` } : {}),
                        }}
                      >
                        <span className="lb-pos">{e.position}</span>
                        <span style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
                          <Helmet color={color} size={top ? 60 : podium ? 52 : 44} />
                          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                            <span className="lb-name">{d?.name ?? "Guest"}</span>
                            <span className="lb-meta" style={{ color: me ? color : "var(--muted)" }}>
                              {me ? "In the seat · " : ""}
                              {car ? ago(e.setAt) : `${e.car} · ${ago(e.setAt)}`}
                            </span>
                          </span>
                        </span>
                        <span className="mono r lb-time">{lapTime(e.timeMs)}</span>
                        <span className="mono r lb-small" style={{ color: "var(--muted)" }}>{top ? "—" : gap(e.gapMs)}</span>
                        {bestSectors.map((best, i) => {
                          const t = e.sectorsMs[i];
                          const own = e.bestSectorsMs[i];
                          const colour = !(t > 0) ? "var(--muted)" : t === best ? PURPLE : own != null && t <= own ? MINT : "var(--text-2)";
                          return (
                            <span key={i} className="mono r lb-small" style={{ color: colour }}>
                              {t > 0 ? (t / 1000).toFixed(3) : "—"}
                            </span>
                          );
                        })}
                        <span className="mono r lb-small" style={{ color: "var(--text-2)" }}>{e.lapCount}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="lb-legend">
                <span style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                  <span className="lb-key"><i style={{ background: PURPLE }} />Fastest sector</span>
                  <span className="lb-key"><i style={{ background: MINT }} />Personal best sector</span>
                </span>
                <span>{includeInvalid ? "Cut laps included" : "Valid laps only"} · out and in laps never count</span>
              </div>
            </section>

            <aside className="card" style={{ flex: "1 1 260px" }}>
              <h2 style={{ fontSize: 18 }}>{selected ? trackName(selected.track, selected.layout) : ""} records</h2>
              {idealMs !== null && (
                <div className="list-row" style={{ justifyContent: "space-between" }} title="Best sectors on this board added together">
                  <span style={{ fontSize: 14 }}>Ideal lap (best sectors)</span>
                  <span className="mono" style={{ fontSize: 14, color: PURPLE }}>{lapTime(idealMs)}</span>
                </div>
              )}
              {records.filter((r) => r.top).map((r) => (
                <div key={r.car} className="list-row" style={{ justifyContent: "space-between" }}>
                  <span style={{ fontSize: 14 }}>{r.car}</span>
                  <span className="mono" style={{ fontSize: 14, color: "var(--gold)" }}>
                    {lapTime(r.top!.timeMs)} · {r.top!.driverId != null ? driverMap.get(r.top!.driverId)?.name : "Guest"}
                  </span>
                </div>
              ))}
            </aside>
          </div>
        </>
      )}
    </>
  );
}
