import { useEffect, useState } from "react";
import { isTauri } from "../api";
import { Logo } from "../components/Helmet";

/** Where the update stands, as sent by the desktop app (src-tauri/src/updater.rs). */
type Stage =
  | { stage: "checking" }
  | { stage: "downloading"; version: string; downloaded: number; total: number | null }
  | { stage: "installing"; version: string }
  | { stage: "failed"; message: string }
  | { stage: "starting" };

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * The small window shown while the installed app checks for and installs an update, in place of
 * the main window. Opening #/updater in a browser plays through the stages as a preview.
 */
export function Updater() {
  const [stage, setStage] = useState<Stage>({ stage: "checking" });

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    if (!isTauri) return preview(setStage);
    let unlisten: (() => void) | undefined;
    let gone = false;
    import("@tauri-apps/api/event").then(({ listen }) =>
      listen<Stage>("updater://stage", (e) => setStage(e.payload)).then((u) => (gone ? u() : (unlisten = u))),
    );
    // Anything sent before the listener was ready.
    import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke<Stage | null>("updater_stage").then((s) => s && !gone && setStage((now) => (now.stage === "checking" ? s : now))),
    );
    return () => {
      gone = true;
      unlisten?.();
    };
  }, []);

  let title: string;
  let detail = "";
  let progress: number | null = null;
  switch (stage.stage) {
    case "checking":
      title = "Checking for updates";
      break;
    case "downloading":
      title = `Downloading ${stage.version}`;
      if (stage.total) {
        progress = Math.min(1, stage.downloaded / stage.total);
        detail = `${mb(stage.downloaded)} of ${mb(stage.total)}`;
      } else detail = mb(stage.downloaded);
      break;
    case "installing":
      title = `Installing ${stage.version}`;
      detail = "Bin It will open again in a moment";
      break;
    case "failed":
      title = "Update didn't work";
      detail = stage.message;
      break;
    case "starting":
      title = "Starting Bin It";
      break;
  }

  return (
    <div className="updater" data-tauri-drag-region>
      <div className={`updater-logo${stage.stage === "downloading" || stage.stage === "installing" ? " busy" : ""}`} data-tauri-drag-region>
        <Logo size={92} />
      </div>
      <div className="updater-text" data-tauri-drag-region>
        <div className="updater-title">{title}</div>
        <div className={`updater-detail${stage.stage === "failed" ? " failed" : ""}`}>{detail || " "}</div>
      </div>
      <div className={`updater-bar${progress === null ? " indeterminate" : ""}${stage.stage === "failed" ? " failed" : ""}`} role="progressbar" aria-valuenow={progress === null ? undefined : Math.round(progress * 100)}>
        <span style={progress === null ? undefined : { width: `${progress * 100}%` }} />
      </div>
    </div>
  );
}

/** A browser preview of the whole flow, looping, so the window can be designed without a release. */
function preview(setStage: (s: Stage) => void) {
  const total = 10.4 * 1024 * 1024;
  const steps: [Stage, number][] = [[{ stage: "checking" }, 1500]];
  for (let i = 0; i <= 20; i++) steps.push([{ stage: "downloading", version: "0.3.0", downloaded: (total * i) / 20, total }, 150]);
  steps.push([{ stage: "installing", version: "0.3.0" }, 2000], [{ stage: "failed", message: "Couldn't update this time. Starting Bin It..." }, 2500], [{ stage: "starting" }, 1200]);
  let i = 0;
  let timer = 0;
  const next = () => {
    const [s, ms] = steps[i++ % steps.length];
    setStage(s);
    timer = window.setTimeout(next, ms);
  };
  next();
  return () => clearTimeout(timer);
}
