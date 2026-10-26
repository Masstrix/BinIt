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

  const seated = drivers.find((d) => d.id === seatId);

  return (
    <>
      <Modal title="Who's driving?" onClose={onClose} className="pick">
        <div className="modal-body">
          <div className="pick-hero">
            <Helmet color={seated?.color ?? "#8f99b3"} look={seated?.look} size={52} seed={seated?.id} mood="happy" round />
            <span>
              <strong>{seated ? `${seated.name} has the seat` : "Nobody has the seat"}</strong>
              <span className="muted">Times go to whoever is picked. No passwords, play fair.</span>
            </span>
          </div>
          {drivers.length > 0 && (
            <div className="driver-grid pick-grid">
              {drivers.map((d, i) => {
                const active = d.id === seatId;
                return (
                  <button
                    key={d.id}
                    type="button"
                    className="driver-btn pick-card"
                    aria-pressed={active}
                    style={{ ["--c" as string]: d.color, animationDelay: `${i * 28}ms` }}
                    onClick={() => {
                      choose(active ? null : d);
                      onClose();
                    }}
                  >
                    {active && <span className="pick-tag">DRIVING</span>}
                    <Helmet color={d.color} look={d.look} size={68} seed={d.id} mood={active ? "happy" : "idle"} round />
                    <span className="name">{d.name}</span>
                    <span className="muted" style={{ fontSize: 12 }}>{active ? "tap to leave the seat" : "tap to drive"}</span>
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
          <span className="muted" style={{ fontSize: 13, marginTop: -10 }}>
            {added ? `Added ${added}. Tap their helmet when it is their turn to drive.` : "Adding someone doesn't take the seat."}
          </span>
          {error && <span className="error">{error}</span>}
        </div>
      </Modal>
    </>
  );
}
