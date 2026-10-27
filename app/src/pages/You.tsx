import { useState } from "react";
import { api, isTauri, useAppState, useFetch, type Driver, type Profile } from "../api";
import { WhoAreYou } from "../components/MeBar";
import { Coin } from "../components/Coin";
import { Helmet } from "../components/Helmet";
import { carName, lapTime, trackName, ago } from "../format";
import { GameIcon } from "../components/GameIcon";
import { Modal } from "../components/Modal";
import { useSeatSwitcher } from "../components/SeatSwitcher";
import { PhonesDialog } from "./Drivers";

/** Why a ledger row paid out, in words. */
const KIND: Record<string, string> = { lap: "Clean lap", first: "First lap here", pb: "Personal best", record: "Track record" };

/** Ledger rows for a purchase carry the item: `buy:shell:aurora`. */
function kindLabel(kind: string) {
  if (kind.startsWith("buy:")) return `Bought ${kind.split(":")[2] ?? "an item"}`;
  if (kind.startsWith("challenge:")) {
    // challenge:<place>:<name> or challenge:entry:<name>
    const [, place, ...name] = kind.split(":");
    const ordinal = ({ "1": "Won", "2": "2nd in", "3": "3rd in" } as Record<string, string>)[place] ?? (place === "entry" ? "Took part in" : `${place}th in`);
    return `${ordinal} ${name.join(":")}`;
  }
  return KIND[kind] ?? kind;
}

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
export function YouPage({ path = "/you" }: { path?: string }) {
  const { drivers, status } = useAppState();
  const [tick, setTick] = useState(0);
  const [switching, setSwitching] = useState(false);
  const info = useFetch(() => api.me(), [drivers, tick]);
  const me = info?.driver ?? null;
  // `#/you/3` shows driver 3; otherwise this phone's driver; on the PC (nobody is paired) whoever is in the seat.
  const asked = path.match(/^\/you\/(\d+)/);
  const viewId = asked ? Number(asked[1]) : (me?.id ?? (info?.local ? (status?.seat ?? null) : null));
  const profile = useFetch<Profile>(viewId != null ? () => api.profile(viewId) : null, [viewId, tick]);
  const mine = me != null && me.id === viewId;

  return (
    <>
      {/* A profile can be anyone's, so the page has no title of its own: the driver's name is the heading. */}

      {info && viewId == null && (
        <section className="card" style={{ alignItems: "center", textAlign: "center", padding: "40px 24px" }}>
          {info.local ? (
            <>
              <h2>Nobody is in the seat</h2>
              <p className="muted" style={{ margin: 0 }}>Pick a driver below to see their level, bests and stickers.</p>
            </>
          ) : (
            <>
              <h2>Who are you?</h2>
              <p className="muted" style={{ margin: 0 }}>Pick yourself once and this phone remembers you. Your level, bests and stickers live here.</p>
              <button className="btn big" onClick={() => setSwitching(true)}>Pick your driver</button>
            </>
          )}
        </section>
      )}

      {viewId != null && profile && <ProfileView profile={profile} mine={mine} manage={!!info?.local} onSwitch={() => setSwitching(true)} />}
      {viewId != null && !profile && <div className="empty">Loading…</div>}

      {info?.local && drivers.length > 0 && (
        <nav className="you-drivers" aria-label="Whose profile">
          {drivers.map((d) => (
            <a key={d.id} href={`#/you/${d.id}`} aria-current={d.id === viewId ? "page" : undefined}>
              <Helmet color={d.color} look={d.look} size={36} seed={d.id} />
              {d.name}
            </a>
          ))}
        </nav>
      )}

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

function ManageRow({ icon, title, sub, onClick, href, trailing }: { icon: string; title: string; sub?: string; onClick?: () => void; href?: string; trailing?: string }) {
  const body = (
    <>
      <span className="manage-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icon} /></svg>
      </span>
      <span className="grow">
        <span className="manage-title">{title}</span>
        {sub && <span className="muted manage-sub">{sub}</span>}
      </span>
      {trailing && <span className="chip plain">{trailing}</span>}
      <svg className="manage-go" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
    </>
  );
  return href ? (
    <a className="manage-row" href={href}>{body}</a>
  ) : (
    <button type="button" className="manage-row" onClick={onClick}>{body}</button>
  );
}

/** From the PC: who is in the seat, how they look, how they have improved and (desktop app only) which devices are signed in as them. */
function ManageDriver({ driver }: { driver: Driver }) {
  const { status } = useAppState();
  const seat = useSeatSwitcher();
  const [connections, setConnections] = useState(false);
  const devices = useFetch(isTauri ? () => api.driverDevices(driver.id) : null, [driver.id, connections]);
  const seated = status?.seat === driver.id;
  return (
    <section className="card manage" aria-label={`Manage ${driver.name}`}>
      <h2>Manage {driver.name}</h2>
      <div className="manage-list">
        <ManageRow icon="M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 21a8 8 0 0 1 16 0" title={seated ? "In the seat" : "Put in seat"} sub={seated ? "Laps are going to them now" : "Laps will go to them"} onClick={seated ? undefined : () => seat.choose(driver)} trailing={seated ? "Now" : undefined} />
        {isTauri && (
          <ManageRow icon="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2" title="Connections" sub="Phones and browsers signed in as them" trailing={devices ? String(devices.length) : undefined} onClick={() => setConnections(true)} />
        )}
      </div>
      {seat.dialog}
      {connections && (
        <Modal title={`${driver.name}'s connections`} narrow onClose={() => setConnections(false)}>
          <PhonesDialog driver={driver} />
        </Modal>
      )}
    </section>
  );
}

function ProfileView({ profile: p, mine, manage, onSwitch }: { profile: Profile; mine: boolean; manage: boolean; onSwitch: () => void }) {
  const { status } = useAppState();
  // Customize and the Shop belong to the driver signed in on this device (or, on the PC, the one in the seat).
  const canDress = mine || (manage && status?.seat === p.driver.id);
  const into = p.xp - p.levelStartXp;
  const span = Math.max(1, p.nextLevelXp - p.levelStartXp);
  const earned = p.stickers.filter((s) => s.earned).length;
  return (
    <div className="you-layout">
      <div className="you-main">
      <section className="card you-hero" aria-label="Level">
        <span className="you-tile" style={{ background: `${p.driver.color}2E` }}>
          <Helmet color={p.driver.color} look={p.driver.look} size={92} tile={false} seed={p.driver.id} mood="happy" />
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
        <div className="you-wallet" data-solo={!canDress || undefined}>
          {canDress && (
            <a className="you-shop" href="#/shop">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 6h15l-1.5 9h-12zM6 6L5 3H2M9 20.5h.01M18 20.5h.01" /></svg>
              Shop
            </a>
          )}
          <span className="you-wallet-coins" title="Coins: earned with XP, spent in the Shop">
            <Coin size={26} spin title="Coins" />
            {p.coins.toLocaleString()}
          </span>
        </div>
        {canDress && (
          <a className="you-customize" href="#/customize">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" /></svg>
            Customize
          </a>
        )}
      </section>

      <div className="you-stats">
        <div className="stat-tile"><span className="mono">{p.cleanLaps}</span><span className="label">Clean laps</span></div>
        <div className="stat-tile"><span className="mono">{p.cleanPercent}%</span><span className="label">Clean</span></div>
        <div className="stat-tile"><span className="mono">{p.tracks}</span><span className="label">Tracks</span></div>
      </div>

      <div className="manage-list">
        <ManageRow icon="M3 17l5-6 4 4 6-8M14 7h6v6" title="Progress over time" sub="Bests and speed score on every track" href={`#/you/${p.driver.id}/progress`} />
      </div>

      {manage && <ManageDriver driver={p.driver} />}

      {mine && (
        <div className="you-switch">
          <span className="grow muted">This phone is set to {p.driver.name}.</span>
          <button className="btn ghost" onClick={onSwitch}>Not you?</button>
        </div>
      )}
      </div>

      <div className="you-side">
      <section className="you-section" aria-label="Bests">
        <div className="head"><h2>Bests</h2><span className="muted" style={{ fontSize: 13 }}>All games</span></div>
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

      <section className="you-section" aria-label="Recent">
        <div className="head"><h2>Recent</h2></div>
        {p.recent.length === 0 && <div className="empty">XP shows up here as you set clean laps.</div>}
        <div className="list">
          {p.recent.map((e) => (
            <div className="list-row" key={e.id}>
              <span className="grow">
                <span>{kindLabel(e.kind)}</span>
                <span className="muted" style={{ fontSize: 13 }}>{ago(e.at)}</span>
              </span>
              {e.xp !== 0 && <span className="mono" style={{ color: "var(--peri-1)" }}>+{e.xp} XP</span>}
              <span className="mono you-coin-gain" data-spend={e.coins < 0 || undefined}><Coin size={16} />{e.coins > 0 ? "+" : "−"}{Math.abs(e.coins)}</span>
            </div>
          ))}
        </div>
      </section>

      </div>
    </div>
  );
}
