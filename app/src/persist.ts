import { useCallback, useState } from "react";

/**
 * What each browser remembers about how it was last using the app (the picked track, filters, last
 * page of a section). It lives in that browser's own local storage: nothing is sent anywhere, and the
 * desktop app, a phone and an office PC each keep their own. Storage can be blocked or full (private
 * windows, cleared data), so every read and write is guarded and the app works without it.
 */
const PREFIX = "tt.";

export function readStored<T>(key: string, fallback: T, valid?: (v: unknown) => boolean): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const value: unknown = JSON.parse(raw);
    return !valid || valid(value) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the choice just isn't remembered.
  }
}

/** `useState` that starts from what this browser stored last time (if it still passes `valid`) and saves every change. */
export function usePersistedState<T>(key: string, initial: T, valid?: (v: unknown) => boolean) {
  const [value, set] = useState<T>(() => readStored(key, initial, valid));
  const setAndStore = useCallback(
    (next: T) => {
      set(next);
      writeStored(key, next);
    },
    [key],
  );
  return [value, setAndStore] as const;
}
