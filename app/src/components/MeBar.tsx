import { useState } from "react";
import { useAppState } from "../api";
import { usePersistedState } from "../persist";
import { Helmet } from "./Helmet";
import { Modal } from "./Modal";
import { useSeatSwitcher } from "./SeatSwitcher";

/**
 * Phones: "this is me", above the tab bar. Who you are is remembered by this browser only (local
 * storage), never by the app, so each phone keeps its own. Once picked, one tap puts you in the seat.
 */
export function MeBar() {
  const { status, drivers } = useAppState();
  const [meId, setMeId] = usePersistedState<number | null>("me", null, (v) => typeof v === "number");
  const [picking, setPicking] = useState(false);
  const seat = useSeatSwitcher();

  // A driver that has since been removed counts as nobody picked.
  const me = drivers.find((d) => d.id === meId) ?? null;
  const inSeat = me != null && status?.seat === me.id;

  return (
    <div className="me-bar">
      <button type="button" className="me-who" onClick={() => setPicking(true)} title="Choose who you are on this phone">
        <Helmet color={me?.color ?? "#5B6488"} size={34} seed={me?.id} mood={inSeat ? "happy" : "idle"} />
        <span className="me-text">
          <span className="me-name">{me ? me.name : "Who are you?"}</span>
          <span className="me-sub">{me ? (inSeat ? "In the seat" : "Tap to change") : "Pick your driver"}</span>
        </span>
      </button>
      {me &&
        (inSeat ? (
          <span className="me-driving"><span className="dot on" /> Driving</span>
        ) : (
          <button type="button" className="btn me-go" onClick={() => seat.choose(me, true)}>Start driving</button>
        ))}
      {seat.dialog}
      {picking && (
        <Modal title="Who are you?" onClose={() => setPicking(false)} narrow>
          <div className="modal-body">
            <p className="muted" style={{ marginTop: 0 }}>Only this phone remembers it.</p>
            {drivers.length === 0 ? (
              <div className="empty">No drivers yet. Add yourself on the Home page first.</div>
            ) : (
              <div className="driver-grid">
                {drivers.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className="driver-btn"
                    aria-pressed={d.id === me?.id}
                    style={{ borderColor: d.id === me?.id ? d.color : "transparent" }}
                    onClick={() => {
                      setMeId(d.id);
                      setPicking(false);
                    }}
                  >
                    <Helmet color={d.color} size={52} seed={d.id} />
                    <span className="name">{d.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {me && (
            <div className="modal-foot">
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setMeId(null);
                  setPicking(false);
                }}
              >
                Forget me on this phone
              </button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
