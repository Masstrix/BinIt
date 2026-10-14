import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, useAppState, useCatalogue, useFetch, useTrackMaps, type Combo } from "../api";
import { CarBadge, carItems, drivenTrackItems, findMap, TrackThumb } from "../catalogueItems";
import { carName, gameName } from "../format";
import { usePersistedState } from "../persist";
import { cap, words } from "../vocab";
import { Dropdown } from "./Dropdown";
import { GameIcon, GameLabel } from "./GameIcon";
import { Picker } from "./Picker";

const CAR_KEY = "tt.leaderboard.car";

export const trackKey = (c: Pick<Combo, "game" | "track" | "layout">) => `${c.game}|${c.track}|${c.layout}`;

/**
 * Which game, track and car is being looked at: shared by the Leaderboard and Telemetry's lap
 * analysis (and remembered by this browser), so moving between them stays on the same track.
 */
export function useTrackSelection() {
  const { status } = useAppState();
  const combos = useFetch(() => api.combos(), []) ?? [];

  const tracks = useMemo(() => {
    const seen = new Map<string, Combo>();
    combos.forEach((c) => seen.set(trackKey(c), c));
    return [...seen.values()];
  }, [combos]);

  // Games that have laps, and the track last picked in each, so switching game returns to where you were in it.
  const games = useMemo(() => [...new Set(tracks.map((t) => t.game))], [tracks]);
  const [track, setTrack] = usePersistedState<string | null>("leaderboard.track", null, (v) => typeof v === "string");
  const [lastTrack, setLastTrack] = usePersistedState<Record<string, string>>("leaderboard.trackByGame", {}, (v) => typeof v === "object" && v !== null && !Array.isArray(v));
  const chooseTrack = (key: string) => {
    setTrack(key);
    setLastTrack({ ...lastTrack, [key.split("|")[0]]: key });
  };
  const chooseGame = (game: string) => {
    const remembered = lastTrack[game];
    const next = remembered && tracks.some((t) => trackKey(t) === remembered) ? remembered : tracks.find((t) => t.game === game) && trackKey(tracks.find((t) => t.game === game)!);
    if (next) chooseTrack(next);
  };
  // The car you picked sticks across track changes (and restarts); tracks where nobody
  // has driven it fall back to "Any car" without forgetting the pick.
  const [pickedCar, setPickedCarState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(CAR_KEY);
    } catch {
      return null;
    }
  });
  const setPickedCar = (c: string | null) => {
    setPickedCarState(c);
    try {
      if (c) localStorage.setItem(CAR_KEY, c);
      else localStorage.removeItem(CAR_KEY);
    } catch {
      // Storage unavailable: the pick just isn't remembered.
    }
  };

  // Default to what's being driven right now, else the first track with laps.
  useEffect(() => {
    if (tracks.length === 0) return; // still loading: keep what was remembered
    if (track && tracks.some((x) => trackKey(x) === track)) return; // a remembered track that still has laps

    const s = status?.session;
    const pick = (s && tracks.find((t) => trackKey(t) === trackKey(s))) || tracks[0];
    setTrack(trackKey(pick));
    if (s && trackKey(s) === trackKey(pick)) setPickedCar(s.car);
  }, [tracks, status?.session, track]);

  const selected = tracks.find((t) => trackKey(t) === track);
  const catalogue = useCatalogue(selected?.game ?? null);
  const maps = useTrackMaps(selected?.game ?? null);
  const carsHere = combos.filter((c) => selected && trackKey(c) === trackKey(selected)).map((c) => c.car);
  const car = pickedCar && carsHere.includes(pickedCar) ? pickedCar : null;

  return { combos, tracks, games, track, selected, catalogue, maps, carsHere, car, chooseTrack, chooseGame, setPickedCar };
}

export type TrackSelection = ReturnType<typeof useTrackSelection>;

/** The game switch and the track and car pickers for a `useTrackSelection`, plus any extra filters as children. */
export function TrackFilters({ sel, children }: { sel: TrackSelection; children?: ReactNode }) {
  const { combos, tracks, games, track, selected, catalogue, maps, carsHere, car, chooseTrack, chooseGame, setPickedCar } = sel;
  const w = words(selected?.game);
  // Only the selected game's tracks: another game may have a track with the same name, and the switch above picks the game.
  const trackPickItems = useMemo(
    () => drivenTrackItems(combos.filter((c) => c.game === selected?.game), catalogue, maps),
    [combos, selected?.game, catalogue, maps],
  );
  const carPickItems = useMemo(() => {
    const items = carItems(catalogue, { only: new Set(carsHere) });
    // Cars the catalogue somehow lacks still get listed.
    const known = new Set(items.map((i) => i.value));
    return [...items, ...carsHere.filter((c) => !known.has(c)).map((c) => ({ value: c, label: carName(c), visual: <CarBadge name={carName(c)} /> }))];
  }, [catalogue, carsHere.join("|")]);

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      {games.length > 1 ? (
        <Dropdown variant="pill" label="Game" value={selected?.game ?? games[0]} options={games.map((g) => ({ value: g, label: gameName(g), icon: <GameIcon game={g} size={20} /> }))} onChange={chooseGame} />
      ) : (
        selected && <span className="filter-pill on"><GameLabel game={selected.game} size={20} /></span>
      )}
      <Picker
        variant="pill"
        label={cap(w.track)}
        value={track ?? ""}
        items={trackPickItems}
        onChange={chooseTrack}
        tagLabel="Country"
        visualOf={(v) => {
          const t = tracks.find((x) => trackKey(x) === v);
          return <TrackThumb map={t ? findMap(maps, t.track, t.layout) : undefined} />;
        }}
      />
      <Picker
        variant="pill"
        label="Car"
        value={car ?? ""}
        anyLabel="Any car"
        items={carPickItems}
        onChange={(v) => setPickedCar(v || null)}
        tagLabel="Class"
      />
      {children}
    </div>
  );
}
