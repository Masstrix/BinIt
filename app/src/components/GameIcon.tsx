import { gameName, GAMES } from "../format";

/**
 * A small badge for a game: its own colour and a short mark, so a game stands out wherever it's named.
 * (Our own badges rather than the games' logos, which are their publishers' artwork.)
 */
export function GameIcon({ game, size = 22 }: { game: string; size?: number }) {
  const g = GAMES.find((x) => x.key === game);
  const mark = g?.mark ?? game.slice(0, 3).toUpperCase();
  return (
    <span
      className="game-icon"
      role="img"
      aria-label={gameName(game)}
      title={gameName(game)}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        background: g?.color ?? "var(--panel-3)",
        color: g?.ink ?? "var(--text)",
        fontSize: Math.round(size * (mark.length > 2 ? 0.34 : 0.42)),
      }}
    >
      {mark}
    </span>
  );
}

/** A game's badge followed by its name. */
export function GameLabel({ game, size }: { game: string; size?: number }) {
  return (
    <span className="game-label">
      <GameIcon game={game} size={size} />
      <span className="game-label-name">{gameName(game)}</span>
    </span>
  );
}
