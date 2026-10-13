import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
  /** Drawn before the label, in the menu and on the button (a game's badge, for example). */
  icon?: ReactNode;
}

/**
 * Themed replacement for <select>: native pickers render as white OS menus that
 * don't match the app. `pill` is for filter bars, `field` for forms.
 */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  label,
  variant = "field",
}: {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  /** Accessible name; also shown above `field` dropdowns. */
  label: string;
  variant?: "pill" | "field";
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [upward, setUpward] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const openMenu = () => {
    const rect = button.current?.getBoundingClientRect();
    setUpward(!!rect && rect.bottom + 320 > window.innerHeight && rect.top > 320);
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  const choose = (v: T) => {
    onChange(v);
    setOpen(false);
    button.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "Escape" || e.key === "Tab") setOpen(false);
    else if (e.key === "ArrowDown") setActive((a) => Math.min(options.length - 1, a + 1));
    else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
    else if (e.key === "Enter" || e.key === " ") choose(options[active].value);
    else return;
    e.preventDefault();
  };

  return (
    <div ref={root} className={`dropdown ${variant}`}>
      {variant === "field" && <span className="dropdown-label">{label}</span>}
      <button
        ref={button}
        type="button"
        className="dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={variant === "pill" ? `${label}: ${selected?.label ?? ""}` : undefined}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className="dropdown-value">
          {selected?.icon}
          <span className="dropdown-value-text">{selected?.label ?? "Choose…"}</span>
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .15s", flex: "none" }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul id={listId} role="listbox" aria-label={label} className={`dropdown-menu${upward ? " up" : ""}`}>
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={i === active ? "active" : undefined}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o.value)}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                {o.icon}
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span className="dropdown-option">{o.label}</span>
                  {o.hint && <span className="muted" style={{ fontSize: 12 }}>{o.hint}</span>}
                </span>
              </span>
              {o.value === value && (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--peri-1)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}>
                  <path d="M5 12l5 5 9-10" />
                </svg>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
