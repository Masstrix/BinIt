import { useEffect, useState } from "react";
import { readStored, writeStored } from "./persist";

const KEY = "devOverlay";

const read = () => (import.meta.env.DEV ? readStored<string | null>(KEY, null, (v) => typeof v === "string") : null);

/**
 * Development only: the game whose overlay to draw right now, with example data, even when no game is running
 * (null = off). The editor in the main window sets it and the overlay window follows, as both share this
 * browser storage. Always null in a release build.
 */
export function useDevOverlay(): [string | null, (game: string | null) => void] {
  const [game, setGame] = useState<string | null>(read);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const on = (e: StorageEvent) => {
      if (e.key === null || e.key === `tt.${KEY}`) setGame(read());
    };
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);
  return [
    game,
    (g) => {
      if (!import.meta.env.DEV) return;
      writeStored(KEY, g);
      setGame(g);
    },
  ];
}

const CEL = "devCelebrate";
const CEL_EVENT = "tt-dev-celebrate";

/** Development only: ask the overlay to play one celebration (the editor's buttons call this). */
export function fireDevCelebration(kind: string) {
  if (!import.meta.env.DEV) return;
  writeStored(CEL, { kind, at: Date.now() });
  window.dispatchEvent(new CustomEvent(CEL_EVENT, { detail: kind }));
}

/** Development only: hears `fireDevCelebration`, from this window or from the main window (shared storage). */
export function useDevCelebrate(on: (kind: string) => void) {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const local = (e: Event) => on((e as CustomEvent<string>).detail);
    const remote = (e: StorageEvent) => {
      if (e.key !== `tt.${CEL}` || !e.newValue) return;
      try {
        const v = JSON.parse(e.newValue) as { kind?: string };
        if (v.kind) on(v.kind);
      } catch {
        // Not ours.
      }
    };
    window.addEventListener(CEL_EVENT, local);
    window.addEventListener("storage", remote);
    return () => {
      window.removeEventListener(CEL_EVENT, local);
      window.removeEventListener("storage", remote);
    };
  }, [on]);
}
