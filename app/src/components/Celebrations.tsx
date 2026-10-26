import type { Look } from "../looks";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { api, useAppEvent, useAppState, useDriverMap, type AppEvent } from "../api";
import { lapKind, lapTime } from "../format";
import { fx, type Rect } from "../fx";
import { useDevCelebrate } from "../devOverlay";
import { Helmet } from "./Helmet";

/** One moment worth marking on the overlay. The slot that shows them (the Pop-ups widget) shows one at a time. */
export type Celebration =
  | { id: number; kind: "pb"; time: string; position: number | null }
  | { id: number; kind: "record"; time: string; name: string }
  | { id: number; kind: "lead"; name: string; time: string; challenge: string; from: number | null }
  | { id: number; kind: "moved"; from: number; to: number; context: string; gap: string | null }
  | { id: number; kind: "level"; level: number; xp: number }
  | { id: number; kind: "sticker"; name: string; hint: string }
  | { id: number; kind: "switch"; from: { name: string; color: string; look?: Look } | null; to: { name: string; color: string; look?: Look }; moving: boolean };

type Draft = Celebration extends infer C ? (C extends { id: number } ? Omit<C, "id"> : never) : never;

/** A bigger moment replaces a smaller one that is still showing; equals wait their turn. */
const PRIORITY: Record<Celebration["kind"], number> = { record: 6, lead: 5, switch: 5, level: 3, sticker: 3, pb: 3, moved: 2 };
const SHOW_MS: Record<Celebration["kind"], number> = { record: 5000, lead: 5000, switch: 3600, level: 4800, sticker: 4800, pb: 4500, moved: 3600 };
const durationOf = (c: Celebration) => (c.kind === "switch" && !c.moving ? 3600 : c.kind === "switch" ? 3200 : SHOW_MS[c.kind]);

/** True for a switch that plays across the middle of the screen (the car is stopped). */
export const isCentre = (c: Celebration | null): c is Extract<Celebration, { kind: "switch" }> => !!c && c.kind === "switch" && !c.moving;

/**
 * Listens for what is worth celebrating (a PB, a record, taking the lead, moving up, a new level or sticker, a
 * driver change) and hands them out one at a time.
 */
