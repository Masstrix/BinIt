import { useState } from "react";
import { api, useAppState, useCurrentChallenge, useDriverMap, useFetch, type Driver } from "../api";
import { Helmet, Sparkle } from "../components/Helmet";
import { Podium } from "../components/Podium";
import { LAP_BADGE, ago, countdown, gap, lapKind, lapTime, trackName } from "../format";

export function Home() {
  const { status, drivers, recentLaps } = useAppState();
  const driverMap = useDriverMap();
  const seat = status?.seat != null ? driverMap.get(status.seat) : undefined;
  const session = status?.session ?? null;
  const { challenge, board } = useCurrentChallenge();

  const comboBoard = useFetch(
    session ? () => api.leaderboard({ game: session.game, track: session.track, layout: session.layout, car: session.car }) : null,
    [session?.game, session?.track, session?.layout, session?.car],
  );
  const seatPb = seat ? comboBoard?.find((e) => e.driverId === seat.id) : undefined;
  // Last real attempt (timed or cut): out/in laps aren't interesting as a "last lap".
  const seatLast = seat ? recentLaps.find((l) => l.driverId === seat.id && ["timed", "cut"].includes(lapKind(l))) : undefined;
  const standing = seat ? board.find((e) => e.driverId === seat.id) : undefined;
  const leader = board[0];
  const leaderName = leader?.driverId != null ? driverMap.get(leader.driverId)?.name : "A guest";

  return (
    <>
      <div className="head" style={{ alignItems: "flex-end" }}>
        <h1>Who's in the seat?</h1>
        <span className="muted">
          {session ? `${trackName(session.track, session.layout)} · ${session.car}` : status?.connected ? "Waiting for you to get on track" : "Start a game to begin timing"}
        </span>
      </div>

      <section className="hero" aria-label="Current driver">
        <Sparkle size={26} opacity={0.7} style={{ right: 36, top: 28 }} />
        <Sparkle size={14} opacity={0.5} style={{ right: 80, top: 70 }} />
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 20 }}>
          <span style={{ width: 92, height: 92, borderRadius: 26, background: "#EEF0FF", display: "grid", placeItems: "center" }}>
            <Helmet color={seat?.color ?? "#9AA3C7"} size={70} tile={false} />
          </span>
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, opacity: 0.85 }}>{seat ? "Driving now" : "Nobody picked"}</div>
            <div className="hero-name">{seat?.name ?? "Guest"}</div>
            <div style={{ opacity: 0.85, marginTop: 4 }}>
              {seat ? `Every lap is saved to ${seat.name}` : "Laps are saved as guest laps and can be claimed later"}
            </div>
          </div>
          <button className="btn white" onClick={() => document.getElementById("pick")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            Switch driver <span className="kbd">F8</span>
          </button>
        </div>

        <div className="stat-grid">
          <div className="stat">
            <div className="label" style={{ color: "#fff", opacity: 0.85 }}>Current lap</div>
            <span className="mono">{status?.live?.driving ? lapTime(status.live.currentLapMs) : "--:--.---"}</span>
          </div>
          <div className="stat">
            <div className="label" style={{ color: "#fff", opacity: 0.85 }}>Last lap</div>
            <span className="mono" style={seatLast && !seatLast.valid ? { textDecoration: "line-through", opacity: 0.7 } : undefined}>
              {lapTime(seatLast?.timeMs)}
            </span>
          </div>
          <div className="stat">
            <div className="label" style={{ color: "#fff", opacity: 0.85 }}>Personal best</div>
            <span className="mono" style={{ color: "var(--mint-bright)" }}>{lapTime(seatPb?.timeMs)}</span>
          </div>
        </div>

        {challenge && seat && (
          <div className="banner">
            <span className="badge">{standing ? `#${standing.position}` : "?"}</span>
            <span>
              {!standing
                ? `Set a lap to get on the board in ${challenge.name}.`
                : standing.position === 1
                  ? `${seat.name} holds the crown in ${challenge.name}. Defend it!`
                  : `Just ${(standing.gapMs / 1000).toFixed(3)}s off the crown. ${leaderName} holds P1 in ${challenge.name}.`}
            </span>
          </div>
        )}
      </section>

      <DriverPicker drivers={drivers} seatId={status?.seat ?? null} />

      <div className="row">
        <section className="card" aria-label="Active challenge">
          {challenge ? (
            <>
              <div className="head" style={{ alignItems: "flex-start" }}>
                <div>
                  <div className="label" style={{ color: "var(--peach)" }}>Active challenge</div>
                  <h2 style={{ marginTop: 4 }}>{challenge.name}</h2>
                </div>
                {challenge.endsAt && <span className="chip plain mono">{countdown(challenge.endsAt)}</span>}
              </div>
              <Podium entries={board} drivers={driverMap} scale={110} helmets={false} />
              <a href="#/challenges" style={{ fontWeight: 600 }}>See full standings →</a>
            </>
          ) : (
            <>
              <h2>No challenge running</h2>
              <p className="muted" style={{ margin: 0 }}>Set a track and a deadline and let the office fight it out.</p>
              <a className="btn" href="#/challenges" style={{ alignSelf: "flex-start" }}>Start a challenge</a>
            </>
          )}
        </section>

        <section className="card" aria-label="Recent laps">
          <h2>Recent laps</h2>
          {recentLaps.length === 0 && <div className="empty">No laps yet. Get out there!</div>}
          <div className="list">
            {recentLaps.slice(0, 6).map((l) => {
              const d = l.driverId != null ? driverMap.get(l.driverId) : undefined;
              const kind = lapKind(l);
              const badge = kind === "timed" ? null : LAP_BADGE[kind];
              return (
                <div className="list-row" key={l.id}>
                  <span className="grow">
                    <span>
                      {d?.name ?? "Guest"} <span className="muted" style={{ fontSize: 14 }}>· lap {l.lapNumber} · {ago(l.recordedAt)}</span>
                    </span>
                  </span>
                  {badge && <span className={badge.className} title={badge.title}>{badge.text}</span>}
                  {l.driverId == null && seat && (
                    <button className="chip plain" style={{ border: "none" }} onClick={() => api.claimLap(l.id, seat.id)}>
                      Claim for {seat.name}
                    </button>
                  )}
                  <span
                    className="mono"
                    style={{
                      fontSize: 15,
                      ...(kind === "cut" ? { color: "#7F88AE", textDecoration: "line-through" } : kind !== "timed" ? { color: "#7F88AE" } : {}),
                    }}
                  >
                    {lapTime(l.timeMs)}
                  </span>
                </div>
              );
            })}
          </div>
          {comboBoard && comboBoard.length > 0 && seatPb && (
            <span className="muted" style={{ fontSize: 13 }}>
              {seat?.name} is P{seatPb.position} on this combo ({gap(seatPb.gapMs)})
            </span>
          )}
        </section>
      </div>
    </>
  );
}

