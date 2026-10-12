import { cap, words } from "../vocab";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { api, challengeMatches, isActive, useAppState, useCatalogue, useDriverMap, useFetch, useTrackMaps, type Challenge, type Prize } from "../api";
import { carItems, findMap, splitTrackValue, TrackThumb, trackItems } from "../catalogueItems";
import { ChallengeReplay } from "../components/ChallengeReplay";
import { Helmet } from "../components/Helmet";
import { useCompactTable } from "../useCompactTable";
import { Dropdown } from "../components/Dropdown";
import { DateTimePicker } from "../components/DateTimePicker";
import { Modal } from "../components/Modal";
import { Picker } from "../components/Picker";
import { Podium } from "../components/Podium";
import { ago, bestSectors, carName, countdown, gameName, gap, gridMinWidth, lapTime, ordinal, SECTOR_MINT, SECTOR_PURPLE, sectorColor, trackName, whenLabel } from "../format";

type EndPreset = "lunch" | "five" | "friday" | "custom" | "never";

function presetTime(p: EndPreset, custom: number): number | null {
  const d = new Date();
  const at = (h: number) => {
    const t = new Date(d);
    t.setHours(h, 0, 0, 0);
    if (t.getTime() <= Date.now()) t.setDate(t.getDate() + 1);
    return t.getTime();
  };
  switch (p) {
    case "lunch":
      return at(13);
    case "five":
      return at(17);
    case "friday": {
      const t = new Date(d);
      t.setDate(t.getDate() + ((5 - t.getDay() + 7) % 7));
      t.setHours(17, 0, 0, 0);
      if (t.getTime() <= Date.now()) t.setDate(t.getDate() + 7);
      return t.getTime();
    }
    case "custom":
      return custom;
    case "never":
      return null;
  }
}

const PRESETS: { id: EndPreset; label: string }[] = [
  { id: "lunch", label: "Lunch" },
  { id: "five", label: "5 o'clock" },
  { id: "friday", label: "Friday" },
  { id: "custom", label: "Pick a date" },
  { id: "never", label: "No end" },
];

const PLACES = ["1st", "2nd", "3rd", "Last"];

/** Gold trophy marking a challenge, so it reads differently from the everyday leaderboards (same glyph as the nav). */
function TrophyBadge({ small = false }: { small?: boolean }) {
  const size = small ? 16 : 24;
  return (
    <span className={`trophy-badge${small ? " sm" : ""}`} role="img" aria-label="Challenge" title="Challenge">
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3a3 3 0 0 1-3 4M7 5H4a3 3 0 0 0 3 4" />
      </svg>
    </span>
  );
}


/** The prize (or forfeit, for last place) a finishing position earns. */
function prizeFor(c: Challenge, position: number, total: number): string | undefined {
  return (
    c.prizes.find((p) => p.place === ordinal(position))?.prize ??
    (position === total && total > 1 ? c.prizes.find((p) => p.place === "Last")?.prize : undefined)
  );
}

