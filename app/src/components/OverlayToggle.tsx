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
