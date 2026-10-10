import { useState } from "react";
import { api, useAppState, type Driver } from "../api";
import { Helmet, Sparkle } from "../components/Helmet";

export const PALETTE = [
  ["#FF9F6B", "Peach"],
  ["#4FC3FF", "Sky"],
  ["#FF7AC6", "Pink"],
  ["#4BE3A6", "Mint"],
  ["#FFC93C", "Gold"],
  ["#B18CFF", "Violet"],
  ["#FF6B8A", "Red"],
  ["#EEF0FF", "White"],
] as const;

export function DriversPage() {
  const { drivers, status } = useAppState();
  return (
    <>
      <h1>Drivers</h1>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <NewDriver />
        <section className="card" style={{ flex: "1 1 360px" }}>
          <h2>Everyone ({drivers.length})</h2>
          {drivers.length === 0 && <div className="empty">Nobody yet. Be the first!</div>}
          <div className="list">
            {drivers.map((d) => <DriverRow key={d.id} driver={d} seated={status?.seat === d.id} />)}
          </div>
        </section>
      </div>
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

function NewDriver() {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(PALETTE[5][0]);
  const [error, setError] = useState<string | null>(null);

  const submit = async (seat: boolean) => {
    try {
      await api.addDriver(name, color, seat);
      setName("");
      setError(null);
      if (seat) location.hash = "#/";
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <form
      className="card"
      style={{ flex: "1 1 420px", alignItems: "center", textAlign: "center", gap: 22, position: "relative", overflow: "hidden" }}
      onSubmit={(e) => {
        e.preventDefault();
        submit(true);
      }}
    >
      <Sparkle size={26} color="#A9AEFF" style={{ left: 30, top: 30 }} />
      <Sparkle size={16} color="#FF9F6B" style={{ right: 40, top: 70 }} opacity={0.7} />
      <Helmet color={color} size={132} />
      <div>
        <h2 style={{ fontSize: 28 }}>New driver</h2>
        <div className="muted" style={{ marginTop: 6 }}>Just a name. That's it.</div>
      </div>
      <input
        className="input"
        aria-label="Your name"
        value={name}
        maxLength={32}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        style={{ minHeight: 64, fontSize: 24, fontWeight: 700, textAlign: "center", borderColor: "var(--violet)" }}
      />
      <ColorPicker value={color} onChange={setColor} />
      {error && <span className="error">{error}</span>}
      <button className="btn big" type="submit" disabled={!name.trim()} style={{ width: "100%", minHeight: 60 }}>Let's race</button>
      <button className="btn ghost" type="button" disabled={!name.trim()} onClick={() => submit(false)}>Just add (don't seat)</button>
      <span className="muted" style={{ fontSize: 13 }}>No passwords: anyone can pick any name. Play fair.</span>
    </form>
  );
}

function DriverRow({ driver, seated }: { driver: Driver; seated: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(driver.name);
  const [color, setColor] = useState(driver.color);
  const [error, setError] = useState<string | null>(null);

  if (editing) {
    return (
      <div className="list-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
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

  return (
    <div className="list-row">
      <Helmet color={driver.color} size={44} />
      <span className="grow">
        <span style={{ fontWeight: 700 }}>{driver.name}</span>
        {seated && <span style={{ fontSize: 13, color: "var(--peach)" }}>in the seat</span>}
      </span>
      {!seated && <button className="chip plain" style={{ border: "none", minHeight: 36 }} onClick={() => api.setSeat(driver.id)}>Drive</button>}
      <button className="chip plain" style={{ border: "none", minHeight: 36 }} onClick={() => setEditing(true)}>Edit</button>
    </div>
  );
}