export function useCelebrations(): Celebration | null {
  const { status, drivers } = useAppState();
  const driverMap = useDriverMap();
  const [current, setCurrent] = useState<Celebration | null>(null);
  const cur = useRef<Celebration | null>(null);
  const queue = useRef<Celebration[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const ids = useRef(0);

  const show = useCallback((c: Celebration | null) => {
    cur.current = c;
    setCurrent(c);
    window.clearTimeout(timer.current);
    if (c) timer.current = window.setTimeout(() => show(queue.current.shift() ?? null), durationOf(c));
  }, []);

  const push = useCallback(
    (d: Draft) => {
      const c = { ...d, id: ++ids.current } as Celebration;
      const now = cur.current;
      if (!now || PRIORITY[c.kind] > PRIORITY[now.kind]) show(c);
      else {
        queue.current.push(c);
        queue.current.sort((a, b) => PRIORITY[b.kind] - PRIORITY[a.kind]);
        queue.current.length = Math.min(queue.current.length, 4);
      }
    },
    [show],
  );
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const names = useRef(driverMap);
  names.current = driverMap;
  const statusRef = useRef(status);
  statusRef.current = status;
  const seatRef = useRef<number | null>(status?.seat ?? null);

  // Stickers are worked out from a driver's history, so the overlay compares what they had before with what they have now.
  const stickers = useRef(new Map<number, Set<string>>());
  const checkStickers = useCallback(
    async (driverId: number, announce: boolean) => {
      try {
        const p = await api.profile(driverId);
        const now = new Set(p.stickers.filter((s) => s.earned).map((s) => s.id));
        const before = stickers.current.get(driverId);
        stickers.current.set(driverId, now);
        if (!announce || !before) return;
        for (const s of p.stickers) if (s.earned && !before.has(s.id)) push({ kind: "sticker", name: s.name, hint: s.hint });
      } catch {
        // No profile yet (a guest): nothing to compare.
      }
    },
    [push],
  );
  const seat = status?.seat ?? null;
  useEffect(() => {
    if (seat != null) checkStickers(seat, false);
  }, [seat, checkStickers]);

  const onEvent = useCallback(
    (e: AppEvent) => {
      if (e.type === "seatChanged") {
        const to = e.driverId != null ? names.current.get(e.driverId) : undefined;
        const from = seatRef.current != null ? names.current.get(seatRef.current) : undefined;
        seatRef.current = e.driverId;
        const moving = statusRef.current?.live?.phase === "driving";
        push({
          kind: "switch",
          from: from ? { name: from.name, color: from.color, look: from.look } : null,
          to: { name: to?.name ?? "Guest", color: to?.color ?? "#8f99b3", look: to?.look },
          moving,
        });
        return;
      }
      if (e.type !== "lapRecorded") return;
      const r = e.result;
      const driverId = r.lap.driverId;
      const name = driverId != null ? names.current.get(driverId)?.name ?? "Guest" : "Guest";
      const s = r.challenges[0];
      const kind = lapKind(r.lap);
      if (kind === "timed") {
        const time = lapTime(r.lap.timeMs);
        if (r.comboRecord) push({ kind: "record", time, name });
        else if (s?.position === 1 && s.previousPosition !== 1) push({ kind: "lead", name, time, challenge: s.challengeName, from: s.previousPosition });
        else if (r.personalBest) push({ kind: "pb", time, position: s?.position ?? null });
        else if (s?.position != null && s.previousPosition != null && s.position < s.previousPosition) {
          push({ kind: "moved", from: s.previousPosition, to: s.position, context: s.challengeName, gap: s.gapToLeaderMs ? `${(s.gapToLeaderMs / 1000).toFixed(3)} off the lead` : null });
        }
      }
      if (r.awards?.levelUp) push({ kind: "level", level: r.awards.levelUp, xp: r.awards.xp });
      if (driverId != null) window.setTimeout(() => checkStickers(driverId, true), 700);
    },
    [push, checkStickers],
  );
  useAppEvent(onEvent);

  // Development builds can fire each one from the editor.
  useDevCelebrate(
    useCallback(
      (kind: string) => {
        const a = drivers[0];
        const b = drivers[1] ?? drivers[0];
        const mk: Record<string, Draft> = {
          pb: { kind: "pb", time: "1:42.318", position: 2 },
          record: { kind: "record", time: "1:41.902", name: a?.name ?? "Sam" },
          lead: { kind: "lead", name: a?.name ?? "Sam", time: "1:42.114", challenge: "Summer Sprint", from: 2 },
          moved: { kind: "moved", from: 4, to: 3, context: "Summer Sprint", gap: "0.312 off the lead" },
          level: { kind: "level", level: 7, xp: 150 },
          sticker: { kind: "sticker", name: "10 clean laps", hint: "Ten laps with no cuts" },
          switch: { kind: "switch", from: a ? { name: a.name, color: a.color, look: a.look } : { name: "Sam", color: "#FF8A4C" }, to: b ? { name: b.name, color: b.color, look: b.look } : { name: "Jess", color: "#2FA8FF" }, moving: false },
          switchMoving: { kind: "switch", from: a ? { name: a.name, color: a.color, look: a.look } : { name: "Sam", color: "#FF8A4C" }, to: b ? { name: b.name, color: b.color, look: b.look } : { name: "Jess", color: "#2FA8FF" }, moving: true },
        };
        if (mk[kind]) push(mk[kind]);
      },
      [drivers, push],
    ),
  );
  return current;
}

const Bolt = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M13 2L5 14h6l-1 8 8-12h-6z" />
  </svg>
);
const CrownIcon = ({ w = 34, color = "#3A2A00" }: { w?: number; color?: string }) => (
  <svg width={w} height={w * 0.78} viewBox="0 0 170 132" aria-hidden="true">
    <path d="M12 112 L0 30 L44 62 L85 4 L126 62 L170 30 L158 112 Z" fill={color} />
    <rect x="12" y="112" width="146" height="14" rx="7" fill={color} />
  </svg>
);
const BigCrown = () => (
  <svg width="64" height="50" viewBox="0 0 170 132" aria-hidden="true">
    <defs>
      <linearGradient id="celCrown" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#FFE9A0" />
        <stop offset=".5" stopColor="#FFC93C" />
        <stop offset="1" stopColor="#E0A100" />
      </linearGradient>
    </defs>
    <path d="M12 112 L0 30 L44 62 L85 4 L126 62 L170 30 L158 112 Z" fill="url(#celCrown)" />
    <rect x="12" y="112" width="146" height="14" rx="7" fill="#E0A100" />
  </svg>
);
const Trophy = () => (
  <svg width="56" height="56" viewBox="0 0 100 110" aria-hidden="true">
    <defs>
      <linearGradient id="celTrophy" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#D9A000" />
        <stop offset=".45" stopColor="#FFE08A" />
        <stop offset="1" stopColor="#E2A800" />
      </linearGradient>
    </defs>
    <path d="M22 24 C2 22 2 62 30 68" fill="none" stroke="#E0A100" strokeWidth="7" strokeLinecap="round" />
    <path d="M78 24 C98 22 98 62 70 68" fill="none" stroke="#E0A100" strokeWidth="7" strokeLinecap="round" />
    <path d="M16 12 H84 V40 C84 66 66 80 50 82 C34 80 16 66 16 40 Z" fill="url(#celTrophy)" />
    <rect x="44" y="82" width="12" height="16" fill="url(#celTrophy)" />
    <rect x="28" y="98" width="44" height="12" rx="4" fill="#E0A100" />
  </svg>
);
const Star = () => (
  <svg width="44" height="44" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
    <path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.3 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z" />
  </svg>
);
const Swap = ({ s = 16 }: { s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="#C9C9FF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 7h11l-3-3M17 17H6l3 3" />
  </svg>
);
const Chevron = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#8B8BF5" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 15l6-6 6 6" />
  </svg>
);

