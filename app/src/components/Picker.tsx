import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Modal } from "./Modal";

export interface PickerItem {
  value: string;
  label: string;
  /** Second line under the label. */
  sub?: string;
  /** Shown small, e.g. "Not driven yet". */
  note?: string;
  /** Extra words that should match the search (aliases, brand, country). */
  search?: string;
  /** Filter chip this item belongs to (class, country...). */
  tag?: string;
  /** Section header; items should already be sorted by it. */
  group?: string;
  /** The name on a card when the section header already says part of it (the trigger keeps the full label). */
  cardLabel?: string;
  /** Thumbnail: a track map, a badge... */
  visual?: ReactNode;
}

/** Lowercase letters and digits only, accents folded: "Nürburgring" matches "nurburg". */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Every word of the query must appear somewhere in the item's text. */
export function matches(item: PickerItem, query: string): boolean {
  const words = query.split(/\s+/).map(fold).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fold([item.label, item.sub, item.search, item.tag].filter(Boolean).join(" "));
  return words.every((w) => hay.includes(w));
}

/**
 * Searchable replacement for a long <select>: a trigger that opens a dialog with a search
 * box, filter chips and a grid of cards. `pill` is for filter bars, `field` for forms.
 */
export function Picker({
  label,
  title,
  value,
  items,
  onChange,
  anyLabel,
  variant = "field",
  tagLabel,
  visualOf,
}: {
  label: string;
  /** Dialog heading; defaults to "Choose <label>". */
  title?: string;
  value: string;
  items: PickerItem[];
  onChange: (value: string) => void;
  /** Adds a first option with value "" (e.g. "Any car"). */
  anyLabel?: string;
  variant?: "pill" | "field";
  /** Name for the filter chip row, e.g. "Class". */
  tagLabel?: string;
  /** Thumbnail for the selected value (and the "any" option) on the trigger. */
  visualOf?: (value: string) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const all = useMemo(() => (anyLabel ? [{ value: "", label: anyLabel }, ...items] : items), [items, anyLabel]);
  const selected = all.find((i) => i.value === value);

  return (
    <div className={`dropdown ${variant}`}>
      {variant === "field" && <span className="dropdown-label">{label}</span>}
      <button
        ref={button}
        type="button"
        className="dropdown-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={variant === "pill" ? `${label}: ${selected?.label ?? ""}` : undefined}
        onClick={() => setOpen(true)}
      >
        {visualOf && <span className="picker-thumb sm">{visualOf(value)}</span>}
        <span className="dropdown-value" style={{ flex: 1 }}>{selected?.label ?? "Choose…"}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" style={{ flex: "none" }}>
          <circle cx="11" cy="11" r="6" />
          <path d="M16 16l4 4" />
        </svg>
      </button>
      {open && (
        <Modal title={title ?? `Choose ${label.toLowerCase()}`} onClose={() => { setOpen(false); button.current?.focus(); }}>
          <PickerBody
            items={all}
            value={value}
            tagLabel={tagLabel}
            onPick={(v) => {
              onChange(v);
              setOpen(false);
              button.current?.focus();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function PickerBody({ items, value, tagLabel, onPick }: { items: PickerItem[]; value: string; tagLabel?: string; onPick: (v: string) => void }) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The dialog opens after this mounts, so autoFocus would run too early.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  const tags = useMemo(() => [...new Set(items.map((i) => i.tag).filter((t): t is string => !!t))].sort(), [items]);
  const shown = useMemo(() => items.filter((i) => (!tag || i.tag === tag || i.value === "") && matches(i, query)), [items, query, tag]);

  // Start on the current pick; follow the top result while typing.
  useEffect(() => {
    setActive(query || tag ? 0 : Math.max(0, shown.findIndex((i) => i.value === value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, tag]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, shown]);

  const onKeyDown = (e: KeyboardEvent) => {
    // Left and right keep moving the text cursor while typing in the search box.
    const typing = e.target instanceof HTMLInputElement;
    if (e.key === "ArrowDown" || (e.key === "ArrowRight" && !typing)) setActive((a) => Math.min(shown.length - 1, a + 1));
    else if (e.key === "ArrowUp" || (e.key === "ArrowLeft" && !typing)) setActive((a) => Math.max(0, a - 1));
    else if (e.key === "Enter") {
      if (shown[active]) onPick(shown[active].value);
    } else return;
    e.preventDefault();
  };

  return (
    <div className="picker" onKeyDown={onKeyDown}>
      <div className="picker-top">
        <input
          className="input"
          type="search"
          ref={inputRef}
          data-autofocus
          inputMode="search"
          enterKeyHint="go"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          aria-label="Search"
          aria-controls={listId}
          autoComplete="off"
          spellCheck={false}
        />
        {tags.length > 1 && (
          <div className="picker-chips" role="group" aria-label={tagLabel ?? "Filter"}>
            <button type="button" className="filter-pill" aria-pressed={tag === null} onClick={() => setTag(null)}>All</button>
            {tags.map((t) => (
              <button key={t} type="button" className="filter-pill" aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)}>{t}</button>
            ))}
          </div>
        )}
      </div>
      <div className="picker-scroll" ref={listRef}>
        {shown.length === 0 ? (
          <div className="empty">Nothing matches “{query}”.</div>
        ) : (
          <div id={listId} role="listbox" aria-label="Results" className="picker-grid">
            {shown.map((item, i) => (
              <div key={item.value} style={{ display: "contents" }}>
                {item.group && item.group !== shown[i - 1]?.group && <div className="picker-group">{item.group}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={item.value === value}
                  data-active={i === active}
                  className="picker-card"
                  onMouseMove={() => active !== i && setActive(i)}
                  onClick={() => onPick(item.value)}
                >
                  {item.visual !== undefined && <span className="picker-thumb">{item.visual}</span>}
                  <span className="picker-text">
                    <span className="picker-name">{item.cardLabel ?? item.label}</span>
                    {item.sub && <span className="muted picker-sub">{item.sub}</span>}
                    {item.note && <span className="picker-note">{item.note}</span>}
                  </span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
