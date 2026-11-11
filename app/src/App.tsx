import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
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
import { ChallengesPage, NewChallengePage } from "./pages/Challenges";
import { ProLapsPage } from "./pages/ProLaps";
import { DriversPage } from "./pages/Drivers";
import { GamesPage } from "./pages/Games";
import { AdvancedPage } from "./pages/Advanced";
import { DevMemoryPage } from "./pages/DevMemory";
import { TelemetryPage } from "./pages/Telemetry";
import { Overlay } from "./pages/Overlay";
import { YouPage } from "./pages/You";
import { StickerBookPage } from "./pages/Stickers";
import { StatsPage } from "./pages/Stats";
import { BreakdownPage } from "./pages/Breakdown";
import { ComparePage } from "./pages/Compare";
import { ParcelGate } from "./components/Parcel";
import { CustomizePage } from "./pages/Customize";
import { ShopPage } from "./pages/Shop";
import { Updater } from "./pages/Updater";
import { openPickDriver, PickDriverHost } from "./components/PickDriver";
import { QrCode } from "./components/QrCode";
import { SignIn } from "./components/SignIn";

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
  // Developer tools: dev builds only, never shipped.
  ...(import.meta.env.DEV ? [{ path: "/dev/memory", group: "Setup", label: "Dev: memory", icon: "M8 3v3M16 3v3M8 18v3M16 18v3M3 8h3M3 16h3M18 8h3M18 16h3M7 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM10 10h4v4h-4z" }] : []),
];

const GROUPS = ["Play", "Compete", "Setup"] as const;

/** Phones get four tabs, not six pages: what is shared sits in the tabs, what is personal behind the banner. */
const TABS = [
  { href: "#/", label: "Home", match: ["/"], exact: true, icon: ROUTES[0].icon },
  { href: "#/leaderboard", label: "Tracks", match: ["/leaderboard", "/telemetry"], icon: "M5 21V4M5 4h11l-2 4 2 4H5" },
  { href: "#/challenges", label: "Challenges", match: ["/challenges"], icon: ROUTES.find((r) => r.path === "/challenges")!.icon },
  { href: "#/games", label: "Rig", match: ["/games", "/drivers", "/advanced", "/dev"], icon: "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8 21h8M12 17v4" },
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

/** The office challenges page, with or without a challenge picked in its row of cards. */
const isChallengeList = (path: string) => /^\/challenges(\/\d+)?$/.test(path);

/** The id of the Pro lap whose page this is (`/challenges/pro/monza-f2004`), if it is one. */
const proLapId = (path: string) => /^\/challenges\/pro\/([\w-]+)$/.exec(path)?.[1] ?? null;

/** How deep a page sits: the Shop and Customize open from the profile, so they are one step further in than it. */
function pageDepth(path: string): number {
  // The office list, the challenge picked in it and the Pro laps list are one level: they are switched between, not opened.
  if (isChallengeList(path) || path === "/challenges/pro") return 1;
  const base = path.split("/").filter(Boolean).length;
  return base + (path.startsWith("/shop") || path.startsWith("/customize") ? 1 : 0);
}

type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void | Promise<void>) => { ready: Promise<unknown>; finished: Promise<unknown> } };

/**
 * What to do when the address changes: show the new page, with a view transition when the browser has them. This is a
 * function of its own (not written inside the hook) so that editing it while the app runs replaces the listener too.
 */
