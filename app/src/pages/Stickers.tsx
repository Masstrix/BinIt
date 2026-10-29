import { useState } from "react";
import { api, useAppState, useFetch, type BookSticker, type DriverId, type StickerBook } from "../api";
import { Coin } from "../components/Coin";
import { Dropdown } from "../components/Dropdown";
import { Modal } from "../components/Modal";
import { RarityTag, StickerTile } from "../components/StickerTile";
import { RARITY, highlights, stickerState, stickerStatus } from "../stickers";

const MAX_PINNED = 3;

/** The Stickers section of a profile: how many, the ones the driver chose to show, the latest and the nearest. */
export function StickerHighlights({ driverId, color }: { driverId: DriverId; color: string }) {
  const book = useFetch<StickerBook>(() => api.stickerBook(driverId), [driverId]);
  if (!book) return null;
  const shown = highlights(book.stickers, book.pinned);
  const latest = book.stickers.filter((s) => s.earned).sort((a, b) => (b.earnedAt ?? 0) - (a.earnedAt ?? 0)).slice(0, 4);
  const close = book.stickers
    .filter((s) => !s.earned && s.detectable && !s.hidden && s.progress && s.progress.cur > 0)
    .sort((a, b) => b.progress!.cur / b.progress!.max - a.progress!.cur / a.progress!.max)
    .slice(0, 3);
  const hidden = book.stickers.filter((s) => s.hidden && !s.earned).length;
  const href = `#/you/${driverId}/stickers`;
  return (
    <section className="you-section" aria-label="Stickers">
      <div className="head">
        <h2>Stickers</h2>
        <a className="stk-link" href={href}>See all {book.total} ›</a>
      </div>

      <div className="stk-summary">
        <div className="stk-count">
          <span>{book.earned}<small> of {book.total} earned</small></span>
          {hidden > 0 && <span className="muted mono" style={{ fontSize: 12 }}>{hidden} hidden</span>}
        </div>
        <div className="you-bar" role="progressbar" aria-valuemin={0} aria-valuemax={book.total} aria-valuenow={book.earned} aria-label="Stickers earned">
          <div style={{ width: `${(book.earned / Math.max(1, book.total)) * 100}%`, background: color }} />
        </div>
      </div>

      {shown.length > 0 && (
        <div className="stk-block">
          <div className="stk-label"><span>{book.pinned.length ? "ON THEIR PROFILE" : "BEST SO FAR"}</span></div>
          <div className="stk-pinned">
            {shown.map((s) => (
              <a className="stk-card" href={href} key={s.id} style={{ borderTopColor: RARITY[s.rarity].color }}>
                <StickerTile sticker={s} size={72} />
                <span className="stk-card-name">{s.name}</span>
                <RarityTag sticker={s} />
              </a>
            ))}
          </div>
        </div>
      )}

      {latest.length > 0 && (
        <div className="stk-block">
          <div className="stk-label"><span>LATEST</span></div>
          <div className="stk-latest">
            {latest.map((s) => (
              <a className="stk-mini" href={href} key={s.id}>
                <StickerTile sticker={s} size={56} />
                <span className="stk-mini-name">{s.name}</span>
                <span className="stk-mini-sub">{stickerStatus(s).replace("Earned · ", "")}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {close.length > 0 && (
        <div className="stk-close">
          <div className="stk-label"><span>CLOSEST TO UNLOCKING</span></div>
          {close.map((s) => (
            <a className="stk-close-row" href={href} key={s.id}>
              <StickerTile sticker={s} size={44} />
              <span className="grow">
                <span className="stk-close-top"><b>{s.name}</b><span className="mono">{stickerStatus(s)}</span></span>
                <span className="you-bar sm"><span style={{ width: `${(s.progress!.cur / s.progress!.max) * 100}%`, background: RARITY[s.rarity].color }} /></span>
              </span>
            </a>
          ))}
        </div>
      )}

      {book.earned === 0 && <div className="empty">Stickers show up here as you hit things on the rig.</div>}
      <a className="stk-open" href={href}>Open sticker book ›</a>
    </section>
  );
}

type View = "all" | "earned" | "todo";

/** Every sticker for one driver, by group, with a sheet for each (and, for your own, a way to choose what the profile shows). */
export function StickerBookPage({ id }: { id: DriverId }) {
  const { drivers } = useAppState();
  const driver = drivers.find((d) => d.id === id);
  const info = useFetch(() => api.me(), [drivers]);
  const [tick, setTick] = useState(0);
  const book = useFetch<StickerBook>(() => api.stickerBook(id), [id, tick]);
  const [view, setView] = useState<View>("all");
  const [group, setGroup] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canPin = !!info && (info.driver?.id === id || info.local);

  const back = (
    <a href={`#/you/${id}`} className="back-link">← {driver?.name ?? "Profile"}</a>
  );
  if (!book) return <>{back}<div className="empty">Loading…</div></>;

  const hiddenLeft = book.stickers.filter((s) => s.hidden && !s.earned).length;
  const keep = (s: BookSticker) => (view === "all" || (view === "earned" ? s.earned : !s.earned)) && (group === "all" || s.group === group);
  const sections = book.groups
    .map((g) => {
      const mine = book.stickers.filter((s) => s.group === g.id);
      return { g, mine, items: mine.filter(keep) };
    })
    .filter((x) => x.items.length > 0);
  const current = book.stickers.find((s) => s.id === open) ?? null;

  async function pin(ids: string[]) {
    setBusy(true);
    setError(null);
    try {
      await api.pinStickers(id, ids);
      setTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {back}
      <header className="stk-head">
        <h1>Sticker book</h1>
        <div className="stk-summary">
          <div className="stk-count">
            <span>{book.earned}<small> of {book.total}</small></span>
            <span className="muted mono" style={{ fontSize: 12 }}>
              {hiddenLeft} still hidden · {book.pinned.length} of {MAX_PINNED} on the profile
            </span>
          </div>
          <div className="you-bar" role="progressbar" aria-valuemin={0} aria-valuemax={book.total} aria-valuenow={book.earned} aria-label="Stickers earned">
            <div style={{ width: `${(book.earned / Math.max(1, book.total)) * 100}%`, background: driver?.color ?? "var(--peach)" }} />
          </div>
        </div>
      </header>

      <div className="stk-filters">
        <Dropdown
          label="Show"
          variant="pill"
          value={view}
          onChange={setView}
          options={[
            { value: "all", label: "All stickers", hint: `${book.total}` },
            { value: "earned", label: "Earned", hint: `${book.earned}` },
            { value: "todo", label: "To do", hint: `${book.total - book.earned}` },
          ]}
        />
        <Dropdown
          label="Group"
          variant="pill"
          value={group}
          onChange={setGroup}
          options={[
            { value: "all", label: "All groups", hint: `${book.total}` },
            ...book.groups.map((g) => ({ value: g.id, label: g.name, hint: `${book.stickers.filter((s) => s.group === g.id && s.earned).length} of ${book.stickers.filter((s) => s.group === g.id).length}` })),
          ]}
        />
      </div>

      {sections.length === 0 && <div className="empty">Nothing here yet. Try another group.</div>}
      {sections.map(({ g, mine, items }) => (
        <section className="stk-group" key={g.id} aria-label={g.name}>
          <div className="head">
            <h2>{g.name}</h2>
            <span className="muted" style={{ fontSize: 13 }}>{mine.filter((s) => s.earned).length} of {mine.length}</span>
          </div>
          <div className="stk-grid">
            {items.map((s) => {
              const state = stickerState(s);
              return (
                <button type="button" className="stk-cell" data-state={state} key={s.id} onClick={() => { setError(null); setOpen(s.id); }} aria-label={`${s.name}, ${stickerStatus(s)}`}>
                  {book.pinned.includes(s.id) && <span className="stk-pin" aria-label="On the profile">★</span>}
                  <StickerTile sticker={s} size={64} />
                  <span className="stk-cell-name">{s.name}</span>
                  {state === "progress" && s.progress && (
                    <span className="you-bar sm"><span style={{ width: `${(s.progress.cur / s.progress.max) * 100}%`, background: RARITY[s.rarity].color }} /></span>
                  )}
                  {state === "earned" && <span className="stk-cell-sub">{stickerStatus(s).replace("Earned · ", "")}</span>}
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {current && (
        <Modal title={current.name} narrow onClose={() => setOpen(null)}>
          <div className="stk-sheet" style={{ borderTopColor: RARITY[current.rarity].color }}>
            <StickerTile sticker={current} size={104} />
            <RarityTag sticker={current} />
            <p className="stk-sheet-how">{current.how}</p>
            {current.progress && !current.earned && (
              <div className="stk-sheet-progress">
                <span className="you-bar"><span style={{ width: `${(current.progress.cur / current.progress.max) * 100}%`, background: RARITY[current.rarity].color }} /></span>
              </div>
            )}
            <span className="stk-sheet-status" data-state={stickerState(current)}>{stickerStatus(current).toUpperCase()}</span>
            {!current.detectable && !current.earned && <p className="muted" style={{ margin: 0, fontSize: 13 }}>We can't tell when you do this yet. It will start counting in a later update.</p>}
            <div className="stk-rewards">
              <span className="stk-reward gold"><Coin size={16} />+{current.coins}</span>
              <span className="stk-reward">+{current.xp} XP</span>
              {current.item && <span className="stk-reward item">{current.item.replace(":", " · ")}</span>}
            </div>
            {canPin && current.earned && (() => {
              const on = book.pinned.includes(current.id);
              const full = !on && book.pinned.length >= MAX_PINNED;
              return (
                <button type="button" className="btn big" disabled={busy || full} data-off={on || undefined} onClick={() => pin(on ? book.pinned.filter((x) => x !== current.id) : [...book.pinned, current.id])}>
                  {on ? "Remove from profile" : full ? "Profile is full: remove one first" : "Show on profile"}
                </button>
              );
            })()}
            {error && <p role="alert" style={{ margin: 0, color: "var(--red)", fontSize: 14 }}>{error}</p>}
            <button type="button" className="btn ghost" onClick={() => setOpen(null)}>Close</button>
          </div>
        </Modal>
      )}
    </>
  );
}
