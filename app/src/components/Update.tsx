import { useEffect, useState } from "react";
import { api, isTauri, openDownload, store, useAppState, type UpdateStage, type UpdateStatus } from "../api";
import { ago } from "../format";
import { Modal } from "./Modal";

/** What an update in progress is doing, in a few words (null when nothing is happening). */
function stageText(s: UpdateStage | null): string | null {
  switch (s?.stage) {
    case "checking":
      return "Getting the update ready";
    case "downloading":
      return `Downloading ${s.version}${s.total ? ` · ${Math.min(100, Math.round((s.downloaded / s.total) * 100))}%` : ""}`;
    case "installing":
      return `Installing ${s.version}`;
    case "failed":
      return "The update didn't work";
    default:
      return null;
  }
}

function shortStageText(s: UpdateStage | null): string | null {
  switch (s?.stage) {
    case "downloading":
      return `Updating${s.total ? ` · ${Math.min(100, Math.round((s.downloaded / s.total) * 100))}%` : "..."}`;
    case "checking":
    case "installing":
      return "Updating...";
    case "failed":
      return "Update failed";
    default:
      return null;
  }
}

/** What can be done about the newer version from here: install it, download it, or nothing. */
function action(u: UpdateStatus | null): "install" | "download" | null {
  if (!u?.latest || u.stage) return null;
  if (u.kind === "installed") return "install";
  // A portable copy can't update itself; the download only makes sense on the PC itself.
  if (u.kind === "portable" && isTauri) return "download";
  return null;
}

