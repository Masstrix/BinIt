import { useState, type ReactNode } from "react";
import { api, isTauri, useAppState, type Driver } from "../api";
import { Helmet } from "./Helmet";
import { Modal } from "./Modal";

/**
 * Puts a driver in the seat. In the desktop app (and the in-game switcher) that is one step, as it
 * always was. From a phone or any other browser it asks first, so nobody changes who is driving by
 * accident while they're just looking at the standings. Render `dialog` once next to the buttons.
 */
export function useSeatSwitcher(): { choose: (driver: Driver | null) => void; dialog: ReactNode } {
  const { status, drivers } = useAppState();
  const [pending, setPending] = useState<{ driver: Driver | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const current = status?.seat != null ? drivers.find((d) => d.id === status.seat) : undefined;
  // A lap is in progress: swapping now voids it.
  const onTrack = !!(status?.live && (status.live.phase === "driving" || status.live.phase === "paused") && !status.live.outLap);

  const choose = (driver: Driver | null) => {
    if ((driver?.id ?? null) === (status?.seat ?? null)) return;
    if (isTauri) api.setSeat(driver?.id ?? null).catch(() => {});
    else setPending({ driver });
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await api.setSeat(pending.driver?.id ?? null);
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const target = pending?.driver ?? null;
  const dialog = pending && (
    <Modal title={target ? `Switch to ${target.name}?` : "Switch to a guest?"} onClose={() => !busy && setPending(null)} centered>
      <div className="modal-body switch-body">
        <div className="switch-people" aria-hidden="true">
          <Person name={current?.name ?? "Guest"} color={current?.color} faded />
          <svg className="switch-arrow" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
          <Person name={target?.name ?? "Guest"} color={target?.color} />
        </div>
        <p style={{ margin: 0, textAlign: "center" }}>
          {target ? (
            <>
              Laps from now on will be saved to <strong>{target.name}</strong>.
            </>
          ) : (
            <>Laps from now on will be saved as guest laps.</>
          )}
        </p>
        {onTrack && (
          <p className="warn-note" role="alert">
            {current ? `${current.name} is` : "Someone is"} on a lap right now. If you switch, <strong>that lap won't count for anyone</strong>.
          </p>
        )}
      </div>
      <div className="modal-foot switch-foot">
        <button type="button" className="btn ghost" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
        <button type="button" className="btn" disabled={busy} onClick={confirm} autoFocus>
          {busy ? "Switching…" : target ? `Yes, switch to ${target.name}` : "Yes, switch"}
        </button>
      </div>
    </Modal>
  );

  return { choose, dialog };
}

/** A helmet over a name. The one being left is dimmed. */
function Person({ name, color, faded = false }: { name: string; color?: string; faded?: boolean }) {
  return (
    <div className={`switch-person${faded ? " faded" : ""}`}>
      <Helmet color={color ?? "#9AA3C7"} size={faded ? 72 : 96} seed={name} mood={faded ? "idle" : "happy"} />
      <span className="switch-name">{name}</span>
    </div>
  );
}
