import { api, useAppState } from "../api";

/** On/off switch for the in-game overlay. Same setting as Ctrl+Shift+H. */
export function OverlayToggle({ compact = false }: { compact?: boolean }) {
  const { status } = useAppState();
  const enabled = status?.overlayEnabled ?? true;
  const flip = () => api.setOverlayEnabled(!enabled).catch(() => {});

  return (
    <label
      className={compact ? "overlay-toggle compact" : "overlay-toggle"}
      title={`In-game overlay ${enabled ? "on" : "off"} (Ctrl+Shift+H)`}
    >
      <span className="overlay-toggle-label">In-game overlay</span>
      <button className="toggle" role="switch" aria-checked={enabled} aria-label="In-game overlay" onClick={flip} disabled={!status} />
    </label>
  );
}

/** Only draw the overlay while a supported game is the focused app. */
export function OverlayFocusToggle() {
  const { status } = useAppState();
  const focusOnly = status?.overlayFocusOnly ?? true;
  return (
    <label className="overlay-toggle" title="Hide the overlay when you switch to another app">
      <span className="overlay-toggle-label">Only while a game is focused</span>
      <button
        className="toggle"
        role="switch"
        aria-checked={focusOnly}
        aria-label="Only show the overlay while a game is focused"
        onClick={() => api.setOverlayFocusOnly(!focusOnly).catch(() => {})}
        disabled={!status || !status.overlayEnabled}
      />
    </label>
  );
}