/** Waves the digits in one after another. */
function Digits({ text, from = 520 }: { text: string; from?: number }) {
  return (
    <>
      {[...text].map((ch, i) => (
        <span key={i} className="cel-dg" style={{ animationDelay: `${from + i * 45}ms` }}>
          {ch}
        </span>
      ))}
    </>
  );
}

/** What the particle layer does around a celebration, once the card has settled. */
function runFx(c: Celebration, box: Rect) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  switch (c.kind) {
    case "pb":
      fx.arrows(box, ["#7FF0C0", "#FFFFFF"], 0, 2600);
      break;
    case "record":
      fx.ring(cx, cy, Math.max(box.width, 300) * 0.55, "#FFC93C");
      fx.sparks(cx, cy, 22, ["#FFE08A", "#FFC93C", "#FFFFFF"], 100);
      fx.arrows(box, ["#FFE08A", "#FFFFFF"], 200, 2400);
      fx.twinkles(box, ["#FFE08A", "#FFFFFF"], 400, 2000, 240);
      break;
    case "lead":
      fx.ring(cx, cy, Math.max(box.width, 360) * 0.6, "#FFC93C", 650);
      fx.sparks(cx, cy, 36, ["#FFE08A", "#FFC93C", "#FFFFFF"], 700);
      fx.embers(box, ["#FFC93C", "#FFE08A", "#FFFFFF"], 900, 2600);
      fx.twinkles(box, ["#FFE08A", "#FFFFFF"], 900, 2400, 240);
      break;
    case "moved":
      fx.arrows({ x: box.x + 10, y: box.y + 20, width: 40, height: 20 }, ["#8B8BF5"], 300, 900);
      break;
    case "level":
    case "sticker":
      fx.twinkles(box, ["#FFFFFF", c.kind === "level" ? "#C9C9FF" : "#FFC93C"], 700, 2200, 150, 34);
      break;
    case "switch":
      fx.ring(box.x + 38, cy, 64, c.to.color, 800);
      fx.twinkles(box, ["#FFFFFF", c.to.color], 1000, 900, 260, 20);
      break;
  }
}

