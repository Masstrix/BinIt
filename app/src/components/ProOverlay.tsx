// The overlay while a pro-lap challenge is on: the gap to the pro is the main thing on screen, with the prize and the
// office's standing against the pro, and a map showing where the pro's lap would have you. Designed on the "Pro laps"
// page of the design canvas (in-car overlay boards).

import type { ReactNode } from "react";
import { useAppState, useCatalogue, useDriverMap, useProOverview, useTrackMaps } from "../api";
import { findMap } from "../catalogueItems";
import { lapTime } from "../format";
import { carNeeded, lapLength, proLive, proRows, rangePosition, setupFor, signedSeconds, standing, type ProOverlay } from "../proMode";
import { TrackMap } from "./TrackMap";

const AMBER = "#F5B544";
const GREEN = "#4FD39A";
const PURPLE = "#B79BFF";
const RED = "#FF7A92";
const MUTED = "#8F99B3";
const INK = "#E8EBF4";
const MONO = "var(--font-mono)";

const shell = {
  borderRadius: 22,
  background: "rgba(16,20,28,0.92)",
  boxShadow: "0 10px 34px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.07)",
  userSelect: "none",
  WebkitUserSelect: "none",
  overflow: "hidden",
} as const;

const label = { font: `600 10px ${MONO}`, letterSpacing: "0.1em", color: MUTED } as const;

function Flag({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
    </svg>
  );
}

function Crown({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />
    </svg>
  );
}

function Tick({ ok, size = 14 }: { ok: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ok ? "M5 12.5l4.5 4.5L19 7.5" : "M6 6l12 12M18 6L6 18"} />
    </svg>
  );
}

function Pill({ children, bg, fg }: { children: ReactNode; bg: string; fg: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 999, background: bg, color: fg, font: `600 11px ${MONO}`, letterSpacing: "0.02em", whiteSpace: "nowrap" }}>{children}</span>
  );
}

function Band({ bg, fg, icon, title, right, pill }: { bg: string; fg: string; icon: ReactNode; title: string; right?: string; pill?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, height: 34, padding: "0 16px", background: bg, color: fg, font: `800 11px ${MONO}`, letterSpacing: "0.12em" }}>
      {icon}
      <span style={{ flex: 1 }}>{title}</span>
      {right && <span style={{ font: "700 12px var(--font-body)", letterSpacing: 0 }}>{right}</span>}
      {pill}
    </div>
  );
}

// ---- the gap -----------------------------------------------------------------------------------------------------

