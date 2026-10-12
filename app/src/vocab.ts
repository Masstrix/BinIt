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
