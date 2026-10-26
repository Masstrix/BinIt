import type { ReactNode } from "react";
import type { Driver } from "../api";
import { Eyes, Helmet, type HelmetMood } from "./Helmet";
import { Coin } from "./Coin";
import { DECALS, SHELLS, faceById, shellCss, type Look } from "../looks";
import type { Offer, Slot } from "../shopModel";

/** Back button, the page's name and the coin count: what the Customize and Shop pages open with, as in the designs. */
export function ShopHeader({ title, coins, back = "#/you", coinHref }: { title: string; coins: number | null; back?: string; coinHref?: string }) {
  const chip = (
    <>
      <Coin size={24} title="Coins" />
      {coins == null ? "–" : coins.toLocaleString()}
    </>
  );
  return (
    <header className="shop-header">
      <a className="shop-back" href={back} aria-label="Back">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </a>
      <h1>{title}</h1>
      {coinHref ? (
        <a className="garage-coins" href={coinHref}>{chip}</a>
      ) : (
        <span className="garage-coins">{chip}</span>
      )}
    </header>
  );
}

/** A price tag on a tile: the coin and a number, "Own", or the level that unlocks it. */
export function PriceTag({ offer }: { offer: Offer }) {
  if (offer.free || offer.owned) return <span className="price own">{offer.free ? "Free" : "Own"}</span>;
  if (offer.locked) return <span className="price lock">Level {offer.minLevel}</span>;
  return (
    <span className="price" style={{ color: offer.affordable ? undefined : "var(--red)" }}>
      <Coin size={16} dim={!offer.affordable} />
      {offer.price.toLocaleString()}
    </span>
  );
}

/** A decal on its own, big enough to read: a white glyph, not a speck on a helmet. */
export function DecalGlyph({ id, size = 28 }: { id: string; size?: number }) {
  const d = DECALS.find((x) => x.id === id);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {d && <path d={d.path} />}
    </svg>
  );
}

/**
 * An item shown the clearest way for what it is: a gradient as a colour swatch, a decal as its glyph, and
 * stripes and eyes on a helmet (where they are the whole point).
 */
export function ItemArt({ slot, id, driver, size = 64 }: { slot: Slot; id: string | null; driver: Driver; size?: number }) {
  if (slot === "shell") {
    const shell = SHELLS.find((s) => s.id === id);
    return <span className="art-swatch" style={{ width: size, height: size, background: shellCss(shell?.stops ?? [driver.color, driver.color], shell?.stars) }} />;
  }
  if (slot === "decal") {
    return (
      <span className="art-glyph" style={{ width: size, height: size }}>
        {id ? (
          <DecalGlyph id={id} size={size * 0.5} />
        ) : (
          <svg width={size * 0.4} height={size * 0.4} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5" aria-hidden="true">
            <circle cx="12" cy="12" r="8" />
            <path d="M6.5 17.5L17.5 6.5" />
          </svg>
        )}
      </span>
    );
  }
  if (slot === "face") {
    // Eyes are tiny on a whole helmet: show the visor up close.
    const mood = (faceById(id ?? "chill")?.mood ?? "idle") as HelmetMood;
    return (
      <span className="art-glyph" style={{ width: size, height: size, background: `${driver.color}33` }}>
        <svg width={size * 0.9} height={size * 0.55} viewBox="22.5 14 25 14" aria-hidden="true">
          <path d="M24.2 14.8H44.4C45.6 17 46.3 19.6 46.6 22.6V26.2H25.4C22.8 26.2 21.4 24.4 21.8 22L22.6 17C22.8 15.6 23.4 14.8 24.2 14.8Z" fill="#0e1117" />
          <Eyes mood={mood} />
        </svg>
      </span>
    );
  }
  const look: Look = id ? { [slot]: id } : {};
  return (
    <span className="art-glyph" style={{ width: size, height: size }}>
      <Helmet color={driver.color} look={look} size={size * 0.85} tile={false} seed={driver.id} />
    </span>
  );
}

/** "3 more in the Shop": the way from a section of what you own to what you could own. */
export function MoreInShop({ count, children }: { count: number; children?: ReactNode }) {
  if (count === 0 && !children) return null;
  return (
    <a className="more-shop" href="#/shop">
      {children ?? `${count} more in the Shop`}
    </a>
  );
}