/** The main widget: the gap to the pro, the range to pro level, and what the lap is on course for. */
export function ProGapCard({ pro }: { pro: ProOverlay }) {
  const wrong = pro.setup && !pro.setup.ok;
  if (wrong && pro.setup) return <WrongSetup pro={pro} />;
  const live = pro.live;
  const st = live ? standing(live.gapMs, pro.proMs, pro.limitMs) : null;
  const tone = st === "ahead" ? PURPLE : st === "inRange" ? GREEN : st === "outOfRange" ? AMBER : MUTED;
  const levelGap = pro.limitMs - pro.proMs;
  const levelAt = rangePosition(levelGap, pro.proMs, pro.limitMs) * 100;
  const markerAt = live ? rangePosition(live.gapMs, pro.proMs, pro.limitMs) * 100 : null;
  const toFind = live && st === "outOfRange" ? live.gapMs - levelGap : 0;
  const note =
    st === "ahead" ? "Ahead of the pro. Hold it to the line." : st === "inRange" ? (pro.proLevelEarned ? "In range. Keep it up and chase the pro." : "In range. This lap is on course for pro level.") : st === "outOfRange" ? `${(toFind / 1000).toFixed(1)} s to find to get back in range.` : "Start a timed lap. The gap shows once you are under way.";
  return (
    <div style={{ ...shell, width: 580 }}>
      <Band bg={AMBER} fg="#241A05" icon={<Flag size={16} />} title="PRO CHALLENGE" right={pro.title} pill={<Pill bg="#241A05" fg={AMBER}>ATTEMPT {pro.attempt}</Pill>} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 10, padding: "12px 22px 2px" }}>
        <div>
          <div style={label}>THIS LAP</div>
          <div style={{ font: `500 24px ${MONO}`, letterSpacing: "-0.03em", marginTop: 2 }}>{live ? lapTime(pro.lapMs) : "—"}</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={label}>GAP TO THE PRO</div>
          <div style={{ font: `500 ${live ? 58 : 40}px/1 ${MONO}`, letterSpacing: "-0.045em", color: tone }}>{live ? signedSeconds(live.gapMs) : "—"}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={label}>PRO TIME</div>
          <div style={{ font: `500 24px ${MONO}`, letterSpacing: "-0.03em", marginTop: 2 }}>{lapTime(pro.proMs)}</div>
          <div style={{ fontSize: 11, color: MUTED }}>{pro.driver}</div>
        </div>
      </div>
      <div style={{ padding: "6px 22px 14px" }}>
        <div style={{ position: "relative", height: 10, borderRadius: 999, background: "#262D3B" }}>
          {markerAt !== null && <span style={{ position: "absolute", left: 0, width: `${markerAt}%`, top: 0, bottom: 0, borderRadius: 999, background: `linear-gradient(90deg, #3A4258, ${tone})` }} />}
          <span style={{ position: "absolute", left: `${levelAt}%`, top: -4, bottom: -4, width: 2, background: GREEN }} />
          {markerAt !== null && <span style={{ position: "absolute", left: `${markerAt}%`, top: -5, width: 14, height: 20, marginLeft: -7, borderRadius: 7, background: "#fff", boxShadow: `0 0 0 3px ${tone}, 0 4px 12px rgba(0,0,0,0.5)` }} />}
          <span style={{ position: "absolute", right: 0, top: -4, bottom: -4, width: 3, borderRadius: 2, background: PURPLE }} />
        </div>
        <div style={{ position: "relative", height: 18, marginTop: 10, font: `500 10px ${MONO}`, letterSpacing: "0.04em" }}>
          <span style={{ position: "absolute", left: 0, color: MUTED }}>OUT OF RANGE</span>
          <span style={{ position: "absolute", left: `${levelAt}%`, transform: "translateX(-50%)", color: GREEN, whiteSpace: "nowrap" }}>PRO LEVEL {signedSeconds(levelGap)}</span>
          <span style={{ position: "absolute", right: 0, color: PURPLE }}>BEAT THE PRO</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 4 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            {st && <Pill bg={st === "ahead" ? "#2D2250" : st === "inRange" ? "#12332A" : "#3A2C0C"} fg={tone}>{st === "ahead" ? "AHEAD" : st === "inRange" ? "IN RANGE" : "OUT OF RANGE"}</Pill>}
            <span style={{ fontSize: 12, color: INK }}>{note}</span>
          </span>
          <span style={{ font: `500 11px ${MONO}`, color: MUTED, whiteSpace: "nowrap" }}>
            {live ? <>on pace for <b style={{ color: INK, fontWeight: 600 }}>{lapTime(Math.round(live.onPaceMs))}</b> · </> : null}
            {pro.bestMs ? `best ${lapTime(pro.bestMs)}` : "no counted lap yet"}
          </span>
        </div>
      </div>
    </div>
  );
}

function WrongSetup({ pro }: { pro: ProOverlay }) {
  const s = pro.setup!;
  const rows: { name: string; ok: boolean; has: string; need: string }[] = [
    { name: "GAME", ok: s.game.ok, has: s.game.has, need: "" },
    { name: "TRACK", ok: s.track.ok, has: s.track.has, need: pro.need.track },
    { name: "LAYOUT", ok: s.layout.ok, has: s.layout.has, need: pro.need.layout },
    { name: "CAR", ok: s.car.ok, has: s.car.has, need: pro.need.car },
  ];
  return (
    <div style={{ ...shell, width: 330 }}>
      <Band bg={RED} fg="#3A0B16" icon={<Flag size={16} />} title="WRONG SETUP" pill={<Pill bg="#3A0B16" fg={RED}>NOT COUNTING</Pill>} />
      <div style={{ padding: "12px 16px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.4 }}>This lap will not count toward the pro challenge. Change these to match:</div>
        {rows.map((r) => (
          <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 26 }}>
            <span style={{ flex: "none", color: r.ok ? GREEN : RED, display: "flex" }}>
              <Tick ok={r.ok} />
            </span>
            <span style={{ font: `500 10px ${MONO}`, letterSpacing: "0.08em", color: MUTED, width: 50, flex: "none" }}>{r.name}</span>
            <span style={{ fontSize: 13, flex: 1, minWidth: 0, lineHeight: 1.25 }}>
              {r.ok ? (
                r.has
              ) : (
                <>
                  <span style={{ color: MUTED, textDecoration: "line-through", textDecorationColor: `${RED}99` }}>{r.has}</span>
                  {r.need && <span style={{ display: "block", marginTop: 2 }}>Needs <b>{r.need}</b></span>}
                </>
              )}
            </span>
          </div>
        ))}
        <div style={{ font: `500 11px ${MONO}`, color: MUTED, marginTop: 2 }}>Laps still go on the normal boards.</div>
      </div>
    </div>
  );
}