export function CelebrationView({ c, layout, ahead = null }: { c: Celebration; layout: "pill" | "card"; ahead?: { name: string; gapMs: number } | null }) {
  const ref = useRef<HTMLDivElement>(null);
  // The particle layer waits for the card to land (its entrance has finished), then works around where it ended up.
  useEffect(() => {
    const el = ref.current;
    let dead = false;
    let timer: number | undefined;
    let ran = false;
    const go = () => {
      if (ran || dead) return;
      ran = true;
      const r = ref.current?.getBoundingClientRect();
      if (r) runFx(c, { x: r.x, y: r.y, width: r.width, height: r.height });
    };
    // As soon as the entrance is over, or after a second at the latest if the animation clock is not running.
    const entrance = el?.getAnimations?.()[0];
    if (entrance) entrance.finished.then(() => (timer = window.setTimeout(go, 60))).catch(() => {});
    const fallback = window.setTimeout(go, 1000);
    return () => {
      dead = true;
      window.clearTimeout(timer);
      window.clearTimeout(fallback);
      fx.clear();
    };
  }, [c]);
  const out = durationOf(c) - 450;
  const style = { ["--out" as string]: `${out}ms` } as CSSProperties;
  const cls = (k: string) => `cel cel-${k}${layout === "card" ? " as-card" : ""}`;

  switch (c.kind) {
    case "pb":
      return (
        <div ref={ref} className={cls("pb")} style={style}>
          <span className="cel-ico"><Bolt /></span>
          <span className="cel-txt">
            <span className="cel-k">Personal best</span>
            <span className="cel-time"><Digits text={c.time} /></span>
          </span>
          {c.position != null && <span className="cel-chip">P{c.position}</span>}
          <span className="cel-sheen" />
        </div>
      );
    case "record":
      return (
        <div ref={ref} className={cls("record")} style={style}>
          <span className="cel-ico"><CrownIcon /></span>
          <span className="cel-txt">
            <span className="cel-k">Track record</span>
            <span className="cel-time"><Digits text={c.time} from={560} /></span>
          </span>
          <span className="cel-chip">{c.name}</span>
          <span className="cel-sheen" />
        </div>
      );
    case "lead":
      return (
        <div className="cel-wrap has-crown" style={style}>
          <span className="cel-cone" aria-hidden="true" />
          <div ref={ref} className={cls("lead")}>
            <span className="cel-rank sq">
              <span className="cel-r old">P{c.from ?? 2}</span>
              <span className="cel-r new">P1</span>
            </span>
            <span className="cel-txt">
              <span className="cel-kick">{c.challenge}</span>
              <span className="cel-grid cel-name">
                <span className="old">{c.name} is closing in</span>
                <span className="new">{c.name} took the crown</span>
              </span>
              <span className="cel-sub">{c.time}</span>
            </span>
            {ahead && ahead.gapMs > 0 && <span className="cel-gap">{(ahead.gapMs / 1000).toFixed(3)} clear of {ahead.name}</span>}
            <span className="cel-trophy"><Trophy /></span>
            <span className="cel-sheen" />
          </div>
          <span className="cel-crown"><BigCrown /></span>
        </div>
      );
    case "moved":
      return (
        <div ref={ref} className={cls("moved")} style={style}>
          <span className="cel-rank rd">
            <span className="cel-r old">P{c.from}</span>
            <span className="cel-r new">P{c.to}</span>
          </span>
          <span className="cel-chev"><Chevron /></span>
          <span className="cel-txt">
            <span className="cel-kick">{c.context}</span>
            <span className="cel-k" style={{ fontSize: 20 }}>Up to P{c.to}</span>
          </span>
          {c.gap && <span className="cel-gap">{c.gap}</span>}
        </div>
      );
    case "level":
      return (
        <div ref={ref} className={cls("level")} style={style}>
          <span className="cel-ring">
            <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
              <circle cx="42" cy="42" r="36" fill="#1E2430" stroke="#2A3040" strokeWidth="7" />
              <circle className="cel-prog" cx="42" cy="42" r="36" fill="none" stroke="#8B8BF5" strokeWidth="7" strokeLinecap="round" />
            </svg>
            <span className="cel-num">
              <span className="cel-r old">{c.level - 1}</span>
              <span className="cel-r new">{c.level}</span>
            </span>
          </span>
          <span className="cel-txt cel-label">
            <span className="cel-kick" style={{ color: "#B79BFF" }}>Level up</span>
            <span className="cel-name">Level {c.level}</span>
            {c.xp > 0 && <span className="cel-xp">+{c.xp} XP</span>}
          </span>
        </div>
      );
    case "sticker":
      return (
        <div ref={ref} className={cls("sticker")} style={style}>
          <span className="cel-stage">
            <span className="cel-badge">
              <Star />
              <span className="cel-shine" />
            </span>
          </span>
          <span className="cel-txt cel-label">
            <span className="cel-kick" style={{ color: "#FFB27C" }}>Sticker unlocked</span>
            <span className="cel-name">{c.name}</span>
            <span className="cel-sub">{c.hint}</span>
          </span>
        </div>
      );
    case "switch":
      return (
        <div ref={ref} className={cls("switch")} style={style}>
          <span className="cel-av">
            <span className="bg" style={{ background: `${c.from?.color ?? "#8f99b3"}38` }} />
            <span className="bg b" style={{ background: `${c.to.color}3d` }} />
            <span className="h old"><Helmet color={c.from?.color ?? "#8f99b3"} look={c.from?.look} size={56} seed={c.from?.name} tile={false} /></span>
            <span className="h new"><Helmet color={c.to.color} look={c.to.look} size={56} seed={c.to.name} mood="happy" tile={false} moment /></span>
            <span className="cel-swapbadge"><Swap /></span>
          </span>
          <span className="cel-txt">
            <span className="cel-kick">Driver switch</span>
            <span className="cel-grid cel-name">
              <span className="old">{c.from?.name ?? "Guest"}</span>
              <span className="new">{c.to.name}</span>
            </span>
            <span className="cel-sub">Laps now save to {c.to.name}</span>
          </span>
        </div>
      );
  }
}

