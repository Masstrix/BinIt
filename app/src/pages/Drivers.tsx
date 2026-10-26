import { useState } from "react";
import { api, useAppState, useFetch, type Device, type Driver, type DriverRating } from "../api";
import { ago } from "../format";
import { TIER_ORDER, tierByKey, tierOf } from "../driverStats";
import { Helmet } from "../components/Helmet";
import { Modal } from "../components/Modal";

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

export function DriversPage() {
  const { drivers, status } = useAppState();
  const [adding, setAdding] = useState(false);
  // Speed scores change whenever laps do (useFetch refetches then).
  const ratings = useFetch(() => api.driverRatings(), []) ?? [];
  const ratingOf = new Map(ratings.map((r) => [r.driverId, r]));
  return (
    <>
      <div className="page-head" style={{ alignItems: "center" }}>
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
            Grouped by speed score: 100 means quickest on every track and car you share with others, and each point below is about 1% slower. Open a driver for their profile.
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

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
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
        submit(false);
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
        <button className="btn ghost" type="button" disabled={!name.trim() || busy} onClick={() => submit(true)}>Add and drive now</button>
        <button className="btn big" type="submit" disabled={!name.trim() || busy}>Add driver</button>
      </div>
    </form>
  );
}

function DriverCard({ driver, seated, rating }: { driver: Driver; seated: boolean; rating?: DriverRating }) {
  const fastestOn = rating?.fastestOn ?? 0;
  // The whole card opens their profile: the level, bests and stickers, and (from this PC) editing and phones.
  return (
    <a className="driver-card" href={`#/you/${driver.id}`} data-seated={seated || undefined} title={`Open ${driver.name}'s profile`}>
      <span className="dc-tile" style={{ background: `${driver.color}2E` }}>
        <Helmet color={driver.color} look={driver.look} size={60} tile={false} seed={driver.id} mood={seated ? "happy" : "idle"} />
      </span>
      <span className="dc-title">{driver.name}</span>
      {seated && (
        <span className="dc-seat">
          <i /> in the seat
        </span>
      )}
      {rating?.score != null ? (
        <span className="dc-score" title={`Speed score from ${rating.combos} shared ${rating.combos === 1 ? "track and car" : "tracks and cars"}`}>
          <span className="mono">{rating.score.toFixed(1)}</span>
          <span className="label">speed</span>
        </span>
      ) : (
        <span className="muted" style={{ fontSize: 14 }}>Not rated yet</span>
      )}
      {fastestOn > 0 && <span className="muted dc-fast">Fastest on {fastestOn} {fastestOn === 1 ? "track" : "tracks"}</span>}
    </a>
  );
}

/** The phones and browsers signed in as a driver: pair one more, sign one out, or sign them all out (a lost phone). */
export function PhonesDialog({ driver }: { driver: Driver }) {
  const [tick, setTick] = useState(0);
  const list = useFetch<Device[]>(() => api.driverDevices(driver.id), [driver.id, tick]);
  const [error, setError] = useState<string | null>(null);
  const run = async (f: () => Promise<unknown>) => {
    setError(null);
    try {
      await f();
      setTick((t) => t + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <div className="modal-body">
        {list == null ? (
          <span className="muted">Loading…</span>
        ) : list.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Nothing is signed in as {driver.name}. A phone or browser signs in by picking them on its own sign-in screen.
          </p>
        ) : (
          <div className="list">
            {list.map((d) => (
              <div className="list-row" key={d.id}>
                <span className="grow">
                  <span>{d.label}</span>
                  <span className="muted" style={{ fontSize: 13 }}>paired {ago(d.createdAt)} · last used {ago(d.lastSeen)}</span>
                </span>
                <button className="chip plain" onClick={() => run(() => api.signOutDevice(d.id))}>Sign out</button>
              </div>
            ))}
          </div>
        )}
        {error && <span className="error">{error}</span>}
      </div>
      <div className="modal-foot">
        {list != null && list.length > 0 && (
          <button className="btn ghost" onClick={() => confirm(`Sign every phone out of ${driver.name}?`) && run(() => api.signOutDriver(driver.id))}>Sign all out</button>
        )}
      </div>
    </>
  );
}
