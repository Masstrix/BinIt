import type { CSSProperties } from "react";
import { Coin } from "./Coin";

/** One flying bit: where it ends up (relative to the centre), when it leaves and how far it spins. */
interface Bit {
  kind: "coin" | "spark";
  dx: number;
  dy: number;
  delay: number;
  rot: number;
  size: number;
}

/** Fixed, so the burst is the same every time and renders without randomness (and without a flicker on re-render). */
const BITS: Bit[] = Array.from({ length: 18 }, (_, i) => {
  const angle = (i / 18) * Math.PI * 2 + (i % 2 ? 0.18 : -0.1);
  const far = i % 3 === 0 ? 118 : i % 3 === 1 ? 92 : 70;
  const coin = i % 3 === 0;
  return {
    kind: coin ? "coin" : "spark",
    dx: Math.round(Math.cos(angle) * far),
    // Coins arc up first and then fall a little, sparks fly straight out.
    dy: Math.round(Math.sin(angle) * far * (coin ? 0.9 : 0.8) + (coin ? 14 : 0)),
    delay: (i % 6) * 0.025,
    rot: (i % 2 ? 1 : -1) * (90 + (i % 5) * 50),
    size: coin ? 18 : 10 + (i % 4) * 3,
  };
});

/**
 * A burst of coins and sparkles for the moment something is bought: a ring pulses out and bits fly from the middle of
 * its parent, then it is gone. Mount it (give it a new `key` to play it again) over the item's picture.
 */
export function PurchaseBurst({ color = "#FFC93C" }: { color?: string }) {
  return (
    <span className="burst" aria-hidden="true" style={{ "--ring": color } as CSSProperties}>
      <span className="burst-ring" />
      <span className="burst-ring burst-ring-late" />
      {BITS.map((b, i) => (
        <span key={i} className="burst-bit" style={{ "--dx": `${b.dx}px`, "--dy": `${b.dy}px`, "--rot": `${b.rot}deg`, animationDelay: `${b.delay}s` } as CSSProperties}>
          {b.kind === "coin" ? (
            <Coin size={b.size} />
          ) : (
            <svg width={b.size} height={b.size} viewBox="0 0 24 24">
              <path d="M12 0C13 7 17 11 24 12C17 13 13 17 12 24C11 17 7 13 0 12C7 11 11 7 12 0Z" fill={i % 2 ? "#FFF6CF" : color} />
            </svg>
          )}
        </span>
      ))}
    </span>
  );
}
