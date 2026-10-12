import { useAppState } from "../api";
import { InputsPanel } from "../components/InputsPanel";
import { LiveMap } from "../components/LiveMap";
import { carName, trackName } from "../format";

/** Everything live in one place: the track map with sector colours, and what the driver is doing. */
export function TelemetryPage() {
  const { status } = useAppState();
  const session = status?.session ?? null;
  const driving = !!(status?.live?.driving && session);

  return (
    <>
      <div className="head" style={{ alignItems: "flex-end" }}>
        <h1>Telemetry</h1>
        <span className="muted">{session ? `${trackName(session.track, session.layout)} · ${carName(session.car)}` : "No session"}</span>
      </div>
      {driving ? (
        <div className="telemetry-grid">
          <LiveMap />
          <InputsPanel />
        </div>
      ) : (
        <div className="empty">
          {status?.connected ? "Waiting for you to get on track…" : "Start a game and get on track to see live telemetry."}
        </div>
      )}
    </>
  );
}