function makeNavHandler(read: () => string, current: { current: string }, setPath: (path: string) => void) {
  return () => {
    const next = read();
    const from = current.current;
    current.current = next;
    const doc = document as ViewTransitionDocument;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Picking another challenge in the row changes what is shown, not the page: nothing slides.
    if (!doc.startViewTransition || calm || next === from || (isChallengeList(from) && isChallengeList(next))) {
      setPath(next);
      return;
    }
    // A Pro lap's card grows into its page, and the page shrinks back into its card: the card and the page's banner
    // are one shared element (see `pro-hero` in styles.css) while everything else fades and the page's parts rise in.
    const entering = from === "/challenges/pro" ? proLapId(next) : null;
    const leaving = next === "/challenges/pro" ? proLapId(from) : null;
    if (entering || leaving) {
      const root = document.documentElement;
      const card = (id: string) => document.querySelector<HTMLElement>(`[data-pro-card="${CSS.escape(id)}"]`);
      // The picture, the shading and each piece of text on it are shared with their twin on the other page, one by one,
      // so the time and the title move to where they are on the other page (a whole block would be stretched into
      // the other's shape). A shared element is drawn above the rest of the page, so each piece has to be shared or
      // it would be hidden behind the growing picture until the end.
      // Pieces that are the same on both pages move across (the title, the time, the chip). Pieces that are not (the car
      // line, the game, the status) are named too, so they stay above the picture, but each on its own: the card's
      // fade out and the banner's fade in, rather than one smearing into the other.
      const shared: [string, string][] = [
        [".pro-art", "pro-hero"], [".pro-flag-chip", "pro-chip"], [".pro-card-name", "pro-title"], [".pro-card-time", "pro-time"],
        [".pro-card-car", "pro-card-car"], [".pro-card-meta", "pro-card-meta"], [".pro-status", "pro-card-status"],
      ];
      const mark = (el: HTMLElement | null) => {
        if (!el) return;
        for (const [selector, name] of shared) el.querySelector<HTMLElement>(selector)?.style.setProperty("view-transition-name", name);
        el.dataset.hero = "1";
      };
      root.dataset.nav = entering ? "open" : "close";
      if (entering) mark(card(entering)); // the page being left: the card that was tapped
      // Where each picture is centred, so the one picture that moves can slide from the card's crop to the banner's
      // (or back) as it grows. Read from the pictures themselves: the data sets them.
      // (the offset is on the picture inside the `.pro-art` wrapper)
      const where = (el: Element | null | undefined) => el?.querySelector<HTMLElement>("img")?.style.objectPosition || "50% 50%";
      let cardPos = entering ? where(card(entering)?.querySelector(".pro-art")) : "50% 50%";
      // The banner's picture is the whole photo, taller than the banner (the rest is cut off by the banner's edge), so it
      // can show the card's framing exactly. These are how much of it is cut off, so the grow can end on the banner.
      const cut = (hero: Element | null): [number, number] => {
        const art = hero?.querySelector(".pro-art")?.getBoundingClientRect();
        const box = hero?.getBoundingClientRect();
        return art && box ? [Math.max(0, box.top - art.top), Math.max(0, art.bottom - box.bottom)] : [0, 0];
      };
      let cuts = leaving ? cut(document.querySelector(".pro-hero")) : ([0, 0] as [number, number]);
      const t = doc.startViewTransition(async () => {
        flushSync(() => setPath(next));
        if (leaving) mark(card(leaving)); // the page being entered: the card the banner shrinks into
        if (leaving) cardPos = where(card(leaving)?.querySelector(".pro-art"));
        if (entering) cuts = cut(document.querySelector(".pro-hero"));
        root.style.setProperty("--vt-card-pos", cardPos);
        root.style.setProperty("--vt-cut-top", `${cuts[0]}px`);
        root.style.setProperty("--vt-cut-bottom", `${cuts[1]}px`);
        // The new page is captured as soon as this returns. Its picture is the one already on screen (same file), so it
        // is loaded; it is decoded while the page is made (`decoding="sync"` on it), so it is in the capture. Only a
        // picture that is not loaded yet is waited for, briefly.
        const picture = document.querySelector<HTMLImageElement>(entering ? ".pro-hero .pro-art img" : `[data-pro-card="${CSS.escape(leaving!)}"] .pro-art img`);
        if (picture && !picture.complete) await new Promise((done) => { picture.addEventListener("load", done, { once: true }); setTimeout(done, 400); });
      });
      t.ready.catch(() => {});
      t.finished.catch(() => {}).finally(() => {
        delete root.dataset.nav;
        for (const name of ["--vt-card-pos", "--vt-cut-top", "--vt-cut-bottom"]) root.style.removeProperty(name);
        document.querySelectorAll<HTMLElement>("[data-hero]").forEach((el) => {
          el.querySelectorAll<HTMLElement>("*").forEach((child) => child.style.removeProperty("view-transition-name"));
          delete el.dataset.hero;
        });
      });
      return;
    }
    // The page area slides in from the right going deeper, from the left coming back, and rises in between sections
    // (see `::view-transition-*(page)` in styles.css). Browsers without view transitions just change page.
    const [a, b] = [pageDepth(from), pageDepth(next)];
    const root = document.documentElement;
    root.dataset.nav = b > a ? "forward" : b < a ? "back" : "across";
    const t = doc.startViewTransition(() => flushSync(() => setPath(next)));
    // A newer navigation skips this one mid-flight; that rejection is expected.
    t.ready.catch(() => {});
    t.finished.catch(() => {}).finally(() => delete root.dataset.nav);
  };
}

