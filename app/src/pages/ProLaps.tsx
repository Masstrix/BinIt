import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api, assetUrl, useAppState, useCatalogue, useDriverMap, useFetch, useProOverview, useViewerId, type Catalogue, type ProBest, type ProEntry, type ProOverview } from "../api";
import { Helmet } from "../components/Helmet";
import { GameLabel } from "../components/GameIcon";
import { ago, carName, gameName, gap, lapTime, trackName } from "../format";
import { setupFor } from "../proMode";

/** The Office / Pro laps switch at the top of the Challenges section. */
export function ChallengeTabs({ active }: { active: "office" | "pro" }) {
  return (
    <nav className="pro-tabs" aria-label="Kinds of challenge">
      <a href="#/challenges" aria-current={active === "office" ? "page" : undefined}>Office challenges</a>
      <a href="#/challenges/pro" aria-current={active === "pro" ? "page" : undefined}>
        <FlagIcon size={16} />Pro laps
      </a>
    </nav>
  );
}

/** The title and the Office / Pro laps switch: the same place on every page of the section. */
export function ChallengesHeader({ active }: { active: "office" | "pro" }) {
  return (
    <div className="page-head ch-section-head">
      <h1>Challenges</h1>
      <ChallengeTabs active={active} />
    </div>
  );
}

function FlagIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
    </svg>
  );
}

type Status = "beaten" | "level" | "tried" | "new";

/** Where one driver stands on a challenge, from the board's rows. */
function standing(c: ProEntry, who: number | null): { status: Status; best: ProBest | null } {
  const best = (who != null && c.board.find((b) => b.driverId === who)) || null;
  if (!best) return { status: "new", best: null };
  if (best.timeMs < c.timeMs) return { status: "beaten", best };
  if (best.timeMs <= c.limitMs) return { status: "level", best };
  return { status: "tried", best };
}

const STATUS_LABEL: Record<Status, string> = { beaten: "Beaten", level: "Pro level", tried: "Tried", new: "Not tried" };

function carLabel(c: ProEntry) {
  return c.car ? carName(c.car) : `Any ${c.class}`;
}

/** The games a challenge can be driven in, for display. */
function gamesLabel(c: ProEntry) {
  return c.games.length ? c.games.map(gameName).join(" · ") : "Any game";
}

function artUrl(c: ProEntry) {
  return c.art ? assetUrl(`/challenge-art/${encodeURIComponent(c.art)}`) : null;
}

/** Without a photo a card gets a calm gradient of its own, so the list still reads as a set. */
function placeholder(id: string): CSSProperties {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return { background: `linear-gradient(135deg, hsl(${h} 38% 14%), hsl(${(h + 40) % 360} 42% 26%))` };
}

/** The picture, with its shading on it: one element, so the shading stays on the picture while it moves. */
function Art({ c, position }: { c: ProEntry; position?: string | null }) {
  const url = artUrl(c);
  return url ? (
    <span className="pro-art" aria-hidden="true">
      <img src={url} alt="" decoding="sync" style={position ? { objectPosition: position } : undefined} />
    </span>
  ) : (
    <span className="pro-art" style={placeholder(c.id)} aria-hidden="true" />
  );
}

/** The Pro lap whose page was open last, so the list can scroll to its card on the way back. */
let lastOpened: string | null = null;

// ---- list ------------------------------------------------------------------------

export function ProLapsPage({ path }: { path: string }) {
  const overview = useProOverview();
  const id = path.split("/")[3];
  const entry = overview?.challenges.find((c) => c.id === id) ?? null;
  if (id) {
    if (!overview) return <div className="pro-page"><ChallengesHeader active="pro" /></div>;
    return entry ? <ProDetail overview={overview} entry={entry} /> : <div className="pro-page"><ChallengesHeader active="pro" /><div className="empty">That challenge is not here any more.</div></div>;
  }
  return <ProList overview={overview} />;
}

