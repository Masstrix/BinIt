import { useEffect, useMemo, useState } from "react";
import { api, isActive, useAppState, useDriverMap, useFetch, type Challenge, type Combo, type Prize } from "../api";
import { Helmet } from "../components/Helmet";
import { countdown, gap, lapTime, ordinal, trackName } from "../format";

type EndPreset = "lunch" | "five" | "friday" | "custom" | "never";

function presetTime(p: EndPreset, custom: string): number | null {
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
      return custom ? new Date(custom).getTime() : null;
    case "never":
      return null;
  }
}

const PRESETS: { id: EndPreset; label: string; hint: string }[] = [
  { id: "lunch", label: "Lunch", hint: "13:00" },
  { id: "five", label: "5 o'clock", hint: "17:00" },
  { id: "friday", label: "Friday", hint: "Fri 17:00" },
  { id: "custom", label: "Custom", hint: "pick a time" },
  { id: "never", label: "No end", hint: "until I end it" },
];

const trackKey = (c: Pick<Combo, "game" | "track" | "layout">) => `${c.game}|${c.track}|${c.layout}`;

export function ChallengesPage() {
  const { challenges } = useAppState();
  const running = challenges.filter((c) => isActive(c));
  const finished = challenges.filter((c) => !isActive(c) && c.endsAt !== null && c.endsAt <= Date.now());

  return (
    <>
      <h1>Challenges</h1>
      {running.map((c) => <ChallengeCard key={c.id} challenge={c} />)}
      <NewChallengeForm />
      {finished.length > 0 && (
        <section className="card">
          <h2>Past challenges</h2>
          {finished.map((c) => <PastChallenge key={c.id} challenge={c} />)}
        </section>
      )}
    </>
  );
}

