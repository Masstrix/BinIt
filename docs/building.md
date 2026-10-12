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

## Version numbers

* **App version**: `version` under `[workspace.package]` in the root `Cargo.toml`. It is the only
  place: `tauri.conf.json` has none, so Tauri uses this one, and the build script names files after
  it. Bump it before packaging a new release.
* **Build number**: a counter in `.build-number` at the repo root (git-ignored, so it is per checkout;
  it starts at 1 on a fresh clone). `app/src-tauri/build.rs` adds one every time the app is compiled
  after a source change (dev rebuilds, `cargo test`, release builds) and bakes it into the exe. It shows
  on the Advanced page ("Version 0.1.0 · build 42") and in the packaged file names
  (`BinIt-0.1.0-b42-portable.exe`), so two copies can be compared. Numbers can skip (a test run and
  the release build both count) but never go down. Only compare numbers from the same checkout.
* **Database format**: `SCHEMA_VERSION` in `crates/tt-core/src/store.rs`. Bump it and add a
  `if version < N { ... }` migration whenever a table or column changes. A database from a newer
  format is refused rather than downgraded.
* **Stored blobs** carry their own version byte (see `LapTrace` in `crates/tt-games/src/timing.rs`).
