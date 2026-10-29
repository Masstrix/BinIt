import { useEffect, useReducer, useRef } from "react";
import { useAppState, type LiveView } from "./api";

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
/** Between two headings the short way round, so 359° to 1° passes through 0°, not 180°. */
const mixAngle = (a: number, b: number, t: number) => a + ((((b - a) % 360) + 540) % 360 - 180) * t;

/** The state part-way from `a` to `b` (`t` 0 to 1). Anything that is a jump rather than a movement is taken as it is. */
function blend(a: LiveView, b: LiveView, t: number): LiveView {
  if (t >= 1 || !a.onTrack || !b.onTrack || a.phase !== b.phase || a.resets !== b.resets) return b;
  // Crossing the line (progress wraps) or a reset or teleport (the car is somewhere else): no gliding across it.
  if (Math.abs(b.lapProgress - a.lapProgress) > 0.5) return b;
  if (a.position && b.position && Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]) > 100) return b;
  const ai = a.inputs;
  const bi = b.inputs;
  const inputs =
    ai && bi
      ? {
          ...bi,
          throttle: mix(ai.throttle, bi.throttle, t),
          brake: mix(ai.brake, bi.brake, t),
          clutch: mix(ai.clutch, bi.clutch, t),
          steering: mix(ai.steering, bi.steering, t),
          speedKmh: mix(ai.speedKmh, bi.speedKmh, t),
          rpm: Math.round(mix(ai.rpm, bi.rpm, t)),
          dynamics:
            ai.dynamics && bi.dynamics
              ? {
                  ...bi.dynamics,
                  headingDeg: mixAngle(ai.dynamics.headingDeg, bi.dynamics.headingDeg, t),
                  slipDeg: mix(ai.dynamics.slipDeg, bi.dynamics.slipDeg, t),
                  yawRateDps: mix(ai.dynamics.yawRateDps, bi.dynamics.yawRateDps, t),
                }
              : bi.dynamics,
        }
      : bi;
  return {
    ...b,
    lapProgress: mix(a.lapProgress, b.lapProgress, t),
    position: a.position && b.position ? [mix(a.position[0], b.position[0], t), mix(a.position[1], b.position[1], t)] : b.position,
    inputs,
  };
}

const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The live feed, glided between readings. The game is read every 50 ms, so what arrives is 20 steps a second:
 * a car on the map, a needle or a bar that jumps from one to the next looks steppy on a screen that draws 60.
 * This shows each reading as a blend from the one before to the one that just came in, over the time that
 * reading took to arrive (so it runs one reading behind, about 50 ms, which is not noticeable). Jumps (the lap
 * wrapping, a reset, a phase change) are not blended.
 */
export function useSmoothLive(): LiveView | null {
  const { status } = useAppState();
  const raw = status?.live ?? null;
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const s = useRef<{ raw: LiveView | null; from: LiveView | null; to: LiveView | null; start: number; ms: number; shown: LiveView | null; last: number }>({
    raw: null, from: null, to: null, start: 0, ms: 50, shown: null, last: 0,
  });
  const st = s.current;
  const now = performance.now();
  if (raw !== st.raw) {
    // A new reading: glide from wherever the last one had got to, over how long this one took to come.
    st.ms = st.last ? Math.min(150, Math.max(20, now - st.last)) : 50;
    st.last = now;
    st.from = st.shown ?? raw;
    st.to = raw;
    st.start = now;
    st.raw = raw;
  }
  const smooth = !!raw && raw.onTrack && !reducedMotion();
  const shown = smooth && st.from && st.to ? blend(st.from, st.to, Math.min(1, (now - st.start) / st.ms)) : raw;
  st.shown = shown;

  const gliding = smooth && now - st.start < st.ms;
  useEffect(() => {
    if (!gliding) return;
    const id = requestAnimationFrame(() => tick());
    return () => cancelAnimationFrame(id);
  });
  return shown;
}
