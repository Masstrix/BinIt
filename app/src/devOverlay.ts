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
