import { words } from "../vocab";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePersistedState } from "../persist";
import { api, useDriverMap, useFetch, useTrackMaps, type Challenge, type ReplayEntry } from "../api";
import { findMap } from "../catalogueItems";
import { lapTime } from "../format";
import { Helmet } from "./Helmet";
import { cameraAt, MapViewControls, TrackMap, useMapView } from "./TrackMap";
import { GapLadder, initials } from "./GapLadder";

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
 * How far behind the car in front on track each racer is at time `t` (ms): the time since the front
 * car went through the point they're at. A finished racer's gap is its lap time against the front's.
 */
function gapsAt(racers: Racer[], t: number): number[] {
  const p = racers.map((r) => progressAt(r.profile, t));
  let front = 0;
  for (let i = 1; i < racers.length; i++) {
    if (p[i] > p[front] || (p[i] === p[front] && racers[i].timeMs < racers[front].timeMs)) front = i;
  }
  return racers.map((r, i) => Math.max(0, elapsedAt(r.profile, p[i]) - elapsedAt(racers[front].profile, p[i])));
}

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
  // Zoom and turn the map as the viewer chose (shared with the telemetry map), following one car:
  // whoever is in front on track, unless the viewer picked someone in the legend.
  const mapView = useMapView();
  const [followed, setFollowed] = useState<number | null>(null);
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
  const ladder = gapsAt(racers, t);
  const front = state.reduce<(typeof state)[number] | undefined>((best, x) => (!best || x.p > best.p || (x.p === best.p && x.r.timeMs < best.r.timeMs) ? x : best), undefined);
  const follow = state.find((x) => x.r.lapId === followed) ?? front;
  const following = mapView.zoom > 1 || mapView.carUp;
  const camera = map && follow ? cameraAt(map.points, map.closed, follow.p, mapView) : undefined;

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
        <div className="empty">Bin It hasn't learned this {words(challenge.game).track}'s map yet. Finish one clean {words(challenge.game).lap} on it and the replay appears here.</div>
      ) : (
        <>
          <div className={`livemap-frame${racers.length > 1 ? " with-ladder" : ""}`}>
            {racers.length > 1 && (
              <GapLadder
                cars={state.map(({ r, finished }, i) => ({ key: r.lapId, color: colorOf(r), name: nameOf(r), short: initials(nameOf(r)), icon: <Helmet color={colorOf(r)} size={26} tile={false} seed={r.driverId ?? undefined} />, gapMs: ladder[i], faded: finished }))}
              />
            )}
            <div className="ladder-map">
              {/* The controls float over the top right; the map keeps the track clear of them. */}
              <MapViewControls view={mapView} />
              <TrackMap
                camera={camera}
                corner={{ w: 250, h: 48 }}
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
              <button
                type="button"
                className="replay-row"
                key={r.lapId}
                aria-pressed={followed === r.lapId}
                data-followed={(following && follow?.r === r) || undefined}
                title={followed === r.lapId ? "Following (tap to follow whoever is in front)" : "Follow on the map"}
                onClick={() => setFollowed(followed === r.lapId ? null : r.lapId)}
              >
                <i style={{ background: colorOf(r) }} />
                <span className="replay-name">{nameOf(r)}</span>
                <span className="mono muted">{lapTime(r.timeMs)}</span>
                <span className="mono replay-gap" style={{ color: r === leader ? "var(--gold)" : gap > 0 ? "var(--red)" : "var(--muted)" }}>
                  {r === leader ? (finished ? "P1" : "leader") : `+${(gap / 1000).toFixed(3)}`}
                </span>
              </button>
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
