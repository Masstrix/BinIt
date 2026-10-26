import { useEffect, useMemo, useState } from "react";
import { api, type Driver, type ShopState } from "../api";
import { Coin } from "../components/Coin";
import { Helmet } from "../components/Helmet";
import type { Look } from "../looks";
import { SLOTS, offers, useShop, useShopDriver, type Offer, type Slot } from "../shopModel";

/** The Shop puts "try on" here by leaving the item's key for the Garage to pick up. */
export const TRY_KEY = "garage-try";

/** A price tag on a tile: the coin and a number, "Own", or the level that unlocks it. */
export function PriceTag({ offer }: { offer: Offer }) {
  if (offer.free || offer.owned) return <span className="price own">{offer.free ? "Free" : "Own"}</span>;
  if (offer.locked) return <span className="price lock">Level {offer.minLevel}</span>;
  return (
    <span className="price" data-poor={!offer.affordable || undefined} style={{ color: offer.affordable ? undefined : "var(--red)" }}>
      <Coin size={16} dim={!offer.affordable} />
      {offer.price.toLocaleString()}
    </span>
  );
}

/** Your helmet, a slot at a time. Anything in the shop can be tried on for free; Buy and equip pays for what is new. */
export function GaragePage() {
  const { driver, local, ready } = useShopDriver();
  const { shop, refresh } = useShop(driver?.id ?? null);

  return (
    <>
      {ready && !driver && (
        <section className="card" style={{ alignItems: "center", textAlign: "center", padding: "40px 24px" }}>
          <h2>{local ? "Nobody is in the seat" : "Who are you?"}</h2>
          <p className="muted" style={{ margin: 0 }}>{local ? "Put a driver in the seat to open their Garage." : "Pick yourself on your profile first, then come back to dress your helmet."}</p>
          <a className="btn big" href="#/you">Profile</a>
        </section>
      )}
      {driver && shop && <Workbench driver={driver} shop={shop} refresh={refresh} />}
      {driver && !shop && <div className="empty">Loading…</div>}
    </>
  );
}