export function DriverPicker({ drivers, seatId }: { drivers: Driver[]; seatId: number | null }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!name.trim()) return;
    try {
      await api.addDriver(name, undefined, true);
      setName("");
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section id="pick" className="card" aria-label="Pick a driver">
      <div className="head">
        <h2>Tap your helmet</h2>
        <span className="muted" style={{ fontSize: 14 }}>Laps go to whoever is picked. No passwords, play fair.</span>
      </div>
      {drivers.length > 0 && (
        <div className="driver-grid">
          {drivers.map((d) => {
            const active = d.id === seatId;
            return (
              <button
                key={d.id}
                className="driver-btn"
                aria-pressed={active}
                style={{ borderColor: active ? d.color : "transparent" }}
                onClick={() => api.setSeat(active ? null : d.id)}
              >
                <Helmet color={d.color} size={60} />
                <span className="name">{d.name}</span>
                <span className="muted" style={{ fontSize: 12 }}>{active ? "in the seat" : "tap to drive"}</span>
              </button>
            );
          })}
        </div>
      )}
      <form
        className="add-bar"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <label htmlFor="newname">New here?</label>
        <input
          id="newname"
          className="input"
          value={name}
          maxLength={32}
          onChange={(e) => setName(e.target.value)}
          placeholder="Type your name and press Enter"
          autoComplete="off"
        />
        <button className="btn" type="submit" disabled={!name.trim()}>Add + drive</button>
      </form>
      {error && <span className="error">{error}</span>}
    </section>
  );
}