export function ChallengesPage({ path }: { path: string }) {
  const { challenges, status } = useAppState();
  const [creating, setCreating] = useState(false);
  const running = challenges.filter((c) => isActive(c));
  const finished = challenges
    .filter((c) => !isActive(c) && c.endsAt !== null && c.endsAt <= Date.now())
    .sort((a, b) => b.endsAt! - a.endsAt!);

  // #/challenges/<id> picks one; otherwise whatever is being driven right now, else the first running.
  const wanted = Number(path.split("/")[2]);
  const session = status?.session ?? null;
  const shown =
    challenges.find((c) => c.id === wanted) ??
    (session && running.find((c) => challengeMatches(c, session))) ??
    running[0] ??
    null;

  return (
    <>
      <div className="head" style={{ alignItems: "center" }}>
        <h1>Challenges</h1>
        <button className="btn" onClick={() => setCreating(true)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          New challenge
        </button>
      </div>

      {running.length > 1 && (
        <nav className="ch-picker" aria-label="Running challenges">
          {running.map((c) => (
            <a key={c.id} href={`#/challenges/${c.id}`} className="ch-tab" aria-current={shown?.id === c.id ? "page" : undefined}>
              <span className="ch-tab-name"><TrophyBadge small />{c.name}</span>
              <span className="ch-tab-meta">
                {trackName(c.track, c.layout)}
                {c.endsAt ? ` · ${countdown(c.endsAt)}` : ""}
              </span>
            </a>
          ))}
        </nav>
      )}

      {shown ? (
        <ChallengeView key={shown.id} challenge={shown} />
      ) : (
        <section className="card" style={{ alignItems: "center", textAlign: "center", padding: "56px 24px" }}>
          <h2>No challenge running</h2>
          <p className="muted" style={{ margin: 0 }}>Pick a track and a deadline and let the office fight it out.</p>
          <button className="btn big" onClick={() => setCreating(true)}>Start a challenge</button>
        </section>
      )}

      {finished.length > 0 && (
        <section className="card">
          <h2>Past challenges</h2>
          <div className="list">
            {finished.map((c) => <PastChallenge key={c.id} challenge={c} selected={shown?.id === c.id} />)}
          </div>
        </section>
      )}

      {creating && (
        <Modal title="New challenge" onClose={() => setCreating(false)}>
          <NewChallengeForm
            onCreated={(c) => {
              setCreating(false);
              location.hash = `#/challenges/${c.id}`;
            }}
            onCancel={() => setCreating(false)}
          />
        </Modal>
      )}
    </>
  );
}

function ChallengeView({ challenge: c }: { challenge: Challenge }) {
  const { status } = useAppState();
  const drivers = useDriverMap();
  const board = useFetch(() => api.challengeLeaderboard(c.id), [c.id]) ?? [];
  const live = isActive(c);
  const seat = status?.seat ?? null;
  const hasPrizes = c.prizes.length > 0;
  const sectors = bestSectors(board);
  const cols = `44px minmax(150px, 1fr) ${hasPrizes ? "minmax(100px, 0.6fr) " : ""}132px 64px ${sectors.map(() => "56px ").join("")}44px`;
  const { ref: tableRef, compact } = useCompactTable(gridMinWidth(cols));

  return (
    <>
    <section className="card ch-view" aria-label={c.name}>
      <div className="head" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div className="label" style={{ color: live ? "var(--peach)" : "var(--muted)" }}>{live ? "Running" : "Finished"}</div>
          <div className="ch-title">
            <TrophyBadge />
            <h2 className="ch-name">{c.name}</h2>
          </div>
          <div className="ch-rules">
            <span className="chip plain">{gameName(c.game)}</span>
            <span className="chip plain">{trackName(c.track, c.layout)}</span>
            <span className="chip plain">{c.car ? carName(c.car) : "Any car"}</span>
            {c.validOnly && <span className="chip plain">Valid {words(c.game).laps} only</span>}
            {c.maxLaps && <span className="chip plain">{c.maxLaps} {words(c.game).laps} each</span>}
          </div>
        </div>
        <div className="ch-clock">
          {live ? (
            <>
              <span className="label">{c.endsAt ? "Ends in" : "Runs until ended"}</span>
              {c.endsAt && <span className="mono ch-countdown" title={whenLabel(c.endsAt)}>{countdown(c.endsAt)}</span>}
              <button className="btn ghost" onClick={() => confirm(`End "${c.name}" now?`) && api.endChallenge(c.id)}>End now</button>
            </>
          ) : (
            <>
              <span className="label">Ended</span>
              <span style={{ fontWeight: 600 }}>{c.endsAt ? whenLabel(c.endsAt) : ""}</span>
              <button className="btn ghost" onClick={() => confirm(`Delete "${c.name}" for good?`) && api.deleteChallenge(c.id).then(() => (location.hash = "#/challenges"))}>
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      <Podium
        entries={board}
        drivers={drivers}
        scale={230}
        big
        prizes={[1, 2, 3].map((p) => prizeFor(c, p, board.length))}
      />

      {board.length === 0 ? (
        <div className="empty">No {words(c.game).laps} yet. First one to set a time takes the crown.</div>
      ) : (
        <div className="lb-scroll" style={{ "--lb-min": `${gridMinWidth(cols)}px` } as CSSProperties} ref={tableRef} data-compact={compact || undefined}>
          <div className="lb-grid lb-head" style={{ gridTemplateColumns: cols }}>
            <span style={{ textAlign: "center" }}>POS</span>
            <span>DRIVER</span>
            {hasPrizes && <span>PRIZE</span>}
            <span className="r">{words(c.game).rally ? "BEST TIME" : "BEST LAP"}</span>
            <span className="r">GAP</span>
            {sectors.map((_, i) => (
              <span key={i} className="r">S{i + 1}</span>
            ))}
            <span className="r">LAPS</span>
          </div>
          {board.map((e) => {
            const d = e.driverId != null ? drivers.get(e.driverId) : undefined;
            const color = d?.color ?? "#5B6488";
            const me = live && e.driverId != null && e.driverId === seat;
            const prize = prizeFor(c, e.position, board.length);
            const podium = e.position <= 3;
            return (
              <div
                key={e.lapId}
                className={`lb-grid lb-row${podium ? ` place place-${e.position}` : ""}`}
                style={{ gridTemplateColumns: cols, ...(me && !podium ? { background: `${color}1F`, borderColor: `${color}73` } : {}) }}
              >
                <span className="lb-pos">{e.position}</span>
                <span className="lb-c-driver" style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
                  <Helmet color={color} size={podium ? 52 : 44} />
                  <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span className="lb-name">{d?.name ?? "Guest"}</span>
                    <span className="lb-meta" style={{ color: me ? color : "var(--muted)" }}>
                      {me ? "In the seat · " : ""}
                      {c.car ? ago(e.setAt) : `${carName(e.car)} · ${ago(e.setAt)}`}
                    </span>
                  </span>
                </span>
                {hasPrizes && <span className="lb-meta lb-c-prize" data-label="PRIZE" style={{ color: "var(--text-2)", fontWeight: 600 }}>{prize ?? ""}</span>}
                <span className="mono r lb-time">{lapTime(e.timeMs)}</span>
                <span className="lb-break" />
                <span className="mono r lb-small lb-c-stat" data-label="GAP" style={{ color: "var(--muted)" }}>{e.position === 1 ? "—" : gap(e.gapMs)}</span>
                {sectors.map((best, i) => {
                  const t = e.sectorsMs[i];
                  return (
                    <span key={i} className="mono r lb-small lb-c-stat" data-label={`S${i + 1}`} style={{ color: sectorColor(t, best, e.bestSectorsMs[i]) }}>
                      {t > 0 ? (t / 1000).toFixed(3) : "—"}
                    </span>
                  );
                })}
                <span className="mono r lb-small lb-c-stat" data-label={words(c.game).rally ? "RUNS" : "LAPS"} style={{ color: "var(--text-2)" }}>
                  {e.lapCount}
                  {c.maxLaps ? `/${c.maxLaps}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {board.length > 0 && sectors.length > 0 && (
        <div className="lb-legend">
          <span style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
            <span className="lb-key"><i style={{ background: SECTOR_PURPLE }} />Fastest sector</span>
            <span className="lb-key"><i style={{ background: SECTOR_MINT }} />Personal best sector</span>
          </span>
          <span>Sectors are from each driver's best {words(c.game).lap}</span>
        </div>
      )}
    </section>
    {board.length > 0 && <ChallengeReplay challenge={c} />}
    </>
  );
}

function PastChallenge({ challenge: c, selected }: { challenge: Challenge; selected: boolean }) {
  const drivers = useDriverMap();
  const board = useFetch(() => api.challengeLeaderboard(c.id), [c.id]) ?? [];
  const winner = board[0];
  return (
    <a className="list-row link-row" href={`#/challenges/${c.id}`} aria-current={selected ? "page" : undefined} style={{ justifyContent: "space-between" }}>
      <span>
        <TrophyBadge small />
        {c.name} <span className="muted" style={{ fontSize: 13 }}>· {trackName(c.track, c.layout)}</span>
      </span>
      <span className="muted">
        {winner ? `Won by ${winner.driverId != null ? drivers.get(winner.driverId)?.name : "a guest"} · ${lapTime(winner.timeMs)}` : "No laps"}
      </span>
    </a>
  );
}

function defaultCustomEnd() {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  t.setHours(17, 0, 0, 0);
  return t.getTime();
}

function NewChallengeForm({ onCreated, onCancel }: { onCreated: (c: Challenge) => void; onCancel: () => void }) {
  const { status } = useAppState();
  const combos = useFetch(() => api.combos(), []) ?? [];
  const session = status?.session ?? null;

  // Games to pick from: what's being driven, anything with laps, and AC EVO (the supported one).
  const games = useMemo(() => [...new Set([session?.game, ...combos.map((c) => c.game), "acevo"].filter((g): g is string => !!g))], [combos, session]);
  const [game, setGame] = useState(session?.game ?? "acevo");
  const catalogue = useCatalogue(game);
  const maps = useTrackMaps(game);
  const trackPickItems = useMemo(() => trackItems(catalogue, maps), [catalogue, maps]);
  const carPickItems = useMemo(() => carItems(catalogue), [catalogue]);

  const [name, setName] = useState("");
  const [track, setTrack] = useState("");
  const [car, setCar] = useState("");
  const [preset, setPreset] = useState<EndPreset>("friday");
  const [custom, setCustom] = useState(defaultCustomEnd);
  const [validOnly, setValidOnly] = useState(true);
  const [limit, setLimit] = useState<number | null>(null);
  const [withPrizes, setWithPrizes] = useState(false);
  const [prizes, setPrizes] = useState<Prize[]>([{ place: "1st", prize: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Start from what's being driven, else the first track in the list.
  useEffect(() => {
    if (track || trackPickItems.length === 0) return;
    const live = session && session.game === game ? trackPickItems.find((i) => splitTrackValue(i.value).track.toLowerCase() === session.track.toLowerCase() && splitTrackValue(i.value).layout.toLowerCase() === session.layout.toLowerCase()) : undefined;
    setTrack((live ?? trackPickItems[0]).value);
    if (live && session) setCar(session.car);
  }, [trackPickItems, track, session, game]);

  const selected = track ? splitTrackValue(track) : null;
  const endsAt = presetTime(preset, custom);

  const submit = async () => {
    if (!selected) return;
    if (endsAt !== null && endsAt <= Date.now()) {
      setError("That end time has already passed. Pick one in the future.");
      return;
    }
    setBusy(true);
    try {
      const created = await api.createChallenge({
        name: name.trim() || `${trackName(selected.track)} Hot Lap`,
        game,
        track: selected.track,
        layout: selected.layout,
        car: car || null,
        endsAt,
        validOnly,
        maxLaps: limit,
        prizes: withPrizes ? prizes.filter((p) => p.prize.trim()) : [],
      });
      onCreated(created);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  if (catalogue && trackPickItems.length === 0) {
    return (
      <div className="modal-body">
        <div className="empty">Bin It doesn't know any {words(game).tracks} for this game yet. {words(game).rally ? "Drive a stage" : "Get on track"} for a moment and it will learn {words(game).rally ? "it" : "them"}.</div>
      </div>
    );
  }

  return (
    <form
      className="modal-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="modal-body">
        <label className="field">
          Give it a name
          <input className="input" autoFocus={!window.matchMedia("(pointer: coarse)").matches} value={name} onChange={(e) => setName(e.target.value)} placeholder={selected ? `${trackName(selected.track)} Hot Lap` : ""} style={{ fontSize: 20, fontWeight: 700, minHeight: 56 }} />
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {games.length > 1 && (
            <div style={{ flex: "1 1 100%", minWidth: 0 }}>
              <Dropdown
                label="Game"
                value={game}
                options={games.map((g) => ({ value: g, label: gameName(g) }))}
                onChange={(g) => {
                  setGame(g);
                  setTrack("");
                  setCar("");
                }}
              />
            </div>
          )}
          <div style={{ flex: "1 1 220px", minWidth: 0 }}>
            <Picker
              label={cap(words(game).track)}
              title={`Choose a ${words(game).track}`}
              value={track}
              items={trackPickItems}
              onChange={setTrack}
              tagLabel="Country"
              visualOf={(v) => {
                const t = splitTrackValue(v);
                return <TrackThumb map={findMap(maps, t.track, t.layout)} />;
              }}
            />
          </div>
          <div style={{ flex: "1 1 220px", minWidth: 0 }}>
            <Picker label="Car" title="Choose a car" value={car} anyLabel="Any car" items={carPickItems} onChange={setCar} tagLabel="Class" />
          </div>
        </div>

        <fieldset className="plain-fieldset">
          <legend style={{ fontWeight: 600, marginBottom: 10 }}>Ends</legend>
          <div className="preset-grid">
            {PRESETS.map((p) => {
              const at = presetTime(p.id, custom);
              return (
                <label key={p.id} className="preset" data-on={preset === p.id || undefined}>
                  <input type="radio" name="end" checked={preset === p.id} onChange={() => setPreset(p.id)} />
                  <span style={{ font: "800 15px var(--font-display)" }}>{p.label}</span>
                  <span className="muted" style={{ fontSize: 13 }}>{at === null ? "until you end it" : p.id === "custom" && preset !== "custom" ? "on the calendar" : whenLabel(at)}</span>
                </label>
              );
            })}
          </div>
          {preset === "custom" && <DateTimePicker value={custom} onChange={setCustom} />}
        </fieldset>

        <div className="rules-box" role="group" aria-labelledby="house-rules">
          <h3 id="house-rules">House rules</h3>
          <label className="rules-row">
            <input type="checkbox" checked={validOnly} onChange={(e) => setValidOnly(e.target.checked)} />
            Valid {words(game).laps} only (no cutting)
          </label>
          <div className="rules-row">
            <input type="checkbox" aria-label={`Limit ${words(game).laps} per driver`} checked={limit !== null} onChange={(e) => setLimit(e.target.checked ? 10 : null)} />
            <label className="rules-limit">
              Max
              <input type="number" min={1} value={limit ?? 10} disabled={limit === null} onChange={(e) => setLimit(Math.max(1, Number(e.target.value) || 1))} className="input" />
              {words(game).laps} per driver
            </label>
          </div>
        </div>

        <div className="prize-box">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span>
              <span style={{ fontWeight: 600 }}>Prizes</span> <span className="muted" style={{ fontSize: 14 }}>· optional</span>
            </span>
            <button type="button" className="toggle" role="switch" aria-checked={withPrizes} aria-label="Add prizes" onClick={() => setWithPrizes(!withPrizes)} />
          </div>
          {withPrizes && (
            <>
              {prizes.map((p, i) => (
                <div key={i} className="prize" style={{ background: ["var(--peri-1)", "var(--peri-2)", "var(--peri-3)"][i] ?? "var(--panel-3)", color: i < 3 ? "var(--bg)" : "var(--text)" }}>
                  <b>{p.place}</b>
                  <input
                    value={p.prize}
                    onChange={(e) => setPrizes(prizes.map((q, j) => (j === i ? { ...q, prize: e.target.value } : q)))}
                    placeholder={p.place === "Last" ? "e.g. makes the coffee" : "e.g. picks Friday lunch"}
                    aria-label={`${p.place} prize`}
                    style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", textAlign: "right", fontWeight: 700, color: "inherit", outline: "none" }}
                  />
                </div>
              ))}
              {prizes.length < PLACES.length && (
                <button type="button" className="btn ghost" style={{ borderStyle: "dashed" }} onClick={() => setPrizes([...prizes, { place: PLACES[prizes.length], prize: "" }])}>
                  + Add {PLACES[prizes.length] === "Last" ? "a forfeit for last" : `${PLACES[prizes.length]} place prize`}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="modal-foot">
        {error && <span className="error" style={{ marginRight: "auto" }}>{error}</span>}
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn big" type="submit" disabled={busy || !selected}>Lights out</button>
      </div>
    </form>
  );
}
