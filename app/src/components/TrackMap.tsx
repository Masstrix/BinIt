import { useMemo } from "react";

/**
 * A track outline from learned telemetry (world [x, z] metres), optionally with a dot for
 * the car. Scales to its container; world z grows downward on screen, because the game's axes are mirrored compared to a normal map view (a left turn must look like a left turn).
 */
/** Applies the chosen orientation: mirror left/right, then rotate clockwise on screen (z down). */
export function orient([x, z]: [number, number], rotate: number, mirror: boolean): [number, number] {
  if (mirror) x = -x;
  switch (((rotate % 360) + 360) % 360) {
    case 90: return [-z, x];
    case 180: return [-x, -z];
    case 270: return [z, -x];
    default: return [x, z];
  }
}

export function TrackMap({
  points: rawPoints,
  position: rawPosition,
  rotate = 0,
  mirror = false,
  closed = true,
  stroke = 3,
  label,
  sectors,
  markers,
}: {
  points: [number, number][];
  rotate?: number;
  mirror?: boolean;
  /** A circuit comes back to its start. A rally stage does not: drawn open, with a finish marker. */
  closed?: boolean;
  /** Car position in the same world coordinates. */
  position?: [number, number] | null;
  /** Outline thickness in CSS pixels. */
  stroke?: number;
  label?: string;
  /** Colour the outline by sector: boundaries as lap fractions `[0, ..., 1]` and one colour per sector. */
  sectors?: { boundaries: number[]; colors: string[]; active?: number };
  /** Extra cars to draw (drawn in order, so put the one that should sit on top last). */
  markers?: { position: [number, number]; color: string; faded?: boolean }[];
}) {
  const points = useMemo(() => rawPoints.map((p) => orient(p, rotate, mirror)), [rawPoints, rotate, mirror]);
  const position = rawPosition ? orient(rawPosition, rotate, mirror) : null;
  const geo = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of points) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const span = Math.max(maxX - minX, maxZ - minZ, 1);
    const pad = span * 0.06;
    return {
      unit: span / 100,
      box: `${minX - pad} ${minZ - pad} ${maxX - minX + pad * 2} ${maxZ - minZ + pad * 2}`,
      d: points.map(([x, z], i) => `${i ? "L" : "M"}${x} ${z}`).join("") + (closed ? "Z" : ""),
      start: points[0],
      end: points[points.length - 1],
    };
  }, [points, closed]);

  // One path per sector, cut from the outline at the boundaries (the map has one point per 1/N of the lap).
  const segments = useMemo(() => {
    if (!sectors || sectors.boundaries.length < 2) return null;
    const n = points.length;
    return sectors.boundaries.slice(0, -1).map((from, i) => {
      const a = Math.round(from * n);
      const b = Math.max(a + 1, Math.round(sectors.boundaries[i + 1] * n));
      const pts = Array.from({ length: b - a + 1 }, (_, k) => points[closed ? (a + k) % n : Math.min(a + k, n - 1)]);
      return pts.map(([x, z], k) => `${k ? "L" : "M"}${x} ${z}`).join("");
    });
  }, [sectors, points, closed]);

  return (
    <svg viewBox={geo.box} width="100%" height="100%" role="img" aria-label={label ?? "Track map"} preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
      <path d={geo.d} fill="none" stroke="var(--line)" strokeWidth={stroke + 4} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {segments ? (
        segments.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={sectors!.colors[i] ?? "var(--peri-1)"}
            strokeWidth={i === sectors!.active ? stroke + 2 : stroke}
            strokeLinejoin="round"
            strokeLinecap="butt"
            vectorEffect="non-scaling-stroke"
          />
        ))
      ) : (
        <path d={geo.d} fill="none" stroke="var(--peri-1)" strokeWidth={stroke} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      )}
      {segments &&
        sectors!.boundaries.slice(1, -1).map((b, i) => {
          const p = points[closed ? Math.round(b * points.length) % points.length : Math.min(Math.round(b * points.length), points.length - 1)];
          return <circle key={i} cx={p[0]} cy={p[1]} r={geo.unit * 1.3} fill="#EEF0FF" />;
        })}
      <circle cx={geo.start[0]} cy={geo.start[1]} r={geo.unit * 1.8} fill="var(--mint)" />
      {!closed && <circle cx={geo.end[0]} cy={geo.end[1]} r={geo.unit * 1.8} fill="var(--peach)" />}
      {markers?.map((m, i) => {
        const [mx, mz] = orient(m.position, rotate, mirror);
        return (
          <g key={i} opacity={m.faded ? 0.55 : 1}>
            <circle cx={mx} cy={mz} r={geo.unit * 3} fill={m.color} stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
      {position && (
        <>
          <circle cx={position[0]} cy={position[1]} r={geo.unit * 4.5} fill="var(--peach)" opacity={0.3} />
          <circle cx={position[0]} cy={position[1]} r={geo.unit * 2.4} fill="var(--peach)" stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </>
      )}
    </svg>
  );
}
