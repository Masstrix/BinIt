import { useState } from "react";
import { api, useAppState, useFetch, type Profile } from "../api";
import { WhoAreYou } from "../components/MeBar";
import { Helmet } from "../components/Helmet";
import { carName, lapTime, trackName, ago } from "../format";
import { GameIcon } from "../components/GameIcon";

/** Why a ledger row paid out, in words. */
const KIND: Record<string, string> = { lap: "Clean lap", first: "First lap here", pb: "Personal best", record: "Track record" };

const STICKER_ICON: Record<string, string> = {
  "first-lap": "M5 21V4M5 4h11l-2 4 2 4H5",
  "ten-clean": "M5 12l5 5L20 7",
  "fifty-clean": "M4 12l4 4 6-8M12 16l4 4 6-10",
  explorer: "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  record: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3a3 3 0 0 1-3 4M7 5H4a3 3 0 0 0 3 4",
  streak: "M13 2L5 14h6l-1 8 8-12h-6z",
  "clean-sweep": "M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.7 6.7 19.6l1.1-6L3.4 9.4l6-.8z",
  regular: "M12 3l9 5v8l-9 5-9-5V8z",
};

/**
 * The page behind the phone banner: who you are, how far you have got and what you have done. It follows the
 * phone's paired driver (see MeBar); from the PC there is no paired driver, so it asks to pick one.
 */
export function YouPage() {
  const { drivers } = useAppState();
  const [tick, setTick] = useState(0);
  const [switching, setSwitching] = useState(false);
  const info = useFetch(() => api.me(), [drivers, tick]);
  const me = info?.driver ?? null;
  const profile = useFetch<Profile>(me ? () => api.profile(me.id) : null, [me?.id, tick]);

  return (
    <>
      <div className="page-head">
        <h1>You</h1>
      </div>

      {info && !me && (
        <section className="card" style={{ alignItems: "center", textAlign: "center", padding: "40px 24px" }}>
          <h2>Who are you?</h2>
          <p className="muted" style={{ margin: 0 }}>Pick yourself once and this phone remembers you. Your level, bests and stickers live here.</p>
          <button className="btn big" onClick={() => setSwitching(true)}>Pick your driver</button>
        </section>
      )}

      {me && profile && <ProfileView profile={profile} onSwitch={() => setSwitching(true)} />}
      {me && !profile && <div className="empty">Loading…</div>}

      {switching && (
        <WhoAreYou
          drivers={drivers}
          me={me}
          onClose={() => setSwitching(false)}
          onChanged={() => {
            setSwitching(false);
            setTick((t) => t + 1);
          }}
        />
      )}
    </>
  );
}

function ProfileView({ profile: p, onSwitch }: { profile: Profile; onSwitch: () => void }) {
  const into = p.xp - p.levelStartXp;
  const span = Math.max(1, p.nextLevelXp - p.levelStartXp);
  const earned = p.stickers.filter((s) => s.earned).length;
  return (
    <>
      <section className="card you-hero" aria-label="Level">
        <span className="you-tile" style={{ background: `${p.driver.color}2E` }}>
          <Helmet color={p.driver.color} size={92} tile={false} seed={p.driver.id} mood="happy" />
        </span>
        <h2 className="you-name">{p.driver.name}</h2>
        <div className="muted">
          Level {p.level} · {p.title}
          {p.streakDays >= 2 ? ` · ${p.streakDays}-day streak` : ""}
        </div>
        <div className="you-bar" role="progressbar" aria-valuemin={0} aria-valuemax={span} aria-valuenow={into} aria-label="XP to the next level">
          <div style={{ width: `${Math.min(100, (into / span) * 100)}%`, background: p.driver.color }} />
        </div>
        <div className="you-bar-labels">
          <span>{p.xp.toLocaleString()} XP</span>
          <span>{(p.nextLevelXp - p.xp).toLocaleString()} to {p.nextTitle === p.title ? `level ${p.level + 1}` : p.nextTitle}</span>
        </div>
        <span className="chip you-coins" title="Coins: earned with XP, for the Garage when it opens">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9 10c0-1 1-1.7 3-1.7s3 .7 3 1.7-1 1.5-3 2-3 1-3 2 1 1.7 3 1.7 3-.7 3-1.7" /></svg>
          {p.coins.toLocaleString()} coins
        </span>
      </section>

      <div className="you-stats">
        <div className="stat-tile"><span className="mono">{p.cleanLaps}</span><span className="label">Clean laps</span></div>
        <div className="stat-tile"><span className="mono">{p.cleanPercent}%</span><span className="label">Clean</span></div>
        <div className="stat-tile"><span className="mono">{p.tracks}</span><span className="label">Tracks</span></div>
      </div>

      <section className="you-section" aria-label="Your bests">
        <div className="head"><h2>Your bests</h2><span className="muted" style={{ fontSize: 13 }}>All games</span></div>
        {p.bests.length === 0 && <div className="empty">No times yet. Get out there!</div>}
        <div className="list">
          {p.bests.map((b) => (
            <div className="list-row you-best" key={`${b.game}|${b.track}|${b.layout}|${b.car}`}>
              <GameIcon game={b.game} size={22} />
              <span className="grow">
                <span style={{ fontWeight: 600 }}>{trackName(b.track, b.layout)}</span>
                <span className="muted" style={{ fontSize: 13 }}>{carName(b.car)}{b.of > 1 ? ` · P${b.position} of ${b.of}` : ""}</span>
              </span>
              <span className="mono" style={{ color: "var(--mint)" }}>{lapTime(b.timeMs)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="you-section" aria-label="Stickers">
        <div className="head"><h2>Stickers</h2><span className="muted" style={{ fontSize: 13 }}>{earned} of {p.stickers.length}</span></div>
        <div className="sticker-grid">
          {p.stickers.map((s) => (
            <div className="sticker" data-earned={s.earned || undefined} key={s.id} title={s.hint}>
              <span className="sticker-icon">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={STICKER_ICON[s.id] ?? STICKER_ICON.regular} />
                </svg>
              </span>
              <span className="sticker-name">{s.name}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="you-section" aria-label="Recent XP">
        <div className="head"><h2>Recent XP</h2></div>
        {p.recent.length === 0 && <div className="empty">XP shows up here as you set clean laps.</div>}
        <div className="list">
          {p.recent.map((e) => (
            <div className="list-row" key={e.id}>
              <span className="grow">
                <span>{KIND[e.kind] ?? e.kind}</span>
                <span className="muted" style={{ fontSize: 13 }}>{ago(e.at)}</span>
              </span>
              <span className="mono" style={{ color: "var(--peri-1)" }}>+{e.xp} XP</span>
              <span className="mono muted">+{e.coins}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="you-switch">
        <span className="grow muted">This phone is set to {p.driver.name}.</span>
        <button className="btn ghost" onClick={onSwitch}>Not you?</button>
      </div>
    </>
  );
}
