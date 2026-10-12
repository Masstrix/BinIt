import { words } from "../vocab";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePersistedState } from "../persist";
import { api, useDriverMap, useFetch, useTrackMaps, type Challenge, type ReplayEntry } from "../api";
import { findMap } from "../catalogueItems";
import { lapTime } from "../format";
import { TrackMap } from "./TrackMap";

/** Seconds to linger on the finished picture before the replay starts over. */
const HOLD_MS = 2000;
const SPEEDS = [1, 2, 4] as const;
const GUEST = "#9AA3C7";

/** How far round the lap (0..1) a car with this timing profile is after `t` ms. */
function progressAt(profile: number[], t: number): number {
  const last = profile.length - 1;
  if (t <= 0) return 0;
  if (t >= profile[last]) return 1;
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (profile[mid] <= t) lo = mid;
    else hi = mid;
  }
  const span = profile[hi] - profile[lo];
  return (lo + (span > 0 ? (t - profile[lo]) / span : 0)) / last;
}

/** Elapsed ms at a point round the lap. */
function elapsedAt(profile: number[], progress: number): number {
  const last = profile.length - 1;
  const pos = Math.min(Math.max(progress, 0), 1) * last;
  const i = Math.min(Math.floor(pos), last - 1);
  return profile[i] + (profile[i + 1] - profile[i]) * (pos - i);
}

/** World position at a point round the lap, from the map's evenly spaced outline. */
function pointAt(points: [number, number][], progress: number): [number, number] {
  const n = points.length;
  const pos = (progress % 1) * n;
  const i = Math.floor(pos) % n;
  const f = pos - Math.floor(pos);
  const a = points[i];
  const b = points[(i + 1) % n];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

type Racer = ReplayEntry & { profile: number[] };

/**
 * Every driver's best lap run side by side on the track map, from the same start line, so the
 * gaps between them show up as distance on the track. Uses the timing trace saved with each lap.
 */
export function ChallengeReplay({ challenge }: { challenge: Challenge }) {
  const drivers = useDriverMap();
  const replay = useFetch(() => api.challengeReplay(challenge.id), [challenge.id]) ?? [];
  const maps = useTrackMaps(challenge.game);
  const map = findMap(maps, challenge.track, challenge.layout);

  const racers = useMemo(() => replay.filter((r): r is Racer => r.profile !== null), [replay]);
  const missing = replay.filter((r) => r.profile === null);
  const raceLength = Math.max(0, ...racers.map((r) => r.timeMs));

  const reduceMotion = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [playing, setPlaying] = useState(!reduceMotion);
  const [speed, setSpeed] = usePersistedState<(typeof SPEEDS)[number]>("replay.speed", 1, (v) => SPEEDS.some((s) => s === v));
  const [t, setT] = useState(0);
  const clock = useRef({ last: 0, t: 0 });

  // One clock for everyone: advance by real elapsed time x speed, hold at the end, then loop.
  useEffect(() => {
    if (!playing || raceLength === 0) return;
    let frame = 0;
    clock.current.last = performance.now();
    const tick = (now: number) => {
      const dt = now - clock.current.last;
      clock.current.last = now;
      let next = clock.current.t + dt * speed;
      if (next > raceLength + HOLD_MS) next = 0;
      clock.current.t = next;
      setT(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, raceLength]);

  const seek = (v: number) => {
    clock.current.t = v;
    setT(v);
  };

  if (replay.length === 0) return null;

  const colorOf = (r: ReplayEntry) => (r.driverId != null ? drivers.get(r.driverId)?.color : undefined) ?? GUEST;
  const nameOf = (r: ReplayEntry) => (r.driverId != null ? drivers.get(r.driverId)?.name : undefined) ?? "Guest";
  const leader = racers[0];

  const state = racers.map((r) => {
    const p = progressAt(r.profile, t);
    const finished = p >= 1;
    // Gap to the leader at the same point of the lap (once finished, the difference in lap times).
    const gap = !leader || r === leader ? 0 : finished ? r.timeMs - leader.timeMs : Math.max(0, t - elapsedAt(leader.profile, p));
    return { r, p, finished, gap };
  });

  return (
    <section className="card replay" aria-label="Race replay">
      <div className="head" style={{ alignItems: "center" }}>
        <div>
          <h2>Race replay</h2>
          <span className="muted" style={{ fontSize: 14 }}>Everyone's best {words(challenge.game).lap}, side by side from the start line</span>
        </div>
        <span className="chip plain mono">{lapTime(Math.floor(Math.min(t, raceLength)))} / {lapTime(raceLength)}</span>
      </div>

      {racers.length === 0 ? (
        <div className="empty">These laps were set before timing traces were saved, so they can't be replayed. The next lap each driver sets can.</div>
      ) : !map ? (
        <div className="empty">TimeTrial hasn't learned this {words(challenge.game).track}'s map yet. Finish one clean {words(challenge.game).lap} on it and the replay appears here.</div>
      ) : (
        <>
          <div className="livemap-frame">
            <TrackMap
              points={map.points}
              rotate={map.rotate}
              mirror={map.mirror}
              closed={map.closed}
              stroke={4}
              label="Race replay"
              // Back of the pack first so the leader is drawn on top.
              markers={[...state].reverse().map(({ r, p, finished }) => ({ position: pointAt(map.points, p), color: colorOf(r), faded: finished }))}
            />
          </div>

          <div className="replay-controls">
            <button type="button" className="filter-pill" onClick={() => setPlaying(!playing)} aria-pressed={playing}>
              {playing ? "Pause" : "Play"}
            </button>
            <button type="button" className="filter-pill" onClick={() => seek(0)}>Restart</button>
            <div className="segmented" role="group" aria-label="Speed">
              {SPEEDS.map((s) => (
                <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s}x</button>
              ))}
            </div>
            <input
              type="range"
              className="replay-scrub"
              min={0}
              max={raceLength}
              step={50}
              value={Math.min(t, raceLength)}
              aria-label="Replay position"
              onChange={(e) => {
                setPlaying(false);
                seek(Number(e.target.value));
              }}
            />
          </div>

          <div className="replay-legend">
            {state.map(({ r, finished, gap }) => (
              <div className="replay-row" key={r.lapId}>
                <i style={{ background: colorOf(r) }} />
                <span className="replay-name">{nameOf(r)}</span>
                <span className="mono muted">{lapTime(r.timeMs)}</span>
                <span className="mono replay-gap" style={{ color: r === leader ? "var(--gold)" : gap > 0 ? "var(--red)" : "var(--muted)" }}>
                  {r === leader ? (finished ? "P1" : "leader") : `+${(gap / 1000).toFixed(3)}`}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {missing.length > 0 && racers.length > 0 && (
        <span className="muted" style={{ fontSize: 13 }}>
          Not shown (best lap set before timing traces were saved): {missing.map(nameOf).join(", ")}
        </span>
      )}
    </section>
  );
}
