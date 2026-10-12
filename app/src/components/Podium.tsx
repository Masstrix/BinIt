import type { Driver, LeaderboardEntry } from "../api";
import { lapTime } from "../format";
import { Helmet } from "./Helmet";

// Back-to-front order on screen: 2 | 1 | 3. Each block is a lit top face over a front face.
const BLOCKS = [
  { place: 2, height: 0.62, size: 0.78 },
  { place: 1, height: 0.86, size: 1 },
  { place: 3, height: 0.46, size: 0.64 },
];

/** The crown in a gold hexagon, sat on the leader's helmet. */
function CrownBadge({ size }: { size: number }) {
  return (
    <svg className="podium-badge" width={size} height={size * 1.1} viewBox="0 0 40 44" role="img" aria-label="Leader">
      <path d="M20 2l17 9.75v20.5L20 42 3 32.25v-20.5z" fill="#1A2140" stroke="#FFC93C" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M10.5 17.5l5 4 4.5-8 4.5 8 5-4-1.8 11.5H12.3z" fill="#FFC93C" />
    </svg>
  );
}

/** 3D podium for the top three. `scale` is roughly the height of the 1st-place block in px. */
export function Podium({
  entries,
  drivers,
  scale = 170,
  helmets = true,
  big = false,
  prizes,
}: {
  entries: LeaderboardEntry[];
  drivers: Map<number, Driver>;
  scale?: number;
  helmets?: boolean;
  /** Larger names, times and helmets for a page-wide podium. */
  big?: boolean;
  /** Prize text for 1st, 2nd and 3rd, shown under each time. */
  prizes?: (string | undefined)[];
}) {
  const helmet = (place: number) => (place === 1 ? 72 : 60) * (big ? 1.4 : 1);
  return (
    <div className={`podium${big ? " big" : ""}`} style={{ ["--top" as string]: `${Math.round(scale * 0.16)}px` }}>
      {BLOCKS.map((b) => {
        const e = entries[b.place - 1];
        const d = e?.driverId != null ? drivers.get(e.driverId) : undefined;
        return (
          <div className={`podium-col p${b.place}`} key={b.place}>
            <div className="podium-who">
              {e && helmets ? (
                <span className="podium-avatar">
                  {b.place === 1 && <CrownBadge size={big ? 40 : 30} />}
                  <Helmet color={d?.color ?? "#5B6488"} size={helmet(b.place)} seed={d?.id} mood={b.place === 1 ? "happy" : "idle"} />
                </span>
              ) : (
                b.place === 1 && e && <CrownBadge size={big ? 40 : 30} />
              )}
              <span className="who">{e ? (d?.name ?? "Guest") : "—"}</span>
              <span className={`podium-time${e ? "" : " open"}`}>{e ? lapTime(e.timeMs) : "open"}</span>
              {prizes?.[b.place - 1] && <span className="podium-prize" title={prizes[b.place - 1]}>{prizes[b.place - 1]}</span>}
            </div>
            <div className="podium-block" style={{ height: scale * b.height, ["--size" as string]: `${Math.round(scale * 0.42 * b.size)}px` }}>
              <span className="podium-num">{b.place}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
