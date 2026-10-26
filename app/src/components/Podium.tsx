import { useId } from "react";
import type { Driver, LeaderboardEntry } from "../api";
import { lapTime } from "../format";
import { Helmet } from "./Helmet";

/**
 * The challenge podium: a front-on stage under a spotlight, three steps touching edge to edge so their tops
 * line up, the leader's step tallest, a gold trophy over the winner and a name plate for each place on the
 * glowing floor. Drawn in one SVG (viewBox 840 x 710) so it scales to whatever width it is given.
 */

interface Step {
  place: 1 | 2 | 3;
  /** Left and right edge, and the y of the front face's top edge. */
  x0: number;
  x1: number;
  top: number;
  front: string;
  lit: string;
  /** The lit top face leans away to the right, so it is narrower at the back. */
  topFace: string;
  numSize: number;
  numY: number;
  /** Helmet size, its top-left corner, and where its shadow sits on the step. */
  helmet: number;
  helmetAt: [number, number];
  shadow: [number, number];
}

const FLOOR = 610;

/** Each place bobs on its own beat, so the three never move in lockstep. */
const delay = (place: number) => `${place === 1 ? 0 : place === 2 ? -0.9 : -1.7}s`;

// Painted back to front: 2 and 3 first, so the leader's lit top overlaps them.
const STEPS: Step[] = [
  { place: 2, x0: 220, x1: 440, top: 470, front: "#DB7641", lit: "#FFA778", topFace: "273.2,440 462.4,440 440,470 220,470", numSize: 70, numY: 556.8, helmet: 140, helmetAt: [278.9, 314.9], shadow: [348.9, 456.5] },
  { place: 3, x0: 760, x1: 980, top: 510, front: "#DB518B", lit: "#FF87B9", topFace: "737.6,480 926.8,480 980,510 760,510", numSize: 70, numY: 572, helmet: 140, helmetAt: [781.1, 354.9], shadow: [851.1, 496.5] },
  { place: 1, x0: 440, x1: 760, top: 400, front: "#2890DB", lit: "#63BDFF", topFace: "462.4,370 737.6,370 760,400 440,400", numSize: 88, numY: 530.2, helmet: 168, helmetAt: [516, 221.38], shadow: [600, 386.5] },
];

function Trophy({ x, y, gold }: { x: number; y: number; gold: string }) {
  return (
    <g transform={`translate(${x},${y})`} aria-hidden="true">
      <g className="pod-float">
      <path d="M22 24 C2 22 2 62 30 68" fill="none" stroke="#E0A100" strokeWidth="7" strokeLinecap="round" />
      <path d="M78 24 C98 22 98 62 70 68" fill="none" stroke="#E0A100" strokeWidth="7" strokeLinecap="round" />
      <path d="M16 12 H84 V40 C84 66 66 80 50 82 C34 80 16 66 16 40 Z" fill={`url(#${gold})`} />
      <path d="M26 22 V40 C26 54 34 64 42 70" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="4" strokeLinecap="round" />
      <rect x="44" y="82" width="12" height="16" fill={`url(#${gold})`} />
      <rect x="28" y="98" width="44" height="12" rx="4" fill="#E0A100" />
      </g>
    </g>
  );
}

