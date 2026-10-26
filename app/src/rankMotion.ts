import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * Motion for a ranked list when somebody changes place: whoever moved lifts and slides to the new place, the
 * ones they passed are nudged along a moment later, and for a second and a half the climber is marked green
 * (with the number of places gained) and the passed red.
 *
 * Mark each thing that should travel with `data-flip="<key>"`: the same key on two different elements (a
 * helmet on the podium that becomes a helmet in the list) is treated as one thing moving from the first to the
 * second, scaling as it goes. Nothing animates the first time a list is drawn, only a change you are watching.
 */

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface Flash {
  mv: "up" | "down" | "";
  gain: number;
}

const NONE: Flash = { mv: "", gain: 0 };
const MOVE_MS = 720;
const PASS_STAGGER_MS = 80;
const FLASH_MS = 1500;
/** More places than this and the row just slides, with no badge. */
const BADGE_MAX = 5;

interface Snap {
  x: number;
  y: number;
  w: number;
  h: number;
}

function read(root: HTMLElement): Map<string, { el: HTMLElement; box: Snap }> {
  const out = new Map<string, { el: HTMLElement; box: Snap }>();
  root.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
    const r = el.getBoundingClientRect();
    out.set(el.dataset.flip!, { el, box: { x: r.x, y: r.y, w: r.width, h: r.height } });
  });
  return out;
}

/**
 * @param order the keys in rank order (best first)
 * @param root the element holding the `data-flip` things
 */
export function useRankMotion(order: string[], root: RefObject<HTMLElement | null>, enabled = true, scope = ""): (key: string) => Flash {
  const prevOrder = useRef<string[] | null>(null);
  const prevScope = useRef(scope);
  const boxes = useRef(new Map<string, Snap>());
  const [flash, setFlash] = useState<Record<string, Flash>>({});
  const timer = useRef<number | undefined>(undefined);
  const sig = order.join("\u0001");

  // Remember where everything is whenever it is not in the middle of moving.
  const remember = useCallback(() => {
    const el = root.current;
    if (!el) return;
    read(el).forEach(({ el: node, box }, key) => {
      if (node.getAnimations().length === 0) boxes.current.set(key, box);
    });
  }, [root]);

  useLayoutEffect(() => {
    const el = root.current;
    const was = prevOrder.current;
    prevOrder.current = order;
    // A different list altogether (another track, another challenge): nothing moved, it is a new board.
    const sameList = prevScope.current === scope;
    prevScope.current = scope;
    if (!el) return;
    if (!was || !sameList || was.join("\u0001") === sig) {
      remember();
      return;
    }
    // Who went up and who went down, among the ones in both lists.
    const gained = new Map<string, number>();
    const lost = new Map<string, number>();
    order.forEach((k, i) => {
      const j = was.indexOf(k);
      if (j < 0) return;
      if (i < j) gained.set(k, j - i);
      else if (i > j) lost.set(k, i - j);
    });
    if (gained.size === 0 && lost.size === 0) {
      remember();
      return;
    }
    const now = read(el);
    if (!reduced() && enabled) {
      let passedAt = 0;
      now.forEach(({ el: node, box }, key) => {
        // Something new on the page can start from where another thing with a stand-in key was (a helmet that was in
        // the table and is now on the podium).
        const from = boxes.current.get(key) ?? (node.dataset.flipFrom ? boxes.current.get(node.dataset.flipFrom) : undefined);
        if (!from) return;
        let dx = from.x - box.x;
        let dy = from.y - box.y;
        // Something inside a row that moves along with it (a helmet in a sliding row) is not moving on its own.
        const parentKey = node.parentElement?.closest<HTMLElement>("[data-flip]")?.dataset.flip;
        const parent = parentKey ? now.get(parentKey) : undefined;
        const parentFrom = parentKey ? boxes.current.get(parentKey) : undefined;
        if (parent && parentFrom) {
          dx -= parentFrom.x - parent.box.x;
          dy -= parentFrom.y - parent.box.y;
        }
        const sx = box.w ? from.w / box.w : 1;
        const sy = box.h ? from.h / box.h : 1;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.02) return;
        const base = key.replace(/^[a-z]+:/, "");
        const climbing = gained.has(base);
        // Inside an SVG the units are the drawing's, not the screen's.
        const svg = node instanceof SVGElement ? node.ownerSVGElement : null;
        const k = svg && svg.viewBox.baseVal.width ? svg.viewBox.baseVal.width / svg.getBoundingClientRect().width : 1;
        if (svg) node.style.transformBox = "fill-box";
        const arc = Math.abs(dx) > 24 ? Math.min(46, Math.abs(dx) * 0.22 + Math.abs(dy) * 0.1) * k : 0;
        dx *= k;
        dy *= k;
        const inverse = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
        const lift = climbing ? 1.04 : 1;
        const frames: Keyframe[] = [{ transform: `${inverse} scale(${lift})`, transformOrigin: "0 0" }];
        if (arc) frames.push({ transform: `translate(${dx / 2}px, ${dy / 2 - arc}px) scale(${(sx + 1) / 2}, ${(sy + 1) / 2}) scale(${lift})`, transformOrigin: "0 0", offset: 0.5 });
        frames.push({ transform: "none", transformOrigin: "0 0" });
        const delay = climbing ? 0 : (passedAt += PASS_STAGGER_MS);
        if (climbing) node.style.zIndex = "3";
        node
          .animate(frames, { duration: MOVE_MS, delay, easing: "cubic-bezier(.3, 1.25, .4, 1)", fill: "backwards" })
          .finished.then(() => {
            node.style.zIndex = "";
            remember();
          })
          .catch(() => {});
      });
    }
    // The green and red marks.
    const next: Record<string, Flash> = {};
    gained.forEach((n, k) => (next[k] = { mv: "up", gain: n <= BADGE_MAX ? n : 0 }));
    lost.forEach((_, k) => (next[k] = { mv: "down", gain: 0 }));
    setFlash(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFlash({}), FLASH_MS);
    // Positions are remembered again when the moves finish; for keys that are not animating, now.
    now.forEach(({ box }, key) => {
      if (!boxes.current.has(key)) boxes.current.set(key, box);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // The layout can change for other reasons (a wider name, a window resize): keep what we remember current.
  useEffect(() => {
    const t = window.setInterval(remember, 1000);
    return () => window.clearInterval(t);
  }, [remember]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return useCallback((key: string) => flash[key] ?? NONE, [flash]);
}

/**
 * Which way each number last moved: "closing" when it fell (a gap shrinking), "growing" when it rose. The tint
 * lasts a moment after the last change so a ticking gap reads as a trend rather than a flicker.
 */
export function useTrends(values: Record<string, number>, threshold = 6, holdMs = 450): Record<string, "closing" | "growing"> {
  const last = useRef<Record<string, number>>({});
  const until = useRef<Record<string, { t: "closing" | "growing"; at: number }>>({});
  const [, redraw] = useState(0);
  const now = performance.now();
  for (const [k, v] of Object.entries(values)) {
    const was = last.current[k];
    if (was !== undefined && Math.abs(v - was) > threshold) until.current[k] = { t: v < was ? "closing" : "growing", at: now + holdMs };
    last.current[k] = v;
  }
  useEffect(() => {
    const t = window.setTimeout(() => redraw((n) => n + 1), holdMs + 30);
    return () => window.clearTimeout(t);
  });
  const out: Record<string, "closing" | "growing"> = {};
  for (const [k, e] of Object.entries(until.current)) if (e.at > now) out[k] = e.t;
  return out;
}
