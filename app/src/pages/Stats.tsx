import { useMemo } from "react";
import { api, useAppState, useFetch, type DriverId, type DriverStats, type Lap, type StickerBook } from "../api";
import { GameIcon } from "../components/GameIcon";
import { Helmet } from "../components/Helmet";
import { isTimed } from "../driverStats";
import { carName, gameName, km, spanText, trackName } from "../format";
import { RARITY } from "../stickers";
import { ProgressSection } from "./DriverProgress";

interface Cell {
  label: string;
  icon: string;
  value: string;
  unit?: string;
  note?: string;
}

const ICON = {
  lap: "M4 12a8 8 0 1 1 3 6.2M4 19v-4h4",
  check: "M5 12.5l4.5 4.5L19 7",
  clock: "M12 8v5l3 2M9 2h6M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  car: "M4 16l1.5-5.5A2 2 0 0 1 7.4 9h9.2a2 2 0 0 1 1.9 1.5L20 16v3h-3v-2H7v2H4zM7 13h.01M17 13h.01",
  flag: "M5 21V4M5 4h12l-2 4 2 4H5",
  skid: "M5 20c4-1 5-5 7-8s5-4 8-4M9 20c4-1 5-5 7-8",
  bolt: "M13 2L5 14h6l-1 8 8-12h-6z",
  spin: "M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5",
  brake: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v6M12 16h.01",
  target: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  crown: "M3 8l4 4 5-7 5 7 4-4-2 11H5z",
  trophy: "M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 14v4M8 21h8",
  medal: "M8 3h8l-2 6h-4zM12 9a5 5 0 1 0 0 10 5 5 0 0 0 0-10z",
};

const shortDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });

function groups(s: DriverStats): { title: string; cells: Cell[] }[] {
  const time = spanText(s.timeOnTrackMs);
  const slid = s.driftM > 0;
  return [
    {
      title: "Driving",
      cells: [
        { label: "Timed laps", icon: ICON.lap, value: s.timedLaps.toLocaleString() },
        { label: "Clean laps", icon: ICON.check, value: String(s.cleanPercent), unit: "%", note: "no cuts" },
        { label: "Time on track", icon: ICON.clock, value: time.value, unit: time.unit },
        { label: "Tracks", icon: ICON.globe, value: String(s.tracks) },
        { label: "Cars", icon: ICON.car, value: String(s.cars) },
        { label: "Longest streak", icon: ICON.flag, value: String(s.longestStreakDays), unit: s.longestStreakDays === 1 ? "day" : "days" },
      ],
    },
    {
      title: "Sliding",
      cells: [
        { label: "Distance drifted", icon: ICON.skid, value: slid ? km(s.driftM) : "–", unit: slid ? "km" : "", note: s.driftSince ? `since ${shortDate(s.driftSince)}` : "" },
        { label: "Longest drift", icon: ICON.bolt, value: s.longestDriftMs ? (s.longestDriftMs / 1000).toFixed(1) : "–", unit: s.longestDriftMs ? "s" : "" },
        { label: "Drifts", icon: ICON.skid, value: s.drifts.toLocaleString() },
        { label: "Spins", icon: ICON.spin, value: s.spins.toLocaleString() },
        { label: "Handbrake drifts", icon: ICON.brake, value: s.handbrakeDrifts.toLocaleString() },
        { label: "Peak slip", icon: ICON.target, value: s.peakSlipDeg ? String(Math.round(s.peakSlipDeg)) : "–", unit: s.peakSlipDeg ? "°" : "" },
      ],
    },
    {
      title: "On the boards",
      cells: [
        { label: "Records held", icon: ICON.crown, value: String(s.recordsHeld) },
        { label: "Challenges entered", icon: ICON.trophy, value: String(s.challengesEntered) },
        { label: "Podiums", icon: ICON.medal, value: String(s.podiums) },
        { label: "Wins", icon: ICON.trophy, value: String(s.wins) },
      ],
    },
  ];
}

interface Favourite {
  name: string;
  game?: string;
  laps: number;
  share: number;
  timeMs: number;
}

/** The game, car and track a driver has spent the most timed laps on. */
function favourites(laps: Lap[]): { game: Favourite | null; car: Favourite | null; track: Favourite | null } {
  const timed = laps.filter(isTimed);
  const top = (key: (l: Lap) => string, label: (l: Lap) => string, game?: (l: Lap) => string): Favourite | null => {
    const m = new Map<string, { l: Lap; n: number; ms: number }>();
    for (const l of timed) {
      const k = key(l);
      const e = m.get(k) ?? { l, n: 0, ms: 0 };
      e.n++;
      e.ms += l.timeMs;
      m.set(k, e);
    }
    const best = [...m.values()].sort((a, b) => b.n - a.n || b.ms - a.ms)[0];
    return best ? { name: label(best.l), game: game?.(best.l), laps: best.n, share: Math.round((best.n / timed.length) * 100), timeMs: best.ms } : null;
  };
  return {
    game: top((l) => l.game, (l) => gameName(l.game), (l) => l.game),
    car: top((l) => `${l.game}|${l.car}`, (l) => carName(l.car), (l) => l.game),
    track: top((l) => `${l.game}|${l.track}|${l.layout}`, (l) => trackName(l.track, l.layout), (l) => l.game),
  };
}

