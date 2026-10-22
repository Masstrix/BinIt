import { useMemo, useState } from "react";
import { api, associationImageUrl, useAppState, useFetch, type AssociationEntry, type AssociationsView } from "../api";
import { Combo, type ComboOption } from "../components/Combo";
import dr2Names from "../data/dr2-names.json";

/** Games whose telemetry names nothing, so a developer records what their stages and cars are called. */
const GAMES = [{ key: "dr2", name: "DiRT Rally 2.0" }];

/** Suggestions per game, from public lists (see the file): the stages with their lengths, the cars, the groups. */
const SUGGESTIONS: Record<string, { stages: { country: string; stage: string; km: number; reverse: boolean }[]; cars: string[]; classes: string[] }> = {
  dr2: dr2Names,
};

/** A stage is told apart from its published length, which is given to 0.1 km: this close counts as a match (km). */
const LENGTH_TOLERANCE_KM = 0.15;

/**
 * Every known stage as a pick, the ones about as long as `km` first (closest first). Direction is part of the pick,
 * because the list has the reverse of a stage as a stage of its own.
 */
function stageOptions(game: string, km: number): ComboOption[] {
  const list = SUGGESTIONS[game]?.stages ?? [];
  const rank = (diff: number) => (diff <= LENGTH_TOLERANCE_KM ? diff : 99 + diff);
  const scored = list.map((s) => ({ s, diff: Math.abs(s.km - km) }));
  scored.sort((a, b) => rank(a.diff) - rank(b.diff));
  return scored.map(({ s, diff }) => ({
    value: `${s.country} ${s.stage}`,
    hint: `${s.km.toFixed(1)} km`,
    badge: diff <= LENGTH_TOLERANCE_KM ? "about this long" : undefined,
  }));
}

/**
 * Developer tools: record what a game's unnamed stages and cars are called. Only in a development build
 * (`tauri dev`); a name is saved at once and applies to everything stored, and Export writes the whole list into
 * the source tree so it ships with the next build and names the same stage for everyone.
 */
export function DevNamesPage() {
  const { status } = useAppState();
  const [game, setGame] = useState(GAMES[0].key);
  const [tick, setTick] = useState(0);
  const view = useFetch(() => api.devAssociations(game), [game, tick, status?.session?.track, status?.session?.car]);
  const refresh = () => setTick((t) => t + 1);
  const [exported, setExported] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (what: () => Promise<unknown>) => {
    setError(null);
    try {
      await what();
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!import.meta.env.DEV) {
    return (
      <>
        <h1>Names</h1>
        <div className="empty">The developer tools are only in a development build.</div>
      </>
    );
  }

  return (
    <>
      <h1>Names</h1>
      <section className="card" aria-label="About this page">
        <span className="muted">
          Developer tool. {GAMES.find((g) => g.key === game)?.name} doesn't say what its stages and cars are called, so record them here: drive a stage, name it
          and the car, and every stored run is relabelled at once. <strong>Export</strong> writes the list into the source tree; commit it and the next release
          names them for everyone.
        </span>
        <div className="segmented compact" role="group" aria-label="Game" style={{ alignSelf: "flex-start" }}>
          {GAMES.map((g) => (
            <button key={g.key} type="button" aria-pressed={game === g.key} onClick={() => setGame(g.key)}>
              {g.name}
            </button>
          ))}
        </div>
      </section>

      {error && (
        <div role="alert" style={{ color: "var(--red)", fontWeight: 600 }}>
          {error}
        </div>
      )}

      {view ? (
        <>
          <DrivingNow game={game} view={view} onSaved={refresh} run={run} />
          <Recorded game={game} entries={view.entries} run={run} />
          <Unnamed view={view} />
          <section className="card" aria-label="Export">
            <div>
              <h2>Export to source</h2>
              <span className="muted">Writes the list of names, and the car pictures recorded here, into the repository.</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn white"
                onClick={() => run(async () => setExported((await api.devExport(game)).written))}
                disabled={view.entries.length === 0}
              >
                Export {view.entries.length} {view.entries.length === 1 ? "name" : "names"}
              </button>
              {exported && (
                <span className="muted" role="status">
                  Wrote {exported.length} {exported.length === 1 ? "file" : "files"}: {exported.join(", ")}. Commit them.
                </span>
              )}
            </div>
          </section>
        </>
      ) : (
        <div className="empty">Waiting for the app…</div>
      )}
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
      <span className="label">{label}</span>
      <span className="mono">{value}</span>
    </span>
  );
}

function DrivingNow({ game, view, onSaved, run }: { game: string; view: AssociationsView; onSaved: () => void; run: (what: () => Promise<unknown>) => Promise<void> }) {
  const { identity } = view.now;
  if (!identity) {
    return (
      <section className="card" aria-label="Driving now">
        <h2>Driving now</h2>
        <div className="empty" style={{ minHeight: 0 }}>Start a stage to name it and the car.</div>
      </section>
    );
  }
  const { stage, car } = identity;
  const stageEntry = stage.id ? view.entries.find((e) => e.kind === "stage" && e.id === stage.id) : undefined;
  const carEntry = view.entries.find((e) => e.kind === "car" && e.id === car.id);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, alignItems: "start" }}>
      <StageCard game={game} stage={stage} label={view.now.stageLabel} entry={stageEntry} onSaved={onSaved} run={run} />
      <CarCard game={game} car={car} label={view.now.carLabel} entry={carEntry} onSaved={onSaved} run={run} />
    </div>
  );
}

