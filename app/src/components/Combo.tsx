import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface ComboOption {
  /** What fills the field when it is picked. */
  value: string;
  /** Small text beside it (a length, a group). */
  hint?: string;
  /** Marks a likely choice: shown first, with this word beside it. */
  badge?: string;
}

/** Lower case, accents taken off. */
const plain = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * A text field with a list to pick from: type to narrow the list, pick one to fill the field, or just type a
 * name that isn't in it. Used by the dev tools to name things from the known lists.
 */
export function Combo({
  label,
  value,
  onChange,
  options,
  placeholder,
  note,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  note?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  // Everything matches an empty field; otherwise the words typed must all appear in the option, whatever the
  // case and accents ("skoda" finds "ŠKODA Fabia R5").
  const shown = useMemo(() => {
    const words = plain(value).split(/\s+/).filter(Boolean);
    const hit = options.filter((o) => {
      const text = plain(`${o.value} ${o.hint ?? ""}`);
      return words.every((w) => text.includes(w));
    });
    // Likely choices first (in the order given), then the rest as given.
    return [...hit.filter((o) => o.badge), ...hit.filter((o) => !o.badge)].slice(0, 60);
  }, [options, value]);

  useEffect(() => setActive(0), [value]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const pick = (o: ComboOption) => {
    onChange(o.value);
    setOpen(false);
  };

  return (
    <div className="field" ref={box} style={{ position: "relative" }}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, shown.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && shown[active]) {
            e.preventDefault();
            pick(shown[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {note && <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>{note}</span>}
      {open && shown.length > 0 && (
        <ul
          id={`${id}-list`}
          role="listbox"
          style={{
            position: "absolute",
            zIndex: 20,
            left: 0,
            right: 0,
            top: "calc(100% + 4px)",
            maxHeight: 280,
            overflowY: "auto",
            margin: 0,
            padding: 4,
            listStyle: "none",
            borderRadius: 14,
            background: "var(--panel-2)",
            border: "1px solid var(--line)",
            boxShadow: "0 18px 40px rgba(4,6,16,0.5)",
          }}
        >
          {shown.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={i === active}
              onPointerDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              onPointerEnter={() => setActive(i)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                borderRadius: 10,
                cursor: "pointer",
                fontWeight: 600,
                background: i === active ? "rgba(106,88,245,0.28)" : undefined,
              }}
            >
              <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{o.value}</span>
              {o.badge && <span className="chip pb">{o.badge}</span>}
              {o.hint && <span className="muted mono" style={{ fontSize: 12, fontWeight: 400 }}>{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
