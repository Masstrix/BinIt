import { useState } from "react";
import { api, useAppState, useFetch } from "../api";
import { OverlayEditor } from "../components/OverlayEditor";
import { QrCode } from "../components/QrCode";

const GAMES = [
  { key: "acevo", name: "AC EVO", detail: "Laps · shared memory", ready: true },
  { key: "ac", name: "Assetto Corsa", detail: "Laps · shared memory", ready: true },
  { key: "dr2", name: "DiRT Rally 2.0", detail: "Stages · UDP telemetry", ready: false },
  { key: "acr", name: "Assetto Corsa Rally", detail: "Stages · shared memory", ready: true },
];

/** Which games TimeTrial can follow, and which one is running right now. */
function SupportedGames({ running }: { running: string | null }) {
  return (
    <section className="card" aria-label="Supported games" style={{ gap: 10, padding: "16px 20px" }}>
      <h2 style={{ fontSize: 17 }}>Supported games</h2>
      <div className="games-list">
        {GAMES.map((g) => {
          const on = running === g.key;
          return (
            <div key={g.key} className="game-tile" data-running={on || undefined} data-soon={!g.ready || undefined}>
              <span className="game-tile-name">{g.name}</span>
              <span className={`chip ${on ? "" : "plain"}`} style={on ? { background: "rgba(13,18,36,0.3)" } : undefined}>
                {on && <span className="dot on" style={{ width: 8, height: 8 }} />}
                {on ? "Running" : g.ready ? "Supported" : "Coming soon"}
              </span>
              <span className="game-tile-detail">{g.detail}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function GamesPage() {
  const { status, online } = useAppState();
  const server = useFetch(() => api.server(), [online]);
  const [lanSaved, setLanSaved] = useState<boolean | null>(null);
  const url = server?.urls[0];

  const lanOn = lanSaved ?? server?.lanEnabled ?? true;

  return (
    <>
      <h1>Games &amp; overlay</h1>

      <OverlayEditor />

      <SupportedGames running={status?.connected ? status.game : null} />

      <section className="card" style={{ flexDirection: "row", flexWrap: "wrap", gap: 28 }} aria-label="In-game controls">
        <div style={{ flex: "999 1 420px", minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={{ fontSize: 20 }}>Playing in fullscreen?</h2>
          <span className="muted" style={{ fontSize: 14 }}>
            The overlay draws on top of games running in <strong>borderless windowed</strong> mode. DirectX 12 games (like AC EVO) lose nothing
            in borderless. For DirectX 11 games, turn on Windows' <strong>Optimizations for windowed games</strong> (Settings › System › Display ›
            Graphics) to get fullscreen performance back.
          </span>
          <span className="muted" style={{ fontSize: 14 }}>
            In exclusive fullscreen the overlay can't be seen, but F8 still works: press F8, then a number (or type a new name and press Enter). TimeTrial
            says who's driving out loud.
          </span>
        </div>
        <div style={{ flex: "1 1 240px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontWeight: 700 }}>Hotkeys</div>
          <div className="head"><span>Switch / add driver</span><span className="kbd" style={{ background: "var(--line)", color: "var(--text)" }}>F8</span></div>
          <div className="head"><span>Pick while open</span><span className="kbd" style={{ background: "var(--line)", color: "var(--text)" }}>1–9</span></div>
          <div className="head"><span>Hide overlay</span><span className="kbd" style={{ background: "var(--line)", color: "var(--text)" }}>Ctrl+Shift+H</span></div>
        </div>
      </section>

      <section className="card" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 20 }} aria-label="Network access">
        <QrCode url={url} />
        <div style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <h2 style={{ fontSize: 20 }}>Open it anywhere in the office</h2>
          <span className="muted">Anyone on the network can view leaderboards and pick the next driver from their phone.</span>
          {server?.urls.map((u) => <span key={u} className="mono" style={{ fontSize: 18, color: "var(--peri-1)" }}>{u}</span>)}
          {lanSaved !== null && lanSaved !== server?.lanEnabled && <span style={{ color: "var(--peach)", fontSize: 14 }}>Restart TimeTrial to apply.</span>}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 600 }}>
          Share on network
          <button
            className="toggle"
            role="switch"
            aria-checked={lanOn}
            onClick={async () => setLanSaved(await api.setLan(!lanOn))}
          />
        </label>
      </section>
    </>
  );
}