function StageCard({
  game,
  stage,
  label,
  entry,
  onSaved,
  run,
}: {
  game: string;
  stage: { id: string | null; length_m: number; start: [number, number] | null };
  label: string | null;
  entry?: AssociationEntry;
  onSaved: () => void;
  run: (what: () => Promise<unknown>) => Promise<void>;
}) {
  const [name, setName] = useState(entry?.name ?? "");
  const km = stage.length_m / 1000;
  const options = useMemo(() => stageOptions(game, km), [game, km]);
  const save = () =>
    run(async () => {
      await api.devSaveAssociation(game, "stage", { name: name.trim(), detail: { length_m: stage.length_m, start: stage.start } });
      onSaved();
    });
  return (
    <section className="card" aria-label="Stage">
      <div className="head" style={{ alignItems: "baseline" }}>
        <h2>Stage</h2>
        <span className="chip plain mono">{stage.id ?? "no start seen"}</span>
      </div>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        <Detail label="Length" value={`${stage.length_m.toFixed(1)} m`} />
        <Detail label="Start line" value={stage.start ? `${stage.start[0].toFixed(1)}, ${stage.start[1].toFixed(1)}` : "not seen"} />
        <Detail label="Called now" value={label ?? "-"} />
      </div>
      {!stage.id ? (
        <div className="empty" style={{ minHeight: 0 }}>
          This stage was joined after the start, so its start line was never seen. Restart the stage to name it (a reverse stage has the same length).
        </div>
      ) : (
        <>
          <Combo
            label="Which stage is this?"
            value={name}
            onChange={setName}
            options={options}
            placeholder="Start typing, or pick from the list"
            note="Stages about this long are first. The reverse of a stage is its own entry, so pick the direction you drove."
          />
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <button type="button" className="btn white" disabled={!name.trim() || name.trim() === entry?.name} onClick={save}>
              {entry ? "Rename" : "Save name"}
            </button>
            {entry && <span className="muted">Recorded as <strong>{entry.name}</strong> ({entry.source})</span>}
          </div>
        </>
      )}
    </section>
  );
}

