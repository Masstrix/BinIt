import { useState } from "react";
import { useAppState } from "../api";
import { InputsPanel } from "../components/InputsPanel";
import { LapAnalysis } from "../components/LapAnalysis";
import { LiveMap } from "../components/LiveMap";
import { carName, trackName } from "../format";

/**
 * Live: the track map with sector colours and what the driver is doing right now.
 * Analysis: any recorded lap (or rally run)'s inputs, laid over another. It opens on Live while someone is
 * driving and on Analysis otherwise (or when a lap is linked: #/telemetry/lap/<id>); the
 * switch at the top moves between them either way.
 */
export function TelemetryPage({ path }: { path: string }) {
  const { status } = useAppState();
  const session = status?.session ?? null;
  const driving = !!(status?.live?.onTrack && session);
  const linked = /^\/telemetry\/lap\/(\d+)/.exec(path);
  const lapId = linked ? Number(linked[1]) : null;
  // Arriving on a linked lap counts as choosing Analysis, so it stays put after the link is let go.
  const [picked, setPicked] = useState<"live" | "laps" | null>(lapId != null ? "laps" : null);
  const view = picked ?? (lapId != null || !driving ? "laps" : "live");

  return (
    <>
      <div className="page-head" style={{ alignItems: "center" }}>
        <h1>Telemetry</h1>
        <div className="segmented" role="group" aria-label="View">
          <button aria-pressed={view === "live"} onClick={() => setPicked("live")}>
            {driving && <span className="dot on" style={{ marginRight: 8 }} aria-label="Someone is driving" />}Live
          </button>
          <button aria-pressed={view === "laps"} onClick={() => setPicked("laps")}>Analysis</button>
        </div>
      </div>
      {view === "laps" ? (
        <LapAnalysis lapId={lapId} />
      ) : (
        <>
          {session && <span className="muted">{trackName(session.track, session.layout)} · {carName(session.car)}</span>}
          {driving ? (
            <div className="telemetry-grid">
              <LiveMap />
              <InputsPanel />
            </div>
          ) : (
            <div className="empty">
              {status?.connected ? "Waiting for you to get on track…" : "Start a game and get on track to see live telemetry."}
              <div style={{ marginTop: 12 }}>
                <button className="btn ghost" onClick={() => setPicked("laps")}>Look back at a recorded lap or run</button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