/** Podium for the top three. `prizes` (1st, 2nd, 3rd) are printed under each time. */
export function Podium({
  entries,
  drivers,
  prizes,
  helmets = true,
}: {
  entries: LeaderboardEntry[];
  drivers: Map<number, Driver>;
  prizes?: (string | undefined)[];
  helmets?: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const ids = { beam: `beam${uid}`, floor: `floor${uid}`, gold: `gold${uid}` };
  const hasPrizes = !!prizes?.some(Boolean);
  const plateH = hasPrizes ? 76 : 56;
  const height = 636 + plateH + 18;
  const names = STEPS.map((s) => {
    const e = entries[s.place - 1];
    return `${s.place === 1 ? "first" : s.place === 2 ? "second" : "third"}: ${e ? (e.driverId != null ? drivers.get(e.driverId)?.name ?? "Guest" : "Guest") : "open"}`;
  });

  return (
    <div className="podium-stage">
      <svg viewBox={`180 0 840 ${height}`} width="100%" role="img" aria-label={`Podium lit by a spotlight, ${names.join(", ")}`}>
        <defs>
          <linearGradient id={ids.gold} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#D9A000" />
            <stop offset="0.45" stopColor="#FFE08A" />
            <stop offset="1" stopColor="#E2A800" />
          </linearGradient>
          <linearGradient id={ids.beam} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={ids.floor} cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#8B8BF5" stopOpacity="0.38" />
            <stop offset="1" stopColor="#8B8BF5" stopOpacity="0" />
          </radialGradient>
        </defs>

        <polygon className="pod-beam" points="552,0 648,0 860,610 340,610" fill={`url(#${ids.beam})`} />
        <ellipse cx="600" cy="630" rx="540" ry="80" fill={`url(#${ids.floor})`} />

        {STEPS.map((s) => (
          <g key={s.place}>
            <polygon points={`${s.x0},${s.top} ${s.x1},${s.top} ${s.x1},${FLOOR} ${s.x0},${FLOOR}`} fill={s.front} />
            <polygon points={`${s.x0},576 ${s.x1},576 ${s.x1},${FLOOR} ${s.x0},${FLOOR}`} fill="#000" opacity="0.18" />
            <polygon points={s.topFace} fill={s.lit} />
            <line x1={s.x0} y1={s.top} x2={s.x1} y2={s.top} stroke="#fff" strokeOpacity="0.45" strokeWidth="2" />
            <text x={(s.x0 + s.x1) / 2} y={s.numY} textAnchor="middle" fontWeight="800" fontSize={s.numSize} fill="#fff" fillOpacity="0.95" fontFamily="var(--font-display)">
              {s.place}
            </text>
          </g>
        ))}

        {STEPS.map((s) => {
          const e = entries[s.place - 1];
          if (!e) return null;
          const d = e.driverId != null ? drivers.get(e.driverId) : undefined;
          const k = s.helmet / 140;
          return (
            <g key={`h${s.place}`}>
              <ellipse className="pod-shadow" style={{ animationDelay: delay(s.place) }} cx={s.shadow[0]} cy={s.shadow[1]} rx={47.6 * k} ry={9.8 * k} fill="#000" opacity="0.35" />
              {helmets && (
                <g transform={`translate(${s.helmetAt[0]},${s.helmetAt[1]})`}>
                  <g className={`pod-bob${s.place === 1 ? " lead" : ""}`} style={{ animationDelay: delay(s.place) }}>
                    <Helmet color={d?.color ?? "#5b6578"} size={s.helmet} tile={false} seed={d?.id} mood={s.place === 1 ? "happy" : "idle"} />
                  </g>
                </g>
              )}
            </g>
          );
        })}

        {entries[0] && <Trophy x={550} y={40} gold={ids.gold} />}

        {STEPS.map((s) => {
          const e = entries[s.place - 1];
          const d = e?.driverId != null ? drivers.get(e.driverId) : undefined;
          const cx = (s.x0 + s.x1) / 2;
          const prize = prizes?.[s.place - 1];
          return (
            <g key={`p${s.place}`}>
              <rect x={cx - 92} y="636" width="184" height={plateH} rx="18" fill="var(--panel)" stroke="var(--line)" />
              <text x={cx} y="661" textAnchor="middle" fontWeight="700" fontSize="17" fill="var(--text)" fontFamily="var(--font-display)">
                {e ? (d?.name ?? "Guest") : "Open"}
              </text>
              <text x={cx} y="681" textAnchor="middle" fontSize="13" fill="var(--muted)" fontFamily="var(--font-mono)">
                {e ? lapTime(e.timeMs) : "no time yet"}
              </text>
              {hasPrizes && prize && (
                <text x={cx} y="702" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--peri-1)" fontFamily="var(--font-body)">
                  {prize.length > 26 ? `${prize.slice(0, 25)}…` : prize}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
