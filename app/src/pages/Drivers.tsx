import { useState } from "react";
import { api, useAppState, useFetch, type Driver, type DriverRating } from "../api";
import { TIER_ORDER, tierByKey, tierOf } from "../driverStats";
import { Helmet } from "../components/Helmet";
import { Modal } from "../components/Modal";
import { useSeatSwitcher } from "../components/SeatSwitcher";
import { DriverProgress } from "./DriverProgress";

export const PALETTE = [
  ["#FF9F6B", "Peach"],
  ["#4FC3FF", "Sky"],
  ["#FF7AC6", "Pink"],
  ["#4fd39a", "Mint"],
  ["#FFC93C", "Gold"],
  ["#b79bff", "Violet"],
  ["#ff7a92", "Red"],
  ["#e8ebf4", "White"],
] as const;

export function DriversPage({ path = "/drivers" }: { path?: string }) {
  const { drivers, status } = useAppState();
  const [adding, setAdding] = useState(false);
  // Speed scores change whenever laps do (useFetch refetches then).
  const ratings = useFetch(() => api.driverRatings(), []) ?? [];
  const ratingOf = new Map(ratings.map((r) => [r.driverId, r]));
  // #/drivers/<id>: one driver's progress over time.
  const open = path.match(/^\/drivers\/(\d+)/);
  if (open) return <DriverProgress id={Number(open[1])} />;
  return (
    <>
      <div className="head" style={{ alignItems: "center" }}>
        <h1>Drivers</h1>
        <button className="btn" onClick={() => setAdding(true)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          New driver
        </button>
      </div>

      <section className="card">
        <h2>Everyone ({drivers.length})</h2>
        {drivers.length === 0 && (
          <div className="empty" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            Nobody yet. Be the first!
            <button className="btn big" onClick={() => setAdding(true)}>Add a driver</button>
          </div>
        )}
        {drivers.length > 0 && (
          <span className="muted" style={{ fontSize: 13 }}>
            Grouped by speed score: 100 means quickest on every track and car you share with others, and each point below is about 1% slower.
          </span>
        )}
        {TIER_ORDER.map((key) => {
          const group = drivers
            .filter((d) => tierOf(ratingOf.get(d.id)?.score).key === key)
            .sort((a, b) => (ratingOf.get(b.id)?.score ?? -1) - (ratingOf.get(a.id)?.score ?? -1) || a.name.localeCompare(b.name));
          if (group.length === 0) return null;
          const tier = tierByKey(key);
          return (
            <div key={key} className="tier-group">
              <div className="tier-head">
                <span style={{ color: tier.color, fontWeight: 800 }}>{tier.label}</span>
                <span className="muted" style={{ fontSize: 13 }}>{tier.blurb}</span>
              </div>
              <div className="driver-cards">
                {group.map((d) => <DriverCard key={d.id} driver={d} seated={status?.seat === d.id} rating={ratingOf.get(d.id)} />)}
              </div>
            </div>
          );
        })}
      </section>

      {adding && (
        <Modal title="New driver" narrow onClose={() => setAdding(false)}>
          <NewDriverForm onDone={() => setAdding(false)} />
        </Modal>
      )}
    </>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 10 }} role="group" aria-label="Helmet colour">
      {PALETTE.map(([hex, label]) => (
        <button
          key={hex}
          type="button"
          aria-label={label}
          aria-pressed={value === hex}
          onClick={() => onChange(hex)}
          style={{ width: 44, height: 44, borderRadius: 14, background: hex, padding: 0, border: `3px solid ${value === hex ? "var(--text)" : "transparent"}` }}
        />
      ))}
    </div>
  );
}

/** Name and a helmet colour: the whole sign-up. Lives in a dialog so the page stays about the drivers. */
function NewDriverForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(PALETTE[5][0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (seat: boolean) => {
    setBusy(true);
    try {
      await api.addDriver(name, color, seat);
      onDone();
      if (seat) location.hash = "#/";
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <form
      className="modal-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit(true);
      }}
    >
      <div className="modal-body" style={{ alignItems: "center", textAlign: "center", gap: 18 }}>
        <Helmet color={color} size={84} />
        <input
          className="input"
          data-autofocus
          aria-label="Name"
          value={name}
          maxLength={32}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          style={{ minHeight: 56, fontSize: 20, fontWeight: 700, textAlign: "center", width: "100%" }}
        />
        <ColorPicker value={color} onChange={setColor} />
        {error && <span className="error">{error}</span>}
        <span className="muted" style={{ fontSize: 13 }}>No passwords: anyone can pick any name. Play fair.</span>
      </div>
      <div className="modal-foot">
        <button className="btn ghost" type="button" disabled={!name.trim() || busy} onClick={() => submit(false)}>Just add</button>
        <button className="btn big" type="submit" disabled={!name.trim() || busy}>Let's race</button>
      </div>
    </form>
  );
}

function DriverCard({ driver, seated, rating }: { driver: Driver; seated: boolean; rating?: DriverRating }) {
  const seat = useSeatSwitcher();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(driver.name);
  const [color, setColor] = useState(driver.color);
  const [error, setError] = useState<string | null>(null);

  if (editing) {
    return (
      <div className="driver-card editing">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" maxLength={32} />
        <ColorPicker value={color} onChange={setColor} />
        {error && <span className="error">{error}</span>}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn"
            onClick={async () => {
              try {
                await api.updateDriver(driver.id, name, color);
                setEditing(false);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Save
          </button>
          <button className="btn ghost" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </div>
    );
  }

  const fastestOn = rating?.fastestOn ?? 0;
  return (
    <div className="driver-card" data-seated={seated || undefined}>
      <div className="dc-top">
        <Helmet color={driver.color} size={52} seed={driver.id} />
        <a className="dc-name driver-link" href={`#/drivers/${driver.id}`} title={`See how ${driver.name} has improved`}>
          <span style={{ fontWeight: 700, fontSize: 17, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{driver.name}</span>
          <span className="dc-sub">
            {seated && <span style={{ color: "var(--peach)" }}>in the seat</span>}
            {seated && fastestOn > 0 && " · "}
            {fastestOn > 0 && <span className="muted">fastest on {fastestOn}</span>}
          </span>
        </a>
        {rating?.score != null && (
          <span className="speed-score" title={`Speed score from ${rating.combos} shared ${rating.combos === 1 ? "track and car" : "tracks and cars"}`}>
            <span className="mono">{rating.score.toFixed(1)}</span>
            <span className="label">speed</span>
          </span>
        )}
      </div>
      <span className="driver-actions">
        <a className="chip plain" href={`#/drivers/${driver.id}`}>Progress</a>
        {!seated && <button className="chip plain" onClick={() => seat.choose(driver)}>Drive</button>}
        <button className="chip plain" onClick={() => setEditing(true)}>Edit</button>
      </span>
      {seat.dialog}
    </div>
  );
}
