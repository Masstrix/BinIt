import { useEffect, useState } from "react";
import { api, useAppState, type Driver } from "../api";
import { Helmet } from "./Helmet";
import { Modal } from "./Modal";
import { useSeatSwitcher } from "./SeatSwitcher";

const OPEN = "tt-pick-driver";

/** Opens the "who's driving" picker (mounted once as <PickDriverHost />) from anywhere. */
export function openPickDriver() {
  window.dispatchEvent(new Event(OPEN));
}

/** The "who's driving" picker as a dialog: tap a helmet to put them in the seat, or add someone new. */
export function PickDriverHost() {
  const [open, setOpen] = useState(false);
  // Lives here, not in the picker: the picker closes on a choice, but a browser still has to ask "are you sure?".
  const seat = useSeatSwitcher();
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(OPEN, on);
    return () => window.removeEventListener(OPEN, on);
  }, []);
  return (
    <>
      {open && <PickDriver choose={seat.choose} onClose={() => setOpen(false)} />}
      {seat.dialog}
    </>
  );
}

function PickDriver({ choose, onClose }: { choose: (d: Driver | null) => void; onClose: () => void }) {
  const { status, drivers } = useAppState();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const seatId = status?.seat ?? null;

  const add = async () => {
    if (!name.trim()) return;
    try {
      await api.addDriver(name, undefined, true);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <Modal title="Who's driving?" onClose={onClose}>
        <div className="modal-body">
          <span className="muted" style={{ fontSize: 14 }}>Times go to whoever is picked. No passwords, play fair.</span>
          {drivers.length > 0 && (
            <div className="driver-grid">
              {drivers.map((d) => {
                const active = d.id === seatId;
                return (
                  <button
                    key={d.id}
                    type="button"
                    className="driver-btn"
                    aria-pressed={active}
                    style={{ borderColor: active ? d.color : "transparent" }}
                    onClick={() => {
                      choose(active ? null : d);
                      onClose();
                    }}
                  >
                    <Helmet color={d.color} size={60} seed={d.id} />
                    <span className="name">{d.name}</span>
                    <span className="muted" style={{ fontSize: 12 }}>{active ? "in the seat" : "tap to drive"}</span>
                  </button>
                );
              })}
            </div>
          )}
          <form
            className="add-bar"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <label htmlFor="newname">New here?</label>
            <input id="newname" className="input" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} placeholder="Type your name and press Enter" autoComplete="off" />
            <button className="btn" type="submit" disabled={!name.trim()}>Add + drive</button>
          </form>
          {error && <span className="error">{error}</span>}
        </div>
      </Modal>
    </>
  );
}
