import { useEffect, useRef, useState } from "react";
import { api, useAppState, useFetch, type BookSticker, type Parcel, type ParcelSticker } from "../api";
import { RARITY } from "../stickers";
import { Coin } from "./Coin";
import { StickerTile } from "./StickerTile";

/** How many stickers get a card of their own before the compact grid. */
const FEATURED = 3;

const asSticker = (s: ParcelSticker): BookSticker => ({
  id: s.id, name: s.name, group: "", rarity: s.rarity, how: s.how, hidden: false, earned: true, earnedAt: null, progress: null, xp: s.xp, coins: s.coins, item: s.item, detectable: true,
});

function Gift({ size, className, open }: { size: number; className?: string; open?: boolean }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 160 160" aria-hidden="true">
      <ellipse cx="80" cy="146" rx="46" ry="8" fill="#000" opacity="0.3" />
      <rect x="28" y="70" width="104" height="72" rx="10" fill="#8b8bf5" />
      <rect x="72" y="70" width="16" height="72" fill="#ffc93c" />
      <g className={open ? "pc-lid" : undefined}>
        <rect x="20" y="50" width="120" height="28" rx="10" fill="#a9a9fa" />
        <rect x="72" y="50" width="16" height="28" fill="#ffc93c" />
        <path d="M80 50C66 22 44 28 52 42C58 52 72 50 80 50ZM80 50C94 22 116 28 108 42C102 52 88 50 80 50Z" fill="#ffc93c" />
      </g>
    </svg>
  );
}

