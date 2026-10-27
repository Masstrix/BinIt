import { useRef } from "react";
import type { LiveAids } from "../api";

/** A setting with a range of levels: one pip each, filled up to the level the car's menu shows. */
function Pips({ level, max }: { level: number; max: number }) {
  const n = Math.min(Math.max(max, 1), 16);
  return (
    <span className="aid-pips" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <i key={i} data-on={i < level || undefined} />
      ))}
    </span>
  );
}

function LevelRow({ label, level, max, offWhenZero = false }: { label: string; level: number; max: number; offWhenZero?: boolean }) {
  return (
    <div className="aid-row">
      <span className="label">{label}</span>
      <Pips level={level} max={max} />
      <span className="mono aid-value">{offWhenZero && level === 0 ? "off" : max > 0 ? `${level}/${max}` : level}</span>
    </div>
  );
}

/** The brake bias: where it sits between the most rearward and the most forward the car allows. */
function BiasRow({ bias, min, max }: { bias: number; min: number; max: number }) {
  const range = max - min;
  const at = range > 0.001 ? Math.min(1, Math.max(0, (bias - min) / range)) : 0.5;
  return (
    <div className="aid-row">
      <span className="label">Brake bias</span>
      <span className="aid-bar" role="meter" aria-label="Brake bias" aria-valuemin={Math.round(min * 1000) / 10} aria-valuemax={Math.round(max * 1000) / 10} aria-valuenow={Math.round(bias * 1000) / 10}>
        <i style={{ left: `${at * 100}%` }} />
      </span>
      <span className="mono aid-value">{(bias * 100).toFixed(1)}%</span>
    </div>
  );
}

function BoostRow({ boost, scale }: { boost: number; scale: number }) {
  return (
    <div className="aid-row">
      <span className="label">Boost</span>
      <span className="aid-bar" role="meter" aria-label="Turbo boost" aria-valuemin={0} aria-valuemax={scale} aria-valuenow={boost}>
        <b style={{ width: `${Math.min(100, (boost / scale) * 100)}%` }} />
      </span>
      <span className="mono aid-value">{boost.toFixed(2)} bar</span>
    </div>
  );
}

/**
 * The car's driver aids and brake balance as set, each on its own range, and the turbo boost: the live view's, or a lap's
 * at the point being read. `tag` names whose they are when two laps are shown. Boost shows once a car has made some, so an
 * engine without a turbo never gets an empty bar, and a turbo car's bar doesn't come and go as it lifts.
 */
export function ElectronicsGauges({ aids, boost, tag }: { aids: LiveAids; boost: number | null; tag?: { color: string; text: string } }) {
  const turbo = useRef({ seen: false, peak: 0 });
  if (boost !== null && boost > 0.05) {
    turbo.current.seen = true;
    turbo.current.peak = Math.max(turbo.current.peak, boost);
  }
  // The bar runs to 1.5 bar, or a little over the most this car has made.
  const scale = Math.max(1.5, Math.ceil(turbo.current.peak * 5) / 5);
  return (
    <div className="aids" role="group" aria-label={tag ? `Electronics, ${tag.text}` : "Electronics"} style={tag ? { borderColor: tag.color } : undefined}>
      {tag && <span className="aid-tag" style={{ color: tag.color }}>{tag.text}</span>}
      <LevelRow label="TC" level={aids.tcLevel} max={aids.tcMax} offWhenZero />
      <LevelRow label="ABS" level={aids.absLevel} max={aids.absMax} offWhenZero />
      <BiasRow bias={aids.brakeBias} min={aids.biasMin} max={aids.biasMax} />
      <LevelRow label="Diff power" level={aids.diffPowerLevel} max={aids.diffPowerMax} />
      <LevelRow label="Diff coast" level={aids.diffCoastLevel} max={aids.diffCoastMax} />
      {turbo.current.seen && boost !== null && <BoostRow boost={boost} scale={scale} />}
      {aids.pitLimiter && <span className="chip plain aid-limiter">Pit limiter on</span>}
    </div>
  );
}
