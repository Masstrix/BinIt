# Working on TimeTrial: rebuild, preview, and check it on a phone

For any agent (or person) picking this project up. It covers how a change you make reaches the
desktop app, a browser, and the owner's phone, and how to check each one. Packaging an `.exe` is in
[building.md](building.md). Product decisions and what's built are in [roadmap.md](roadmap.md).

## The moving parts

```
crates/tt-games     game adapters (AC EVO shared memory), lap tracking, timing profiles, input traces
crates/tt-core      the domain: drivers, seat, laps, challenges, leaderboards, catalogue, SQLite
app/src-tauri       the desktop app: HTTP + WebSocket server (axum, port 7878) and the overlay window
app/src             the React UI (Vite, port 1420 in development)
```

* The UI never talks to the game. It talks to the server on **:7878** (`/api/...` plus a
  WebSocket at `/api/events`). The desktop window, a browser and a phone all use the same API.
* In development the desktop window loads the UI from Vite on **:1420**.
* The server also listens on the office network (setting "Share on network", on by default).

## Who runs what

**The owner runs the dev app** (`cd app; npm run tauri dev`) and keeps it open; its output goes to
`dumps/tauri-dev.log`. You normally just edit files. Do not start a second dev server, and do not
kill theirs. If `http://127.0.0.1:7878/api/status` doesn't answer, say so and ask rather than
starting your own. The app also allows only one instance at a time.

`preview_start {name: "ui"}` fails when the owner's Vite is already on 1420. That is expected: use
`navigate` to `http://localhost:1420/#/...` instead.

## How a change reaches each screen

| You edited | Desktop window | Browser at `localhost:1420` | Phone |
|---|---|---|---|
| `app/src/**` (UI) | hot-reloads on save | hot-reloads (or `location.reload()`) | **refresh the page by hand** |
| `crates/**` or `app/src-tauri/src/**` (Rust) | `tauri dev` rebuilds and **restarts the app**: 10 to 60 s, longer after a `Cargo.toml` change | the API is down meanwhile, then it reconnects | same, then refresh |
| `app/vite.config.ts`, `tauri.conf.json` | Vite restarts by itself for its own config; Tauri config needs a dev restart (ask the owner) | | |

A restart also re-runs database migrations and the catalogue relabelling, so schema mistakes show up
immediately. While the server is down the UI shows the "Can't reach TimeTrial" screen after 2.5 s
and recovers by itself.

### Why the phone uses port 7878, not 1420

The owner's Windows Firewall has a **Block** rule for `node.exe` on Public networks, and their
network is Public, so a phone can't reach Vite on 1420 (it just hangs). Port 7878 (the app) is
allowed. So in **debug builds** the server forwards every non-`/api` request to Vite over loopback
(`dev_proxy` in `app/src-tauri/src/server.rs`, compiled out of release builds). The phone opens:

```
http://<this PC's LAN address>:7878
```

* There is no hot reload over that path (Vite's update socket isn't forwarded): **refresh the phone page**.
* Find the address on the Games page (also shown as a QR code), or `ipconfig`. At time of writing it
  was `192.168.0.79` (Ethernet). Ignore virtual adapters such as Hyper-V's `192.168.240.1`: phones
  can't reach them. The server's list already filters those out (`lan_urls` in `server.rs`).
* In development the page picks the API address from where it was loaded (`BASE` in `app/src/api.ts`),
  so the same page works from `localhost` and from a phone.

* **A phone that shows an old UI:** `static_asset` used to serve the bundled `app/dist` before trying
  Vite, so a leftover `dist` (from `npm run build` or `build.cmd`) froze the phone on that build.
  Debug builds now ask Vite first and only fall back to the bundle if Vite is down. To confirm the
  phone is getting the live UI: `curl -s http://127.0.0.1:7878/ | grep -c "@vite/client"` must print `1`.
  (A page with `/assets/index-<hash>.js` is the bundle, not the dev UI.)

You can't hold a phone, but you can check the same path from the PC:

