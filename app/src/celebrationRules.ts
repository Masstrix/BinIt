// Which celebrations a recorded lap earns. Kept free of React so the rules can be read and tested on their own.

/** The driver's standing in one challenge, as the server reports it with a lap. */
export interface Standing {
  challengeName: string;
  position: number | null;
  previousPosition: number | null;
  gapToLeaderMs: number | null;
}

export interface LapMoments {
  /** A timed (valid) lap: only these are celebrated for place and times. */
  timed: boolean;
  time: string;
  name: string;
  personalBest: boolean;
  comboRecord: boolean;
  standing?: Standing;
}

export type Moment =
  | { kind: "record"; time: string; name: string }
  | { kind: "lead"; name: string; time: string; challenge: string; from: number | null }
  | { kind: "moved"; from: number; to: number; context: string; gap: string | null }
  | { kind: "pb"; time: string; position: number | null };

/**
 * A lap can earn several: a track record that also takes a challenge lead is both, and the overlay plays them one
 * after the other (the bigger first). A personal best is only announced when nothing bigger already says so, because
 * taking a place or the lead on a board is itself a new best and its card says more.
 */
export function momentsFor(l: LapMoments): Moment[] {
  if (!l.timed) return [];
  const s = l.standing;
  const out: Moment[] = [];
  if (l.comboRecord) out.push({ kind: "record", time: l.time, name: l.name });
  const tookLead = s?.position === 1 && s.previousPosition !== 1;
  const movedUp = s != null && s.position != null && s.previousPosition != null && s.position < s.previousPosition;
  if (tookLead && s) out.push({ kind: "lead", name: l.name, time: l.time, challenge: s.challengeName, from: s.previousPosition });
  else if (movedUp && s) {
    out.push({ kind: "moved", from: s.previousPosition!, to: s.position!, context: s.challengeName, gap: s.gapToLeaderMs ? `${(s.gapToLeaderMs / 1000).toFixed(3)} off the lead` : null });
  }
  if (l.personalBest && out.length === 0) out.push({ kind: "pb", time: l.time, position: s?.position ?? null });
  return out;
}
