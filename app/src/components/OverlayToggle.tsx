import { api, useAppState, type OverlayShow } from "../api";

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
      <span className="overlay-toggle-label">{compact ? "Overlay" : "In-game overlay"}</span>
      <button className="toggle" role="switch" aria-checked={enabled} aria-label="In-game overlay" onClick={flip} disabled={!status} />
    </label>
  );
}

/** When the widgets are drawn: always, not in menus, or only while driving. */
export function OverlayShowPicker() {
  const { status } = useAppState();
  const mode = status?.overlayShow ?? "drivingPaused";
  const options: { value: OverlayShow; label: string; hint: string }[] = [
    { value: "always", label: "Always", hint: "Even in menus" },
    { value: "drivingPaused", label: "Not in menus", hint: "While driving, and when paused" },
    { value: "driving", label: "Only driving", hint: "Hidden when paused too" },
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span className="overlay-toggle-label">Show widgets</span>
      <div className="segmented" role="group" aria-label="When to show the widgets">
        {options.map((o) => (
          <button key={o.value} title={o.hint} aria-pressed={mode === o.value} disabled={!status || !status.overlayEnabled} onClick={() => api.setOverlayShow(o.value).catch(() => {})}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
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
