import { useEffect, useRef, useState } from "react";
import { api, isTauri, useAppState, useFetch } from "./api";
import { GameIcon } from "./components/GameIcon";
import { readStored, usePersistedState, writeStored } from "./persist";
import { OverlayToggle } from "./components/OverlayToggle";
import { UpdateButton } from "./components/Update";
import { MeBar } from "./components/MeBar";
import { TitleBar } from "./components/TitleBar";
import { Helmet, Logo } from "./components/Helmet";
import { Home } from "./pages/Home";
import { ConnectionGate } from "./components/ConnectionGate";
import { LeaderboardPage } from "./pages/Leaderboard";
import { ChallengesPage } from "./pages/Challenges";
import { DriversPage } from "./pages/Drivers";
import { GamesPage } from "./pages/Games";
import { AdvancedPage } from "./pages/Advanced";
import { TelemetryPage } from "./pages/Telemetry";
import { Overlay } from "./pages/Overlay";
import { YouPage } from "./pages/You";
import { GaragePage } from "./pages/Garage";
import { ShopPage } from "./pages/Shop";
import { Updater } from "./pages/Updater";
import { openPickDriver, PickDriverHost } from "./components/PickDriver";

const ROUTES = [
  { path: "/", group: "Play", label: "Home", icon: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
  { path: "/you", group: "Play", label: "Profile", icon: "M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 21a8 8 0 0 1 16 0" },
  { path: "/telemetry", group: "Play", label: "Telemetry", icon: "M3 12h4l3-8 4 16 3-8h4" },
  { path: "/leaderboard", group: "Compete", label: "Leaderboards", icon: "M4 20v-6h5v6M9 20V9h6v11M15 20v-8h5v8" },
  { path: "/challenges", group: "Compete", label: "Challenges", icon: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3a3 3 0 0 1-3 4M7 5H4a3 3 0 0 0 3 4" },
  { path: "/drivers", group: "Setup", label: "Drivers", icon: "M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 21a8 8 0 0 1 16 0" },
  { path: "/games", group: "Setup", label: "Games & overlay", icon: "M7 7h10a5 5 0 0 1 0 10H7A5 5 0 0 1 7 7zM7 11v4M5 13h4M16 12h.01M18 14h.01" },
  // Maintenance tools: only offered inside the desktop app, never on phones or other browsers.
  ...(isTauri
    ? [{ path: "/advanced", group: "Setup", label: "Advanced", icon: "M4 6h16M4 12h16M4 18h16M9 3v6M15 9v6M8 15v6" }]
    : []),
];

const GROUPS = ["Play", "Compete", "Setup"] as const;

/** Phones get four tabs, not six pages: what is shared sits in the tabs, what is personal behind the banner. */
const TABS = [
  { href: "#/", label: "Home", match: ["/"], exact: true, icon: ROUTES[0].icon },
  { href: "#/leaderboard", label: "Tracks", match: ["/leaderboard", "/telemetry"], icon: "M5 21V4M5 4h11l-2 4 2 4H5" },
  { href: "#/challenges", label: "Challenges", match: ["/challenges"], icon: ROUTES.find((r) => r.path === "/challenges")!.icon },
  { href: "#/games", label: "Rig", match: ["/games", "/drivers", "/advanced"], icon: "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8 21h8M12 17v4" },
];

/** On a phone, the pages that share a tab are one tap apart. */
const SWITCHES: { match: string[]; items: { href: string; label: string; path: string }[] }[] = [
  { match: ["/leaderboard", "/telemetry"], items: [{ href: "#/leaderboard", label: "Boards", path: "/leaderboard" }, { href: "#/telemetry", label: "Telemetry", path: "/telemetry" }] },
  { match: ["/games", "/drivers"], items: [{ href: "#/games", label: "Games & overlay", path: "/games" }, { href: "#/drivers", label: "Drivers", path: "/drivers" }] },
];

function PhoneSwitch({ path }: { path: string }) {
  const sw = SWITCHES.find((x) => x.match.some((m) => path.startsWith(m)));
  if (!sw) return null;
  return (
    <div className="phone-switch segmented" role="group" aria-label="Page">
      {sw.items.map((i) => (
        <a key={i.path} href={i.href} aria-pressed={path.startsWith(i.path)}>{i.label}</a>
      ))}
    </div>
  );
}

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

/** The last page visited inside each section (`/challenges/3`, `/drivers/2`), so its nav link returns there. */
const lastPathKey = (section: string) => `lastPath.${section}`;

function titleFor(path: string) {
  if (path.startsWith("/garage")) return "Garage";
  if (path.startsWith("/shop")) return "Shop";
  return ROUTES.find((r) => (r.path === "/" ? path === "/" : path.startsWith(r.path)))?.label ?? "Bin It";
}

/** Small windows always get the icon rail; otherwise it is the person's choice. */
function useCollapsed() {
  const [user, setUser] = usePersistedState<boolean>("sidebarCollapsed", false, (v) => typeof v === "boolean");
  const query = "(max-width: 1100px)";
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return [user || narrow, user, setUser] as const;
}

export function App() {
  const path = useHashPath();
  const [collapsed, userCollapsed, setUserCollapsed] = useCollapsed();
  useEffect(() => {
    const section = ROUTES.find((r) => r.path !== "/" && path.startsWith(r.path));
    if (section) writeStored(lastPathKey(section.path), path === section.path ? null : path);
  }, [path]);
  // Each page starts at the top (the content column keeps its own scroll position).
  useEffect(() => {
    document.querySelector(".content")?.scrollTo(0, 0);
  }, [path]);
  if (path.startsWith("/overlay")) return <Overlay />;
  if (path.startsWith("/updater")) return <Updater />;

  let page;
  if (path.startsWith("/leaderboard")) page = <LeaderboardPage />;
  else if (path.startsWith("/challenges")) page = <ChallengesPage path={path} />;
  else if (path.startsWith("/drivers")) page = <DriversPage path={path} />;
  else if (path.startsWith("/games")) page = <GamesPage />;
  else if (path.startsWith("/telemetry")) page = <TelemetryPage path={path} />;
  else if (path.startsWith("/advanced")) page = <AdvancedPage />;
  else if (path.startsWith("/you")) page = <YouPage path={path} />;
  else if (path.startsWith("/garage")) page = <GaragePage />;
  else if (path.startsWith("/shop")) page = <ShopPage />;
  else page = <Home />;

  return (
    <div className={`shell${collapsed ? " collapsed" : ""}`}>
      <Sidebar path={path} collapsed={collapsed} onToggle={() => setUserCollapsed(!userCollapsed)} />
      <div className="main-col">
        <TitleBar title={titleFor(path)} />
        {!isTauri && <MeBar />}
        <main className="content">
          <PhoneSwitch path={path} />
          {page}
        </main>
      </div>
      <ConnectionGate />
      <PickDriverHost />
    </div>
  );
}

function Sidebar({ path, collapsed, onToggle }: { path: string; collapsed: boolean; onToggle: () => void }) {
  const { status, online, drivers } = useAppState();
  const server = useFetch(() => api.server(), [online]);
  const lanUrl = server?.urls[0];
  // On phones the menu is a bar fixed to the bottom; its height (--dock-h) lets sticky things sit above it.
  const aside = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = aside.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const set = () => document.documentElement.style.setProperty("--dock-h", `${el.offsetHeight}px`);
    const ro = new ResizeObserver(set);
    ro.observe(el);
    window.addEventListener("resize", set);
    set();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", set);
    };
  }, []);

  const driver = status?.seat != null ? drivers.find((d) => d.id === status.seat) : undefined;
  const driving = !!driver && status?.live?.phase === "driving";
  const switchDriver = openPickDriver;
  const gameLabel = !online ? "Offline" : status?.connected ? status.gameName : "No game running";

  return (
    <aside className="sidebar" ref={aside}>
      <div className="sidebar-head" data-tauri-drag-region>
        <a className="brand" href="#/" title="Bin It">
          <Logo />
          <span>bin it</span>
        </a>
        <button type="button" className="icon-btn sidebar-toggle" onClick={onToggle} aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"} title={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <path d="M9 4v16" />
          </svg>
        </button>
      </div>
      <nav className="nav" aria-label="Main">
        {GROUPS.map((group) => (
          <div className="nav-group" key={group}>
            <div className="nav-group-label">{group}</div>
            {ROUTES.filter((r) => r.group === group).map((r) => {
              const current = r.path === "/" ? path === "/" : path.startsWith(r.path);
              // Another section: go back to where you were in it. The one you're in: its main page.
              const remembered = current ? null : readStored<string | null>(lastPathKey(r.path), null, (v) => typeof v === "string" && v.startsWith(r.path));
              return (
                <a key={r.path} href={`#${remembered ?? r.path}`} aria-current={current ? "page" : undefined} title={r.label}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d={r.icon} />
                  </svg>
                  <span className="nav-label">{r.label}</span>
                </a>
              );
            })}
          </div>
        ))}
      </nav>
      <nav className="tabbar" aria-label="Main">
        {TABS.map((t) => {
          const current = t.match.some((m) => (t.exact ? path === m : path.startsWith(m)));
          return (
            <a key={t.href} href={t.href} aria-current={current ? "page" : undefined}>
              <span className="tab-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={t.icon} />
                </svg>
              </span>
              {t.label}
            </a>
          );
        })}
      </nav>
      <span className="sidebar-fill" />
      {lanUrl && (
        <div className="lan-box">
          <span className="muted">Open on any office device</span>
          <span className="mono">{lanUrl}</span>
        </div>
      )}
      <UpdateButton />
      <div className="seat-card">
        <button type="button" className="seat-who" data-driving={driving || undefined} onClick={driver ? () => (location.hash = `#/you/${driver.id}`) : switchDriver} title={driver ? `${driver.name} is in the seat. Open their profile` : "Nobody in the seat. Pick a driver"}>
          <Helmet color={driver?.color ?? "#5b6578"} look={driver?.look} size={44} seed={driver?.id} mood={driving ? "happy" : "idle"} />
          <span className="seat-text">
            <span className="seat-name">{driver ? driver.name : "Guest"}</span>
            <span className="seat-sub" data-driving={driving || undefined}>{driving ? "Driving" : driver ? "In the seat" : "Pick a driver"}</span>
          </span>
        </button>
        <button type="button" className="seat-switch" onClick={switchDriver}>
          Switch driver <span className="kbd-key">F8</span>
        </button>
        <div className="seat-row">
          <div className="game-pill" title={!online ? "Can't reach the Bin It service" : status?.connected ? `${status.gameName} is running` : "No game running"}>
            <span className={`dot${status?.connected ? " on" : ""}`} />
            {online && status?.connected && status.game && <GameIcon game={status.game} size={20} />}
            <span className="game-name">{gameLabel}</span>
            {status?.connected && <span className="live">live</span>}
          </div>
          <OverlayToggle compact />
        </div>
      </div>
    </aside>
  );
}
