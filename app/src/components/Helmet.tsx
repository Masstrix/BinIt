import { useEffect, useMemo, useState, type CSSProperties } from "react";

/**
 * How the driver looks through the visor: `happy` for a win, `binned` for a lap the game threw out,
 * `focus` while they're in the seat, `wink` for a cheeky moment.
 */
export type HelmetMood = "idle" | "happy" | "binned" | "focus" | "wink";

function Eyes({ mood }: { mood: HelmetMood }) {
  const arc = { fill: "none", stroke: "#fff", strokeWidth: 1.6, strokeLinecap: "round" } as const;
  switch (mood) {
    case "happy":
      return <path d="M29.6 21.8Q31.4 18.4 33.2 21.8M37 21.8Q38.8 18.4 40.6 21.8" {...arc} />;
    case "binned":
      return <path d="M30 18.6L33 22.4M33 18.6L30 22.4M37.4 18.6L40.4 22.4M40.4 18.6L37.4 22.4" {...arc} strokeWidth={1.5} />;
    case "focus":
      return <path d="M29.6 18.2L33.2 19.6V22Q33.2 23.4 31.4 23.4Q29.6 23.4 29.6 22ZM37 19.6L40.6 18.2V22Q40.6 23.4 38.8 23.4Q37 23.4 37 22Z" fill="#fff" />;
    case "wink":
      return (
        <>
          <ellipse cx="31.4" cy="20.5" rx="1.7" ry="2.6" fill="#fff" />
          <path d="M37 21.4Q38.8 19.4 40.6 21.4" {...arc} />
        </>
      );
    default:
      return (
        <>
          <ellipse cx="31.4" cy="20.5" rx="1.7" ry="2.6" fill="#fff" />
          <ellipse cx="38.8" cy="20.5" rx="1.7" ry="2.6" fill="#fff" />
        </>
      );
  }
}

/** Small seeded PRNG (mulberry32), so a driver's quirks are the same on every screen and every visit. */
function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AMBIENT: HelmetMood[] = ["happy", "wink", "focus"];

/** A driver's personality: how often they blink and glance, and the face they pull most when idle. */
function personality(seed: string) {
  const r = seeded(seed);
  const blink = 2.6 + r() * 4;
  const look = 7 + r() * 7;
  return {
    vars: {
      "--blink": `${blink.toFixed(2)}s`,
      "--blink-delay": `${(-r() * blink).toFixed(2)}s`,
      "--look": `${look.toFixed(2)}s`,
      "--look-delay": `${(-r() * look).toFixed(2)}s`,
      "--look-x": `${((r() < 0.5 ? -1 : 1) * (0.8 + r() * 0.8)).toFixed(2)}px`,
    } as CSSProperties,
    favourite: AMBIENT[Math.floor(r() * AMBIENT.length)],
    rand: r,
  };
}

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** While idle, now and then pull a face for a moment (mostly the driver's favourite), then relax. */
function useAmbientMood(base: HelmetMood, seed: string): HelmetMood {
  const [face, setFace] = useState<HelmetMood | null>(null);
  useEffect(() => {
    setFace(null);
    if (base !== "idle" || reducedMotion()) return;
    const { rand, favourite } = personality(`${seed}:mood`);
    let timer: ReturnType<typeof setTimeout>;
    const relax = () => {
      setFace(null);
      timer = setTimeout(pull, 6000 + rand() * 14000);
    };
    const pull = () => {
      setFace(rand() < 0.6 ? favourite : AMBIENT[Math.floor(rand() * AMBIENT.length)]);
      timer = setTimeout(relax, 1200 + rand() * 1800);
    };
    timer = setTimeout(pull, 2000 + rand() * 12000);
    return () => clearTimeout(timer);
  }, [base, seed]);
  return face ?? base;
}

/**
 * A driver's identity: a racing helmet in their colour, with eyes in the visor, on a tinted tile.
 * The eyes are alive: they blink, glance about and pull faces, on a rhythm unique to `seed`
 * (pass the driver's id; it defaults to the colour).
 */
export function Helmet({ color, size = 48, tile = true, mood = "idle", seed }: { color: string; size?: number; tile?: boolean; mood?: HelmetMood; seed?: string | number }) {
  const key = String(seed ?? color);
  const { vars } = useMemo(() => personality(key), [key]);
  const face = useAmbientMood(mood, key);
  const blinks = face === "idle" || face === "focus";
  const svg = (
    <svg className={face === "binned" ? "helmet-shake" : undefined} width={tile ? size * 0.76 : size} height={tile ? size * 0.76 : size} viewBox="0 0 48 48" aria-hidden="true">
      {/* Full-face shell: the straight underside rises from the chin to the nape, as on a race helmet. */}
      <path d="M11.2 34C7.4 26.4 8 15.6 15.6 10.2C21.6 6 31.6 5.6 38 9C43 11.8 46.2 17 46.6 23L46.6 31.4C46.6 36.4 44.6 39.6 40.8 40L13.4 35.6C12.4 35.4 11.6 34.8 11.2 34Z" fill={color} />
      <path d="M11.2 34L13.4 35.6L40.8 40C43 39.8 44.6 38.6 45.6 36.8L11.6 31.4Z" fill="#0D1224" opacity="0.25" />
      <path d="M24.2 14.8H44.4C45.6 17 46.3 19.6 46.6 22.6V26.2H25.4C22.8 26.2 21.4 24.4 21.8 22L22.6 17C22.8 15.6 23.4 14.8 24.2 14.8Z" fill="#0D1224" />
      <circle cx="18" cy="20.6" r="1.6" fill="#0D1224" opacity="0.5" />
      <path d="M13 28C12.4 19.6 17 12.6 25.4 10.4" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" opacity="0.55" />
      <path d="M36.6 32.4L43.6 33.5M37.2 35.2L42.6 36.1" stroke="#0D1224" strokeWidth="1.3" strokeLinecap="round" opacity="0.45" />
      <g className="helmet-look" style={vars}>
        <g key={face} className="helmet-pop">
          <g className={blinks ? "helmet-blink" : undefined}>
            <Eyes mood={face} />
          </g>
        </g>
      </g>
    </svg>
  );
  if (!tile) return svg;
  return (
    <span className="helmet-tile" style={{ width: size, height: size, borderRadius: size * 0.3, background: `${color}33` }}>
      {svg}
    </span>
  );
}

export function Crown({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.77} viewBox="0 0 26 20" role="img" aria-label="Leader">
      <path d="M2 6l6 5 5-9 5 9 6-5-2 13H4z" fill="#FFC93C" />
    </svg>
  );
}