function ChallengeCard({ challenge: c }: { challenge: Challenge }) {
  const drivers = useDriverMap();
  const board = useFetch(() => api.challengeLeaderboard(c.id), [c.id]) ?? [];
  return (
    <section className="card">
      <div className="head" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="label" style={{ color: "var(--peach)" }}>Running</div>
          <h2 style={{ marginTop: 4 }}>{c.name}</h2>
          <div className="muted" style={{ marginTop: 4 }}>
            {trackName(c.track, c.layout)} · {c.car ?? "Any car"} {c.validOnly ? "· valid laps only" : ""} {c.maxLaps ? `· ${c.maxLaps} laps each` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {c.endsAt && <span className="chip plain mono">ends in {countdown(c.endsAt)}</span>}
          <button className="btn ghost" onClick={() => confirm(`End "${c.name}" now?`) && api.endChallenge(c.id)}>End now</button>
        </div>
      </div>
      {board.length === 0 ? (
        <div className="empty">No laps yet. First one to set a time takes the crown.</div>
      ) : (
        <div className="list">
          {board.map((e) => {
            const d = e.driverId != null ? drivers.get(e.driverId) : undefined;
            const prize =
              c.prizes.find((p) => p.place === ordinal(e.position)) ??
              (e.position === board.length && board.length > 1 ? c.prizes.find((p) => p.place === "Last") : undefined);
            return (
              <div className="list-row" key={e.lapId}>
                <span className="pos">{e.position}</span>
                <Helmet color={d?.color ?? "#5B6488"} size={40} />
                <span className="grow">
                  <span style={{ fontWeight: 700 }}>{d?.name ?? "Guest"}</span>
                  {prize && <span className="muted" style={{ fontSize: 13 }}>{prize.prize}</span>}
                </span>
                <span className="mono muted" style={{ fontSize: 13, fontWeight: 600 }}>{gap(e.gapMs)}</span>
                <span className="mono" style={{ fontSize: 17, color: e.position === 1 ? "var(--gold)" : undefined }}>{lapTime(e.timeMs)}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function PastChallenge({ challenge: c }: { challenge: Challenge }) {
  const drivers = useDriverMap();
  const board = useFetch(() => api.challengeLeaderboard(c.id), [c.id]) ?? [];
  const winner = board[0];
  return (
    <div className="list-row" style={{ justifyContent: "space-between" }}>
      <span>{c.name} <span className="muted" style={{ fontSize: 13 }}>· {trackName(c.track, c.layout)}</span></span>
      <span className="muted">
        {winner ? `Won by ${winner.driverId != null ? drivers.get(winner.driverId)?.name : "a guest"} · ${lapTime(winner.timeMs)}` : "No laps"}
      </span>
    </div>
  );
}

function NewChallengeForm() {
  const { status } = useAppState();
  const combos = useFetch(() => api.combos(), []) ?? [];
  const session = status?.session ?? null;

  // Tracks we know about: anything with laps, plus whatever is being driven right now.
  const known = useMemo(() => {
    const all = session ? [session, ...combos] : combos;
    const tracks = new Map<string, Combo>();
    const cars = new Map<string, Set<string>>();
    for (const c of all) {
      tracks.set(trackKey(c), c);
      if (!cars.has(trackKey(c))) cars.set(trackKey(c), new Set());
      cars.get(trackKey(c))!.add(c.car);
    }
    return { tracks: [...tracks.values()], cars };
  }, [combos, session]);

  const [name, setName] = useState("");
  const [track, setTrack] = useState("");
  const [car, setCar] = useState("");
  const [preset, setPreset] = useState<EndPreset>("friday");
  const [custom, setCustom] = useState("");
  const [validOnly, setValidOnly] = useState(true);
  const [limit, setLimit] = useState<number | null>(null);
  const [prizes, setPrizes] = useState<Prize[]>([{ place: "1st", prize: "" }]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!track && known.tracks.length) {
      setTrack(trackKey(known.tracks[0]));
      setCar(known.tracks[0].car);
    }
  }, [known, track]);

  const selected = known.tracks.find((t) => trackKey(t) === track);
  const cars = [...(known.cars.get(track) ?? [])];

  const submit = async () => {
    if (!selected) return;
    try {
      await api.createChallenge({
        name: name.trim() || `${trackName(selected.track)} Hot Lap`,
        game: selected.game,
        track: selected.track,
        layout: selected.layout,
        car: car || null,
        endsAt: presetTime(preset, custom),
        validOnly,
        maxLaps: limit,
        prizes: prizes.filter((p) => p.prize.trim()),
      });
      setName("");
      setPrizes([{ place: "1st", prize: "" }]);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (known.tracks.length === 0) {
    return (
      <section className="card">
        <h2>New challenge</h2>
        <div className="empty">Drive a lap first (or just get on track) so TimeTrial knows which tracks and cars you have.</div>
      </section>
    );
  }

  const places = ["1st", "2nd", "3rd", "Last"];
  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <form
        className="card"
        style={{ flex: "999 1 480px", gap: 22 }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2>New challenge</h2>
        <label className="field">
          Give it a name
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={selected ? `${trackName(selected.track)} Hot Lap` : ""} style={{ fontSize: 20, fontWeight: 700, minHeight: 56 }} />
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <label className="field" style={{ flex: "1 1 220px" }}>
            Track
            <select className="select" value={track} onChange={(e) => { setTrack(e.target.value); setCar(""); }}>
              {known.tracks.map((t) => <option key={trackKey(t)} value={trackKey(t)}>{trackName(t.track, t.layout)}</option>)}
            </select>
          </label>
          <label className="field" style={{ flex: "1 1 220px" }}>
            Car
            <select className="select" value={car} onChange={(e) => setCar(e.target.value)}>
              <option value="">Any car</option>
              {cars.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>

        <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
          <legend style={{ fontWeight: 600, marginBottom: 10 }}>Ends</legend>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
            {PRESETS.map((p) => (
              <label key={p.id} style={{ display: "flex", flexDirection: "column", gap: 4, padding: 14, borderRadius: 18, cursor: "pointer", background: preset === p.id ? "rgba(106,88,245,0.18)" : "var(--panel-2)", border: `2px solid ${preset === p.id ? "var(--violet)" : "var(--line)"}` }}>
                <input type="radio" name="end" checked={preset === p.id} onChange={() => setPreset(p.id)} style={{ accentColor: "var(--violet)" }} />
                <span style={{ font: "800 15px var(--font-display)" }}>{p.label}</span>
                <span className="muted" style={{ fontSize: 13 }}>{p.hint}</span>
              </label>
            ))}
          </div>
          {preset === "custom" && (
            <input type="datetime-local" className="input" style={{ marginTop: 10 }} value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Custom end time" />
          )}
        </fieldset>

        <fieldset style={{ border: "none", margin: 0, padding: 18, borderRadius: 22, background: "var(--panel-2)", display: "flex", flexDirection: "column", gap: 14 }}>
          <legend style={{ fontWeight: 600, padding: "0 4px" }}>House rules</legend>
          <label style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input type="checkbox" checked={validOnly} onChange={(e) => setValidOnly(e.target.checked)} style={{ width: 22, height: 22, accentColor: "var(--violet)" }} />
            Valid laps only (no cutting)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input type="checkbox" checked={limit !== null} onChange={(e) => setLimit(e.target.checked ? 10 : null)} style={{ width: 22, height: 22, accentColor: "var(--violet)" }} />
            Max
            <input type="number" min={1} value={limit ?? 10} disabled={limit === null} onChange={(e) => setLimit(Math.max(1, Number(e.target.value) || 1))} aria-label="Laps per driver" className="input" style={{ width: 80, minHeight: 36, padding: "0 8px" }} />
            laps per driver
          </label>
        </fieldset>

        {error && <span className="error">{error}</span>}
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn big" type="submit">Lights out</button>
        </div>
      </form>

      <aside className="card" style={{ flex: "1 1 300px", gap: 12 }} aria-label="Prizes">
        <div>
          <div className="label">Optional</div>
          <h2>Prizes</h2>
        </div>
        {prizes.map((p, i) => (
          <div key={i} className="prize" style={{ background: ["var(--peri-1)", "var(--peri-2)", "var(--peri-3)"][i] ?? "var(--panel-2)", color: i < 3 ? "var(--bg)" : "var(--text)" }}>
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
        {prizes.length < places.length && (
          <button className="btn ghost" style={{ borderStyle: "dashed" }} onClick={() => setPrizes([...prizes, { place: places[prizes.length], prize: "" }])}>
            + Add {places[prizes.length] === "Last" ? "a forfeit for last" : `${places[prizes.length]} place prize`}
          </button>
        )}
      </aside>
    </div>
  );
}