function CarCard({
  game,
  car,
  label,
  entry,
  onSaved,
  run,
}: {
  game: string;
  car: { id: string; max_rpm: number; idle_rpm: number; gears: number };
  label: string | null;
  entry?: AssociationEntry;
  onSaved: () => void;
  run: (what: () => Promise<unknown>) => Promise<void>;
}) {
  const savedGroup = typeof entry?.detail.class === "string" ? entry.detail.class : "";
  const [name, setName] = useState(entry?.name ?? "");
  const [group, setGroup] = useState(savedGroup);
  const [file, setFile] = useState<File | null>(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  const [bust, setBust] = useState(0);
  const names = useMemo<ComboOption[]>(() => (SUGGESTIONS[game]?.cars ?? []).map((value) => ({ value })), [game]);
  const groups = useMemo<ComboOption[]>(() => (SUGGESTIONS[game]?.classes ?? []).map((value) => ({ value })), [game]);
  const detail = { max_rpm: car.max_rpm, idle_rpm: car.idle_rpm, gears: car.gears, class: group.trim() || null };
  const changed = name.trim() !== (entry?.name ?? "") || group.trim() !== savedGroup || !!file;
  const save = () =>
    run(async () => {
      await api.devSaveAssociation(game, "car", { name: name.trim(), detail });
      if (file) await api.devSetAssociationImage(game, "car", car.id, file);
      setFile(null);
      setBust((b) => b + 1);
      onSaved();
    });
  const shown = preview ?? (entry?.hasImage ? `${associationImageUrl(game, "car", car.id)}?v=${bust}` : null);
  return (
    <section className="card" aria-label="Car">
      <div className="head" style={{ alignItems: "baseline" }}>
        <h2>Car</h2>
        <span className="chip plain mono">{car.id}</span>
      </div>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        <Detail label="Rev limit" value={`${car.max_rpm.toFixed(0)} rpm`} />
        <Detail label="Idle" value={`${car.idle_rpm.toFixed(0)} rpm`} />
        <Detail label="Gears" value={String(car.gears)} />
        <Detail label="Called now" value={label ?? "-"} />
      </div>
      <Combo label="Car" value={name} onChange={setName} options={names} placeholder="Start typing, or pick from the list" />
      <Combo label="Group" value={group} onChange={setGroup} options={groups} placeholder="R2, R5, Group A..." note="The class it races in. Pick one, or type another." />
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ width: 120, height: 72, borderRadius: 12, background: "var(--panel-2)", display: "grid", placeItems: "center", overflow: "hidden", flex: "none" }}>
          {shown ? <img src={shown} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /> : <span className="muted" style={{ fontSize: 12 }}>no picture</span>}
        </div>
        <label className="btn ghost" style={{ cursor: "pointer" }}>
          Choose picture…
          <input type="file" accept="image/*" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <button type="button" className="btn white" disabled={!name.trim() || !changed} onClick={save}>
          {entry ? "Update" : "Save name"}
        </button>
        {entry && <span className="muted">Recorded as <strong>{entry.name}</strong> ({entry.source})</span>}
      </div>
    </section>
  );
}

