import { useRef } from "react";
import type { LiveInputs } from "../api";
import { useAppState } from "../api";

const WINDOW_MS = 10_000;
const THROTTLE = "#4fd39a";
const BRAKE = "#ff7a92";
const CLUTCH = "#c9c9ff";

interface Sample {
  t: number;
  throttle: number;
  brake: number;
  steering: number;
}

/** The last few seconds of pedal and steering input, collected from the live feed as it arrives. */
function useInputHistory(inputs: LiveInputs | null | undefined, live: unknown): Sample[] {
  const ref = useRef<Sample[]>([]);
  const lastLive = useRef<unknown>(null);
  const now = Date.now();
  if (inputs && live !== lastLive.current) {
    lastLive.current = live;
    ref.current.push({ t: now, throttle: inputs.throttle, brake: inputs.brake, steering: inputs.steering });
  }
  ref.current = ref.current.filter((s) => now - s.t <= WINDOW_MS);
  return ref.current;
}

export function gearLabel(gear: number): string {
  return gear < 0 ? "R" : gear === 0 ? "N" : String(gear);
}

/** Gear, speed, pedals, steering and a rolling trace of the last 10 seconds. */
export function InputsPanel() {
  const { status } = useAppState();
  const live = status?.live ?? null;
  const inputs = live?.inputs ?? null;
  const history = useInputHistory(inputs, live);
  const now = Date.now();

  const x = (t: number) => ((t - (now - WINDOW_MS)) / WINDOW_MS) * 300;
  const line = (pick: (s: Sample) => number, top: number, height: number) =>
    history.map((s, i) => `${i ? "L" : "M"}${x(s.t).toFixed(1)} ${(top + height - pick(s) * height).toFixed(1)}`).join("");
  const area = (pick: (s: Sample) => number, top: number, height: number) =>
    history.length > 1 ? `${line(pick, top, height)}L${x(history[history.length - 1].t).toFixed(1)} ${top + height}L${x(history[0].t).toFixed(1)} ${top + height}Z` : "";

  return (
    <section className="card inputs" aria-label="Driver inputs">
      <div className="head" style={{ alignItems: "center" }}>
        <h2>Inputs</h2>
        {live?.slide && live.slide !== "none" && inputs?.dynamics ? (
          <span className="chip plain mono" role="status" style={{ background: live.slide === "spin" ? "rgba(255,107,138,0.18)" : "rgba(255,159,107,0.18)", color: live.slide === "spin" ? "#ff7a92" : "var(--peach)", fontSize: 15 }}>
            {live.slide === "spin" ? "SPIN" : "DRIFT"} {Math.abs(inputs.dynamics.slipDeg).toFixed(0)}°
          </span>
        ) : (
          <span className="muted" style={{ fontSize: 13 }}>last 10 seconds</span>
        )}
      </div>

      {!inputs ? (
        <div className="empty">This game isn't sending pedal data.</div>
      ) : (
        <>
          <div className="inputs-top">
            <div className="inputs-gear" aria-label={`Gear ${gearLabel(inputs.gear)}`}>
              <span className="label">GEAR</span>
              <span className="mono">{gearLabel(inputs.gear)}</span>
            </div>
            <div className="inputs-stat">
              <span className="label">SPEED</span>
              <span className="mono">{Math.round(inputs.speedKmh)}<small> km/h</small></span>
            </div>
            <div className="inputs-stat">
              <span className="label">RPM</span>
              <span className="mono">{inputs.rpm}</span>
            </div>
          </div>

          {inputs.dynamics && (
            <div className="inputs-top" aria-label="How the car is sliding">
              <div className="inputs-stat">
                <span className="label">SLIP</span>
                <span className="mono">
                  {Math.abs(inputs.dynamics.slipDeg).toFixed(0)}<small>°</small>
                  {live?.slide && live.slide !== "none" && <small style={{ marginLeft: 6, color: live.slide === "spin" ? "var(--red, #ff7a92)" : "var(--peach)" }}>{live.slide === "spin" ? "spin" : "drift"}</small>}
                </span>
              </div>
              <div className="inputs-stat">
                <span className="label">YAW</span>
                <span className="mono">{Math.round(inputs.dynamics.yawRateDps)}<small> °/s</small></span>
              </div>
              {inputs.dynamics.turboBoost > 0.01 && (
                <div className="inputs-stat">
                  <span className="label">BOOST</span>
                  <span className="mono">{inputs.dynamics.turboBoost.toFixed(2)}<small> bar</small></span>
                </div>
              )}
            </div>
          )}

          {inputs.dynamics && live && (live.slideStats.drifts > 0 || live.slideStats.spins > 0) && (
            <div className="muted" style={{ fontSize: 13, margin: "-4px 0 10px" }} aria-label="Sliding this lap">
              This lap:{" "}
              {live.slideStats.drifts > 0 && (
                <>
                  {live.slideStats.drifts} {live.slideStats.drifts === 1 ? "drift" : "drifts"} · {(live.slideStats.driftMs / 1000).toFixed(1)} s
                  {" "}(longest {(live.slideStats.longestMs / 1000).toFixed(1)} s, up to {Math.round(live.slideStats.peakSlipDeg)}°)
                </>
              )}
              {live.slideStats.spins > 0 && <>{live.slideStats.drifts > 0 ? " · " : ""}{live.slideStats.spins} {live.slideStats.spins === 1 ? "spin" : "spins"}</>}
            </div>
          )}

          <div className="pedals">
            {(
              [
                ["Throttle", inputs.throttle, THROTTLE],
                ["Brake", inputs.brake, BRAKE],
                ["Clutch", inputs.clutch, CLUTCH],
              ] as const
            ).map(([name, value, color]) => (
              <div className="pedal" key={name}>
                <div className="pedal-bar" role="meter" aria-label={name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
                  <div className="pedal-fill" style={{ height: `${Math.round(value * 100)}%`, background: color }} />
                </div>
                <span className="mono pedal-value">{Math.round(value * 100)}</span>
                <span className="label">{name}</span>
              </div>
            ))}

            <div className="steer">
              <span className="label">Steering</span>
              <div className="steer-track" role="meter" aria-label="Steering" aria-valuemin={-100} aria-valuemax={100} aria-valuenow={Math.round(inputs.steering * 100)}>
                <span className="steer-mid" />
                <span className="steer-fill" style={{ left: inputs.steering < 0 ? `${50 + inputs.steering * 50}%` : "50%", width: `${Math.abs(inputs.steering) * 50}%` }} />
                <span className="steer-knob" style={{ left: `${50 + inputs.steering * 50}%` }} />
              </div>
              <span className="mono steer-value">
                {Math.abs(inputs.steering) < 0.02 ? "centre" : `${inputs.steering < 0 ? "L" : "R"} ${Math.round(Math.abs(inputs.steering) * 100)}%`}
              </span>
            </div>
          </div>

          <svg viewBox="0 0 300 130" width="100%" className="trace" role="img" aria-label="Pedal and steering trace for the last 10 seconds" preserveAspectRatio="none">
            {[0, 0.5, 1].map((f) => (
              <line key={f} x1="0" x2="300" y1={80 - f * 80} y2={80 - f * 80} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray={f === 0 ? undefined : "2 4"} />
            ))}
            <path d={area((s) => s.throttle, 0, 80)} fill={THROTTLE} opacity="0.18" />
            <path d={area((s) => s.brake, 0, 80)} fill={BRAKE} opacity="0.28" />
            <path d={line((s) => s.throttle, 0, 80)} fill="none" stroke={THROTTLE} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            <path d={line((s) => s.brake, 0, 80)} fill="none" stroke={BRAKE} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            {/* Steering sits in its own strip below: centre line is straight ahead. */}
            <line x1="0" x2="300" y1="110" y2="110" stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <path d={line((s) => (s.steering + 1) / 2, 92, 36)} fill="none" stroke="var(--peri-1)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>
          <div className="trace-key">
            <span><i style={{ background: THROTTLE }} />Throttle</span>
            <span><i style={{ background: BRAKE }} />Brake</span>
            <span><i style={{ background: "var(--peri-1)" }} />Steering</span>
          </div>
        </>
      )}
    </section>
  );
}
