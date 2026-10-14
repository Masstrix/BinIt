/** The stopwatch-with-an-exclamation-mark used for a time penalty, so it reads the same on the live timing, the live map chip and the overlay. */
export function PenaltyIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ flex: "none" }}>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M10 2.5h4M12 2.5v3.5M18.2 7l1.4-1.4" />
      <path d="M12 9.8v4.4" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" />
    </svg>
  );
}