// ---- the prize and the office ------------------------------------------------------------------------------------

const payText = (p: { xp: number; coins: number }) => `+${p.xp.toLocaleString("en-US")} XP · +${p.coins.toLocaleString("en-US")} coins`;

/** What beating the pro pays, and where the office stands against the pro. */
export function ProBoardCard({ pro }: { pro: ProOverlay }) {
  const seatAt = pro.rows.findIndex((r) => r.isSeat);
  // The top three, and the driver's own row when they are further down.
  const rows = pro.rows.slice(0, 3).concat(seatAt >= 3 ? [pro.rows[seatAt]] : []);
  return (
    <div style={{ ...shell, width: 250, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ padding: "12px 14px", borderRadius: 16, background: "linear-gradient(160deg, #2D2250, #1D1638)", boxShadow: "inset 0 0 0 1px rgba(183,155,255,0.4)" }}>
        <div style={{ font: `600 10px ${MONO}`, letterSpacing: "0.12em", color: PURPLE, display: "flex", alignItems: "center", gap: 6 }}>
          <Crown />
          {pro.beatEarned ? "PRIZE CLAIMED" : "THE PRIZE"}
        </div>
        <div style={{ font: "800 19px var(--font-display)", marginTop: 4, color: "#fff" }}>Beat {lapTime(pro.proMs)}</div>
        <div style={{ marginTop: 8 }}>
          <Pill bg="#3A2D66" fg="#D9CBFF">{payText(pro.rewards.beat)}</Pill>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "0 4px", color: pro.proLevelEarned ? MUTED : INK, fontSize: 12 }}>
        <span style={{ color: pro.proLevelEarned ? GREEN : MUTED, display: "flex", marginTop: 1 }}>
          {pro.proLevelEarned ? <Tick ok size={13} /> : <span style={{ width: 11, height: 11, margin: 1, borderRadius: "50%", boxShadow: `inset 0 0 0 2px ${MUTED}` }} />}
        </span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          <span>{pro.proLevelEarned ? "Pro level earned" : "Pro level"}</span>
          <span style={{ font: `500 10px ${MONO}`, color: MUTED }}>{pro.proLevelEarned ? payText(pro.rewards.proLevel) : `within ${lapTime(pro.limitMs)} · ${payText(pro.rewards.proLevel)}`}</span>
        </span>
      </div>
      {rows.length > 0 && (
        <div>
          <div style={{ ...label, letterSpacing: "0.12em", margin: "0 0 4px 4px" }}>OFFICE vs THE PRO</div>
          {rows.map((r) => (
            <div key={r.driverId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 10, background: r.isSeat ? "rgba(79,211,154,0.1)" : undefined }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: r.color, flex: "none" }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: r.isSeat ? 700 : 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
              {r.proLevel && (
                <span style={{ color: r.beat ? PURPLE : GREEN, display: "flex" }}>
                  <Tick ok size={12} />
                </span>
              )}
              <span style={{ font: `500 12px ${MONO}`, color: r.beat ? PURPLE : r.proLevel ? INK : MUTED }}>{signedSeconds(r.gapMs)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- the pro ghost -----------------------------------------------------------------------------------------------

/** A map with the car and where the pro would be at this point of the lap. */
export function ProGhostCard({ pro }: { pro: ProOverlay }) {
  const { status } = useAppState();
  const session = status?.session ?? null;
  const maps = useTrackMaps(session?.game ?? null);
  const map = session ? findMap(maps, session.track, session.layout) : undefined;
  const live = pro.live;
  const live2 = status?.live ?? null;
  const n = map?.points.length ?? 0;
  const proPoint = map && live && n > 1 ? map.points[Math.min(n - 1, Math.round(live.proProgress * n) % n)] : null;
  const behindM = live && pro.lapLengthM ? Math.round(Math.abs(live.proProgress - live.progress) * pro.lapLengthM) : null;
  const ahead = live ? live.gapMs <= 0 : false;
  return (
    <div style={{ ...shell, width: 250, padding: "14px 16px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ ...label, letterSpacing: "0.12em", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>PRO GHOST</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: PURPLE }} />
          pro
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#FF8A4C", marginLeft: 6 }} />
          you
        </span>
      </div>
      <div style={{ position: "relative", width: 218, height: 140 }}>
        {map ? (
          <TrackMap points={map.points} position={live2?.position ?? null} rotate={map.rotate} mirror={map.mirror} closed={map.closed} stroke={4} markers={proPoint ? [{ position: proPoint, color: PURPLE }] : undefined} />
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 12 }}>
            {[
              { name: "You", at: live?.progress ?? 0, color: GREEN },
              { name: "Pro", at: live?.proProgress ?? 0, color: PURPLE },
            ].map((b) => (
              <div key={b.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 28, font: `500 10px ${MONO}`, color: MUTED }}>{b.name}</span>
                <span style={{ flex: 1, height: 8, borderRadius: 999, background: "#262D3B", position: "relative" }}>
                  <span style={{ position: "absolute", left: 0, width: `${b.at * 100}%`, top: 0, bottom: 0, borderRadius: 999, background: b.color }} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>
        {!live ? <span style={{ color: MUTED, fontWeight: 500 }}>Shows once you are under way</span> : behindM !== null ? (
          <>
            {behindM >= 1000 ? `${(behindM / 1000).toFixed(1)} km` : `≈ ${Math.max(10, Math.round(behindM / 10) * 10)} m`}
            <span style={{ fontWeight: 500, color: MUTED }}>{ahead ? " ahead of the pro" : " behind the pro"}</span>
          </>
        ) : (
          <>
            {Math.abs(live.gapMs / 1000).toFixed(1)} s<span style={{ fontWeight: 500, color: MUTED }}>{ahead ? " ahead of the pro" : " behind the pro"}</span>
          </>
        )}
      </div>
    </div>
  );
}

// ---- the data ----------------------------------------------------------------------------------------------------

/** Pro mode as the overlay draws it: null when no challenge is switched on. */
export function useProOverlay(): ProOverlay | null {
  const { status } = useAppState();
  const overview = useProOverview();
  const drivers = useDriverMap();
  const session = status?.session ?? null;
  const catalogue = useCatalogue(session?.game ?? null);
  const maps = useTrackMaps(session?.game ?? null);
  const entry = overview?.challenges.find((c) => c.id === overview.active);
  if (!overview || !entry) return null;
  const seat = status?.seat ?? null;
  const mine = entry.board.find((b) => b.driverId === seat);
  const map = session ? findMap(maps, session.track, session.layout) : undefined;
  const setup = setupFor(entry, session, catalogue);
  const live = status?.live?.driving && setup?.ok !== false ? proLive(status.live, entry.timeMs, mine?.timeMs ?? null) : null;
  const rows = proRows(entry).map((r) => {
    const d = drivers.get(r.driverId);
    return { ...r, name: d?.name ?? "Guest", color: d?.color ?? MUTED, isSeat: r.driverId === seat };
  });
  const carLabel = carNeeded(entry);
  return {
    id: entry.id,
    name: entry.name,
    title: `${entry.name} · ${carLabel}`,
    proMs: entry.timeMs,
    limitMs: entry.limitMs,
    driver: entry.driver,
    rewards: entry.rewards,
    attempt: (mine?.attempts ?? 0) + 1,
    bestMs: mine?.timeMs ?? null,
    proLevelEarned: !!mine && mine.timeMs <= entry.limitMs,
    beatEarned: !!mine && mine.timeMs < entry.timeMs,
    setup,
    need: { track: entry.name, layout: entry.layout || "Any layout", car: carLabel },
    live,
    lapMs: status?.live?.currentLapMs ?? 0,
    rows,
    lapLengthM: lapLength(map?.points, map?.closed ?? true),
  };
}
