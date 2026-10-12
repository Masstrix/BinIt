import type { CSSProperties } from "react";

/** A driver's identity: a racing helmet in their colour on a tinted tile. */
export function Helmet({ color, size = 48, tile = true }: { color: string; size?: number; tile?: boolean }) {
  const svg = (
    <svg width={tile ? size * 0.76 : size} height={tile ? size * 0.76 : size} viewBox="0 0 48 48" aria-hidden="true">
      <path d="M10 38C4 30 6 13 22 8.5c12-3.4 22.5 2.5 24 12.5.6 3.6.3 6.6-1 9l1.5 4c.9 2.8-.9 5-3.8 5.2L29 38c-3.2-.4-6.4.6-10 1.4-3.6.7-7 .4-9-1.4z" fill={color} />
      <path d="M27 15l18 1.5c1.1 3 1.4 6.6 1 10.5l-18-.8c-3-.2-4.8-2.6-4.7-5.4.1-3.1 1.6-5.6 3.7-5.8z" fill="#0D1224" />
      <circle cx="20.4" cy="20.6" r="1.6" fill="#0D1224" opacity="0.5" />
      <path d="M12.5 34C10.5 22 16 12.5 27 10.7" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" opacity="0.55" />
      <path d="M39.5 31.8l1.2 3.6M42.3 31.4l1.2 3.6" fill="none" stroke="#0D1224" strokeWidth="1.3" strokeLinecap="round" opacity="0.45" />
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
