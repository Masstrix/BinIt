import { useRef, type ReactNode } from "react";

/** A car on the ladder: how far (ms) it is behind the car in front on track. */
export interface LadderCar {
  key: string | number;
  color: string;
  gapMs: number;
  name: string;
  /** A few letters drawn beside the car, like the letters on Gran Turismo's race monitor. */
  short?: string;
  /** Drawn in place of the dot, like a driver's helmet. */
  icon?: ReactNode;
  faded?: boolean;
}

/**
 * The room a gap between two neighbours takes: grows with the gap but less than in step with it, so
 * a 0.2 s fight mid-pack still shows when someone else is 15 s back.
 */
const room = (ms: number) => Math.sqrt(Math.max(ms, 0) / 1000);
/**
 * The ladder's smallest size, in `room` units: a field with less room between it than this sits
 * near the top instead of being stretched to fill the ladder. 2 is one 4 s gap, or two 1 s gaps.
 */
const BASE = 2;
/** The closest two cars get (fraction of the ladder), so each keeps room for its letters and the gap between them. */
const MIN_SPACING = 0.14;
/** How quickly (ms, time constant) the ladder grows to fit a field spreading out, and shrinks as it closes up. */
const GROW_MS = 150;
const SHRINK_MS = 1500;
/** Longer than this between frames is a jump (paused, a click on the timeline): the ladder snaps to size. */
const JUMP_MS = 200;

function gapText(ms: number): string {
  return ms < 60000 ? `+${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}` : `+${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
}

/** Initials from a name: "Matt D" → "MD", "Stig" → "ST". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts.slice(0, 2).map((p) => p[0]) : [...(parts[0] ?? "?").slice(0, 2)]).join("").toUpperCase();
}

/**
 * Where each car sits (0..1 down the ladder), front first: each one below the car ahead by the room
 * its gap takes out of `size`, never closer than `MIN_SPACING`, squeezed back up if that runs off the bottom.
 */
function place(intervals: number[], size: number): number[] {
  const y = [0];
  for (const ms of intervals) y.push(y[y.length - 1] + room(ms) / size);
  const min = Math.min(MIN_SPACING, intervals.length ? 1 / intervals.length : 1);
  for (let i = 1; i < y.length; i++) y[i] = Math.max(y[i], y[i - 1] + min);
  for (let i = y.length - 1; i >= 0; i--) y[i] = Math.max(0, Math.min(y[i], i === y.length - 1 ? 1 : y[i + 1] - min));
  return y;
}

/**
 * The gaps between cars, like the race monitor in Gran Turismo's B-spec: the car in front at the top,
 * everyone else in track order below it, and between each pair the gap to the car directly ahead.
 * Each gap gets room by its own size rather than its place on one clock, and the ladder grows to fit
 * a field that spreads out and eases back as it closes up. Sits beside a track map, which shows the
 * same gaps as distance.
 */
export function GapLadder({ cars }: { cars: LadderCar[] }) {
  const order = [...cars].sort((x, y) => x.gapMs - y.gapMs);
  const intervals = order.slice(1).map((c, i) => c.gapMs - order[i].gapMs);

  // The ladder's size eases toward what the field needs: quickly when it spreads, slowly as it closes.
  const target = Math.max(BASE, intervals.reduce((sum, ms) => sum + room(ms), 0));
  const size = useRef({ value: target, at: 0 });
  const now = performance.now();
  const dt = now - size.current.at;
  if (dt > JUMP_MS) size.current.value = target;
  else {
    const tau = target > size.current.value ? GROW_MS : SHRINK_MS;
    size.current.value = Math.max(target, 0) + (size.current.value - target) * Math.exp(-dt / tau);
  }
  size.current.at = now;

  const y = place(intervals, size.current.value);
  const pct = (f: number) => `${f * 100}%`;

  return (
    <div
      className={`gap-ladder${cars.some((c) => c.icon) ? " with-icons" : ""}`}
      role="img"
      aria-label={`Gaps: ${order.map((c, i) => (i === 0 ? `${c.name} in front` : `${c.name} ${gapText(intervals[i - 1])} behind ${order[i - 1].name}`)).join(", ")}`}
    >
      <div className="gap-ladder-rail">
        {/* The gap to the car ahead, halfway between the two. */}
        {order.slice(1).map((c, i) => (
          <span key={`gap-${c.key}`} className="gap-ladder-interval mono" style={{ top: pct((y[i] + y[i + 1]) / 2) }}>
            {gapText(intervals[i])}
          </span>
        ))}
        {/* Back of the pack first so the front is drawn on top. */}
        {order.map((c, i) => ({ c, at: y[i] })).reverse().map(({ c, at }) => (
          <span key={c.key} className="gap-ladder-car" data-faded={c.faded || undefined} style={{ top: pct(at) }} title={c.name}>
            {c.icon ? <span className="gap-ladder-icon">{c.icon}</span> : <i style={{ background: c.color }} />}
            {c.short && <em style={{ color: c.color }}>{c.short}</em>}
          </span>
        ))}
      </div>
    </div>
  );
}
