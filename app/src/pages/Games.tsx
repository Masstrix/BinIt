import { useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { api, useAppState, useFetch } from "../api";
import { OVERLAY_PROFILES } from "./Overlay";

const GAMES = [
  { key: "acevo", name: "AC EVO", detail: "Laps · shared memory", ready: true },
  { key: "ac", name: "Assetto Corsa", detail: "Laps · shared memory", ready: false },
  { key: "acc", name: "ACC", detail: "Laps · shared memory", ready: false },
  { key: "dr2", name: "DiRT Rally 2.0", detail: "Stages · UDP telemetry", ready: false },
  { key: "wrc", name: "EA WRC", detail: "Stages · UDP telemetry", ready: false },
];

export function GamesPage() {
  const { status, online } = useAppState();
  const server = useFetch(() => api.server(), [online]);
  const [lanSaved, setLanSaved] = useState<boolean | null>(null);
  const profile = OVERLAY_PROFILES[status?.game ?? "acevo"] ?? OVERLAY_PROFILES.acevo;
  const url = server?.urls[0];

  const qr = useMemo(() => {
    if (!url) return null;
    const q = qrcode(0, "M");
    q.addData(url);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [url]);

  const lanOn = lanSaved ?? server?.lanEnabled ?? true;

  return (
    <>
      <h1>Games &amp; overlay</h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
        {GAMES.map((g) => {
          const running = status?.connected && status.game === g.key;
          return (
            <div key={g.key} className="card" style={{ padding: 18, gap: 6, borderRadius: 22, ...(running ? { background: "var(--violet)", borderColor: "var(--violet)" } : {}) }}>
              <span className={`chip ${running ? "" : "plain"}`} style={{ alignSelf: "flex-start", ...(running ? { background: "rgba(13,18,36,0.3)" } : {}) }}>
                {running && <span className="dot on" style={{ width: 8, height: 8 }} />}
                {running ? "Running" : g.ready ? "Supported" : "Coming soon"}
              </span>
              <span style={{ font: "800 18px var(--font-display)", marginTop: 6 }}>{g.name}</span>
              <span style={{ fontSize: 14, opacity: 0.85 }}>{g.detail}</span>
            </div>
          );
        })}
      </div>

      <section className="card" style={{ flexDirection: "row", flexWrap: "wrap", gap: 28 }} aria-label="Overlay placement">
        <div style={{ flex: "999 1 420px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="head">
            <h2 style={{ fontSize: 20 }}>Overlay placement · {profile.name}</h2>
            <span className="chip plain">Auto (game profile)</span>
          </div>
          <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", borderRadius: 18, background: "#2B3138", overflow: "hidden" }}>
            {profile.hud.map((z) => (
              <div key={z.label} title={z.label} style={{ position: "absolute", ...z.box, border: "2px dashed rgba(255,107,138,0.85)", background: "rgba(255,107,138,0.14)", borderRadius: 6 }} />
            ))}
            <div style={{ position: "absolute", ...profile.strip, width: "30%", height: "8%", borderRadius: 8, background: "var(--violet)", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700 }}>1 · Driver strip</div>
            <div style={{ position: "absolute", ...profile.toasts, width: "22%", height: "9%", borderRadius: 8, background: "var(--mint)", color: "#062A1C", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700 }}>2 · Pop-ups</div>
          </div>
          <span className="muted" style={{ fontSize: 13 }}>
            Red boxes are the game's own HUD (approximate). TimeTrial keeps its two widgets clear of them. Run the game in borderless windowed mode so the overlay can draw on top.
          </span>
        </div>
        <div style={{ flex: "1 1 240px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontWeight: 700 }}>Hotkeys</div>
          <div className="head"><span>Switch / add driver</span><span className="kbd" style={{ background: "var(--line)", color: "var(--text)" }}>F8</span></div>
          <div className="head"><span>Hide overlay</span><span className="kbd" style={{ background: "var(--line)", color: "var(--text)" }}>Ctrl+Shift+H</span></div>
        </div>
      </section>

      <section className="card" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 20 }} aria-label="Network access">
        <div
          style={{ width: 120, height: 120, borderRadius: 18, background: "#EEF0FF", padding: 6, flex: "none", display: "grid", placeItems: "center", color: "var(--bg)", fontSize: 12 }}
          role="img"
          aria-label={url ? `QR code for ${url}` : "No network address"}
          dangerouslySetInnerHTML={qr ? { __html: qr } : undefined}
        >
          {qr ? undefined : "No address"}
        </div>
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