function Recorded({ game, entries, run }: { game: string; entries: AssociationEntry[]; run: (what: () => Promise<unknown>) => Promise<void> }) {
  const [editing, setEditing] = useState<string | null>(null);
  // Bumped whenever a picture is replaced, so the thumbnails fetch the new one.
  const [bust, setBust] = useState(0);
  return (
    <section className="card" aria-label="Recorded names">
      <div>
        <h2>Recorded</h2>
        <span className="muted">Every name in force: <em>dev</em> ones were recorded here and can be edited, <em>shipped</em> ones come with this build.</span>
      </div>
      {entries.length === 0 ? (
        <div className="empty" style={{ minHeight: 0 }}>Nothing recorded yet.</div>
      ) : (
        <div className="lb-scroll">
          {entries.map((e) => {
            const key = `${e.kind}-${e.id}`;
            const picture = e.hasImage ? `${associationImageUrl(game, "car", e.id)}?v=${bust}` : null;
            return (
              <div key={key} style={{ borderTop: "1px solid var(--line)", padding: "8px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <span className="chip plain" style={{ width: 52, justifyContent: "center" }}>{e.kind}</span>
                  <span className="mono" style={{ width: 70, color: "var(--muted)" }}>{e.id}</span>
                  {e.kind === "car" && <Thumb src={picture} />}
                  <span style={{ flex: "1 1 220px", fontWeight: 700 }}>
                    {e.name}
                    {typeof e.detail.class === "string" && e.detail.class && <span className="chip plain" style={{ marginLeft: 8 }}>{e.detail.class}</span>}
                  </span>
                  <span className={`chip ${e.source === "dev" ? "pb" : "plain"}`}>{e.source}</span>
                  {e.source === "dev" && editing !== key && (
                    <>
                      <button type="button" className="btn ghost" onClick={() => setEditing(key)}>Edit</button>
                      <button type="button" className="btn danger" onClick={() => run(() => api.devDeleteAssociation(game, e.kind, e.id))}>Remove</button>
                    </>
                  )}
                </div>
                {editing === key && (
                  <EditEntry
                    game={game}
                    entry={e}
                    picture={picture}
                    run={run}
                    onDone={(pictureChanged) => {
                      if (pictureChanged) setBust((b) => b + 1);
                      setEditing(null);
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** A small picture box (a car's), empty when it has none. */
function Thumb({ src, size = 48 }: { src: string | null; size?: number }) {
  return (
    <span style={{ width: size, height: size * 0.625, display: "grid", placeItems: "center", background: "var(--panel-2)", borderRadius: 8, overflow: "hidden", flex: "none" }}>
      {src && <img src={src} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />}
    </span>
  );
}

/** Changes a recorded name: its name, and for a car its group and its picture. */
function EditEntry({
  game,
  entry,
  picture,
  run,
  onDone,
}: {
  game: string;
  entry: AssociationEntry;
  picture: string | null;
  run: (what: () => Promise<unknown>) => Promise<void>;
  onDone: (pictureChanged: boolean) => void;
}) {
  const car = entry.kind === "car";
  const savedGroup = typeof entry.detail.class === "string" ? entry.detail.class : "";
  const [name, setName] = useState(entry.name);
  const [group, setGroup] = useState(savedGroup);
  const [file, setFile] = useState<File | null>(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  const options = useMemo<ComboOption[]>(() => {
    if (car) return (SUGGESTIONS[game]?.cars ?? []).map((value) => ({ value }));
    const length = entry.detail.length_m;
    return stageOptions(game, typeof length === "number" ? length / 1000 : 0);
  }, [game, car, entry.detail.length_m]);
  const groups = useMemo<ComboOption[]>(() => (SUGGESTIONS[game]?.classes ?? []).map((value) => ({ value })), [game]);
  const changed = name.trim() !== entry.name || group.trim() !== savedGroup || !!file;
  const save = () =>
    run(async () => {
      const detail = car ? { ...entry.detail, class: group.trim() || null } : entry.detail;
      await api.devSaveAssociation(game, entry.kind, { name: name.trim(), detail });
      if (file) await api.devSetAssociationImage(game, entry.kind, entry.id, file);
      onDone(!!file);
    });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 0 4px 0" }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "2 1 260px", minWidth: 0 }}>
          <Combo label={car ? "Car" : "Stage"} value={name} onChange={setName} options={options} placeholder="Start typing, or pick from the list" />
        </div>
        {car && (
          <div style={{ flex: "1 1 160px", minWidth: 0 }}>
            <Combo label="Group" value={group} onChange={setGroup} options={groups} placeholder="R2, R5, Group A..." />
          </div>
        )}
      </div>
      {car && (
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <Thumb src={preview ?? picture} size={120} />
          <label className="btn ghost" style={{ cursor: "pointer" }}>
            {picture || file ? "Choose a different picture…" : "Choose picture…"}
            <input type="file" accept="image/*" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {file && <span className="muted">New picture: {file.name}</span>}
        </div>
      )}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="btn white" disabled={!name.trim() || !changed} onClick={save}>Save</button>
        <button type="button" className="btn ghost" onClick={() => onDone(false)}>Cancel</button>
      </div>
    </div>
  );
}

function Unnamed({ view }: { view: AssociationsView }) {
  if (view.unknown.length === 0) return null;
  return (
    <section className="card" aria-label="Still unnamed">
      <div>
        <h2>Still unnamed</h2>
        <span className="muted">Stages and cars in this install's stored runs with no name yet. Drive one to name it.</span>
      </div>
      {view.unknown.map((u) => (
        <div key={`${u.kind}-${u.id}`} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="chip plain" style={{ width: 52, justifyContent: "center" }}>{u.kind}</span>
          <span className="mono" style={{ flex: 1 }}>{u.label}</span>
          <span className="muted">{u.runs} {u.runs === 1 ? "run" : "runs"}</span>
        </div>
      ))}
    </section>
  );
}
