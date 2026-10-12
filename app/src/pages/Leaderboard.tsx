import { cap, words } from "../vocab";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { api, useAppState, useCatalogue, useDriverMap, useFetch, useTrackMaps, type Combo } from "../api";
import { CarBadge, carItems, drivenTrackItems, findMap, TrackThumb } from "../catalogueItems";
import { Dropdown } from "../components/Dropdown";
import { Picker } from "../components/Picker";
import { Helmet } from "../components/Helmet";
import { TrackHero } from "../components/TrackHero";
import { useCompactTable } from "../useCompactTable";
import { usePersistedState } from "../persist";
import { ago, bestSectors as fastestSectors, carName, gameName, gap, gridMinWidth, lapTime, SECTOR_MINT as MINT, SECTOR_PURPLE as PURPLE, sectorColor } from "../format";

type Period = "today" | "week" | "all";

function periodStart(p: Period): number | null {
  const d = new Date();
  if (p === "all") return null;
  d.setHours(0, 0, 0, 0);
  if (p === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d.getTime();
}

const CAR_KEY = "tt.leaderboard.car";

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

  // Games that have laps, and the track last picked in each, so switching game returns to where you were in it.
  const games = useMemo(() => [...new Set(tracks.map((t) => t.game))], [tracks]);
  const [track, setTrack] = usePersistedState<string | null>("leaderboard.track", null, (v) => typeof v === "string");
  const [lastTrack, setLastTrack] = usePersistedState<Record<string, string>>("leaderboard.trackByGame", {}, (v) => typeof v === "object" && v !== null && !Array.isArray(v));
  const chooseTrack = (key: string) => {
    setTrack(key);
    setLastTrack({ ...lastTrack, [key.split("|")[0]]: key });
  };
  const chooseGame = (game: string) => {
    const remembered = lastTrack[game];
    const next = remembered && tracks.some((t) => trackKey(t) === remembered) ? remembered : tracks.find((t) => t.game === game) && trackKey(tracks.find((t) => t.game === game)!);
    if (next) chooseTrack(next);
  };
  // The car you picked sticks across track changes (and restarts); tracks where nobody
  // has driven it fall back to "Any car" without forgetting the pick.
  const [pickedCar, setPickedCarState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(CAR_KEY);
    } catch {
      return null;
    }
  });
  const setPickedCar = (c: string | null) => {
    setPickedCarState(c);
    try {
      if (c) localStorage.setItem(CAR_KEY, c);
      else localStorage.removeItem(CAR_KEY);
    } catch {
      // Storage unavailable: the pick just isn't remembered.
    }
  };
  const [period, setPeriod] = usePersistedState<Period>("leaderboard.period", "all", (v) => v === "today" || v === "week" || v === "all");
  const [includeInvalid, setIncludeInvalid] = usePersistedState("leaderboard.includeInvalid", false, (v) => typeof v === "boolean");

  // Default to what's being driven right now, else the first track with laps.
  useEffect(() => {
    if (tracks.length === 0) return; // still loading: keep what was remembered
    if (track && tracks.some((x) => trackKey(x) === track)) return; // a remembered track that still has laps

    const s = status?.session;
    const pick = (s && tracks.find((t) => trackKey(t) === trackKey(s))) || tracks[0];
    setTrack(trackKey(pick));
    if (s && trackKey(s) === trackKey(pick)) setPickedCar(s.car);
  }, [tracks, status?.session, track]);

  const selected = tracks.find((t) => trackKey(t) === track);
  const w = words(selected?.game);
  const catalogue = useCatalogue(selected?.game ?? null);
  const maps = useTrackMaps(selected?.game ?? null);
  const carsHere = combos.filter((c) => selected && trackKey(c) === trackKey(selected)).map((c) => c.car);
  const car = pickedCar && carsHere.includes(pickedCar) ? pickedCar : null;
  // Only the selected game's tracks: another game may have a track with the same name, and the switch above picks the game.
  const trackPickItems = useMemo(
    () => drivenTrackItems(combos.filter((c) => c.game === selected?.game), catalogue, maps),
    [combos, selected?.game, catalogue, maps],
  );
  const carPickItems = useMemo(() => {
    const items = carItems(catalogue, { only: new Set(carsHere) });
    // Cars the catalogue somehow lacks still get listed.
    const known = new Set(items.map((i) => i.value));
    return [...items, ...carsHere.filter((c) => !known.has(c)).map((c) => ({ value: c, label: carName(c), visual: <CarBadge name={carName(c)} /> }))];
  }, [catalogue, carsHere.join("|")]);

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
  const idealMs = sectorCount > 0 && bestSectors.every((t) => t !== null) ? bestSectors.reduce((a, t) => a! + t!, 0)! : null;

  return (
    <>
      <div className="head" style={{ alignItems: "center" }}>
        <h1>Leaderboard</h1>
      </div>

      {tracks.length === 0 ? (
        <div className="empty">Nothing recorded yet. Once someone finishes a lap or a stage it'll show up here.</div>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            {games.length > 1 ? (
              <Dropdown variant="pill" label="Game" value={selected?.game ?? games[0]} options={games.map((g) => ({ value: g, label: gameName(g) }))} onChange={chooseGame} />
            ) : (
              selected && <span className="filter-pill on">{gameName(selected.game)}</span>
            )}
            <Picker
              variant="pill"
              label={cap(w.track)}
              value={track ?? ""}
              items={trackPickItems}
              onChange={chooseTrack}
              tagLabel="Country"
              visualOf={(v) => {
                const t = tracks.find((x) => trackKey(x) === v);
                return <TrackThumb map={t ? findMap(maps, t.track, t.layout) : undefined} />;
              }}
            />
            <Picker
              variant="pill"
              label="Car"
              value={car ?? ""}
              anyLabel="Any car"
              items={carPickItems}
              onChange={(v) => setPickedCar(v || null)}
              tagLabel="Class"
            />
            <button className="filter-pill" aria-pressed={!includeInvalid} onClick={() => setIncludeInvalid(!includeInvalid)}>
              {!includeInvalid && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
              )}
              {w.rally ? "Valid runs only" : "Valid laps only"}
            </button>
          </div>

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
                          <Helmet color={d?.color ?? "#5B6488"} size={28} />
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
                          <span className="lb-c-driver" style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
                            <Helmet color={color} size={top ? 60 : podium ? 52 : 44} />
                            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                              <span className="lb-name">{d?.name ?? "Guest"}</span>
                              <span className="lb-meta" style={{ color: me ? color : "var(--muted)" }}>
                                {me ? "In the seat · " : ""}
                                {car ? ago(e.setAt) : `${carName(e.car)} · ${ago(e.setAt)}`}
                              </span>
                            </span>
                          </span>
                          <span className="mono r lb-time">{lapTime(e.timeMs)}</span>
                          <span className="lb-break" />
                  <span className="mono r lb-small lb-c-stat" data-label="GAP" style={{ color: "var(--muted)" }}>{top ? "—" : gap(e.gapMs)}</span>
                          {bestSectors.map((best, i) => {
                            const t = e.sectorsMs[i];
                            return (
                              <span key={i} className="mono r lb-small lb-c-stat" data-label={`S${i + 1}`} style={{ color: sectorColor(t, best, e.bestSectorsMs[i]) }}>
                                {t > 0 ? (t / 1000).toFixed(3) : "—"}
                              </span>
                            );
                          })}
                          <span className="mono r lb-small lb-c-stat" data-label={w.rally ? "RUNS" : "LAPS"} style={{ color: "var(--text-2)" }}>{e.lapCount}</span>
                        </div>
                      );
                    })}
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
                    <span>{includeInvalid ? `Cut ${w.laps} included` : `Valid ${w.laps} only`} · out and in {w.laps} never count</span>
                  </>
                )}
              </div>
            </section>
        </>
      )}
    </>
  );
}