function FavCard({ label, fav }: { label: string; fav: Favourite | null }) {
  const time = fav ? spanText(fav.timeMs) : null;
  return (
    <div className="fav-card">
      <span className="stats-label">{label}</span>
      {fav ? (
        <>
          <span className="fav-name">
            {fav.game && <GameIcon game={fav.game} size={28} />}
            <span>{fav.name}</span>
          </span>
          <span className="fav-bar" aria-hidden="true"><span style={{ width: `${fav.share}%` }} /></span>
          <span className="stats-note">{fav.laps.toLocaleString()} timed {fav.laps === 1 ? "lap" : "laps"} · {fav.share}% · {time!.value} {time!.unit}</span>
        </>
      ) : (
        <span className="muted">Nothing yet</span>
      )}
    </div>
  );
}

/** Stickers whose progress is these numbers, so a driver can see what the stats are feeding. */
const FEEDS = ["century", "marathon", "skid-marks", "tourist", "world-tour"];

/** Everything about a driver's driving in one place: what they drive most, how far, how sideways, and how they are improving. */
export function StatsPage({ id }: { id: DriverId }) {
  const { drivers } = useAppState();
  const driver = drivers.find((d) => d.id === id);
  const stats = useFetch<DriverStats>(() => api.driverStats(id), [id]);
  const book = useFetch<StickerBook>(() => api.stickerBook(id), [id]);
  const laps = useFetch<Lap[]>(() => api.driverLaps(id), [id]);
  const fav = useMemo(() => favourites(laps ?? []), [laps]);
  const back = <a href={`#/you/${id}`} className="back-link">← {driver?.name ?? "Profile"}</a>;
  if (!driver) return <>{back}<div className="empty">That driver isn't here (anymore).</div></>;
  if (!stats) return <>{back}<div className="empty">Loading…</div></>;

  const feeds = (book?.stickers ?? []).filter((s) => FEEDS.includes(s.id) && (s.earned || s.progress)).slice(0, 4);
  const missing = stats.lapsCounted - stats.lapsWithDistance;
  return (
    <>
      {back}
      <div className="head" style={{ alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
          <Helmet color={driver.color} look={driver.look} size={64} seed={driver.id} />
          <div style={{ minWidth: 0 }}>
            <h1 style={{ overflowWrap: "anywhere" }}>{driver.name}</h1>
            <span className="muted">Driver stats</span>
          </div>
        </div>
      </div>
      <section className="stats-hero" aria-label="Distance driven">
        <span className="stats-label">DISTANCE DRIVEN</span>
        <span className="big">{stats.lapsWithDistance ? km(stats.distanceM) : "–"}<small> km</small></span>
        <span className="muted" style={{ fontSize: 14 }}>
          {stats.timedLaps.toLocaleString()} timed laps, {spanText(stats.timeOnTrackMs).value} {spanText(stats.timeOnTrackMs).unit} on track.
        </span>
      </section>

      <section className="stats-group" aria-label="Most driven">
        <h2>Most driven</h2>
        <div className="fav-grid">
          <FavCard label="GAME" fav={fav.game} />
          <FavCard label="CAR" fav={fav.car} />
          <FavCard label="TRACK" fav={fav.track} />
        </div>
      </section>

      {groups(stats).map((g) => (
        <section className="stats-group" key={g.title} aria-label={g.title}>
          <h2>{g.title}</h2>
          <div className="stats-grid">
            {g.cells.map((c) => (
              <div className="stats-cell" key={c.label}>
                <span className="stats-label">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={c.icon} /></svg>
                  {c.label}
                </span>
                <span className="stats-value">{c.value}{c.unit && <small> {c.unit}</small>}</span>
                <span className="stats-note">{c.note ?? ""}</span>
              </div>
            ))}
          </div>
        </section>
      ))}

      {feeds.length > 0 && (
        <section className="stk-close" aria-label="Stickers these feed">
          <div className="stk-label"><span>STICKERS THESE FEED</span></div>
          {feeds.map((s) => (
            <div className="stk-close-top" key={s.id} style={{ flexDirection: "column", gap: 6 }}>
              <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <b>{s.name}</b>
                <span className="mono">{s.earned ? "Earned" : `${s.progress!.cur.toLocaleString()} / ${s.progress!.max.toLocaleString()}`}</span>
              </span>
              <span className="you-bar sm">
                <span style={{ width: `${s.earned ? 100 : (s.progress!.cur / s.progress!.max) * 100}%`, background: RARITY[s.rarity].color }} />
              </span>
            </div>
          ))}
        </section>
      )}

      <section className="stats-group" aria-label="Progress over time">
        <h2>Progress over time</h2>
        {laps === null ? <div className="empty">Loading…</div> : <ProgressSection id={id} name={driver.name} laps={laps} />}
      </section>

      <p className="stats-foot">
        {stats.driftSince ? `Drift and handbrake numbers count from laps recorded since ${shortDate(stats.driftSince)}, when they started being measured. ` : "Drift and handbrake numbers appear once a lap with a drift is recorded. "}
        Games that don't report physics have none.
        {missing > 0 && ` Distance covers ${stats.lapsWithDistance.toLocaleString()} of ${stats.lapsCounted.toLocaleString()} laps: older laps with no recorded track length or trace aren't counted.`}
      </p>
    </>
  );
}
