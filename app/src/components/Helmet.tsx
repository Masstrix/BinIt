import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import { DECAL_AT, decalById, faceById, shellById, stripeById, type Look } from "../looks";

/**
 * How the driver looks through the visor: `happy` for a win, `binned` for a lap the game threw out,
 * `focus` while they're in the seat, `wink` for a cheeky moment.
 */
export type HelmetMood = "idle" | "happy" | "binned" | "focus" | "wink" | "sleepy" | "wide" | "angry" | "peaked" | "stars" | "hearts" | "cash";

export function Eyes({ mood }: { mood: HelmetMood }) {
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
    case "sleepy":
      return <path d="M29.6 20.6Q31.4 22.8 33.2 20.6M37 20.6Q38.8 22.8 40.6 20.6" {...arc} />;
    case "wide":
      return (
        <>
          <ellipse cx="31.4" cy="20.5" rx="2.4" ry="3.5" fill="#fff" />
          <ellipse cx="38.8" cy="20.5" rx="2.4" ry="3.5" fill="#fff" />
        </>
      );
    case "angry":
      return (
        <>
          <ellipse cx="31.4" cy="21.2" rx="1.6" ry="2.2" fill="#fff" />
          <ellipse cx="38.8" cy="21.2" rx="1.6" ry="2.2" fill="#fff" />
          <path d="M28.8 17.2L33.6 18.8M41.4 17.2L36.6 18.8" {...arc} strokeWidth={1.4} />
        </>
      );
    case "peaked":
      return <path d="M29.4 21.8L31.4 18.6L33.4 21.8M36.8 21.8L38.8 18.6L40.8 21.8" {...arc} strokeWidth={1.7} strokeLinejoin="round" />;
    case "stars":
      return <path d="M31.4 17.4L32.3 19.6L34.5 20.5L32.3 21.4L31.4 23.6L30.5 21.4L28.3 20.5L30.5 19.6ZM38.8 17.4L39.7 19.6L41.9 20.5L39.7 21.4L38.8 23.6L37.9 21.4L35.7 20.5L37.9 19.6Z" fill="#FFE48A" />;
    case "hearts":
      return <path d="M31.4 23.2C28.6 21.3 28.8 18.6 30.5 18.6C31 18.6 31.3 18.9 31.4 19.3C31.5 18.9 31.8 18.6 32.3 18.6C34 18.6 34.2 21.3 31.4 23.2ZM38.8 23.2C36 21.3 36.2 18.6 37.9 18.6C38.4 18.6 38.7 18.9 38.8 19.3C38.9 18.9 39.2 18.6 39.7 18.6C41.4 18.6 41.6 21.3 38.8 23.2Z" fill="#FF6FA3" />;
    case "cash":
      return (
        <>
          <circle cx="31.4" cy="20.5" r="2.5" fill="#FFC93C" />
          <circle cx="38.8" cy="20.5" r="2.5" fill="#FFC93C" />
          <path d="M31.4 19L30.4 20.8H31.6L31.2 22L32.4 20.2H31.2Z M38.8 19L37.8 20.8H39L38.6 22L39.8 20.2H38.6Z" fill="#8A5405" />
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

/** Where the galaxy shell's stars sit (x, y, size, twinkle delay). Size under 0.8 is a pin-prick; bigger is a four-point star. */
const STARS: [number, number, number, number][] = [
  [16, 14, 0.4, 0], [22, 10, 0.4, 1.1], [30, 9, 0.9, 0.4], [37, 11, 0.4, 1.7], [14, 22, 0.4, 0.7], [19, 27, 1.1, 1.3], [26, 32, 0.4, 0.2],
  [33, 35, 0.4, 1.9], [41, 33, 0.9, 0.9], [44, 27, 0.4, 1.5], [21, 19, 0.4, 0.5], [12, 30, 0.4, 2.1], [28, 14, 0.4, 1.2], [35, 38, 0.4, 0.6],
];

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
export function Helmet({ color, size = 48, tile = true, mood = "idle", seed, round = false, look }: { color: string; /** What is equipped (gradient shell, decal, stripe, number); without it the helmet is plain `color`. */ look?: Look; size?: number; tile?: boolean; mood?: HelmetMood; seed?: string | number; /** The tile is a circle instead of a rounded square. */ round?: boolean }) {
  const key = String(seed ?? color);
  const { vars } = useMemo(() => personality(key), [key]);
  // The default face is the driver's own choice of how they look when idle; a real moment (a win, a binned lap) still overrides it.
  const chosen = mood === "idle" ? (faceById(look?.face)?.mood as HelmetMood | undefined) : undefined;
  const face = useAmbientMood(chosen && chosen !== "idle" ? chosen : mood, key);
  const blinks = face === "idle" || face === "focus" || face === "wide" || face === "angry";
  const gradId = `helmet-shell-${useId().replace(/:/g, "")}`;
  const shell = shellById(look?.shell);
  const decal = decalById(look?.decal);
  const stripe = stripeById(look?.stripe);
  const at = DECAL_AT[look?.decalAt ?? "side"];
  const svg = (
    <svg className={face === "binned" ? "helmet-shake" : undefined} width={tile ? size * 0.76 : size} height={tile ? size * 0.76 : size} viewBox="0 0 48 48" aria-hidden="true">
      {/* Full-face shell: the straight underside rises from the chin to the nape, as on a race helmet. */}
      {shell && (
        <defs>
          <clipPath id={`${gradId}-clip`}>
            <path d="M11.2 34C7.4 26.4 8 15.6 15.6 10.2C21.6 6 31.6 5.6 38 9C43 11.8 46.2 17 46.6 23L46.6 31.4C46.6 36.4 44.6 39.6 40.8 40L13.4 35.6C12.4 35.4 11.6 34.8 11.2 34Z" />
          </clipPath>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            {shell.stops.map((c, i) => (
              <stop key={i} offset={shell.stops.length === 1 ? 0 : i / (shell.stops.length - 1)} stopColor={c} />
            ))}
          </linearGradient>
        </defs>
      )}
      <path d="M11.2 34C7.4 26.4 8 15.6 15.6 10.2C21.6 6 31.6 5.6 38 9C43 11.8 46.2 17 46.6 23L46.6 31.4C46.6 36.4 44.6 39.6 40.8 40L13.4 35.6C12.4 35.4 11.6 34.8 11.2 34Z" fill={shell ? `url(#${gradId})` : color} />
      <path d="M11.2 34L13.4 35.6L40.8 40C43 39.8 44.6 38.6 45.6 36.8L11.6 31.4Z" fill="#0e1117" opacity="0.25" />
      {shell?.stars && (
        <g clipPath={`url(#${gradId}-clip)`}>
          {STARS.map(([x, y, r, delay], i) =>
            r >= 0.8 ? (
              <path key={i} className="helmet-star" style={{ animationDelay: `${delay}s` }} d={`M${x} ${y - r * 2}L${x + r * 0.5} ${y - r * 0.5}L${x + r * 2} ${y}L${x + r * 0.5} ${y + r * 0.5}L${x} ${y + r * 2}L${x - r * 0.5} ${y + r * 0.5}L${x - r * 2} ${y}L${x - r * 0.5} ${y - r * 0.5}Z`} fill="#fff" />
            ) : (
              <circle key={i} className="helmet-star" style={{ animationDelay: `${delay}s` }} cx={x} cy={y} r={0.55} fill="#fff" />
            ),
          )}
        </g>
      )}
      {stripe && stripe.paths.map((d, i) => <path key={i} d={d} fill="none" stroke="#fff" strokeWidth={stripe.width} strokeLinecap="round" strokeDasharray={stripe.dash} />)}
      {decal && (
        <g transform={`translate(${at.x} ${at.y}) scale(${at.s})`}>
          <path d={decal.path} fill={look?.decalColor ?? "#fff"} />
        </g>
      )}
      {look?.number != null && (
        <text x="19.4" y="33" textAnchor="middle" fontFamily="Archivo, sans-serif" fontStyle="italic" fontWeight={800} fontSize="8.6" fill="#fff">
          {look.number}
        </text>
      )}
      <path d="M24.2 14.8H44.4C45.6 17 46.3 19.6 46.6 22.6V26.2H25.4C22.8 26.2 21.4 24.4 21.8 22L22.6 17C22.8 15.6 23.4 14.8 24.2 14.8Z" fill="#0e1117" />
      <circle cx="18" cy="20.6" r="1.6" fill="#0e1117" opacity="0.5" />
      <path d="M13 28C12.4 19.6 17 12.6 25.4 10.4" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" opacity="0.55" />
      <path d="M36.6 32.4L43.6 33.5M37.2 35.2L42.6 36.1" stroke="#0e1117" strokeWidth="1.3" strokeLinecap="round" opacity="0.45" />
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
    <span className="helmet-tile" style={{ width: size, height: size, borderRadius: round ? "50%" : size * 0.3, background: `${color}33` }}>
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

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 180 180" aria-hidden="true">
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
