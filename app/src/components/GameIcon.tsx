import { gameName, GAMES } from "../format";
import acevoIcon from "../assets/games/acevo.png";
import acIcon from "../assets/games/ac.png";
import dr2Icon from "../assets/games/dr2.png";
import acrIcon from "../assets/games/acr.png";

/** Each game's own app icon (Steam's client icon, 128px), by game key. */
const ICONS: Record<string, string> = { acevo: acevoIcon, ac: acIcon, dr2: dr2Icon, acr: acrIcon };

/**
 * A game's icon, so a game stands out wherever it's named. Games without an icon get a badge
 * instead: their colour and a short mark.
 */
export function GameIcon({ game, size = 22 }: { game: string; size?: number }) {
  const radius = Math.round(size * 0.28);
  const src = ICONS[game];
  if (src) {
    return (
      <img
        className="game-icon"
        src={src}
        alt={gameName(game)}
        title={gameName(game)}
        width={size}
        height={size}
        draggable={false}
        style={{ borderRadius: radius }}
      />
    );
  }
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
        borderRadius: radius,
        background: g?.color ?? "var(--panel-3)",
        color: g?.ink ?? "var(--text)",
        fontSize: Math.round(size * (mark.length > 2 ? 0.34 : 0.42)),
      }}
    >
      {mark}
    </span>
  );
}

/** A game's icon followed by its name. */
export function GameLabel({ game, size }: { game: string; size?: number }) {
  return (
    <span className="game-label">
      <GameIcon game={game} size={size} />
      <span className="game-label-name">{gameName(game)}</span>
    </span>
  );
}
