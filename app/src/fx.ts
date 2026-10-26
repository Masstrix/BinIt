/**
 * A very small particle layer for the overlay's celebrations: arrows drifting up, twinkling stars, a ring and a
 * few sparks. Drawn on one transparent canvas under the widgets, only while something is alive.
 */
type Kind = "arrow" | "star" | "ring" | "spark";

interface Particle {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  age: number;
  color: string;
  rot: number;
  r1: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

class Fx {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private parts: Particle[] = [];
  private raf = 0;
  private last = 0;
  private timers = new Set<number>();

  attach(canvas: HTMLCanvasElement | null) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext("2d") : null;
    if (!canvas) this.clear();
    else this.resize();
  }

  resize() {
    const c = this.canvas;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(window.innerWidth * dpr);
    c.height = Math.round(window.innerHeight * dpr);
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Forget everything in flight (a new celebration took over). */
  clear() {
    this.timers.forEach((t) => window.clearTimeout(t));
    this.timers.clear();
    this.parts = [];
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ctx?.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }

  private at(ms: number, fn: () => void) {
    const t = window.setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  private add(p: Partial<Particle> & { kind: Kind }) {
    this.parts.push({ x: 0, y: 0, vx: 0, vy: 0, size: 10, life: 1.5, age: 0, color: "#fff", rot: 0, r1: 0, ...p });
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame((n) => this.frame(n));
    }
  }

  /** Arrows that fade in, drift up and fade out around `box`, for `ms`. */
  arrows(box: Rect, colors: string[], from: number, ms: number) {
    if (reduced()) return;
    for (let t = from; t < from + ms; t += 90) {
      this.at(t, () => {
        const side = Math.random() < 0.4;
        const x = side ? (Math.random() < 0.5 ? box.x - rnd(10, 90) : box.x + box.width + rnd(10, 90)) : box.x + Math.random() * box.width;
        const y = side ? box.y + rnd(0, box.height) : box.y + box.height + rnd(8, 50);
        this.add({ kind: "arrow", x, y, vy: -rnd(55, 110), size: rnd(10, 20), life: rnd(1.4, 2.1), color: colors[Math.floor(Math.random() * colors.length)] });
      });
    }
  }

  /** Four point stars that twinkle in and out in and around `box`. */
  twinkles(box: Rect, colors: string[], from: number, ms: number, every = 170, pad = 40) {
    if (reduced()) return;
    for (let t = from; t < from + ms; t += every) {
      this.at(t, () => {
        this.add({
          kind: "star",
          x: box.x - pad + Math.random() * (box.width + pad * 2),
          y: box.y - pad + Math.random() * (box.height + pad * 2),
          size: rnd(9, 20),
          life: rnd(0.7, 1.3),
          color: colors[Math.floor(Math.random() * colors.length)],
          rot: Math.random() * 0.5,
        });
      });
    }
  }

  ring(x: number, y: number, radius: number, color: string, at = 0) {
    if (reduced()) return;
    this.at(at, () => this.add({ kind: "ring", x, y, r1: radius, size: 6, life: 0.9, color }));
  }

  sparks(x: number, y: number, n: number, colors: string[], at = 0) {
    if (reduced()) return;
    this.at(at, () => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283;
        const s = rnd(160, 460);
        this.add({ kind: "spark", x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, size: rnd(2, 4), life: rnd(0.5, 0.9), color: colors[i % colors.length] });
      }
    });
  }

  private frame(now: number) {
    const ctx = this.ctx;
    if (!ctx) {
      this.raf = 0;
      return;
    }
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);
    const alive: Particle[] = [];
    for (const p of this.parts) {
      p.age += dt;
      if (p.age >= p.life) continue;
      p.vx *= 1 - (p.kind === "spark" ? 2.2 : 0) * dt;
      p.vy *= 1 - (p.kind === "spark" ? 2.2 : 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      alive.push(p);
      const k = p.age / p.life;
      const pulse = Math.sin(Math.PI * Math.min(1, k));
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;
      if (p.kind === "arrow") {
        const s = p.size;
        ctx.globalAlpha = 0.9 * pulse;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = Math.max(2.5, s * 0.22);
        ctx.beginPath();
        ctx.moveTo(p.x - s * 0.6, p.y + s * 0.25);
        ctx.lineTo(p.x, p.y - s * 0.35);
        ctx.lineTo(p.x + s * 0.6, p.y + s * 0.25);
        ctx.stroke();
        ctx.globalAlpha *= 0.55;
        ctx.beginPath();
        ctx.moveTo(p.x - s * 0.6, p.y + s * 0.85);
        ctx.lineTo(p.x, p.y + s * 0.25);
        ctx.lineTo(p.x + s * 0.6, p.y + s * 0.85);
        ctx.stroke();
      } else if (p.kind === "star") {
        const sc = pulse * p.size;
        ctx.globalAlpha = Math.min(1, 1.6 * pulse);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot + k * 0.8);
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const r = i % 2 ? sc * 0.22 : sc;
          const an = (i * Math.PI) / 4;
          ctx.lineTo(Math.cos(an) * r, Math.sin(an) * r);
        }
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha *= 0.3;
        ctx.beginPath();
        ctx.arc(0, 0, sc * 0.7, 0, 6.283);
        ctx.fill();
        ctx.restore();
      } else if (p.kind === "ring") {
        const e = 1 - Math.pow(1 - k, 3);
        ctx.globalAlpha = 1 - k;
        ctx.lineWidth = Math.max(0.5, p.size * (1 - k));
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10 + (p.r1 - 10) * e, 0, 6.283);
        ctx.stroke();
      } else {
        ctx.globalAlpha = 1 - k;
        ctx.lineCap = "round";
        ctx.lineWidth = p.size * (1 - k * 0.6);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    this.parts = alive;
    if (alive.length) this.raf = requestAnimationFrame((n) => this.frame(n));
    else this.raf = 0;
  }
}

export const fx = new Fx();
