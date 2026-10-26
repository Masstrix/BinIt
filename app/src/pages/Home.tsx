import { api, isTauri, openDownload, useAppState, useCurrentChallenge, useDriverMap, useFetch } from "../api";
import { Helmet } from "../components/Helmet";
import { LiveMap } from "../components/LiveMap";
import { cap, words } from "../vocab";
import { ago, carName, countdown, gap, LAP_BADGE, lapKind, lapTime, trackName } from "../format";
import { Signed } from "../components/Signed";
import { openPickDriver } from "../components/PickDriver";

export function Home() {
  const { status, recentLaps } = useAppState();
  const driverMap = useDriverMap();
  const seat = status?.seat != null ? driverMap.get(status.seat) : undefined;
  const session = status?.session ?? null;
  const w = words(session?.game ?? status?.game);
  // Cut / off the track: the game has invalidated this lap (not just an out lap from the pits).
  const cutLap = !!(status?.live?.driving && !status.live.outLap && !status.live.lapValid);
  const swapped = cutLap && status?.live?.voidReason === "driverChange";
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
      <div className="page-head">
        <h1>Who's in the seat?</h1>
        <span className="muted page-sub">
          {session ? `${trackName(session.track, session.layout)} · ${carName(session.car)}` : status?.connected ? `Waiting for you to ${w.rally ? "start a stage" : "get on track"}` : "Start a game to begin timing"}
        </span>
      </div>

      <div className="home-top">
      <section className="hero" aria-label="Current driver">
        <div className="hero-top">
          <span className="hero-tile">
            <Helmet color={seat?.color ?? "#8f99b3"} look={seat?.look} size={84} tile={false} seed={seat?.id} mood={seat ? "focus" : "idle"} />
          </span>
          <div className="hero-who">
            <div className="hero-kicker">{seat ? "Driving now" : "Nobody picked"}</div>
            <div className="hero-name">{seat?.name ?? "Guest"}</div>
            <div className="hero-sub">
              {seat ? `Every ${w.lap} is saved to ${seat.name}` : `${cap(w.laps)} are saved as guest ${w.laps} and can be claimed later`}
            </div>
          </div>
          <button className="btn white hero-switch" onClick={openPickDriver}>
            <span className="long">Switch driver</span>
            <span className="short">Switch</span> <span className="kbd">F8</span>
          </button>
        </div>

        <div className={`now-lap${cutLap ? " invalid" : ""}`}>
          <div className="now-lap-main">
            <span className="label">{swapped ? "Driver changed" : cutLap ? `${cap(w.lap)} invalid` : `Current ${w.lap}`}</span>
            <span className="mono now-lap-time">{status?.live?.driving ? lapTime(status.live.currentLapMs) : "--:--.---"}</span>
          </div>
          {status?.live?.driving && status.live.timing?.deltaMs != null && !cutLap && (
            <>
              <span className={`delta-pill${status.live.timing.deltaMs > 0 ? " slower" : ""}`}>
                <Signed text={`${status.live.timing.deltaMs <= 0 ? "−" : "+"}${(Math.abs(status.live.timing.deltaMs) / 1000).toFixed(3)}`} />
              </span>
              <span className="muted now-lap-ref">vs {status.live.timing.reference ?? "your best"}</span>
            </>
          )}
        </div>
        <div className="stat-grid">
          <div className="stat">
            <div className="label">Last {w.lap}</div>
            <span className="mono" style={seatLast && !seatLast.valid ? { textDecoration: "line-through", opacity: 0.7 } : undefined}>
              {lapTime(seatLast?.timeMs)}
            </span>
          </div>
          <div className="stat">
            <div className="label">Personal best</div>
            <span className="mono" style={{ color: "var(--mint)" }}>{lapTime(seatPb?.timeMs)}</span>
          </div>
        </div>

        {challenge && seat && (
          <a className="banner" href={`#/challenges/${challenge.id}`}>
            <span className="badge">{standing ? `P${standing.position}` : "?"}</span>
            <span className="banner-text">
              {!standing
                ? `Set a ${w.lap === "run" ? "time" : "lap"} to get on the board in ${challenge.name}.`
                : standing.position === 1
                  ? `${seat.name} holds the crown in ${challenge.name}. Defend it!`
                  : `Just ${(standing.gapMs / 1000).toFixed(3)}s off the crown. ${leaderName} holds P1 in ${challenge.name}.`}
            </span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
          </a>
        )}
      </section>

      <div className="home-side">
        <LiveMap placeholder />
        <RecentLaps />
      </div>
      </div>

      <div className="home-bottom">
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
              <ol className="rank-list">
                {board.slice(0, 3).map((e) => {
                  const d = e.driverId != null ? driverMap.get(e.driverId) : undefined;
                  return (
                    <li key={e.lapId} className={`rank-row${seat && e.driverId === seat.id ? " me" : ""}`}>
                      <span className="rank-pos">{e.position}</span>
                      <Helmet color={d?.color ?? "#5b6578"} look={d?.look} size={36} seed={d?.id} />
                      <span className="rank-name">{d?.name ?? "Guest"}</span>
                      <span className="mono">{lapTime(e.timeMs)}</span>
                    </li>
                  );
                })}
              </ol>
              {board.length === 0 && <div className="empty">No {w.laps} yet. First one to set a time takes the crown.</div>}
              <a href={`#/challenges/${challenge.id}`} style={{ fontWeight: 600 }}>See full standings →</a>
            </>
          ) : (
            <>
              <h2>No challenge running</h2>
              <p className="muted" style={{ margin: 0 }}>Set a {w.track} and a deadline and let the office fight it out.</p>
              <a className="btn" href="#/challenges" style={{ alignSelf: "flex-start" }}>Start a challenge</a>
            </>
          )}
        </section>

        <DriversLink />
      </div>

      {isTauri && <GetLatest />}
    </>
  );
}

