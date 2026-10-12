import { useMemo, useState } from "react";
import { api, isTauri, useAppState, useFetch, type Combo } from "../api";
import { CarBadge } from "../catalogueItems";
import { Logo } from "../components/Helmet";
import { Modal } from "../components/Modal";
import { Picker, type PickerItem } from "../components/Picker";
import { carName, gameName, trackName } from "../format";

/** Value for a track (+ optionally one layout) in the picker. */
const scopeValue = (game: string, track: string, layout: string | null) => JSON.stringify([game, track, layout]);
const parseScope = (v: string): { game: string; track: string; layout: string | null } => {
  const [game, track, layout] = JSON.parse(v) as [string, string, string | null];
  return { game, track, layout };
};

const mb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** Which version this is, and where its data lives. */
function AboutCard() {
  const { online } = useAppState();
  const about = useFetch(() => api.about(), [online]);
  if (!about) return null;
  const rows: [string, string][] = [
    ["Version", `${about.version} · build ${about.buildNumber}${about.build === "development" ? " (development build)" : ""}`],
    [
      "Updates",
      about.build === "development"
        ? "Development build: doesn't check for updates"
        : about.installed
          ? about.update
            ? `${about.update.version} is out and installs next time Bin It starts`
            : "Checks for a new version every time Bin It starts, and installs it"
          : `Portable copy: it can't update itself${about.update ? `, and ${about.update.version} is out` : ""}. Get the latest from the Home page`,
    ],
    ["Network", `Port ${about.port}, ${about.lanEnabled ? "shared on the office network" : "this PC only"}`],
    ["Data", about.counts.laps === 0 ? "No laps yet" : `${about.counts.laps} laps (${about.counts.timedLaps} timed, ${about.counts.tracedLaps} with input traces), ${about.counts.drivers} drivers, ${about.counts.challenges} challenges`],
    ["Database", `${about.dbBytes !== null ? `${mb(about.dbBytes)} · ` : ""}format ${about.counts.schemaVersion}${about.counts.createdWith ? ` · created by ${about.counts.createdWith}` : ""}${about.counts.previousVersion && about.counts.previousVersion !== about.version ? ` · last used by ${about.counts.previousVersion}` : ""}`],
    ["Data folder", about.dataDir ?? "unknown"],
    ["System", `${about.os}${about.webview ? ` · WebView2 ${about.webview}` : ""}`],
  ];
  return (
    <section className="card" aria-label="About Bin It">
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Logo />
        <div>
          <h2>About {about.name}</h2>
          <span className="muted">Lap times and challenges for the office sim rig. Everything stays on this PC.</span>
        </div>
      </div>
      <dl className="about-list">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className={k === "Data folder" ? "mono" : undefined}>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Maintenance tools. Desktop app only: the server refuses these requests from other devices too. */
export function AdvancedPage() {
  const { online } = useAppState();
  const combos = useFetch(() => api.combos(), [online]) ?? [];
  const [scope, setScope] = useState("");
  const [car, setCar] = useState("");
  const [forgetMap, setForgetMap] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // One entry per track ("all layouts"), then one per layout, so a whole track or a single layout can go.
  const trackItems = useMemo<PickerItem[]>(() => {
    const byTrack = new Map<string, Combo[]>();
    for (const c of combos) {
      const k = `${c.game}|${c.track}`;
      byTrack.set(k, [...(byTrack.get(k) ?? []), c]);
    }
    const items: PickerItem[] = [];
    for (const list of byTrack.values()) {
      const { game, track } = list[0];
      const layouts = [...new Set(list.map((c) => c.layout))];
      items.push({ value: scopeValue(game, track, null), label: trackName(track), sub: `All layouts · ${gameName(game)}`, search: layouts.join(" ") });
      if (layouts.length > 1 || layouts[0] !== "") {
        for (const l of layouts) items.push({ value: scopeValue(game, track, l), label: trackName(track, l), sub: gameName(game) });
      }
    }
    return items;
  }, [combos]);

  const picked = scope && trackItems.some((i) => i.value === scope) ? parseScope(scope) : null;
  const carsHere = useMemo(() => {
    if (!picked) return [];
    return [
      ...new Set(
        combos
          .filter((c) => c.game === picked.game && c.track === picked.track && (picked.layout === null || c.layout === picked.layout))
          .map((c) => c.car),
      ),
    ].sort();
  }, [combos, picked?.game, picked?.track, picked?.layout]);
  const carChoice = car && carsHere.includes(car) ? car : "";

  const filter = picked ? { game: picked.game, track: picked.track, layout: picked.layout, car: carChoice || null, forgetMap } : null;
  const count = useFetch(filter ? () => api.countLaps(filter) : null, [scope, carChoice, online]);

  if (!isTauri) {
    return (
      <>
        <h1>Advanced</h1>
        <div className="empty">These tools are only available in the Bin It app on the PC.</div>
      </>
    );
  }

  const describe = picked
    ? `${picked.layout === null ? trackName(picked.track) : trackName(picked.track, picked.layout)}${carChoice ? ` in the ${carChoice}` : ""}`
    : "";

  const doDelete = async () => {
    if (!filter) return;
    setBusy(true);
    try {
      const deleted = await api.deleteLaps(filter);
      setMessage(`Deleted ${deleted} ${deleted === 1 ? "lap" : "laps"} on ${describe}.`);
      setScope("");
      setCar("");
      setForgetMap(false);
    } catch (e) {
      setMessage(`Couldn't delete: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <>
      <h1>Advanced</h1>
      <AboutCard />
      <section className="card" aria-label="Clean up lap times">
        <div>
          <h2>Clean up lap times</h2>
          <span className="muted">
            Permanently delete recorded laps, for example test laps on a track. Challenges stay, they just lose those laps. Not available from phones or
            other devices.
          </span>
        </div>

        {trackItems.length === 0 ? (
          <div className="empty">No laps recorded yet, so there is nothing to clean up.</div>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                <Picker
                  label="Track"
                  title="Choose a track"
                  value={scope}
                  items={trackItems}
                  onChange={(v) => {
                    setScope(v);
                    setCar("");
                    setMessage(null);
                  }}
                />
              </div>
              <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                <Picker
                  label="Car"
                  title="Choose a car"
                  value={carChoice}
                  anyLabel="All cars"
                  items={carsHere.map((c) => ({ value: c, label: carName(c), visual: <CarBadge name={carName(c)} /> }))}
                  onChange={setCar}
                />
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <input type="checkbox" checked={forgetMap} onChange={(e) => setForgetMap(e.target.checked)} style={{ width: 22, height: 22, accentColor: "var(--violet)" }} />
              Also forget the learned track map and sector layout
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
              <button type="button" className="btn danger" disabled={!picked || !count} onClick={() => setConfirming(true)}>
                {picked ? (count ? `Delete ${count} ${count === 1 ? "lap" : "laps"}…` : "No laps match") : "Pick a track first"}
              </button>
              {picked && (
                <span className="muted">
                  {count ?? 0} {count === 1 ? "lap" : "laps"} on {describe}
                </span>
              )}
            </div>
          </>
        )}
        {message && (
          <div role="status" style={{ color: "var(--mint)", fontWeight: 600 }}>
            {message}
          </div>
        )}
      </section>

      {confirming && picked && (
        <Modal title="Delete these laps?" onClose={() => !busy && setConfirming(false)}>
          <div className="modal-body">
            <p style={{ margin: 0 }}>
              This permanently deletes{" "}
              <strong>
                {count} {count === 1 ? "lap" : "laps"}
              </strong>{" "}
              on <strong>{describe}</strong>
              {forgetMap ? ", plus its learned map and sector layout" : ""}. It can't be undone.
            </p>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button type="button" className="btn danger" disabled={busy} onClick={doDelete}>
              {busy ? "Deleting…" : "Delete for good"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