/** `decal:crown` as "Crown decal", `shell:gold` as "Gold shell". */
const itemText = (item: string) => {
  const [slot, id = ""] = item.split(":");
  const name = id.replace(/[-_]/g, " ");
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${slot}`;
};

type Stage = "arrive" | "opening" | "showcase" | "summary";

/**
 * Everything a driver earned since they last looked, as a full-screen takeover: nothing else can be used until they
 * have opened it and collected. There is no close button and Escape does nothing. Rewards were paid when each
 * sticker unlocked; this is how they find out.
 */
export function ParcelOverlay({ parcel, name, onCollect }: { parcel: Parcel; name: string; onCollect: () => Promise<void> }) {
  const many = parcel.stickers.length > FEATURED;
  const [stage, setStage] = useState<Stage>("arrive");
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const main = useRef<HTMLButtonElement>(null);
  const featured = parcel.stickers.slice(0, FEATURED);
  const lastFeatured = idx >= featured.length - 1;

  // The rest of the app can't be reached while this is up.
  useEffect(() => {
    const shell = document.querySelector(".shell");
    shell?.setAttribute("inert", "");
    return () => shell?.removeAttribute("inert");
  }, []);
  useEffect(() => {
    if (stage !== "opening") return;
    const t = window.setTimeout(() => setStage(many ? "showcase" : "summary"), 2600);
    return () => window.clearTimeout(t);
  }, [stage, many]);
  useEffect(() => {
    main.current?.focus();
  }, [stage, idx]);

  const collect = async () => {
    setBusy(true);
    try {
      await onCollect();
    } finally {
      setBusy(false);
    }
  };
  const count = `${parcel.stickers.length} new sticker${parcel.stickers.length === 1 ? "" : "s"}`;
  const cur = featured[Math.min(idx, featured.length - 1)];

  return (
    <div className="pc-overlay" role="dialog" aria-modal="true" aria-label="Your parcel" onKeyDown={(e) => e.key === "Escape" && e.stopPropagation()}>
      {stage === "arrive" && (
        <div className="pc-center">
          <Gift size={210} className="pc-bob" />
          <span className="pc-kicker">A PARCEL FOR {name.toUpperCase()}</span>
          <h2 className="pc-title">{count} {parcel.stickers.length === 1 ? "is" : "are"} waiting</h2>
          <p className="pc-sub">Earned while you were away. It's yours: open it to collect.</p>
          <button type="button" ref={main} className="pc-primary" onClick={() => setStage("opening")}>Open parcel</button>
        </div>
      )}

      {stage === "opening" && (
        <div className="pc-center pc-opening">
          <span className="pc-burst" aria-hidden="true" />
          <Gift size={230} className="pc-shake" open />
          <span className="pc-kicker">OPENING…</span>
        </div>
      )}
      {(stage === "opening" || stage === "showcase") &&
        Array.from({ length: 16 }, (_, i) => <span key={i} className={`pc-spark pc-s${i % 8}`} style={{ animationDelay: `${1.5 + (i % 4) * 0.06}s`, background: ["#ffc93c", "#8b8bf5", "#ec6fdb", "#5fe3b0", "#ffe48a", "#7dc0ff"][i % 6] }} aria-hidden="true" />)}

      {stage === "showcase" && (
        <div className="pc-center pc-showcase">
          <span className="pc-kicker">THE BEST OF YOUR PARCEL</span>
          <span className="pc-dots" role="img" aria-label={`${idx + 1} of ${featured.length}`}>
            {featured.map((f, i) => <i key={f.id} data-on={i === idx || undefined} />)}
          </span>
          <div className={`pc-feature ${idx % 2 ? "pc-flipB" : "pc-flipA"}`} style={{ borderTopColor: RARITY[cur.rarity].color }}>
            <StickerTile sticker={asSticker(cur)} size={132} />
            <span className="pc-rar" style={{ color: RARITY[cur.rarity].color }}>{RARITY[cur.rarity].label}</span>
            <span className="pc-name">{cur.name}</span>
            <span className="pc-how">{cur.how}</span>
            <RewardLine s={cur} />
          </div>
          <div className="pc-actions">
            <button type="button" ref={main} className="pc-primary" onClick={() => (lastFeatured ? setStage("summary") : setIdx(idx + 1))}>{lastFeatured ? `See all ${parcel.stickers.length}` : "Next"}</button>
            <button type="button" className="pc-ghost" onClick={() => setStage("summary")}>Skip to everything</button>
          </div>
        </div>
      )}

      {stage === "summary" && (
        <>
          <div className="pc-scroll">
            <span className="pc-kicker">YOUR PARCEL</span>
            <h2 className="pc-title sm">{many ? `All ${parcel.stickers.length} stickers` : count}</h2>
            {many ? (
              <div className="pc-grid">
                {parcel.stickers.map((s, i) => (
                  <div key={s.id} className="pc-tile" style={{ borderTopColor: RARITY[s.rarity].color, animationDelay: `${i * 70}ms` }}>
                    <StickerTile sticker={asSticker(s)} size={56} />
                    <span className="pc-tile-name">{s.name}</span>
                    <span className="pc-rar sm" style={{ color: RARITY[s.rarity].color }}>{RARITY[s.rarity].label}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="pc-cards">
                {parcel.stickers.map((s) => (
                  <div key={s.id} className="pc-card" style={{ borderColor: RARITY[s.rarity].color }}>
                    <StickerTile sticker={asSticker(s)} size={64} />
                    <span className="pc-card-body">
                      <span className="pc-rar sm" style={{ color: RARITY[s.rarity].color }}>{RARITY[s.rarity].label}</span>
                      <span className="pc-card-name">{s.name}</span>
                      <span className="pc-card-how">{s.how}</span>
                      <RewardLine s={s} small />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="pc-foot">
            <div className="pc-total">
              <span className="pc-total-label">IN TOTAL</span>
              <span className="pc-total-nums"><span className="gold"><Coin size={16} />+{parcel.coins.toLocaleString()}</span><span className="peri">+{parcel.xp.toLocaleString()} XP</span></span>
            </div>
            {(parcel.levelAfter > parcel.levelBefore || parcel.items.length > 0) && (
              <div className="pc-extras">
                {parcel.levelAfter > parcel.levelBefore && <span className="mint">Level {parcel.levelAfter} reached: {parcel.titleAfter}</span>}
                {parcel.items.length > 0 && <span className="peri">Free: {parcel.items.map(itemText).join(", ")}</span>}
              </div>
            )}
            <button type="button" ref={main} className="pc-primary" disabled={busy} onClick={collect}>Collect</button>
          </div>
        </>
      )}
    </div>
  );
}

function RewardLine({ s, small }: { s: ParcelSticker; small?: boolean }) {
  return (
    <span className={`pc-reward${small ? " sm" : ""}`}>
      <span className="gold"><Coin size={small ? 14 : 16} />+{s.coins} coins</span>
      <span className="peri">+{s.xp} XP</span>
      {s.item && <span className="pc-item">{itemText(s.item)}</span>}
    </span>
  );
}

/**
 * Shows a driver their parcel when they have one, the next time they are on the app as themselves: the phone or browser
 * signed in as them, or the PC's seated driver. Never while they are driving.
 */
export function ParcelGate() {
  const { status, drivers } = useAppState();
  const info = useFetch(() => api.me(), [drivers]);
  const driverId = info?.driver?.id ?? (info?.local ? (status?.seat ?? null) : null);
  const [tick, setTick] = useState(0);
  const parcel = useFetch<Parcel | null>(driverId != null ? () => api.parcel(driverId) : null, [driverId, tick]);
  // Look again now and then, and whenever the page comes back into view.
  useEffect(() => {
    const again = () => setTick((t) => t + 1);
    const timer = window.setInterval(again, 15_000);
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, []);
  const name = drivers.find((d) => d.id === driverId)?.name ?? "you";
  if (driverId == null || !parcel || status?.live?.driving) return null;
  return (
    <ParcelOverlay
      key={parcel.stickers.map((s) => s.id).join("|")}
      parcel={parcel}
      name={name}
      onCollect={async () => {
        await api.collectParcel(driverId);
        setTick((t) => t + 1);
      }}
    />
  );
}