/** The driver switch across the middle of the screen, for when the car is stopped. */
export function CentreSwitch({ c }: { c: Extract<Celebration, { kind: "switch" }> }) {
  useEffect(() => {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2 - 30;
    fx.ring(cx, cy, 190, c.to.color, 1400);
    fx.twinkles({ x: cx - 200, y: cy - 150, width: 400, height: 300 }, ["#FFFFFF", c.to.color], 1500, 1400, 220, 20);
    return () => fx.clear();
  }, [c]);
  const old: { name: string; color: string; look?: Look } = c.from ?? { name: "Guest", color: "#8f99b3" };
  return (
    <div className="cel-centre" style={{ ["--glow" as string]: `${c.to.color}8c` } as CSSProperties}>
      <div className="cel-cwrap">
        <span className="cel-ck">DRIVER SWITCH</span>
        <div className="cel-cstage">
          <span className="cel-disc old" style={{ background: `${old.color}33` }}>
            <Helmet color={old.color} look={old.look} size={170} seed={old.name} tile={false} />
          </span>
          <span className="cel-disc new" style={{ background: `${c.to.color}3d` }}>
            <Helmet color={c.to.color} look={c.to.look} size={170} seed={c.to.name} mood="happy" tile={false} moment />
          </span>
          <span className="cel-cswap"><Swap s={22} /></span>
        </div>
        <span className="cel-ctitle">
          <span className="old">{old.name}</span>
          <span className="new">{c.to.name} is driving</span>
        </span>
        <span className="cel-csub">Laps now save to {c.to.name}</span>
      </div>
    </div>
  );
}