function ProList({ overview }: { overview: ProOverview | null }) {
  const who = useViewerId();
  // Coming back from a challenge: its card stays put and the others rise in around it. Decided once, as the page
  // appears, so the rise runs to its end (a rule tied to the transition would be cut off, and the cards would jump,
  // when the transition ends).
  const [returnedFrom] = useState(() => (document.documentElement.dataset.nav === "close" ? (lastOpened ?? "") : null));
  const active = overview?.challenges.find((c) => c.id === overview.active) ?? null;
  // The cards sit in a row you scroll sideways. The row fades out where there is more to see, and is solid at an edge.
  const rail = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false, fit: false, thumb: 1, at: 0 });
  const measure = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    // "Fits" is worked out from the cards and the space they have (not from the row's own scroll width, which changes
    // with the padding a fitting row drops), so it cannot flip back and forth.
    const first = el.firstElementChild as HTMLElement | null;
    const last = el.lastElementChild as HTMLElement | null;
    const cards = first && last ? last.offsetLeft + last.offsetWidth - first.offsetLeft : 0;
    // The scroll bar under the row: its thumb is the share of the row you can see, and it sits where you have scrolled to.
    const thumb = Math.min(1, el.clientWidth / Math.max(1, el.scrollWidth));
    const range = Math.max(1, el.scrollWidth - el.clientWidth);
    // Whole pixels, for the cards and where the row starts: the browser's picture of a card is a whole number of pixels, so a
    // card of 311.34 px would change by a fraction of a pixel (a visible edge) when the real card takes over at the end.
    const wrap = el.parentElement;
    if (wrap) {
      const dpr = window.devicePixelRatio || 1;
      const top = wrap.getBoundingClientRect().top;
      el.style.top = `${(Math.round(top * dpr) - top * dpr) / dpr}px`;
      const free = wrap.clientWidth - cards;
      el.style.setProperty("--row-pad", `${cards > 0 && free > 0 ? Math.floor(free / 2) : 0}px`);
    }
    setEdge({
      start: el.scrollLeft < 4,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4,
      fit: cards > 0 && cards <= (el.parentElement?.clientWidth ?? 0),
      thumb,
      at: Math.min(1, el.scrollLeft / range) * (1 - thumb),
    });
  }, []);
  // The cards are as tall as the window leaves room for, so their width changes with the window: measure again then.
  useLayoutEffect(() => {
    const el = rail.current;
    if (!el) return;
    // Coming back from a challenge: show its card (the row starts at the left every time the page is made).
    const back = lastOpened && el.querySelector<HTMLElement>(`[data-pro-card="${CSS.escape(lastOpened)}"]`);
    lastOpened = null;
    if (back) el.scrollTo({ left: Math.max(0, back.offsetLeft - (el.clientWidth - back.offsetWidth) / 2), behavior: "instant" });
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [measure, overview]);
  const more = () => rail.current?.scrollBy({ left: Math.max(320, rail.current.clientWidth * 0.8), behavior: "smooth" });

  return (
    <div className="pro-page pro-page-list">
      <ChallengesHeader active="pro" />

      <div className="pro-intro">
        <span className="pro-kicker"><FlagIcon size={14} />Pro laps</span>
        <h2 className="pro-intro-title">Take on a real pro lap</h2>
        <p className="pro-intro-sub">Beat a real driver's time on the same track and car.</p>
      </div>

      {overview && overview.problems.length > 0 && (
        <div className="pro-problem" role="alert">
          <b>Your own challenges are not loaded.</b>
          {overview.problems.map((p) => <span key={p}>{p}</span>)}
          <span>Fix the file and reload this page; the challenges that come with Bin It carry on meanwhile.</span>
        </div>
      )}

      {active && (
        <div className="pro-live" role="status">
          <span><b>Challenge mode is on:</b> {active.name} · {carLabel(active)}</span>
          <a className="btn ghost" href={`#/challenges/pro/${active.id}`}>Open</a>
        </div>
      )}

      {!overview ? (
        <div className="empty">Loading…</div>
      ) : (
        <div className="pro-rail-wrap">
          <div className="pro-rail" ref={rail} onScroll={measure} data-start={edge.start || undefined} data-end={edge.end || undefined} data-fit={edge.fit || undefined}>
            {overview.challenges.map((c, i) => {
              const s = standing(c, who);
              return (
                <a key={c.id} className={`pro-card${returnedFrom !== null && c.id !== returnedFrom ? " pro-card-in" : ""}`} href={`#/challenges/pro/${c.id}`} data-status={s.status} data-pro-card={c.id} style={{ "--i": i } as CSSProperties}>
                  <Art c={c} position={c.cardOffset ?? c.artOffset} />
                  <span className="pro-card-top">
                    <span className="pro-flag-chip"><FlagIcon size={13} />Pro lap</span>
                    <span className="pro-status" data-status={s.status}>{overview.active === c.id ? "Challenge on" : STATUS_LABEL[s.status]}</span>
                  </span>
                  <span className="pro-card-bottom">
                    <span className="pro-card-text">
                      <span className="pro-card-name">{c.name}</span>
                      <span className="pro-card-car">{carLabel(c)}</span>
                      <span className="pro-card-meta">{gamesLabel(c)}{c.layout ? ` · ${c.layout}` : ""}</span>
                    </span>
                    <span className="pro-card-time">
                      <span className="pro-card-time-label">PRO TIME</span>
                      <span className="mono">{lapTime(c.timeMs)}</span>
                    </span>
                  </span>
                </a>
              );
            })}
          </div>
          {!edge.fit && (
            <div className="pro-rail-bar" aria-hidden="true">
              <span style={{ width: `${edge.thumb * 100}%`, left: `${edge.at * 100}%` }} />
            </div>
          )}
          {!edge.end && (
            <button type="button" className="pro-rail-next" aria-label="Scroll right" onClick={more}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
            </button>
          )}
        </div>
      )}

      {overview?.folder && (
        <p className="muted pro-folder">
          Add your own: put a <span className="mono">pro_challenges.toml</span> and a <span className="mono">challenge-art</span> folder of pictures in <span className="mono">{overview.folder}</span>, then reload this page.
        </p>
      )}
    </div>
  );
}

