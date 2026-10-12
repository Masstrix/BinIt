# Building and packaging Bin It

Working on the code day to day (rebuilding, previewing, checking on a phone)? See [agent-handoff.md](agent-handoff.md).

## Everyday development

```
cd app
npm install          # once
npm run tauri dev    # desktop app with hot reload (UI on :1420, Bin It server on :7878)
```

Tests: `cargo test --workspace` and, in `app/`, `npx tsc --noEmit`.

Phone testing while developing: open `http://<this PC's address>:7878`. In a debug build that port
forwards to the Vite dev server, so only 7878 needs to be reachable through the firewall.

## Making something to copy to another PC

From the project root, either double-click **`build.cmd`** or run:

```
.\scripts\build.ps1                 # tests, then installer + standalone exe
.\scripts\build.ps1 -SkipInstaller  # just the standalone exe (much quicker)
.\scripts\build.ps1 -SkipTests
```

(`npm run package` in `app/` does the same thing.)

Everything lands in **`dist/`** (git-ignored, emptied on every run):

| File | What it is |
|---|---|
| `BinIt-<version>-b<build>-setup.exe` | Installer (NSIS): Start menu entry, uninstaller |
| `BinIt-<version>-b<build>-portable.exe` | The app on its own: copy it anywhere and run it |
| `BinIt-<version>-b<build>-portable.zip` | A folder with `BinIt.exe` and `README.txt`, zipped, for a USB stick or email |
| `README.txt` | What to do on the other PC (install, firewall, data, troubleshooting). Edit `scripts/dist-readme.txt` |
| `SHA256SUMS.txt` | Checksums to verify a copy |

Requirements on the PC that builds: Rust (stable), Node.js, and for the installer an internet
connection the first time (the Tauri bundler fetches the NSIS tooling). The PC that runs the result
needs Windows 10/11 and the WebView2 runtime. Nothing is code-signed, so Windows SmartScreen asks
once ("More info", "Run anyway").

## Releases and updates

Releases are made on GitHub, not on a PC: **Actions → Release → Run workflow** (on `main`), pick
patch / minor / major or type an exact version. The workflow (`.github/workflows/release.yml`):

1. raises the version (`scripts/set-version.mjs`: `Cargo.toml`, `Cargo.lock`, `app/package.json`,
   `app/package-lock.json`),
2. runs `scripts/build.ps1` on a Windows machine: the tests, then the installer and portable exe,
   with the installer signed for updates,
3. gathers the release files (`scripts/prepare-release.mjs`): the versioned files, the same
   installer and portable exe as `BinIt-setup.exe` / `BinIt-portable.exe` (names that never change,
   so `https://github.com/Masstrix/BinIt/releases/latest/download/BinIt-setup.exe` is always the
   newest), `latest.json`, and release notes from the commit subjects since the last release,
4. commits "Release vX.Y.Z" to `main`, tags it `vX.Y.Z`, and publishes the GitHub release.

Nothing is committed, tagged or published unless the tests and the build pass.

**How the app updates** (`app/src-tauri/src/updater.rs`, Tauri's updater plugin):

* The **installed** app (the one with `uninstall.exe` next to it) checks
  `releases/latest/download/latest.json` every time it starts. The main window starts hidden and a
  small window with the logo and a progress bar (`app/src/pages/Updater.tsx`) shows instead. When
  there's a newer version it downloads the installer, checks its signature against `pubkey` in
  `tauri.conf.json`, runs it silently, and the installer starts Bin It again. No update, no
  internet (it gives up after 8 seconds) or any error: the small window closes and the app opens.
* While it runs, the app **checks again every hour**. A newer version found then is announced, not
  installed by itself (nobody gets thrown out mid-lap): an "Update to X" button appears in the menu,
  on the PC and on phones, and the **Updates** card at the top of Advanced says what's new. "Update
  now" (either place, after a confirmation) shows the same small window and installs it; "Check for
  updates" looks straight away. Phones go through the same HTTP API as the desktop window:
  `GET /api/update`, `POST /api/update/check`, `POST /api/update/install`, and every change is pushed
  to all screens as an `updateChanged` event.
* The **portable** exe can't replace itself. It checks too (at start and hourly), and the menu
  button, the Updates card and the strip at the foot of Home link to the latest download instead.
* **Development builds** never check. Open `http://localhost:1420/#/updater` in a browser while
  `npm run dev` runs to see the update window play through its stages.
* Versions only go up: an installed copy ignores a release that isn't newer than itself.

**The update-signing key.** The installer must be signed with the private key that matches
`plugins.updater.pubkey` in `tauri.conf.json`, or installed copies refuse it. The workflow reads it
from the repository secret `TAURI_SIGNING_PRIVATE_KEY` (Settings → Secrets and variables →
Actions), plus `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if the key has a password. Keep a copy of the
key somewhere safe: **if it is lost, installed copies can never update again** (they'd need the
new installer run by hand once, after a new key pair is made with `npx tauri signer generate` in
`app/` and its public key put in `tauri.conf.json`).

A local `build.cmd` doesn't sign anything unless `TAURI_SIGNING_PRIVATE_KEY` is set; then it signs
the installer too (`app/src-tauri/tauri.updater.conf.json` turns that on).

## Version numbers

* **App version**: `version` under `[workspace.package]` in the root `Cargo.toml`. It is the only
  place: `tauri.conf.json` has none, so Tauri uses this one, and the build script names files after
  it. The release workflow raises it; for a local build, bump it by hand or with `node scripts/set-version.mjs`.
* **Build number**: a counter in `.build-number` at the repo root (git-ignored, so it is per checkout;
  it starts at 1 on a fresh clone). `app/src-tauri/build.rs` adds one every time the app is compiled
  after a source change (dev rebuilds, `cargo test`, release builds) and bakes it into the exe. It shows
  on the Advanced page ("Version 0.1.0 · build 42") and in the packaged file names
  (`BinIt-0.1.0-b42-portable.exe`), so two copies can be compared. Numbers can skip (a test run and
  the release build both count) but never go down. Only compare numbers from the same checkout.
  Releases built on GitHub use the workflow's run number instead (`BINIT_BUILD_NUMBER`).
* **Database format**: `SCHEMA_VERSION` in `crates/tt-core/src/store.rs`. Bump it and add a
  `if version < N { ... }` migration whenever a table or column changes. A database from a newer
  format is refused rather than downgraded.
* **Stored blobs** carry their own version byte (see `LapTrace` in `crates/tt-games/src/timing.rs`).
