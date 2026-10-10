import { useEffect, useState } from "react";
import { api, useAppState, useFetch } from "./api";
import { Logo } from "./components/Helmet";
import { Home } from "./pages/Home";
import { LeaderboardPage } from "./pages/Leaderboard";
import { ChallengesPage } from "./pages/Challenges";
import { DriversPage } from "./pages/Drivers";
import { GamesPage } from "./pages/Games";
import { Overlay } from "./pages/Overlay";

const ROUTES = [
  { path: "/", label: "Home", icon: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
  { path: "/leaderboard", label: "Leaderboards", icon: "M4 20v-6h5v6M9 20V9h6v11M15 20v-8h5v8" },
  { path: "/challenges", label: "Challenges", icon: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3a3 3 0 0 1-3 4M7 5H4a3 3 0 0 0 3 4" },
  { path: "/drivers", label: "Drivers", icon: "M9 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM2 21a7 7 0 0 1 14 0M19 8v6M16 11h6" },
  { path: "/games", label: "Games & overlay", icon: "M7 7h10a5 5 0 0 1 0 10H7A5 5 0 0 1 7 7zM7 11v4M5 13h4M16 12h.01M18 14h.01" },
];

function useHashPath() {
  const read = () => location.hash.replace(/^#/, "") || "/";
  const [path, setPath] = useState(read);
  useEffect(() => {
    const onChange = () => setPath(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return path;
}

export function App() {
  const path = useHashPath();
  // Each page starts at the top (the content column keeps its own scroll position).
  useEffect(() => {
    document.querySelector(".content")?.scrollTo(0, 0);
  }, [path]);
  if (path.startsWith("/overlay")) return <Overlay />;

  let page;
  if (path.startsWith("/leaderboard")) page = <LeaderboardPage />;
  else if (path.startsWith("/challenges")) page = <ChallengesPage />;
  else if (path.startsWith("/drivers")) page = <DriversPage />;
  else if (path.startsWith("/games")) page = <GamesPage />;
  else page = <Home />;

  return (
    <div className="shell">
      <Sidebar path={path} />
      <main className="content">{page}</main>
    </div>
  );
}

function Sidebar({ path }: { path: string }) {
  const { status, online } = useAppState();
  const server = useFetch(() => api.server(), [online]);
  const lanUrl = server?.urls[0];

  return (
    <aside className="sidebar">
      <a className="brand" href="#/">
        <Logo />
        <span>timetrial</span>
      </a>
      <div className="game-pill" title={!online ? "Can't reach the TimeTrial service" : status?.connected ? `${status.gameName} is running` : "No game running"}>
        <span className={`dot${status?.connected ? " on" : ""}`} />
        <span className="game-name" style={{ flex: 1 }}>{!online ? "Offline" : status?.connected ? status.gameName : "No game running"}</span>
        {status?.connected && <span className="live" style={{ fontSize: 12, color: "var(--mint)" }}>live</span>}
      </div>
      <nav className="nav" aria-label="Main">
        {ROUTES.map((r) => {
          const current = r.path === "/" ? path === "/" : path.startsWith(r.path);
          return (
            <a key={r.path} href={`#${r.path}`} aria-current={current ? "page" : undefined} title={r.label}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={r.icon} />
              </svg>
              <span className="nav-label">{r.label}</span>
            </a>
          );
        })}
      </nav>
      {lanUrl && (
        <div className="lan-box">
          <span className="muted">Open on any office device</span>
          <span className="mono">{lanUrl}</span>
        </div>
      )}
    </aside>
  );
}
