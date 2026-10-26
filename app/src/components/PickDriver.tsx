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
  const [added, setAdded] = useState<string | null>(null);
  const seatId = status?.seat ?? null;

  const add = async () => {
    if (!name.trim()) return;
    try {
      // Registering never takes the seat: someone else may be mid-lap. They tap their helmet when it's their turn.
      const d = await api.addDriver(name.trim());
      setName("");
      setError(null);
      setAdded(d.name);
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
                    <Helmet color={d.color} size={64} seed={d.id} mood={active ? "happy" : "idle"} round />
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
            <input id="newname" className="input" value={name} maxLength={32} onChange={(e) => { setName(e.target.value); setAdded(null); }} placeholder="Type your name and press Enter" autoComplete="off" />
            <button className="btn" type="submit" disabled={!name.trim()}>Add driver</button>
          </form>
          {added && <span className="muted" style={{ fontSize: 14 }}>Added {added}. Tap their helmet when it is their turn to drive.</span>}
          {error && <span className="error">{error}</span>}
        </div>
      </Modal>
    </>
  );
}
