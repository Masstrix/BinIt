import type { CSSProperties } from "react";

/** A driver's identity: a racing helmet in their colour on a tinted tile. */
export function Helmet({ color, size = 48, tile = true }: { color: string; size?: number; tile?: boolean }) {
  const svg = (
    <svg width={tile ? size * 0.76 : size} height={tile ? size * 0.76 : size} viewBox="0 0 48 48" aria-hidden="true">
      <path d="M7 31C7 16 17 7 29 7c10 0 16 7 17 17l1 8c.3 3-1.5 5-4.5 5.5L35 38.5c-1 2.5-3 3.5-6 3.5H12c-3 0-5-2-5-5z" fill={color} />
      <path d="M24 15.5c6-2.5 14-2 20 2.5l1 8.5c-7 1.5-14 1.5-20-.5-2-3-2.3-7.3-1-10.5z" fill="#0D1224" />
      <path d="M8.5 29.5c5-1.2 10-1.8 15-2.2" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
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

export function Sparkle({ size = 20, color = "#fff", opacity = 0.6, style }: { size?: number; color?: string; opacity?: number; style?: CSSProperties }) {
  return (
    <svg className="sparkle" width={size} height={size} viewBox="0 0 24 24" style={style} aria-hidden="true">
      <path d="M12 0C13 7 17 11 24 12C17 13 13 17 12 24C11 17 7 13 0 12C7 11 11 7 12 0Z" fill={color} opacity={opacity} />
    </svg>
  );
}

export function Logo() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <rect width="34" height="34" rx="10" fill="#6A58F5" />
      <rect x="8" y="8" width="6" height="6" fill="#fff" />
      <rect x="20" y="8" width="6" height="6" fill="#fff" />
      <rect x="14" y="14" width="6" height="6" fill="#fff" />
      <rect x="8" y="20" width="6" height="6" fill="#fff" />
      <rect x="20" y="20" width="6" height="6" fill="#fff" />
    </svg>
  );
}
