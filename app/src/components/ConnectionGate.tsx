import { useEffect, useState } from "react";
import { useAppState } from "../api";

/** How long a dropped connection is tolerated before covering the page (hides the first-load blip). */
const GRACE_MS = 2500;

/**
 * Full-screen "can't reach TimeTrial" screen for phones (and anything else) that have lost the
 * connection to the PC. The app keeps reconnecting by itself; the page comes back as soon as it does.
 */
export function ConnectionGate() {
  const { online } = useAppState();
  const [deviceOnline, setDeviceOnline] = useState(() => navigator.onLine);
  const [graceOver, setGraceOver] = useState(false);

  useEffect(() => {
    const on = () => setDeviceOnline(true);
    const off = () => setDeviceOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    if (online) {
      setGraceOver(false);
      return;
    }
    const t = setTimeout(() => setGraceOver(true), GRACE_MS);
    return () => clearTimeout(t);
  }, [online]);

  if (online || !graceOver) return null;

  return (
    <div className="gate" role="alertdialog" aria-labelledby="gate-title" aria-describedby="gate-text">
      <div className="gate-card">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--peri-1)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0" />
          <circle cx="12" cy="19.5" r="1" fill="var(--peri-1)" />
          <path d="M3 3l18 18" stroke="var(--peach)" />
        </svg>
        <h1 id="gate-title" style={{ fontSize: 26 }}>{deviceOnline ? "Can't reach TimeTrial" : "You're offline"}</h1>
        <p id="gate-text" className="muted" style={{ margin: 0 }}>
          {deviceOnline
            ? "The gaming PC isn't answering. Check that it's on, TimeTrial is open, and you're on the office wifi."
            : "This device has no connection. Turn on wifi and join the office network."}
        </p>
        <span className="chip plain mono" style={{ alignSelf: "center" }}>{location.host}</span>
        <span className="gate-status"><span className="dot" /> Reconnecting automatically…</span>
        <button type="button" className="btn" onClick={() => location.reload()}>Try again</button>
      </div>
    </div>
  );
}
