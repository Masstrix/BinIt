import type { CSSProperties } from "react";
import type { BookSticker } from "../api";
import { RARITY, stickerPath, stickerState } from "../stickers";

/** A sticker's picture: full colour when earned, grey while it is still to do, dashed while it is hidden. */
export function StickerTile({ sticker, size = 64 }: { sticker: BookSticker; size?: number }) {
  const r = RARITY[sticker.rarity];
  const style = { "--s": `${size}px`, "--a": r.from, "--b": r.to } as CSSProperties;
  return (
    <span className="stk-tile" data-state={stickerState(sticker)} style={style} aria-hidden="true">
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
        <path d={stickerPath(sticker)} />
      </svg>
    </span>
  );
}

/** Pips and the rarity word, e.g. ▮▮ RARE. */
export function RarityTag({ sticker }: { sticker: BookSticker }) {
  const r = RARITY[sticker.rarity];
  return (
    <span className="stk-rarity" style={{ color: r.color }}>
      <span className="stk-pips" aria-hidden="true">
        {[1, 2, 3, 4].map((n) => (
          <i key={n} style={{ background: n <= r.pips ? r.color : "var(--line)" }} />
        ))}
      </span>
      {r.label}
    </span>
  );
}