function Workbench({ driver, shop, refresh }: { driver: Driver; shop: ShopState; refresh: () => void }) {
  const all = useMemo(() => offers(shop), [shop]);
  const [slot, setSlot] = useState<Slot>("shell");
  const [draft, setDraft] = useState<Look | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const look = draft ?? shop.look;

  // Arrive from the Shop's "Try on".
  useEffect(() => {
    let tried: string | null = null;
    try {
      tried = sessionStorage.getItem(TRY_KEY);
      sessionStorage.removeItem(TRY_KEY);
    } catch {
      /* private mode: no try-on hand-over */
    }
    const [s, id] = (tried ?? "").split(":");
    const offer = all.find((o) => o.slot === s && o.id === id);
    if (offer && !offer.locked) {
      setSlot(offer.slot);
      setDraft({ ...shop.look, [offer.slot]: offer.id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wearing = (o: Offer) => look[o.slot] === o.id;
  const pick = (o: Offer) => {
    if (o.locked) return;
    setError(null);
    const next: Look = { ...look, [o.slot]: wearing(o) ? undefined : o.id };
    if (o.slot === "decal" && next.decal && !next.decalAt) next.decalAt = "side";
    setDraft(next);
  };

  const unowned = all.filter((o) => wearing(o) && !o.owned);
  const cost = unowned.reduce((n, o) => n + o.price, 0);
  const short = cost - shop.coins;
  const changed = draft != null && JSON.stringify(clean(draft)) !== JSON.stringify(clean(shop.look));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const o of unowned) await api.buy(driver.id, o.slot, o.id);
      await api.setLook(driver.id, clean(look));
      setDraft(null);
      refresh();
    } catch (e) {
      setError((e as Error).message);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const items = all.filter((o) => o.slot === slot);
  const number = look.number;
  return (
    <div className="garage">
      <section className="card garage-preview" aria-label="Preview">
        <div className="garage-stage">
          {draft && <span className="chip garage-trying">Trying on</span>}
          <span className="garage-coins"><Coin size={20} title="Coins" />{shop.coins.toLocaleString()}</span>
          <Helmet color={driver.color} look={look} size={168} seed={driver.id} mood="happy" />
        </div>
        <div className="garage-name">
          <span>{driver.name}</span>
          {number != null && <span className="garage-num">#{number}</span>}
        </div>
        <div className="garage-chips">
          {SLOTS.map((s) => {
            const id = look[s.slot];
            const o = all.find((x) => x.slot === s.slot && x.id === id);
            return o ? (
              <span key={s.slot} className="chip" style={{ background: "var(--panel)", color: o.rarityColor }}>
                {o.rarity.toUpperCase()} {s.title.toUpperCase()}
              </span>
            ) : null;
          })}
        </div>
      </section>

      <div className="garage-main">
        <nav className="garage-slots" aria-label="Slots">
          {SLOTS.map((s) => (
            <button key={s.slot} type="button" className="chip plain" aria-pressed={slot === s.slot} onClick={() => setSlot(s.slot)}>
              {s.label}
            </button>
          ))}
          <a className="chip plain" href="#/shop">Shop</a>
        </nav>

        <section className="garage-grid" aria-label={SLOTS.find((s) => s.slot === slot)!.label}>
          {items.map((o) => (
            <button key={o.id} type="button" className="garage-tile" aria-pressed={wearing(o)} data-locked={o.locked || undefined} disabled={o.locked} onClick={() => pick(o)} title={o.locked ? `Needs level ${o.minLevel}` : o.name}>
              <span className="garage-swatch">
                <Helmet color={driver.color} look={o.preview} size={52} tile={false} seed={driver.id} />
              </span>
              <span className="garage-tile-name">{o.name}</span>
              <span className="garage-tile-rarity" style={{ color: o.rarityColor }}>{o.rarity}</span>
              <PriceTag offer={o} />
            </button>
          ))}
        </section>

        {slot === "decal" && (
          <section className="card garage-row" aria-label="Placement">
            <span className="grow">Placement</span>
            <div className="seg" role="group" aria-label="Placement">
              {(["side", "top", "chin"] as const).map((at) => (
                <button key={at} type="button" aria-pressed={(look.decalAt ?? "side") === at} disabled={!look.decal} onClick={() => setDraft({ ...look, decalAt: at })}>
                  {at[0].toUpperCase() + at.slice(1)}
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="card garage-row" aria-label="Race number">
          <span className="grow">
            <b>Race number</b>
            <span className="muted" style={{ display: "block", fontSize: 13 }}>1 to 99, free</span>
          </span>
          <button className="btn ghost step" aria-label="Lower number" onClick={() => setDraft({ ...look, number: Math.max(1, (number ?? 2) - 1) })}>−</button>
          <span className="garage-numval">{number ?? "–"}</span>
          <button className="btn ghost step" aria-label="Raise number" onClick={() => setDraft({ ...look, number: Math.min(99, (number ?? 0) + 1) })}>+</button>
          {number != null && <button className="btn ghost" onClick={() => setDraft({ ...look, number: undefined })}>None</button>}
        </section>
        {error && <p className="error" role="alert">{error}</p>}
      </div>

      <footer className="garage-bar">
        <span className="grow garage-total">
          {unowned.length > 0 ? (
            <>
              {unowned.map((o) => o.name).join(" + ")} <span className="muted">({unowned.length} new)</span>
              <span className="price" style={{ marginLeft: 8, color: short > 0 ? "var(--red)" : undefined }}><Coin size={16} dim={short > 0} />{cost.toLocaleString()}</span>
            </>
          ) : (
            <span className="muted">{changed ? "Everything here is yours" : "Tap items to try them on"}</span>
          )}
        </span>
        <button className="btn ghost" disabled={!draft || busy} onClick={() => { setDraft(null); setError(null); }}>Reset</button>
        <button className="btn big" disabled={!changed || busy || short > 0} onClick={save}>
          {short > 0 ? `Need ${short.toLocaleString()} more` : unowned.length > 0 ? "Buy and equip" : "Equip"}
        </button>
      </footer>
    </div>
  );
}

/** A look without the keys that are empty, so two looks compare by what they wear. */
function clean(look: Look): Look {
  const out: Look = {};
  if (look.shell) out.shell = look.shell;
  if (look.decal) {
    out.decal = look.decal;
    out.decalAt = look.decalAt ?? "side";
  }
  if (look.stripe) out.stripe = look.stripe;
  if (look.number != null) out.number = look.number;
  return out;
}
