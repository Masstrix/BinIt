import type { Driver, LeaderboardEntry } from "../api";
import { lapTime } from "../format";
import { Crown, Helmet } from "./Helmet";

const BLOCKS = [
  { place: 2, height: 0.7, color: "var(--peri-2)", size: 0.78 },
  { place: 1, height: 1, color: "var(--peri-1)", size: 1 },
  { place: 3, height: 0.53, color: "var(--peri-3)", size: 0.64 },
];

/** Big-number podium for the top three. `scale` is the height of the 1st-place block in px. */
export function Podium({
  entries,
  drivers,
  scale = 170,
  helmets = true,
}: {
  entries: LeaderboardEntry[];
  drivers: Map<number, Driver>;
  scale?: number;
  helmets?: boolean;
}) {
  return (
    <div className="podium">
      {BLOCKS.map((b) => {
        const e = entries[b.place - 1];
        const d = e?.driverId != null ? drivers.get(e.driverId) : undefined;
        return (
          <div className="podium-col" key={b.place}>
            {b.place === 1 && e && <Crown size={30} />}
            {e && helmets && <Helmet color={d?.color ?? "#5B6488"} size={b.place === 1 ? 72 : 60} />}
            <span className="who">{e ? (d?.name ?? "Guest") : "—"}</span>
            <span className={`podium-time${b.place === 1 && e ? " first" : ""}`}>{e ? lapTime(e.timeMs) : "open"}</span>
            <div
              className="podium-block"
              style={{ height: scale * b.height, background: b.color, ["--size" as string]: `${Math.round(scale * 0.42 * b.size)}px` }}
            >
              {b.place}
            </div>
          </div>
        );
      })}
    </div>
  );
}