// ---- detail ------------------------------------------------------------------------

/** What the game is running next to what the challenge needs, so a wrong setup is easy to fix. */
function useSetup(c: ProEntry, catalogue: Catalogue | null) {
  const { status } = useAppState();
  return setupFor(c, status?.session ?? null, catalogue);
}

function Check({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="pro-dot" aria-hidden="true" />;
  return (
    <span className={`pro-check ${ok ? "ok" : "bad"}`} aria-label={ok ? "Matches" : "Does not match"} role="img">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={ok ? "M5 12.5l4.5 4.5L19 7.5" : "M6 6l12 12M18 6L6 18"} />
      </svg>
    </span>
  );
}

function ProDetail({ overview, entry: c }: { overview: ProOverview; entry: ProEntry }) {
  // Opened by the card growing into this page: the banner's text is carried in by that, so it must not also rise in
  // on its own (and it must not start again when the grow ends). Decided once, as the page appears.
  const [grown] = useState(() => document.documentElement.dataset.nav === "open");
  useEffect(() => {
    lastOpened = c.id;
  }, [c.id]);
  const who = useViewerId();
  const drivers = useDriverMap();
  const { status: app } = useAppState();
  // A class challenge needs the catalogue of the game that is running, to know which class the car is in.
  const catalogue = useCatalogue(app?.session?.game ?? null);
  const setup = useSetup(c, catalogue);
  const { best, status } = standing(c, who);
  const on = overview.active === c.id;
  const mine = useFetch(who != null ? () => api.proAttempts(c.id, who) : null, [c.id, who]) ?? [];
  const rows = useMemo(
    () => [
      { label: "GAME", value: gamesLabel(c), ok: setup?.game.ok ?? null, has: setup?.game.has },
      { label: "TRACK", value: trackName(c.track), ok: setup?.track.ok ?? null, has: setup?.track.has },
      { label: "LAYOUT", value: c.layout || "Any layout", ok: setup?.layout.ok ?? null, has: setup?.layout.has },
      { label: "CAR", value: carLabel(c), ok: setup?.car.ok ?? null, has: setup?.car.has },
    ],
    [c, setup],
  );
  const margin = c.marginPercent;

  // The bar runs from the pro's time (right) back to three margins behind it (left).
  const span = (c.limitMs - c.timeMs) * 3 || 1;
  const pos = (ms: number) => Math.max(0, Math.min(100, ((c.timeMs + span - ms) / span) * 100));

  const action = () => api.setProActive(on ? null : c.id).catch(() => {});

  return (
    <div className={`pro-page pro-detail${grown ? " pro-detail-grown" : ""}`}>
      <ChallengesHeader active="pro" />
      <a className="back-btn" href="#/challenges/pro">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        Back to Pro laps
      </a>

      <section className="pro-hero" style={{ "--py": (parseFloat((c.artOffset ?? "").split(" ")[1]) || 50) / 100 } as CSSProperties}>
        <Art c={c} position={c.artOffset} />
        <div className="pro-hero-top">
          <span className="pro-flag-chip"><FlagIcon size={13} />Pro lap</span>
          <span className="pro-chip-dark">{c.games.length === 1 ? <GameLabel game={c.games[0]} size={16} /> : gamesLabel(c)}</span>
        </div>
        <div className="pro-hero-bottom">
          <div>
            <h1 className="pro-hero-title">{c.name}</h1>
            <div className="pro-hero-sub">{carLabel(c)} · {c.driver}</div>
          </div>
          <div className="pro-hero-time">
            <span className="pro-card-time-label">PRO TIME</span>
            <span className="mono">{lapTime(c.timeMs)}</span>
          </div>
        </div>
      </section>

      <div className="pro-actions">
        <button className={`btn big${on ? " ghost" : ""}`} onClick={action} aria-pressed={on}>
          <FlagIcon size={18} />{on ? "Leave challenge mode" : "Take on this challenge"}
        </button>
        <span className={`pro-conf pro-conf-${c.confidence}`} title={c.source}>{c.source}</span>
      </div>
      <p className="muted pro-note">
        Challenge mode stays on until someone leaves it, here or on a phone. Whoever takes the seat carries on, and each lap counts for the person who drove it.
      </p>

      <div className="pro-cols">
        <div className="pro-col">
          <section className="card">
            <h2>About this lap</h2>
            <p className="pro-about">{c.about}</p>
            <dl className="pro-facts">
              <div><dt>DRIVER</dt><dd>{c.driver}</dd></div>
              <div><dt>DATE</dt><dd>{c.date || "Not recorded"}</dd></div>
              <div><dt>REAL CAR</dt><dd>{c.realCar}</dd></div>
              <div><dt>SESSION</dt><dd>{c.session}</dd></div>
            </dl>
          </section>

          <section className="card">
            <h2>What counts</h2>
            <div className="muted" style={{ fontSize: 14 }}>
              {on ? (setup ? "A lap counts when all four match." : "Start the game to check the setup.") : "A lap counts when all four match and challenge mode is on."}
            </div>
            <div className="pro-rules">
              {rows.map((r) => (
                <div key={r.label} className="pro-rule" data-ok={r.ok === null ? undefined : String(r.ok)}>
                  <Check ok={r.ok} />
                  <span className="pro-rule-label">{r.label}</span>
                  <span className="pro-rule-value">
                    {r.ok === false ? <><s>{r.has}</s><span>Needs <b>{r.value}</b></span></> : r.value}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <h2>How you get there</h2>
            <div className="pro-bar" aria-hidden="true">
              {best && <span className="pro-bar-fill" style={{ width: `${pos(best.timeMs)}%` }} />}
              <span className="pro-bar-mark level" style={{ left: `${pos(c.limitMs)}%` }} />
              <span className="pro-bar-mark pro" />
            </div>
            <div className="pro-bar-labels">
              <span>{best ? `Your best ${lapTime(best.timeMs)}` : "No counted lap yet"}</span>
              <span className="lvl">Pro level {lapTime(c.limitMs)}</span>
              <span className="pro-c">Pro {lapTime(c.timeMs)}</span>
            </div>
            <div className="pro-rewards">
              <div className="pro-reward" data-done={status === "level" || status === "beaten" || undefined}>
                <span className="pro-pill level">Pro level</span>
                <div className="muted">Within {margin}% of the pro time, so {lapTime(c.limitMs)} or faster. Paid the first time.</div>
                <div className="pro-pills"><span className="pro-pill">+{c.rewards.proLevel.xp} XP</span><span className="pro-pill">+{c.rewards.proLevel.coins} coins</span></div>
              </div>
              <div className="pro-reward" data-done={status === "beaten" || undefined}>
                <span className="pro-pill beat">Beat the pro</span>
                <div className="muted">Go faster than {lapTime(c.timeMs)}. Paid the first time.</div>
                <div className="pro-pills"><span className="pro-pill beat">+{c.rewards.beat.xp.toLocaleString()} XP</span><span className="pro-pill beat">+{c.rewards.beat.coins.toLocaleString()} coins</span></div>
              </div>
            </div>
          </section>
        </div>

        <div className="pro-col pro-side">
          <section className="card">
            <div className="head"><h2>Office best attempts</h2><span className="muted">{c.board.length} {c.board.length === 1 ? "driver" : "drivers"}</span></div>
            {c.board.length === 0 ? (
              <div className="empty">Nobody has a counted lap yet.</div>
            ) : (
              <div className="pro-board">
                {c.board.map((b, i) => {
                  const d = drivers.get(b.driverId);
                  const color = d?.color ?? "#5b6578";
                  const diff = b.timeMs - c.timeMs;
                  const level = b.timeMs <= c.limitMs;
                  return (
                    <div key={b.driverId} className="pro-board-row" data-me={b.driverId === who || undefined}>
                      <span className="pro-pos">{i + 1}</span>
                      <Helmet color={color} look={d?.look} size={40} seed={d?.id} mood={i === 0 ? "happy" : "idle"} />
                      <span className="pro-board-name">{d?.name ?? "Driver"}{b.driverId === who && <span className="muted"> (you)</span>}</span>
                      <span className="pro-board-time">
                        <span className="mono">{lapTime(b.timeMs)}</span>
                        <span className="mono" style={{ color: diff < 0 ? "var(--fast)" : level ? "var(--mint)" : "var(--muted)", fontSize: 12 }}>{diff < 0 ? `−${(-diff / 1000).toFixed(3)}` : gap(diff)}</span>
                      </span>
                      <span className="pro-pill" data-kind={diff < 0 ? "beat" : level ? "level" : "none"}>{diff < 0 ? "Beat" : level ? "Pro level" : "Not yet"}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="card">
            <h2>Your counted laps</h2>
            <div className="muted" style={{ fontSize: 13 }}>Only laps driven with challenge mode on appear here.</div>
            {mine.length === 0 ? (
              <div className="empty">{who == null ? "Sit in the seat or sign in to see yours." : "No counted laps yet."}</div>
            ) : (
              <div className="pro-laps">
                {mine.map((a) => (
                  <div key={a.lapId} className="pro-lap">
                    <span className="muted mono" style={{ fontSize: 12 }}>{ago(a.at)}</span>
                    <span className="mono">{lapTime(a.timeMs)}</span>
                    <span className="mono" style={{ fontSize: 13, color: a.timeMs < c.timeMs ? "var(--fast)" : a.timeMs <= c.limitMs ? "var(--mint)" : "var(--muted)" }}>
                      {a.timeMs < c.timeMs ? `−${((c.timeMs - a.timeMs) / 1000).toFixed(3)}` : gap(a.timeMs - c.timeMs)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
