import { useState } from "react";
import { Dropdown } from "./Dropdown";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const QUICK_TIMES: [number, number][] = [
  [12, 0],
  [13, 0],
  [17, 0],
  [18, 0],
];

const pad = (n: number) => String(n).padStart(2, "0");
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Month calendar plus a time row; days before today can't be picked. `value` is epoch ms. */
export function DateTimePicker({ value, onChange }: { value: number; onChange: (ms: number) => void }) {
  const picked = new Date(value);
  const [month, setMonth] = useState(() => new Date(picked.getFullYear(), picked.getMonth(), 1));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  // Six Monday-first weeks covering the shown month.
  const first = new Date(month);
  first.setDate(1 - ((month.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i));

  const set = (patch: { day?: Date; h?: number; m?: number }) => {
    const n = new Date(patch.day ?? picked);
    n.setHours(patch.h ?? picked.getHours(), patch.m ?? picked.getMinutes(), 0, 0);
    onChange(n.getTime());
  };
  const shiftMonth = (by: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + by, 1));

  const minutes = [0, 15, 30, 45];
  if (!minutes.includes(picked.getMinutes())) minutes.push(picked.getMinutes());
  minutes.sort((a, b) => a - b);

  return (
    <div className="dtp">
      <div className="cal">
        <div className="cal-head">
          <button type="button" className="icon-btn" aria-label="Previous month" disabled={month <= thisMonth} onClick={() => shiftMonth(-1)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
          </button>
          <span className="cal-title" aria-live="polite">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
          <button type="button" className="icon-btn" aria-label="Next month" onClick={() => shiftMonth(1)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        </div>
        <div className="cal-grid" role="group" aria-label="Day">
          {WEEKDAYS.map((w) => (
            <span key={w} className="cal-wd" aria-hidden="true">{w}</span>
          ))}
          {days.map((d) => {
            const outside = d.getMonth() !== month.getMonth();
            return (
              <button
                key={d.getTime()}
                type="button"
                className={`cal-day${outside ? " outside" : ""}${sameDay(d, today) ? " today" : ""}`}
                aria-pressed={sameDay(d, picked)}
                aria-label={d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
                disabled={d < today}
                onClick={() => {
                  set({ day: d });
                  if (outside) setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
                }}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
      </div>

      <div className="dtp-time">
        <span style={{ fontWeight: 600 }}>Time</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Dropdown
            variant="pill"
            label="Hour"
            value={pad(picked.getHours())}
            options={Array.from({ length: 24 }, (_, h) => ({ value: pad(h), label: pad(h) }))}
            onChange={(v) => set({ h: Number(v) })}
          />
          <span className="mono" aria-hidden="true">:</span>
          <Dropdown
            variant="pill"
            label="Minute"
            value={pad(picked.getMinutes())}
            options={minutes.map((m) => ({ value: pad(m), label: pad(m) }))}
            onChange={(v) => set({ m: Number(v) })}
          />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {QUICK_TIMES.map(([h, m]) => (
            <button
              key={h}
              type="button"
              className="filter-pill"
              aria-pressed={picked.getHours() === h && picked.getMinutes() === m}
              onClick={() => set({ h, m })}
            >
              {pad(h)}:{pad(m)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
