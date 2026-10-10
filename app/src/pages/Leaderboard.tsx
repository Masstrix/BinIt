import { useEffect, useMemo, useState } from "react";
import { api, useAppState, useDriverMap, useFetch, type Combo } from "../api";
import { Dropdown } from "../components/Dropdown";
import { Helmet } from "../components/Helmet";
import { Podium } from "../components/Podium";
import { ago, gameName, gap, lapTime, trackName } from "../format";

type Period = "today" | "week" | "all";

function periodStart(p: Period): number | null {
  const d = new Date();
  if (p === "all") return null;
  d.setHours(0, 0, 0, 0);
  if (p === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d.getTime();
}

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
            <div style={{ flex: "999 1 520px", display: "flex", flexDirection: "column", gap: 0 }}>
              {board.length > 0 && <Podium entries={board} drivers={driverMap} />}
              <div className="card" style={{ padding: 16, gap: 8, marginTop: board.length > 0 ? -1 : 0 }}>
                {board.length === 0 && <div className="empty">No laps in this period.</div>}
                <div className="list">
                  {board.map((e) => {
                    const d = e.driverId != null ? driverMap.get(e.driverId) : undefined;
                    return (
                      <div key={e.lapId} className={`list-row${e.driverId != null && e.driverId === seat ? " me" : ""}`}>
                        <span className="pos">{e.position}</span>
                        <Helmet color={d?.color ?? "#5B6488"} size={44} />
                        <span className="grow">
                          <span style={{ fontWeight: 700 }}>{d?.name ?? "Guest"}</span>
                          <span className="muted" style={{ fontSize: 13 }}>
                            {e.lapCount} lap{e.lapCount === 1 ? "" : "s"} · {car ? ago(e.setAt) : `${e.car} · ${ago(e.setAt)}`}
                          </span>
                          {sectorCount > 0 && (
                            <span className="sectors" aria-label="Sector times">
                              {bestSectors.map((best, i) => {
                                const t = e.sectorsMs[i];
                                const purple = t > 0 && t === best;
                                return (
                                  <span key={i} className={`sector${purple ? " purple" : ""}`} title={`Sector ${i + 1}`}>
                                    <span className="sector-label">S{i + 1}</span>
                                    <span className="mono">{t > 0 ? (t / 1000).toFixed(3) : "--"}</span>
                                  </span>
                                );
                              })}
                            </span>
                          )}
                        </span>
                        <span className="mono muted" style={{ fontSize: 13, fontWeight: 600, width: 70, textAlign: "right" }}>{gap(e.gapMs)}</span>
                        <span className="mono" style={{ fontSize: 17, width: 96, textAlign: "right", color: e.position === 1 ? "var(--gold)" : undefined }}>
                          {lapTime(e.timeMs)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <aside className="card" style={{ flex: "1 1 260px" }}>
              <h2 style={{ fontSize: 18 }}>{selected ? trackName(selected.track, selected.layout) : ""} records</h2>
              {idealMs !== null && (
                <div className="list-row" style={{ justifyContent: "space-between" }} title="Best sectors on this board added together">
                  <span style={{ fontSize: 14 }}>Ideal lap (best sectors)</span>
                  <span className="mono" style={{ fontSize: 14, color: "#C38BFF" }}>{lapTime(idealMs)}</span>
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
