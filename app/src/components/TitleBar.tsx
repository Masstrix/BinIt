import { useEffect, useState } from "react";
import { isTauri, mockEnabled } from "../api";
import { UpdateButton } from "./Update";

type Action = "minimise" | "maximise" | "close";

/**
 * The window's own title bar (the desktop app has no OS frame). Drag it to move the window; in a
 * browser it is just the page title, without the window buttons.
 */
export function TitleBar({ title }: { title: string }) {
  const [maximised, setMaximised] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    let off: (() => void) | undefined;
    let gone = false;
    import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      const sync = () => win.isMaximized().then((m) => !gone && setMaximised(m)).catch(() => {});
      sync();
      const un = await win.onResized(sync);
      if (gone) un();
      else off = un;
    });
    return () => {
      gone = true;
      off?.();
    };
  }, []);

  const run = (action: Action) =>
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      if (action === "minimise") return win.minimize();
      if (action === "maximise") return win.toggleMaximize();
      return win.close();
    });

  return (
    <header className="titlebar" data-tauri-drag-region>
      <span className="titlebar-title" data-tauri-drag-region>{title}</span>
      {mockEnabled && (
        <a className="mock-badge" href="?mock=0" title="Showing made-up data from src/mock. Click to switch it off.">Mock data</a>
      )}
      <span className="titlebar-fill" data-tauri-drag-region />
      <UpdateButton variant="titlebar" />
      {isTauri && (
        <div className="titlebar-buttons">
          <button type="button" aria-label="Minimise" onClick={() => run("minimise")}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6h10" stroke="currentColor" strokeWidth="1.4" /></svg>
          </button>
          <button type="button" aria-label={maximised ? "Restore" : "Maximise"} onClick={() => run("maximise")}>
            {maximised ? (
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 3.5V1.5h7v7h-2M1.5 3.5h7v7h-7z" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
            )}
          </button>
          <button type="button" className="close" aria-label="Close" onClick={() => run("close")}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" strokeWidth="1.4" /></svg>
          </button>
        </div>
      )}
    </header>
  );
}
