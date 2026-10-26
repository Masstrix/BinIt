import type { CSSProperties } from "react";

/** The coin's face: a gold token with a stamped bolt, readable down to 14px. */
function Face({ size, className, style }: { size: number; className?: string; style?: CSSProperties }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={style}>
      <defs>
        <linearGradient id="coin-gold" x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#FFE48A" />
          <stop offset="0.55" stopColor="#FFC93C" />
          <stop offset="1" stopColor="#E5961A" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="url(#coin-gold)" stroke="#B8750F" strokeWidth="0.9" />
      <circle cx="16" cy="16" r="11.8" fill="none" stroke="#B8750F" strokeWidth="1.2" opacity="0.6" />
      <path d="M17.6 7.2L10.2 17.6H15.2L14 24.8L21.8 14.2H16.6Z" fill="#8A5405" stroke="#8A5405" strokeWidth="0.8" strokeLinejoin="round" />
      <path d="M5.4 12.2C7.2 7.8 11.2 5.4 15 5.2" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" opacity="0.75" />
    </svg>
  );
}

/** Slices of plain gold between the two faces: edge on, they read as the coin's thickness. */
const SLICES = 9;

/**
 * The coin: a gold token with a stamped bolt, readable down to 14px. Shown wherever coins are counted,
 * usually beside a bare number (the icon says "coins").
 */
export function Coin({ size = 18, dim = false, spin = false, title }: { size?: number; /** Dimmed for a price the driver cannot afford. */ dim?: boolean; /** A solid coin with a milled edge that turns now and then, for the balance on the profile. */ spin?: boolean; title?: string }) {
  if (spin) {
    const depth = Math.max(2, size * 0.12);
    return (
      <span className="coin3d-glow" style={{ width: size, height: size }} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
        <span className="coin3d">
          {Array.from({ length: SLICES }, (_, i) => (
            <svg
              key={i}
              className="coin3d-slice"
              width={size}
              height={size}
              viewBox="0 0 32 32"
              aria-hidden="true"
              style={{ transform: `translateZ(${(i / (SLICES - 1) - 0.5) * depth}px)` }}
            >
              <circle cx="16" cy="16" r="15" fill={i % 2 ? "#E0A020" : "#B8750F"} />
            </svg>
          ))}
          <Face size={size} className="coin3d-face" style={{ transform: `translateZ(${depth / 2 + 0.2}px)` }} />
          <Face size={size} className="coin3d-face" style={{ transform: `rotateY(180deg) translateZ(${depth / 2 + 0.2}px)` }} />
        </span>
      </span>
    );
  }
  return (
    <svg className="coin" width={size} height={size} viewBox="0 0 32 32" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} style={dim ? { opacity: 0.55 } : undefined}>
      <defs>
        <linearGradient id="coin-gold" x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#FFE48A" />
          <stop offset="0.55" stopColor="#FFC93C" />
          <stop offset="1" stopColor="#E5961A" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="url(#coin-gold)" stroke="#B8750F" strokeWidth="0.9" />
      <circle cx="16" cy="16" r="11.8" fill="none" stroke="#B8750F" strokeWidth="1.2" opacity="0.6" />
      <path d="M17.6 7.2L10.2 17.6H15.2L14 24.8L21.8 14.2H16.6Z" fill="#8A5405" stroke="#8A5405" strokeWidth="0.8" strokeLinejoin="round" />
      <path d="M5.4 12.2C7.2 7.8 11.2 5.4 15 5.2" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" opacity="0.75" />
    </svg>
  );
}