```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://192.168.0.79:7878/          # 200 text/html
curl -s -o /dev/null -w "%{http_code}\n" http://192.168.0.79:7878/src/main.tsx              # 200
curl -s -w " [%{http_code}]\n" http://192.168.0.79:7878/api/admin/about                      # 403, by design
```

## The loop to follow after a change

1. Edit. Run `cargo test --workspace` and, in `app/`, `npx tsc --noEmit`.
2. If you changed Rust, wait for the app to come back (a bare `sleep` is blocked in this harness, so
   use a loop):
   ```bash
   for i in $(seq 1 40); do curl -s -m 2 http://127.0.0.1:7878/api/status >/dev/null && break; sleep 3; done
   ```
3. Check the API with `curl`/Python against `http://127.0.0.1:7878/api/...` (routes are in `server.rs`).
4. Check the page in the browser pane: `navigate`, then `location.reload()` through `javascript_tool`
   after Rust restarts. Prefer reading the DOM (`javascript_tool`, `get_page_text`, `read_page`) to
   screenshots.
5. For phone layouts: `resize_window` with `preset: "mobile"` (375x812), check there is no horizontal
   scroll (`document.documentElement.scrollWidth === innerWidth`), then **reset to `desktop`**.
6. Say what you verified and what you could not (for example "not seen on a real phone").

## Gotchas that cost time

* **The browser pane lies sometimes.** Screenshots time out when the pane isn't drawn; when it is
  collapsed `innerWidth` is 0, so `max-width` media queries report "narrow" on a desktop layout;
  `requestAnimationFrame` is throttled between your calls. Re-check before concluding the UI is wrong.
  `scrollIntoView` on the main column may not move the visible area: scroll with the mouse instead.
* **Shell quirks.** Long heredocs containing apostrophes sometimes break the Bash tool. Write helper
  scripts with the file tool into the scratchpad and run them. Windows Python cannot see Git-Bash's
  `/tmp`: use real paths. `$TEMP` is *not* the scratchpad folder. There is no PIL.
* **"File changed on disk" notices** are usually the dev app rebuilding or the owner editing. Read
  before editing; never revert.
* **Cargo lock.** `cargo test` waits while a release build (`build.cmd`) is running.

## The owner's real data

The owner uses this app while you work, often mid-lap.

* The database is `%APPDATA%\app.timetrial.desktop\timetrial.db` (plus `-wal` and `-shm`). To look at
  it, copy **all three** files to a temp folder and open the copy (the live data is mostly in the
  `-wal` file while the app is running). Never write to the live file; use the API.
* **Do not change the seat or the overlay layout** to test something. Switching driver mid-lap voids
  that lap for everyone (by design). If you must test the overlay editor, `GET /api/overlay/layout/acevo`
  first, restore exactly what you read afterwards, and expect the owner to be editing it too.
* Test confirmation dialogs by opening and **cancelling** them.
* `/api/admin/*` (counting and deleting laps, About) only answers requests from the PC itself
  (loopback). They exist for the desktop app; delete only if the owner asks.
* Don't read the game's binary content files, ever. Plain-text files the game writes (for example
  `Documents/ACE/Results`), official telemetry and our own data are fine.

## Where to look

* Why telemetry values are corrected (gear offset, lap clock overrun, mirrored map axes):
  `roadmap.md`, and the comments in `crates/tt-games/src/acevo/mod.rs` and `timing.rs`.
* Lap and sector timing design: [sectors.md](sectors.md).
* Adding or changing a game's integration (module layout, where to register it, how to check it against
  the real game): [adding-a-game.md](adding-a-game.md).
* What is stored and for how long (lap rows kept forever, input traces only for timed laps), and the
  three version numbers (app, database format, blob format): `roadmap.md` and `building.md`.
* Commit only when the owner asks. Group commits by area, in build order: Rust crates, the desktop
  server (`app/src-tauri`), the UI, then docs and scripts. Run `cargo test --workspace` and
  `npx tsc --noEmit` first. There is no git remote configured, so nothing is pushed.