/** On a phone the Drivers page sits behind the Rig tab; this card is the way to it from Home. */
function DriversLink() {
  const { drivers } = useAppState();
  if (drivers.length === 0) return null;
  return (
    <a className="card home-drivers" href="#/drivers" aria-label={`Drivers: ${drivers.length}`}>
      <span className="hd-text">
        <h2>Drivers</h2>
        <span className="muted">{drivers.length} {drivers.length === 1 ? "driver" : "drivers"} · speed scores and profiles</span>
      </span>
      <span className="hd-faces" aria-hidden="true">
        {drivers.slice(0, 5).map((d) => (
          <Helmet key={d.id} color={d.color} look={d.look} size={36} seed={d.id} />
        ))}
      </span>
      <svg className="hd-go" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
    </a>
  );
}

function RecentLaps() {
  const { status, recentLaps } = useAppState();
  const driverMap = useDriverMap();
  const seat = status?.seat != null ? driverMap.get(status.seat) : undefined;
  const session = status?.session ?? null;
  const w = words(session?.game ?? status?.game);
  const comboBoard = useFetch(
    session ? () => api.leaderboard({ game: session.game, track: session.track, layout: session.layout, car: session.car }) : null,
    [session?.game, session?.track, session?.layout, session?.car],
  );
  const seatPb = seat ? comboBoard?.find((e) => e.driverId === seat.id) : undefined;
  return (
    <section className="card" aria-label={`Recent ${w.laps}`}>
      <h2>Recent {w.laps}</h2>
      {recentLaps.length === 0 && <div className="empty">No {w.laps} yet. Get out there!</div>}
      <div className="list">
        {recentLaps.slice(0, 6).map((l) => {
          const d = l.driverId != null ? driverMap.get(l.driverId) : undefined;
          const kind = lapKind(l);
          const badge = kind === "timed" ? null : LAP_BADGE[kind];
          return (
            <div className="list-row" key={l.id}>
              <span className="grow">
                <span>
                  {d?.name ?? "Guest"} <span className="muted" style={{ fontSize: 14 }}>· {words(l.game).lap} {l.lapNumber} · {ago(l.recordedAt)}</span>
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
                  ...(kind === "cut" ? { color: "#8f99b3", textDecoration: "line-through" } : kind !== "timed" ? { color: "#8f99b3" } : {}),
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
  );
}

/**
 * Links to the latest installer and portable exe, to set Bin It up on another PC or (for the
 * portable copy, which can't update itself) to get a new version. Desktop app only.
 */
function GetLatest() {
  const { update } = useAppState();
  if (!update) return null;
  const newer = update.latest;
  return (
    <section className={`get-latest${newer ? " has-update" : ""}`} aria-label="Get the latest Bin It">
      <span className="grow">
        {newer ? (
          <>
            <strong>Bin It {newer.version} is out.</strong>{" "}
            <span className="muted">
              {update.kind === "installed" ? "Update from the menu, or it installs next time Bin It starts." : `This copy is ${update.current}.`}
            </span>
          </>
        ) : (
          <span className="muted">
            Bin It {update.current}
            {update.kind === "installed" ? " · updates itself" : update.kind === "portable" ? " · portable copy" : ""}
          </span>
        )}
      </span>
      <span className="get-latest-links">
        <span className="muted">Latest:</span>
        <button className="chip plain" onClick={() => openDownload("installer")}>Installer</button>
        <button className="chip plain" onClick={() => openDownload("portable")}>Portable exe</button>
        <button className="chip plain" onClick={() => openDownload("release")}>What's new</button>
      </span>
    </section>
  );
}
