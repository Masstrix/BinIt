import { useEffect, useState } from "react";
import { ApiError, api, deviceToken, store, useAppState, useFetch, type Driver } from "../api";
import { lapTime } from "../format";
import { readStored, writeStored } from "../persist";
import { Helmet } from "./Helmet";
import { Modal } from "./Modal";
import { useSeatSwitcher } from "./SeatSwitcher";

const RING_R = 24;
const RING_C = 2 * Math.PI * RING_R;

/**
 * Phones: the banner at the top, "this is me" and the seat. A phone is paired to a driver by the server (see
 * `pair_device` in tt-core): the first phone to pick a driver claims them, another one needs a code from the
 * PC or from the driver's own phone. Logging out unpairs this phone.
 */
export function MeBar() {
  const { status, drivers } = useAppState();
  const [picking, setPicking] = useState(false);
  const [tick, setTick] = useState(0);
  const seat = useSeatSwitcher();

  // Who the server says this phone is. It changes when this phone pairs or logs out, or the PC signs it out.
  const info = useFetch(() => api.me(), [drivers, tick]);
  const me = info?.driver ?? null;
  const inSeat = me != null && status?.seat === me.id;
  const refresh = () => {
    setTick((t) => t + 1);
    store.refreshAll().catch(() => {});
  };

  // A phone that remembered a driver before pairing existed: pair it quietly if that driver is still free.
  useEffect(() => {
    if (!info || me || deviceToken.get()) return;
    const old = readStored<number | null>("me", null, (v) => typeof v === "number");
    if (old == null) return;
    writeStored("me", null);
    api
      .pair(old)
      .then((r) => {
        deviceToken.set(r.token);
        refresh();
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

  // Level and XP to go, for the badge and the line under the name. Refetches when a lap is recorded.
  const profile = useFetch(me ? () => api.profile(me.id) : null, [me?.id]);
  const live = status?.live;
  const driving = inSeat && !!live?.driving;
  const delta = live?.timing?.deltaMs;
  const state = driving ? "driving" : inSeat ? "seated" : "free";
  // The ring: XP towards the next level; while you drive it follows the lap instead.
  const xpFill = profile ? (profile.xp - profile.levelStartXp) / Math.max(1, profile.nextLevelXp - profile.levelStartXp) : 0;
  const ringFill = Math.max(0, Math.min(1, driving ? (live?.lapProgress ?? 0) : xpFill));

  return (
    <div className="me-bar" data-state={state}>
      <button type="button" className="me-who" onClick={() => (me ? (location.hash = "#/you") : setPicking(true))} title={me ? "Your profile" : "Who you are on this phone"}>
        <span className="me-ring">
          <svg className="me-ring-svg" viewBox="0 0 54 54" aria-hidden="true">
            <circle className="me-ring-track" cx="27" cy="27" r={RING_R} />
            <circle
              className="me-ring-arc"
              cx="27"
              cy="27"
              r={RING_R}
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - ringFill)}
              transform="rotate(-90 27 27)"
            />
          </svg>
          <span className="me-face" style={{ background: `${me?.color ?? "#5B6578"}2E` }}>
            <Helmet color={me?.color ?? "#5B6578"} size={34} tile={false} seed={me?.id} mood={inSeat ? "happy" : "idle"} />
          </span>
          {profile && <span className="me-level" aria-label={`Level ${profile.level}`}>{profile.level}</span>}
        </span>
        <span className="me-text">
          {driving ? (
            <>
              <span className="mono me-time">{lapTime(live?.currentLapMs)}</span>
              <span className="me-sub me-good">{delta != null ? `${delta <= 0 ? "−" : "+"}${(Math.abs(delta) / 1000).toFixed(3)} on your best` : "Driving"}</span>
            </>
          ) : (
            <>
              <span className="me-name">{me ? me.name : "Who are you?"}</span>
              <span className="me-sub">
                {me
                  ? profile
                    ? `${(profile.nextLevelXp - profile.xp).toLocaleString()} XP to level ${profile.level + 1}${inSeat ? " · in the seat" : ""}`
                    : inSeat ? "In the seat" : "Seat free"
                  : "Pick your driver"}
              </span>
            </>
          )}
        </span>
      </button>
      {me &&
        (inSeat ? (
          <button type="button" className="me-leave" onClick={() => seat.choose(null, true)}>Leave</button>
        ) : (
          <button type="button" className="btn me-go" onClick={() => seat.choose(me, true)}>Enter seat</button>
        ))}
      {seat.dialog}
      {picking && (
        <WhoAreYou
          drivers={drivers}
          me={me}
          onClose={() => setPicking(false)}
          onChanged={() => {
            setPicking(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

/** Pick who you are, ask for a pairing code when that driver already has a phone, pair another phone, or log out. */
export function WhoAreYou({ drivers, me, onClose, onChanged }: { drivers: Driver[]; me: Driver | null; onClose: () => void; onChanged: () => void }) {
  const [asking, setAsking] = useState<Driver | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState<{ code: string; expiresAt: number } | null>(null);

  const pair = async (d: Driver, withCode?: string) => {
    setBusy(true);
    setError(null);
    try {
      // Moving to someone else: log this phone out of the old driver first.
      if (me && me.id !== d.id) await api.logout().catch(() => {});
      const r = await api.pair(d.id, withCode);
      deviceToken.set(r.token);
      onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.code === "codeNeeded") {
        setAsking(d);
        setCode("");
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    await api.logout().catch(() => {});
    deviceToken.set(null);
    setBusy(false);
    onChanged();
  };

  if (asking) {
    return (
      <Modal title={`${asking.name} already has a phone`} onClose={onClose} narrow>
        <div className="modal-body">
          <p className="muted" style={{ marginTop: 0 }}>
            To use {asking.name} on this phone, enter the 6 digit code. Get it on the PC (Drivers, then Phones) or on {asking.name}'s own phone (tap the banner, then Pair another phone).
          </p>
          <input
            className="input code-input mono"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            aria-label="Pairing code"
            autoFocus
          />
          {error && <span className="error">{error}</span>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={() => { setAsking(null); setError(null); }}>Back</button>
          <button type="button" className="btn" disabled={code.length !== 6 || busy} onClick={() => pair(asking, code)}>Pair this phone</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Who are you?" onClose={onClose} narrow>
      <div className="modal-body">
        <p className="muted" style={{ marginTop: 0 }}>
          {me ? `This phone is ${me.name}'s. Pick someone else to switch.` : "Pick yourself once and this phone remembers you."}
        </p>
        {drivers.length === 0 ? (
          <div className="empty">No drivers yet. Add yourself on the Home page first.</div>
        ) : (
          <div className="driver-grid">
            {drivers.map((d) => (
              <button
                key={d.id}
                type="button"
                className="driver-btn"
                aria-pressed={d.id === me?.id}
                disabled={busy}
                style={{ borderColor: d.id === me?.id ? d.color : "transparent" }}
                onClick={() => (d.id === me?.id ? onClose() : pair(d))}
              >
                <Helmet color={d.color} size={52} seed={d.id} />
                <span className="name">{d.name}</span>
              </button>
            ))}
          </div>
        )}
        {error && <span className="error">{error}</span>}
        {share && (
          <div className="pair-code" role="status">
            <span className="muted">On the other phone, pick {me?.name} and enter</span>
            <span className="mono pair-code-digits">{share.code.slice(0, 3)} {share.code.slice(3)}</span>
            <span className="muted">It works once, for 5 minutes.</span>
          </div>
        )}
      </div>
      {me && (
        <div className="modal-foot">
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={async () => {
              try {
                setShare(await api.pairCode(me.id));
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Pair another phone
          </button>
          <button type="button" className="btn ghost" disabled={busy} onClick={logout}>Log out</button>
        </div>
      )}
    </Modal>
  );
}