function useHashPath() {
  const read = () => location.hash.replace(/^#/, "") || "/";
  const [path, setPath] = useState(read);
  const current = useRef(path);
  useEffect(() => {
    const onChange = makeNavHandler(read, current, setPath);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, [makeNavHandler]);
  return path;
}

/** The last page visited inside each section (`/challenges/3`, `/drivers/2`), so its nav link returns there. */
const lastPathKey = (section: string) => `lastPath.${section}`;

/**
 * Only these sections bring you back to the page you were on (the challenge or the telemetry lap you were looking at).
 * Everywhere else, and for a "new" form, the nav link opens the section's own front page: a profile or a driver's
 * progress that was open once must not be what "Profile" or "Drivers" opens next time.
 */
const REMEMBERS = ["/challenges", "/telemetry"];
const remembersPath = (section: string, path: string) => REMEMBERS.includes(section) && !path.endsWith("/new");

/** Pages that belong to a nav section without sharing its first path segment. */
const ALSO_IN: Record<string, string[]> = { "/you": ["/customize", "/shop"] };
const inSection = (section: string, path: string) => (section === "/" ? path === "/" : path.startsWith(section) || (ALSO_IN[section] ?? []).some((p) => path.startsWith(p)));

function titleFor(path: string) {
  if (path.startsWith("/customize")) return "Customize";
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
  const { drivers } = useAppState();
  // A phone or browser that is not the PC and not signed in yet sees the sign-in and nothing else.
  const [signedInTick, setSignedInTick] = useState(0);
  const me = useFetch(() => (isTauri ? Promise.resolve(null) : api.me()), [drivers, signedInTick]);
  const [collapsed, userCollapsed, setUserCollapsed] = useCollapsed();
  useEffect(() => {
    const section = ROUTES.find((r) => r.path !== "/" && path.startsWith(r.path));
    if (section && remembersPath(section.path, path)) writeStored(lastPathKey(section.path), path === section.path ? null : path);
  }, [path]);
  // Each page starts at the top (the content column keeps its own scroll position).
  useEffect(() => {
    document.querySelector(".content")?.scrollTo(0, 0);
  }, [path]);
  if (path.startsWith("/overlay")) return <Overlay />;
  if (!isTauri && me && !me.local && !me.driver) return <SignIn onSignedIn={() => setSignedInTick((t) => t + 1)} />;
  if (path.startsWith("/updater")) return <Updater />;

  let page;
  if (path.startsWith("/leaderboard")) page = <LeaderboardPage />;
  else if (path.startsWith("/challenges/new")) page = <NewChallengePage />;
  else if (path.startsWith("/challenges/pro")) page = <ProLapsPage path={path} />;
  else if (path.startsWith("/challenges")) page = <ChallengesPage path={path} />;
  else if (path.startsWith("/drivers/compare")) page = <ComparePage />;
  else if (/^\/drivers\/\d+/.test(path)) page = <BreakdownPage id={Number(path.split("/")[2])} />;
  else if (path.startsWith("/drivers")) page = <DriversPage />;
  else if (path.startsWith("/games")) page = <GamesPage />;
  else if (path.startsWith("/telemetry")) page = <TelemetryPage path={path} />;
  else if (import.meta.env.DEV && path.startsWith("/dev/memory")) page = <DevMemoryPage />;
  else if (path.startsWith("/advanced")) page = <AdvancedPage />;
  else if (/^\/you\/\d+\/stickers/.test(path)) page = <StickerBookPage id={Number(path.split("/")[2])} />;
  else if (/^\/you\/\d+\/(stats|progress)/.test(path)) page = <StatsPage id={Number(path.split("/")[2])} />;
  else if (path.startsWith("/you")) page = <YouPage path={path} />;
  else if (path.startsWith("/customize")) page = <CustomizePage />;
  else if (path.startsWith("/shop")) page = <ShopPage />;
  else page = <Home />;

  return (
    <>
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
    {/* Outside the shell: while a parcel is up the shell is inert, and the parcel must still work. */}
    <ParcelGate />
    </>
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
              const current = inSection(r.path, path);
              // Another section: go back to where you were in it. The one you're in: its main page.
              const remembered = current || !REMEMBERS.includes(r.path) ? null : readStored<string | null>(lastPathKey(r.path), null, (v) => typeof v === "string" && v.startsWith(r.path) && !v.endsWith("/new"));
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
          <QrCode url={lanUrl} size={84} />
          <span className="lan-text">
            <span className="muted">Scan or open on any office device</span>
            <span className="mono">{lanUrl}</span>
          </span>
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
