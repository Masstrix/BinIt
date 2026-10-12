/**
 * The words for a game. A circuit game has tracks and laps; a rally game has stages and runs at them (a
 * stage is the course, a run is one attempt at it). Pages that know which game they are showing say it with
 * these, so the wording follows the game.
 */
const RALLY_GAMES = new Set(["dr2", "acr"]);

export const isRally = (game?: string | null) => !!game && RALLY_GAMES.has(game);

export interface Words {
  track: string;
  tracks: string;
  lap: string;
  laps: string;
  /** "Best lap" / "Best run": what the single best result is called. */
  rally: boolean;
}

const CIRCUIT: Words = { track: "track", tracks: "tracks", lap: "lap", laps: "laps", rally: false };
const RALLY: Words = { track: "stage", tracks: "stages", lap: "run", laps: "runs", rally: true };

export const words = (game?: string | null): Words => (isRally(game) ? RALLY : CIRCUIT);

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Locations whose names are more than one word, so "Monte Carlo Col de Turini" splits as Monte Carlo + Col de Turini. */
const MULTI_WORD_LOCATIONS = ["Monte Carlo", "New Zealand", "Costa Brava", "Costa Smeralda", "Great Britain"];

/**
 * A rally game's stage name starts with the location the way the game shows it ("Wales Afon Bidno"), so the
 * stages can be grouped by location like the game groups them. A name that does not start with a place
 * (a catalogue with its own country) has no location here.
 */
export function stageParts(track: string): { location: string | null; stage: string } {
  const long = MULTI_WORD_LOCATIONS.find((l) => track.toLowerCase().startsWith(`${l.toLowerCase()} `));
  if (long) return { location: long, stage: track.slice(long.length + 1) };
  const space = track.indexOf(" ");
  return space > 0 ? { location: track.slice(0, space), stage: track.slice(space + 1) } : { location: null, stage: track };
}
