/**
 * The coin: a gold token with a stamped bolt, readable down to 14px. Shown wherever coins are counted,
 * usually beside a bare number (the icon says "coins").
 */
export function Coin({ size = 18, dim = false, spin = false, title }: { size?: number; /** Dimmed for a price the driver cannot afford. */ dim?: boolean; /** Flips now and then, for a coin that is the centre of attention (the balance on the profile). */ spin?: boolean; title?: string }) {
  return (
    <svg className={spin ? "coin coin-spin" : "coin"} width={size} height={size} viewBox="0 0 32 32" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} style={dim ? { opacity: 0.55 } : undefined}>
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