function useUpdateActions() {
  const [busy, setBusy] = useState<"check" | "install" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (what: "check" | "install") => {
    setBusy(what);
    setError(null);
    try {
      store.setUpdate(await (what === "check" ? api.checkForUpdate() : api.installUpdate()));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, check: () => run("check"), install: () => run("install") };
}

/** "Update Bin It now?": Bin It on the PC closes for a moment, so it asks first. */
function ConfirmUpdate({ version, onClose, onConfirm }: { version: string; onClose: () => void; onConfirm: () => void }) {
  return (
    <Modal title={`Update to ${version}?`} onClose={onClose} narrow>
      <div className="modal-body">
        <p style={{ margin: 0 }}>
          Bin It on the PC closes for a moment, installs <strong>{version}</strong> and opens again. Laps and drivers are kept, but a lap being
          driven right now won't be saved.
        </p>
      </div>
      <div className="modal-foot">
        <button type="button" className="btn ghost" onClick={onClose}>
          Not now
        </button>
        <button
          type="button"
          className="btn"
          data-autofocus
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          Update now
        </button>
      </div>
    </Modal>
  );
}

const ICON = "M12 3v12M7 10l5 5 5-5M5 21h14";

/**
 * The menu's update button: only there when a newer version is out (or one is installing). From a
 * phone it updates the app on the PC.
 */
export function UpdateButton({ variant = "menu" }: { variant?: "menu" | "titlebar" }) {
  const { update } = useAppState();
  const { install } = useUpdateActions();
  const [confirming, setConfirming] = useState(false);
  const what = action(update);
  const progress = stageText(update?.stage ?? null);
  if (!update || (!what && !progress)) return null;

  const label = progress ?? (what === "install" ? `Update to ${update.latest!.version}` : `Get ${update.latest!.version}`);
  // The menu is narrow: just how far along it is.
  const short = shortStageText(update.stage) ?? label;
  const onClick = () => (what === "install" ? setConfirming(true) : what === "download" ? openDownload("portable") : undefined);
  return (
    <>
      <button className={`update-pill${variant === "titlebar" ? " in-titlebar" : ""}${progress ? " busy" : ""}`} onClick={onClick} disabled={!what} title={label} aria-label={label}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={ICON} />
        </svg>
        <span className="update-pill-label">{short}</span>
      </button>
      {confirming && <ConfirmUpdate version={update.latest!.version} onClose={() => setConfirming(false)} onConfirm={install} />}
    </>
  );
}

/**
 * A card at the top of the Rig page on a phone: a newer version is out (or installing), and it can be started from here. The
 * update happens on the PC, so it asks first. Hidden on wider screens, where the title bar and the menu carry it.
 */
export function UpdateBanner() {
  const { update } = useAppState();
  const { busy, error, install } = useUpdateActions();
  const [confirming, setConfirming] = useState(false);
  const what = action(update);
  const progress = stageText(update?.stage ?? null);
  if (!update || (!what && !progress)) return null;
  return (
    <section className={`card update-banner${progress ? " busy" : ""}`} aria-label="Update available">
      <div className="update-head">
        <span className="update-dot" aria-hidden="true" />
        <div className="update-text">
          <h2>{progress ?? `Bin It ${update.latest!.version} is available`}</h2>
          <span className="muted">
            {progress ? "Bin It on the PC closes for a moment and opens again." : `The PC has ${update.current}. Updating happens on the PC and takes a minute.`}
          </span>
        </div>
        {what && !progress && (
          <button className="btn" disabled={busy === "install"} onClick={() => (what === "install" ? setConfirming(true) : openDownload("portable"))}>
            {what === "install" ? "Update now" : `Download ${update.latest!.version}`}
          </button>
        )}
      </div>
      {error && <div className="update-error">{error}</div>}
      {confirming && update.latest && <ConfirmUpdate version={update.latest.version} onClose={() => setConfirming(false)} onConfirm={install} />}
    </section>
  );
}

/** Ticks every half minute, so "checked 5 min ago" stays true. */
function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** The release notes as a list: they come as "- one change" lines. */
function Notes({ notes }: { notes: string }) {
  const items = notes
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
    .filter(Boolean);
  return (
    <ul className="update-notes">
      {items.slice(0, 8).map((n, i) => (
        <li key={i}>{n}</li>
      ))}
      {items.length > 8 && <li className="muted">and {items.length - 8} more</li>}
    </ul>
  );
}

/** The top of the Advanced page: up to date or not, check now, update now. */
export function UpdateCard() {
  const { update } = useAppState();
  const { busy, error, check, install } = useUpdateActions();
  const [confirming, setConfirming] = useState(false);
  const now = useNow();
  if (!update) return null;

  const what = action(update);
  const progress = stageText(update.stage);
  const checking = update.checking || busy === "check";
  const tone = progress ? "busy" : update.latest ? "new" : update.error ? "warn" : "ok";
  const title = progress
    ? progress
    : update.latest
      ? `Bin It ${update.latest.version} is available`
      : update.kind === "development"
        ? "Development build"
        : update.lastChecked
          ? "Bin It is up to date"
          : "Not checked for updates yet";

  const about = progress
    ? "Bin It on the PC closes for a moment and opens again on the new version."
    : update.latest
    ? `You have ${update.current}.${update.kind === "installed" ? " It also installs by itself the next time Bin It starts." : update.kind === "portable" ? " This portable copy can't update itself, so download the new one." : ""}`
    : update.kind === "development"
      ? `Version ${update.current}. Development builds never update themselves.`
      : `Version ${update.current}.`;
  const checked = checking ? "Checking now..." : update.lastChecked ? `Checked ${ago(update.lastChecked, now)} · checks every hour` : null;

  return (
    <section className={`card update-card ${tone}`} aria-label="Updates">
      <div className="update-head">
        <span className="update-dot" aria-hidden="true" />
        <div className="update-text">
          <h2>{title}</h2>
          <span className="muted">
            {about}
            {checked && (
              <>
                <br />
                {checked}
              </>
            )}
          </span>
        </div>
        <div className="update-actions">
          <button className="btn ghost" onClick={check} disabled={checking || !!update.stage}>
            {checking ? "Checking..." : "Check for updates"}
          </button>
          {what === "install" && (
            <button className="btn" onClick={() => setConfirming(true)}>
              Update now
            </button>
          )}
          {what === "download" && (
            <button className="btn" onClick={() => openDownload("portable")}>
              Download {update.latest!.version}
            </button>
          )}
        </div>
      </div>
      {update.latest?.notes && !progress && <Notes notes={update.latest.notes} />}
      {(error ?? update.error) && <div className="update-error">{error ?? update.error}</div>}
      {confirming && update.latest && <ConfirmUpdate version={update.latest.version} onClose={() => setConfirming(false)} onConfirm={install} />}
    </section>
  );
}