/** A four-point star that twinkles (offset with `delay` seconds so a group does not pulse in sync). */
export function Sparkle({ size = 20, color = "#fff", opacity = 0.6, style, delay = 0 }: { size?: number; color?: string; opacity?: number; style?: CSSProperties; delay?: number }) {
  return (
    <svg className="sparkle" width={size} height={size} viewBox="0 0 24 24" style={{ ...style, animationDelay: `${delay}s` }} aria-hidden="true">
      <path d="M12 0C13 7 17 11 24 12C17 13 13 17 12 24C11 17 7 13 0 12C7 11 11 7 12 0Z" fill={color} opacity={opacity} />
    </svg>
  );
}

export function Logo() {
  return (
    <svg width="34" height="34" viewBox="0 0 180 180" aria-hidden="true">
      {/* Same mark as src-tauri/icons/binit.svg, the source of every app icon. */}
      <rect width="180" height="180" rx="44" fill="#6A58F5" />
      <g transform="translate(0 10)">
        <g transform="rotate(-10 90 110)">
          <path d="M58 78 L118 78 L112 132 Q111 138 105 138 L71 138 Q65 138 64 132 Z" fill="#fff" stroke="#6A58F5" strokeWidth="6" strokeLinejoin="round" />
          <rect x="98" y="88" width="7" height="40" rx="3.5" fill="#6A58F5" />
        </g>
        <circle cx="62" cy="130" r="13" fill="#6A58F5" />
        <circle cx="62" cy="130" r="9" fill="#fff" />
        <circle cx="62" cy="130" r="3.5" fill="#6A58F5" />
        <path d="M112 108 Q132 108 140 94" fill="none" stroke="#fff" strokeWidth="11" strokeLinecap="round" />
        <g transform="rotate(-16 82 64)">
          <path d="M50 88 Q38 88 38 76 Q38 28 84 28 Q128 28 128 72 Q128 88 114 88 Z" fill="#fff" stroke="#6A58F5" strokeWidth="6" strokeLinejoin="round" />
          <rect x="50" y="48" width="70" height="24" rx="12" fill="#6A58F5" />
          <ellipse cx="74" cy="60" rx="4.5" ry="6.5" fill="#fff" />
          <ellipse cx="98" cy="60" rx="4.5" ry="6.5" fill="#fff" />
        </g>
        <g transform="translate(-2 0)">
          <path d="M126 54 Q114 54 116 66 Q118 74 128 74 M162 54 Q174 54 172 66 Q170 74 160 74" fill="none" stroke="#6A58F5" strokeWidth="11" strokeLinecap="round" />
          <path d="M126 54 Q114 54 116 66 Q118 74 128 74 M162 54 Q174 54 172 66 Q170 74 160 74" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
          <path d="M126 48 H162 V60 Q162 82 144 84 Q126 82 126 60 Z" fill="#fff" stroke="#6A58F5" strokeWidth="4" strokeLinejoin="round" />
          <rect x="140" y="82" width="8" height="10" fill="#fff" />
          <path d="M141 61 L146 58 V75" fill="none" stroke="#6A58F5" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <circle cx="141" cy="93" r="8" fill="#fff" stroke="#6A58F5" strokeWidth="4" />
      </g>
    </svg>
  );
}
