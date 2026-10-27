import { useMemo, useState } from "react";
import { api, type Driver, type ShopState } from "../api";
import { Helmet } from "../components/Helmet";
import { Modal } from "../components/Modal";
import { PurchaseBurst } from "../components/PurchaseBurst";
import type { Look } from "../looks";
import { SLOTS, offers, useShop, useShopDriver, type Offer, type Slot } from "../shopModel";
import { ItemArt, PriceTag, ShopHeader } from "../components/ShopParts";

/** Everything for sale, as a grid. Tap one to see it on your helmet and buy it. */
export function ShopPage() {
  const { driver, local, ready } = useShopDriver();
  const { shop, refresh } = useShop(driver?.id ?? null);

  return (
    <>
      <ShopHeader title="Shop" coins={shop?.coins ?? null} />
      {ready && !driver && (
        <section className="card" style={{ alignItems: "center", textAlign: "center", padding: "40px 24px" }}>
          <h2>{local ? "Nobody is in the seat" : "Who are you?"}</h2>
          <p className="muted" style={{ margin: 0 }}>{local ? "Put a driver in the seat to shop with their coins." : "Pick yourself on your profile first. Coins belong to a driver."}</p>
          <a className="btn big" href="#/you">Profile</a>
        </section>
      )}
      {driver && shop && <Grid driver={driver} shop={shop} refresh={refresh} />}
      {driver && !shop && <div className="empty">Loading…</div>}
    </>
  );
}

function Grid({ driver, shop, refresh }: { driver: Driver; shop: ShopState; refresh: () => void }) {
  const all = useMemo(() => offers(shop), [shop]);
  const [filter, setFilter] = useState<Slot | "all">("all");
  const [open, setOpen] = useState<Offer | null>(null);
  const shown = all.filter((o) => filter === "all" || o.slot === filter);
  // The newest and dearest first within a tier makes the top of the shop the interesting part.
  const rank = { legendary: 0, epic: 1, rare: 2, common: 3 } as const;
  shown.sort((a, b) => rank[a.rarity] - rank[b.rarity] || b.price - a.price);

  return (
    <div className="shop">
      <a className="btn ghost shop-customize" href="#/customize">Customize your helmet</a>
      <nav className="garage-slots" aria-label="Categories">
        <button type="button" className="chip plain" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
        {SLOTS.map((s) => (
          <button key={s.slot} type="button" className="chip plain" aria-pressed={filter === s.slot} onClick={() => setFilter(s.slot)}>{s.label}</button>
        ))}
      </nav>
      <section className="shop-grid" aria-label="Items">
        {shown.map((o) => {
          const wearing = shop.look[o.slot] === o.id;
          return (
            <button key={`${o.slot}:${o.id}`} type="button" className="shop-card" data-wearing={wearing || undefined} data-locked={o.locked || undefined} onClick={() => setOpen(o)}>
              <span className="shop-tile">
                <ItemArt slot={o.slot} id={o.id} driver={driver} size={o.slot === "shell" ? 72 : 80} />
              </span>
              <span className="garage-tile-rarity" style={{ color: o.rarityColor }}>{o.rarity} · {o.slot}</span>
              <span className="shop-card-name">{o.name}</span>
              {wearing ? <span className="price own">Equipped</span> : <PriceTag offer={o} />}
            </button>
          );
        })}
      </section>
      {open && <ItemSheet key={`${open.slot}:${open.id}`} driver={driver} shop={shop} offer={all.find((o) => o.slot === open.slot && o.id === open.id) ?? open} onClose={() => setOpen(null)} onChanged={refresh} />}
    </div>
  );
}

/** Confirm a purchase: what it costs and what you will have left. Afterwards, put it on. */
function ItemSheet({ driver, shop, offer, onClose, onChanged }: { driver: Driver; shop: ShopState; offer: Offer; onClose: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Counts purchases made in this sheet: each one plays the burst (the key restarts it) and the "yours now" message.
  const [bought, setBought] = useState(0);
  const wearing = shop.look[offer.slot] === offer.id;
  const left = shop.coins - offer.price;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const equip = () => {
    const look: Look = { ...shop.look, [offer.slot]: offer.id };
    if (offer.slot === "decal" && !look.decalAt) look.decalAt = "side";
    return run(async () => {
      await api.setLook(driver.id, look);
      onClose();
    });
  };

  return (
    <Modal title={offer.name} narrow onClose={onClose}>
      <div className="modal-body" style={{ alignItems: "center", textAlign: "center", gap: 14 }}>
        <div className="burst-wrap" data-pop={bought > 0 || undefined} key={`pop-${bought}`}>
          <Helmet color={driver.color} look={{ ...shop.look, ...offer.preview }} size={120} seed={driver.id} mood={bought > 0 ? "happy" : "idle"} moment={bought > 0} />
          {bought > 0 && <PurchaseBurst key={bought} color={offer.rarityColor} />}
        </div>
        <div>
          <div className="garage-tile-rarity" style={{ color: offer.rarityColor }}>{offer.rarity} · {offer.slot}</div>
          <h2 style={{ margin: 0 }}>{offer.name}</h2>
        </div>
        {offer.owned ? (
          bought > 0 ? (
            <p className="sheet-won" role="status">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
              Yours now. Equip it to wear it.
            </p>
          ) : (
            <p className="muted" style={{ margin: 0 }}>{offer.free ? "Free for everyone." : "You own this."}</p>
          )
        ) : offer.locked ? (
          <p className="muted" style={{ margin: 0 }}>Reach level {offer.minLevel} to unlock it. You are level {shop.level}.</p>
        ) : (
          <div className="shop-sum">
            <div><span>Your coins</span><span>{shop.coins.toLocaleString()}</span></div>
            <div><span>{offer.name}</span><span style={{ color: "var(--red)" }}>−{offer.price.toLocaleString()}</span></div>
            <div className="total"><span>After</span><span style={{ color: left < 0 ? "var(--red)" : "var(--gold)" }}>{left.toLocaleString()}</span></div>
          </div>
        )}
        {error && <span className="error">{error}</span>}
      </div>
      <div className="modal-foot">
        <button className="btn ghost" onClick={onClose}>Close</button>
        {offer.owned ? (
          <button className="btn big" data-nudge={(bought > 0 && !wearing) || undefined} onClick={equip} disabled={busy || wearing}>{wearing ? "Equipped" : "Equip"}</button>
        ) : (
          <button className="btn big" disabled={busy || offer.locked || left < 0} onClick={() => run(async () => { await api.buy(driver.id, offer.slot, offer.id); setBought((n) => n + 1); })}>
            {left < 0 ? `Need ${(-left).toLocaleString()} more` : `Buy for ${offer.price.toLocaleString()}`}
          </button>
        )}
      </div>
    </Modal>
  );
}
