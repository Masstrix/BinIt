import { useMemo, useState } from "react";
import { api, type Driver, type ShopState } from "../api";
import { Helmet } from "../components/Helmet";
import { ItemArt, MoreInShop, ShopHeader } from "../components/ShopParts";
import { DECAL_COLOURS, type Look } from "../looks";
import { offers, useShop, useShopDriver, type Offer, type Slot } from "../shopModel";
import { PALETTE } from "./Drivers";

/** Your helmet: only what you own. Buying happens in the Shop. */
export function CustomizePage() {
  const { driver, local, ready } = useShopDriver();
  const { shop, refresh } = useShop(driver?.id ?? null);

  return (
    <>
      <ShopHeader title="Customize" coins={shop?.coins ?? null} coinHref="#/shop" />
      {ready && !driver && (
        <section className="card" style={{ alignItems: "center", textAlign: "center", padding: "40px 24px" }}>
          <h2>{local ? "Nobody is in the seat" : "Who are you?"}</h2>
          <p className="muted" style={{ margin: 0 }}>{local ? "Put a driver in the seat to dress their helmet." : "Pick yourself on your profile first, then come back to dress your helmet."}</p>
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
  const [draft, setDraft] = useState<Look | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const look = draft ?? shop.look;
  const shownColor = color ?? driver.color;
  const shownName = name ?? driver.name;

  const mine = (slot: Slot) => all.filter((o) => o.slot === slot && o.owned);
  const unowned = (slot: Slot) => all.filter((o) => o.slot === slot && !o.owned).length;
  const set = (patch: Partial<Look>) => {
    setError(null);
    setDraft({ ...look, ...patch });
  };
  const toggle = (o: Offer) => set(o.slot === "shell" ? { shell: look.shell === o.id ? undefined : o.id } : { [o.slot]: look[o.slot] === o.id ? undefined : o.id });

  const clean = (l: Look): Look => ({
    ...(l.shell ? { shell: l.shell } : {}),
    ...(l.decal ? { decal: l.decal, decalAt: l.decalAt ?? "side", ...(l.decalColor && l.decalColor !== "#FFFFFF" ? { decalColor: l.decalColor } : {}) } : {}),
    ...(l.stripe ? { stripe: l.stripe } : {}),
    ...(l.face ? { face: l.face } : {}),
    ...(l.number != null ? { number: l.number } : {}),
  });
  const changed = (draft != null && JSON.stringify(clean(draft)) !== JSON.stringify(clean(shop.look))) || (color != null && color !== driver.color) || (name != null && name.trim() !== driver.name);
  const nameOk = shownName.trim().length > 0;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if ((color != null && color !== driver.color) || (name != null && name.trim() !== driver.name)) {
        await api.updateDriver(driver.id, shownName.trim(), shownColor);
      }
      await api.setLook(driver.id, clean(look));
      setDraft(null);
      setColor(null);
      setName(null);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    setDraft(null);
    setColor(null);
    setName(null);
    setError(null);
  };

  const number = look.number;
  const previewLook: Look = look;
  return (
    <div className="garage">
      <section className="card garage-preview" aria-label="Preview">
        <div className="garage-stage">
          {changed && <span className="chip garage-trying">Not saved</span>}
          <Helmet color={shownColor} look={previewLook} size={168} seed={driver.id} mood="idle" />
        </div>
        <div className="garage-name">
          <span>{shownName.trim() || driver.name}</span>
          {number != null && <span className="garage-num">#{number}</span>}
        </div>
        <span className="muted" style={{ fontSize: 13 }}>Shown on the leaderboard, the overlay and your phone</span>
      </section>

      <div className="garage-main">
        <section className="garage-section" aria-label="Name">
          <div className="garage-section-head"><h2>Name</h2></div>
          <input className="input" aria-label="Name" value={shownName} maxLength={32} onChange={(e) => { setName(e.target.value); setError(null); }} style={{ minHeight: 52, fontSize: 18, fontWeight: 700 }} />
        </section>

        <section className="garage-section" aria-label="Shell">
          <div className="garage-section-head"><h2>Shell</h2><MoreInShop count={unowned("shell")} /></div>
          <div className="garage-colours" role="group" aria-label="Solid colours">
            {PALETTE.map(([hex, name]) => (
              <button key={hex} type="button" aria-label={name} aria-pressed={!look.shell && shownColor === hex} onClick={() => { setColor(hex); set({ shell: undefined }); }} className="garage-dot" style={{ background: hex }} />
            ))}
          </div>
          {mine("shell").length > 0 && (
            <div className="garage-grid4">
              {mine("shell").map((o) => (
                <button key={o.id} type="button" className="garage-pick" aria-pressed={look.shell === o.id} onClick={() => toggle(o)}>
                  <ItemArt slot="shell" id={o.id} driver={driver} size={64} />
                  <span>{o.name}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="garage-section" aria-label="Decal">
          <div className="garage-section-head"><h2>Decal</h2><MoreInShop count={unowned("decal")} /></div>
          <div className="garage-grid5">
            <button type="button" className="garage-pick" aria-pressed={!look.decal} onClick={() => set({ decal: undefined })}>
              <ItemArt slot="decal" id={null} driver={driver} size={54} />
              <span>None</span>
            </button>
            {mine("decal").map((o) => (
              <button key={o.id} type="button" className="garage-pick" aria-pressed={look.decal === o.id} onClick={() => set({ decal: o.id, decalAt: look.decalAt ?? "side" })}>
                <ItemArt slot="decal" id={o.id} driver={driver} size={54} />
                <span>{o.name}</span>
              </button>
            ))}
          </div>
          {look.decal && (
            <div className="garage-colours" role="group" aria-label="Decal colour">
              {DECAL_COLOURS.map(([hex, name]) => (
                <button key={hex} type="button" aria-label={`${name} decal`} aria-pressed={(look.decalColor ?? "#FFFFFF").toUpperCase() === hex} onClick={() => set({ decalColor: hex })} className="garage-dot" style={{ background: hex }} />
              ))}
            </div>
          )}
          {look.decal && (
            <div className="garage-row" aria-label="Placement">
              <span className="grow">Placement</span>
              <div className="seg" role="group" aria-label="Placement">
                {(["side", "top", "chin"] as const).map((at) => (
                  <button key={at} type="button" aria-pressed={(look.decalAt ?? "side") === at} onClick={() => set({ decalAt: at })}>
                    {at[0].toUpperCase() + at.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="garage-section" aria-label="Stripe">
          <div className="garage-section-head"><h2>Stripe</h2><MoreInShop count={unowned("stripe")} /></div>
          <div className="garage-grid5">
            <button type="button" className="garage-pick" aria-pressed={!look.stripe} onClick={() => set({ stripe: undefined })}>
              <ItemArt slot="stripe" id={null} driver={{ ...driver, color: shownColor }} size={54} />
              <span>None</span>
            </button>
            {mine("stripe").map((o) => (
              <button key={o.id} type="button" className="garage-pick" aria-pressed={look.stripe === o.id} onClick={() => toggle(o)}>
                <ItemArt slot="stripe" id={o.id} driver={{ ...driver, color: shownColor }} size={54} />
                <span>{o.name}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="garage-section" aria-label="Default eyes">
          <div className="garage-section-head"><h2>Default eyes</h2><MoreInShop count={unowned("face")} /></div>
          <div className="garage-grid5">
            {mine("face").map((o) => (
              <button key={o.id} type="button" className="garage-pick" aria-pressed={(look.face ?? "chill") === o.id} onClick={() => set({ face: o.id === "chill" ? undefined : o.id })}>
                <ItemArt slot="face" id={o.id} driver={{ ...driver, color: shownColor }} size={54} />
                <span>{o.name}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="card garage-row" aria-label="Race number">
          <span className="grow">
            <b>Race number</b>
            <span className="muted" style={{ display: "block", fontSize: 13 }}>1 to 99, shown on your helmet</span>
          </span>
          <button className="btn ghost step" aria-label="Lower number" onClick={() => set({ number: Math.max(1, (number ?? 2) - 1) })}>−</button>
          <span className="garage-numval">{number ?? "–"}</span>
          <button className="btn ghost step" aria-label="Raise number" onClick={() => set({ number: Math.min(99, (number ?? 0) + 1) })}>+</button>
          {number != null && <button className="btn ghost" onClick={() => set({ number: undefined })}>None</button>}
        </section>
        {error && <p className="error" role="alert">{error}</p>}
      </div>

      <footer className="garage-bar">
        <span className="grow garage-total muted">{changed ? "Unsaved changes" : "Looking good"}</span>
        <button className="btn ghost" disabled={!changed || busy} onClick={reset}>Reset</button>
        <button className="btn big" disabled={!changed || busy || !nameOk} onClick={save}>Save kit</button>
      </footer>
    </div>
  );
}
