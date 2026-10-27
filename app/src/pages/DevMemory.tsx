import { useEffect, useMemo, useState } from "react";
import { api, useAppState, type MemoryPage } from "../api";
import { GAMES, gameName } from "../format";

const SHM_GAMES = ["acevo", "ac", "acr"];
const RAW_ROW_CAP = 1500;
const ELEMENT_BYTES: Record<string, number> = { i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, f32: 4, u64: 8, text: 1, utf16: 2 };

const toBytes = (hex: string) => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(7))));

/** One element of a field, read at `at`. */
function element(view: DataView, kind: string, at: number): string {
  switch (kind) {
    case "i8": return String(view.getInt8(at));
    case "u8": return String(view.getUint8(at));
    case "i16": return String(view.getInt16(at, true));
    case "u16": return String(view.getUint16(at, true));
    case "i32": return String(view.getInt32(at, true));
    case "u32": return String(view.getUint32(at, true));
    case "f32": return num(view.getFloat32(at, true));
    case "u64": return view.getBigUint64(at, true).toString();
    default: return "?";
  }
}

type Field = MemoryPage["fields"][number];

/** A known field decoded: text as text, anything else as its values. */
function decode(view: DataView, f: Field): string {
  if (f.offset + f.size > view.byteLength) return "(past the end of the page)";
  const step = ELEMENT_BYTES[f.kind] ?? 4;
  if (f.kind === "text" || f.kind === "utf16") {
    const units: number[] = [];
    for (let at = f.offset; at + step <= f.offset + f.size; at += step) {
      const u = step === 1 ? view.getUint8(at) : view.getUint16(at, true);
      if (u === 0) break;
      units.push(u);
    }
    return JSON.stringify(String.fromCharCode(...units));
  }
  const values: string[] = [];
  for (let at = f.offset; at + step <= f.offset + f.size; at += step) values.push(element(view, f.kind, at));
  return values.length === 1 ? values[0] : `[${values.join(", ")}]`;
}

const typeLabel = (f: Field) => {
  const step = ELEMENT_BYTES[f.kind] ?? 4;
  return f.kind === "text" || f.kind === "utf16" || f.size <= step ? f.kind : `${f.kind} ×${f.size / step}`;
};

function PageView({ page, hideZero }: { page: MemoryPage; hideZero: boolean }) {
  const [filter, setFilter] = useState("");
  const bytes = useMemo(() => toBytes(page.hex), [page.hex]);
  const view = useMemo(() => new DataView(bytes.buffer), [bytes]);
  const known = useMemo(() => [...page.fields].sort((a, b) => a.offset - b.offset), [page.fields]);
  const claimed = useMemo(() => {
    const set = new Set<number>();
    for (const f of known) for (let at = f.offset - (f.offset % 4); at < f.offset + f.size; at += 4) set.add(at);
    return set;
  }, [known]);

  const q = filter.trim().toLowerCase();
  const knownRows = known.filter((f) => !q || f.name.toLowerCase().includes(q) || String(f.offset) === q);
  const raw: { at: number; u: number; i: number; f: number }[] = [];
  let rawTotal = 0;
  for (let at = 0; at + 4 <= bytes.length; at += 4) {
    if (claimed.has(at)) continue;
    const u = view.getUint32(at, true);
    if (hideZero && u === 0) continue;
    if (q && String(at) !== q) continue;
    rawTotal++;
    if (raw.length < RAW_ROW_CAP) raw.push({ at, u, i: view.getInt32(at, true), f: view.getFloat32(at, true) });
  }

  return (
    <section className="card" aria-label={`${page.label} page`}>
      <h2>{page.label}</h2>
      <span className="muted mono">
        {page.name} · {page.open ? `${page.size} bytes mapped (${page.size / 4} words)` : "not there: the game hasn't created it"}
      </span>
      {page.open && (
        <>
          <div style={{ margin: "12px 0" }}>
            <input placeholder="Filter by field name, or an exact offset" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <h3>Known fields ({knownRows.length})</h3>
          <div style={{ overflowX: "auto" }}>
            <table className="mono" style={{ fontSize: 13, width: "100%" }}>
              <thead><tr><th align="left">Offset</th><th align="left">Name</th><th align="left">Type</th><th align="left">Value</th></tr></thead>
              <tbody>
                {knownRows.map((f) => (
                  <tr key={f.name + f.offset}>
                    <td>{f.offset}</td>
                    <td>{f.name}</td>
                    <td>{typeLabel(f)}</td>
                    <td style={{ wordBreak: "break-all" }}>{decode(view, f)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 style={{ marginTop: 18 }}>Everything else, a 4-byte word at a time ({rawTotal}{hideZero ? " non-zero" : ""})</h3>
          <div style={{ overflowX: "auto" }}>
            <table className="mono" style={{ fontSize: 13, width: "100%" }}>
              <thead><tr><th align="left">Offset</th><th align="left">Hex</th><th align="left">As int</th><th align="left">As float</th></tr></thead>
              <tbody>
                {raw.map((r) => (
                  <tr key={r.at}>
                    <td>{r.at} (0x{r.at.toString(16)})</td>
                    <td>{r.u.toString(16).padStart(8, "0")}</td>
                    <td>{r.i}</td>
                    <td>{Number.isFinite(r.f) ? num(r.f) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rawTotal > raw.length && <span className="muted">Showing {raw.length} of {rawTotal}; filter to narrow it down.</span>}
        </>
      )}
    </section>
  );
}

/** Dev builds only: what each game's shared memory holds, raw. */
export function DevMemoryPage() {
  const { status } = useAppState();
  const active = status?.session?.game;
  const [picked, setPicked] = useState<string | null>(null);
  const game = picked ?? (active && SHM_GAMES.includes(active) ? active : "acevo");
  const [pages, setPages] = useState<MemoryPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [hideZero, setHideZero] = useState(true);

  useEffect(() => {
    let stop = false;
    const read = () =>
      api.devMemory(game).then(
        (p) => { if (!stop) { setPages(p); setError(null); } },
        (e: Error) => { if (!stop) setError(e.message); },
      );
    read();
    if (!live) return () => { stop = true; };
    const timer = window.setInterval(read, 500);
    return () => { stop = true; window.clearInterval(timer); };
  }, [game, live]);

  return (
    <>
      <div className="page-head" style={{ alignItems: "center" }}>
        <h1>Shared memory</h1>
        <div className="segmented" role="group" aria-label="Game">
          {SHM_GAMES.map((g) => (
            <button key={g} aria-pressed={game === g} onClick={() => { setPicked(g); setPages(null); }}>
              {GAMES.find((x) => x.key === g)?.name ?? gameName(g)}
            </button>
          ))}
        </div>
      </div>
      <p className="muted">
        Dev builds only. Every page the game maps, copied whole: the fields Bin It knows are named, and the rest is shown as plain numbers.
        AC and Rally share page names, so pick the one you're running.
      </p>
      <div style={{ display: "flex", gap: 20, margin: "8px 0 16px" }}>
        <label><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Live (twice a second)</label>
        <label><input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} /> Hide empty words</label>
      </div>
      {error && <div className="empty">{error}</div>}
      {pages?.map((p) => <PageView key={p.label} page={p} hideZero={hideZero} />)}
    </>
  );
}
