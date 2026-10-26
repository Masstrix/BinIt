import { words } from "../vocab";
import { useRef, type CSSProperties } from "react";
import { useRankMotion } from "../rankMotion";
import { api, useAppState, useDriverMap, useFetch } from "../api";
import { CarBadge } from "../catalogueItems";
import { Helmet } from "../components/Helmet";
import { TrackHero } from "../components/TrackHero";
import { TrackFilters, trackKey, useTrackSelection } from "../components/TrackFilters";
import { useCompactTable } from "../useCompactTable";
import { usePersistedState } from "../persist";
import { ago, bestSectors as fastestSectors, carName, gap, gridMinWidth, lapTime, SECTOR_MINT as MINT, SECTOR_PURPLE as PURPLE, sectorColor } from "../format";

type Period = "today" | "week" | "all";

function periodStart(p: Period): number | null {
  const d = new Date();
  if (p === "all") return null;
  d.setHours(0, 0, 0, 0);
  if (p === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d.getTime();
}

export function LeaderboardPage() {
  const { status } = useAppState();
  const driverMap = useDriverMap();
  const sel = useTrackSelection();
  const { tracks, track, selected, catalogue, maps, carsHere, car, setPickedCar } = sel;
  const [period, setPeriod] = usePersistedState<Period>("leaderboard.period", "all", (v) => v === "today" || v === "week" || v === "all");
  const [includeInvalid, setIncludeInvalid] = usePersistedState("leaderboard.includeInvalid", false, (v) => typeof v === "boolean");

  const w = words(selected?.game);

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
      // `selected` resolves only once the laps list has loaded, which with a remembered track is after the first render.
      [track, selected !== undefined, car, period, includeInvalid],
    ) ?? [];

  // Best lap per car on this track (the "Cars" view), under the same period and cut-lap filters as the board.
  const records =
    useFetch(
      selected
        ? () =>
            Promise.all(
              carsHere.slice(0, 24).map(async (c) => {
                const top = await api.leaderboard({ game: selected.game, track: selected.track, layout: selected.layout, car: c, from: periodStart(period), includeInvalid });
                return { car: c, top: top[0] };
              }),
            )
        : null,
      [track, selected !== undefined, carsHere.join("|"), period, includeInvalid],
    ) ?? [];
  const carRows = records.filter((r) => r.top).sort((a, b) => a.top!.timeMs - b.top!.timeMs);
  const [view, setView] = usePersistedState<"drivers" | "cars">("leaderboard.view", "drivers", (v) => v === "drivers" || v === "cars");

  const seat = status?.seat ?? null;
  // Someone is driving the selected track right now: show them on its map.
  const liveHere =
    selected && status?.session && trackKey(status.session) === trackKey(selected) && status.live?.driving && status.live.position
      ? { name: (seat != null ? driverMap.get(seat)?.name : undefined) ?? "Guest", position: status.live.position as [number, number] }
      : null;

  // Fastest time for each sector on this board: purple, like a timing screen.
  const bestSectors = fastestSectors(board);
  const sectorCount = bestSectors.length;
  const cols = `44px minmax(140px, 1fr) 132px 64px ${bestSectors.map(() => "56px").join(" ")} 44px`;
  const carCols = "44px minmax(150px, 1fr) 132px minmax(140px, 1fr) 76px";
  // The Cars view only exists where the switch is shown (more than one car has laps here).
  const cars = view === "cars" && carsHere.length > 1 && carRows.length > 0;
  const tableCols = cars ? carCols : cols;
  const { ref: tableRef, compact } = useCompactTable(gridMinWidth(tableCols));
  const rankKey = (e: (typeof board)[number]) => (e.driverId != null ? `d${e.driverId}` : `l${e.lapId}`);
  const motion = useRef<HTMLDivElement>(null);
  const flash = useRankMotion(board.map(rankKey), motion, true, `${track}|${car}|${period}|${includeInvalid}`);
  const idealMs = sectorCount > 0 && bestSectors.every((t) => t !== null) ? bestSectors.reduce((a, t) => a! + t!, 0)! : null;

  return (
    <>
      <div className="page-head" style={{ alignItems: "center" }}>
        <h1>Leaderboards</h1>
      </div>

      {tracks.length === 0 ? (
        <div className="empty">Nothing recorded yet. Once someone finishes a lap or a stage it'll show up here.</div>
      ) : (
        <>
          <TrackFilters sel={sel}>
            <button className="filter-pill" aria-pressed={!includeInvalid} onClick={() => setIncludeInvalid(!includeInvalid)}>
              {!includeInvalid && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
              )}
              {w.rally ? "Valid runs only" : "Valid laps only"}
            </button>
          </TrackFilters>

          {selected && (
            <TrackHero
              game={selected.game}
              track={selected.track}
              layout={selected.layout}
              catalogue={catalogue}
              maps={maps}
              car={car}
              drivers={board.length}
              laps={board.reduce((n, e) => n + e.lapCount, 0)}
              idealMs={idealMs}
              live={liveHere}
            >
              <div className="segmented" role="group" aria-label="Period">
                {(["today", "week", "all"] as Period[]).map((p) => (
                  <button key={p} aria-pressed={period === p} onClick={() => setPeriod(p)}>
                    {p === "today" ? "Today" : p === "week" ? "This week" : "All time"}
                  </button>
                ))}
              </div>
            </TrackHero>
          )}

            <section className="card lb" aria-label="Leaderboard">
              {carsHere.length > 1 && (
                <div className="lb-views segmented" role="group" aria-label="Group by">
                  <button aria-pressed={!cars} onClick={() => setView("drivers")}>Drivers</button>
                  <button aria-pressed={cars} onClick={() => setView("cars")}>Cars</button>
                </div>
              )}
              {cars ? (
                <div className="lb-scroll" style={{ "--lb-min": `${gridMinWidth(carCols)}px` } as CSSProperties} ref={tableRef} data-compact={compact || undefined}>
                  <div className="lb-grid lb-head" style={{ gridTemplateColumns: carCols }}>
                    <span style={{ textAlign: "center" }}>POS</span>
                    <span>CAR</span>
                    <span className="r">{w.rally ? "BEST TIME" : "BEST LAP"}</span>
                    <span style={{ paddingLeft: 14 }}>DRIVER</span>
                    <span className="r">SET</span>
                  </div>
                  {carRows.map((r, idx) => {
                    const e = r.top!;
                    const d = e.driverId != null ? driverMap.get(e.driverId) : undefined;
                    const info = catalogue?.cars.find((c) => c.name === r.car);
                    return (
                      <button
                        key={r.car}
                        type="button"
                        className={`lb-grid lb-row lb-btn${idx === 0 ? " top" : ""}`}
                        style={{ gridTemplateColumns: carCols }}
                        onClick={() => {
                          setPickedCar(r.car);
                          setView("drivers");
                        }}
                        aria-label={`Show the ${carName(r.car)} leaderboard`}
                      >
                        <span className="lb-pos">{idx + 1}</span>
                        <span className="lb-c-driver" style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
                          <span style={{ flex: "none", width: 48, height: 40 }}><CarBadge brand={info?.brand} name={r.car} /></span>
                          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                            <span className="lb-name">{carName(r.car)}</span>
                            <span className="lb-meta" style={{ color: "var(--muted)" }}>{[info?.brand, info?.class].filter(Boolean).join(" · ") || " "}</span>
                          </span>
                        </span>
                        <span className="mono r lb-time">{lapTime(e.timeMs)}</span>
                        <span className="lb-break" />
                        <span className="lb-c-stat lb-driver-cell" data-label="DRIVER">
                          <Helmet color={d?.color ?? "#5b6578"} size={28} seed={d?.id} />
                          <span className="lb-name" style={{ fontSize: 14 }}>{d?.name ?? "Guest"}</span>
                        </span>
                        <span className="r lb-small lb-c-stat" data-label="SET" style={{ color: "var(--muted)" }}>{ago(e.setAt)}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <>
                {board.length === 0 ? (
                  <div className="empty">No {w.laps} in this period.</div>
                ) : (
                  <div ref={motion} style={{ display: "contents" }}>
                  <div className="lb-scroll" style={{ "--lb-min": `${gridMinWidth(cols)}px` } as CSSProperties} ref={tableRef} data-compact={compact || undefined}>
                    <div className="lb-grid lb-head" style={{ gridTemplateColumns: cols }}>
                      <span style={{ textAlign: "center" }}>POS</span>
                      <span>DRIVER</span>
                      <span className="r">{w.rally ? "BEST TIME" : "BEST LAP"}</span>
                      <span className="r">GAP</span>
                      {bestSectors.map((_, i) => (
                        <span key={i} className="r">S{i + 1}</span>
                      ))}
                      <span className="r">{w.rally ? "RUNS" : "LAPS"}</span>
                    </div>
                    {board.map((e, idx) => {
                      const d = e.driverId != null ? driverMap.get(e.driverId) : undefined;
                      const color = d?.color ?? "#5b6578";
                      const top = idx === 0;
                      const podium = idx < 3;
                      const me = e.driverId != null && e.driverId === seat;
                      return (
                        <a
                          key={rankKey(e)}
                          href={`#/telemetry/lap/${e.lapId}`}
                          title="Analyse this lap"
                          className={`lb-grid lb-row lb-btn${top ? " top" : podium ? " lb-podium" : ""}`}
                          style={{
                            gridTemplateColumns: cols,
                          }}
                          data-me={me || undefined}
                          data-flip={`r:${rankKey(e)}`}
                          data-mv={flash(rankKey(e)).mv || undefined}
                        >
                          {!!flash(rankKey(e)).gain && <span className="mv-badge">▲ {flash(rankKey(e)).gain}</span>}
                          <span className="lb-pos">{e.position}</span>
                          <span className="lb-c-driver" style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
                            <span data-flip={`h:${rankKey(e)}`} style={{ display: "flex" }}>
                              <Helmet color={color} size={top ? 60 : podium ? 52 : 44} seed={d?.id} mood={e.position === 1 ? "happy" : "idle"} />
                            </span>
                            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                              <span className="lb-name">
                                {d?.name ?? "Guest"}
                                {me && <span className="chip you">YOU</span>}
                              </span>
                              <span className="lb-meta" style={{ color: "var(--muted)" }}>
                                {car ? ago(e.setAt) : `${carName(e.car)} · ${ago(e.setAt)}`}
                              </span>
                            </span>
                          </span>
                          <span className="mono r lb-time">{lapTime(e.timeMs)}</span>
                          <span className="lb-break" />
                  <span className="mono r lb-small lb-c-stat" data-label="GAP" style={{ color: "var(--muted)" }}>{top ? "—" : gap(e.gapMs)}</span>
                          {bestSectors.map((best, i) => {
                            const t = e.sectorsMs[i];
                            const col = sectorColor(t, best, e.bestSectorsMs[i]);
                            const fastest = col === PURPLE;
                            return (
                              <span key={i} className="mono r lb-small lb-c-stat" data-label={`S${i + 1}`}>
                                <span className={fastest ? "sector-pill" : undefined} style={fastest ? undefined : { color: col }}>
                                  {t > 0 ? (t / 1000).toFixed(3) : "—"}
                                </span>
                              </span>
                            );
                          })}
                          <span className="mono r lb-small lb-c-stat" data-label={w.rally ? "RUNS" : "LAPS"} style={{ color: "var(--text-2)" }}>{e.lapCount}</span>
                        </a>
                      );
                    })}
                  </div>
                  </div>
                )}
                </>
              )}
              <div className="lb-legend">
                {cars ? (
                  <>
                    <span>Fastest {w.lap} for each car · tap one to see its drivers</span>
                    <span>{includeInvalid ? `Cut ${w.laps} included` : `Valid ${w.laps} only`}</span>
                  </>
                ) : (
                  <>
                    <span style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                      <span className="lb-key"><i style={{ background: PURPLE }} />Fastest sector</span>
                      <span className="lb-key"><i style={{ background: MINT }} />Personal best sector</span>
                    </span>
                    <span>{includeInvalid ? `Cut ${w.laps} included` : `Valid ${w.laps} only`} · out and in {w.laps} never count · tap a row to analyse it</span>
                  </>
                )}
              </div>
            </section>
        </>
      )}
    </>
  );
}
