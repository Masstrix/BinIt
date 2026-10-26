import { useState } from "react";
import { api, useAppState, useFetch, type Driver, type Profile } from "../api";
import { WhoAreYou } from "../components/MeBar";
import { Helmet } from "../components/Helmet";
import { carName, lapTime, trackName, ago } from "../format";
import { GameIcon } from "../components/GameIcon";
import { Modal } from "../components/Modal";
import { useSeatSwitcher } from "../components/SeatSwitcher";
import { ColorPicker, PhonesDialog } from "./Drivers";

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
      <div className="page-head">
        <h1>{info?.local ? "Profile" : "You"}</h1>
      </div>

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
              <Helmet color={d.color} size={36} seed={d.id} />
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

/** From the PC: put them in the seat, change their name and colour, see how they have improved, manage their phones. */
function ManageDriver({ driver }: { driver: Driver }) {
  const { status } = useAppState();
  const seat = useSeatSwitcher();
  const [editing, setEditing] = useState(false);
  const [phones, setPhones] = useState(false);
  const seated = status?.seat === driver.id;
  return (
    <div className="you-manage" role="group" aria-label={`Manage ${driver.name}`}>
      {seated ? (
        <span className="chip plain" style={{ color: "var(--peach)" }}>In the seat</span>
      ) : (
        <button className="btn" onClick={() => seat.choose(driver)}>Put in seat</button>
      )}
      <button className="btn ghost" onClick={() => setEditing(true)}>Edit name and colour</button>
      <a className="btn ghost" href={`#/drivers/${driver.id}`}>Progress</a>
      <button className="btn ghost" onClick={() => setPhones(true)}>Phones</button>
      {seat.dialog}
      {editing && (
        <Modal title={`Edit ${driver.name}`} narrow onClose={() => setEditing(false)}>
          <EditDriverForm driver={driver} onDone={() => setEditing(false)} />
        </Modal>
      )}
      {phones && (
        <Modal title={`${driver.name}'s phones`} narrow onClose={() => setPhones(false)}>
          <PhonesDialog driver={driver} />
        </Modal>
      )}
    </div>
  );
}

function EditDriverForm({ driver, onDone }: { driver: Driver; onDone: () => void }) {
  const [name, setName] = useState(driver.name);
  const [color, setColor] = useState(driver.color);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      await api.updateDriver(driver.id, name, color);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <form
      className="modal-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="modal-body" style={{ alignItems: "center", textAlign: "center", gap: 18 }}>
        <Helmet color={color} size={84} seed={driver.id} />
        <input className="input" data-autofocus aria-label="Name" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} style={{ minHeight: 56, fontSize: 20, fontWeight: 700, textAlign: "center", width: "100%" }} />
        <ColorPicker value={color} onChange={setColor} />
        {error && <span className="error">{error}</span>}
      </div>
      <div className="modal-foot">
        <button className="btn ghost" type="button" onClick={onDone}>Cancel</button>
        <button className="btn big" type="submit" disabled={!name.trim()}>Save</button>
      </div>
    </form>
  );
}

function ProfileView({ profile: p, mine, manage, onSwitch }: { profile: Profile; mine: boolean; manage: boolean; onSwitch: () => void }) {
  const into = p.xp - p.levelStartXp;
  const span = Math.max(1, p.nextLevelXp - p.levelStartXp);
  const earned = p.stickers.filter((s) => s.earned).length;
  return (
    <div className="you-layout">
      <div className="you-main">
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

      {manage && <ManageDriver driver={p.driver} />}

      {mine && (
        <div className="you-switch">
          <span className="grow muted">This phone is set to {p.driver.name}.</span>
          <button className="btn ghost" onClick={onSwitch}>Not you?</button>
        </div>
      )}
      </div>

      <div className="you-side">
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

      </div>
    </div>
  );
}
