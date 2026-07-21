# Design: Self-contained Gnaw `.app` + `.dmg`

- Date: 2026-07-21
- Status: Approved (design), pending implementation plan
- Owner: enuzzo

## Context

Today the SwiftUI app (`app/Gnaw/`) is a thin native shell. At runtime it resolves
the repository root and launches the Node/Playwright engine as a child process
(`node <root>/dist/engine/src/cli.js`, see `EngineClient.swift`). This means the
app only runs on a machine that has:

1. the repository checkout present at a resolvable path,
2. Node.js installed on `PATH` (or a known location), and
3. a Chromium-family browser installed.

`script/build_and_run.sh` builds into a temporary DerivedData directory and opens
it; nothing runnable is persisted in the repo, and nothing is portable to another
Mac.

The engine is Node/Playwright **by design** (documented in `SESSION-NOTES.md`:
"the engine remains the only interface to future UI work"; "the SwiftUI app should
launch the engine as a child process"). That is what gives Gnaw its value — a real
Chromium executing the page — so the engine stays Node/Playwright. Only the
*packaging and resolution* change.

## Goal

Ship a **self-contained, universal** `Gnaw.app` packaged as `dist/Gnaw.dmg` that a
non-technical colleague — or anyone who finds it on GitHub — can run like a normal
Mac app, with **no repository, no terminal, and no Node install**. If a browser
engine is missing, the app downloads Chromium itself with a friendly prompt.

### Priority: zero friction

The overriding requirement is that end users do nothing technical. All technical
dependencies (Node, engine, Chromium) are made invisible.

### Non-goals

- Notarization / Apple Developer Program membership (deferred — no paid account for
  now). See "Residual friction" and "Future: notarization upgrade path".
- Rewriting the engine in native Swift (would lose Chromium fidelity; out of scope).
- Bundling Chromium inside the app (rejected: ~200MB, ~400MB universal, and dozens
  of helper binaries to ad-hoc sign — download-on-first-run is chosen instead).

## Decisions

| Topic | Decision |
| --- | --- |
| Signing | **Ad-hoc** (`codesign -s -`), unsigned/un-notarized distribution. No paid account. |
| Architecture | **Universal** binary: `arm64` + `x86_64`. |
| Node runtime | **Node 22 LTS**, pinned patch, universal via `lipo`, ad-hoc signed, bundled in `Contents/Resources/node/`. |
| Engine | Compiled engine + production-only `node_modules` bundled in `Contents/Resources/engine/`. |
| Browser | Reuse system Chromium/Chrome/Edge if present; otherwise **warn + download Chromium** on first use. |
| Browser cache | `~/Library/Application Support/Gnaw/browsers` (via `PLAYWRIGHT_BROWSERS_PATH`), alongside existing auth profiles. |
| DMG | Volume "Gnaw", drag-to-`/Applications` layout, first-launch note. Output at `dist/Gnaw.dmg` (dir already git-ignored). |
| Dev workflow | `build_and_run.sh` keeps working via a dev fallback in resolution. |

## Architecture changes

### 1. Bundle the engine

Copy the built engine tree into `Gnaw.app/Contents/Resources/engine/`:

- the whole `dist/engine/` tree (this carries non-TS runtime data such as
  `dist/engine/src/stack/stacks.json`, which `detectStack` reads via a path
  relative to `import.meta.url` — verified present in `dist`),
- `package.json`,
- production-only `node_modules` (`commander`, `ajv`, `prettier`, `playwright-core`)
  produced with `npm ci --omit=dev` into a staging directory.

### 2. Bundle a Node runtime

Bundle a pinned **Node 22 LTS** binary in `Contents/Resources/node/bin/node`:

- fetch official `darwin-arm64` and `darwin-x64` builds,
- `lipo -create` them into one universal binary,
- ad-hoc sign it (`codesign --force -s -`) so it executes on Apple Silicon
  (unsigned arm64 binaries are killed by the loader).

The fetch/lipo/sign result is cached under a build directory so repeated packaging
does not re-download.

### 3. `EngineClient` resolves bundled binaries, with dev fallback

`EngineClient` (`app/Gnaw/Sources/Services/EngineClient.swift`) changes so that:

- **Node**: prefer `Bundle.main.resourceURL/node/bin/node`; fall back to the current
  `resolveNode()` (env `GNAW_NODE`, Homebrew, `/usr/local`, `/usr/bin`).
- **Engine entrypoint**: prefer
  `Bundle.main.resourceURL/engine/dist/engine/src/cli.js`; fall back to the current
  `resolveProjectRoot()` walk (env `GNAW_PROJECT_ROOT`, Info.plist key, upward
  search) used by `build_and_run.sh` during development.
- **Working directory**: use a writable temp/support directory rather than the repo
  root (captures already write to the absolute `--out` path, so cwd is not
  load-bearing).

This preserves the inner development loop while making the packaged app default to
its own bundled resources.

### 4. Browser fallback + first-run download

`resolveBrowser` (`engine/src/browser/resolveBrowser.ts`) keeps its order
(Playwright Chromium → `GNAW_CHROME_PATH` → system Chrome/Edge/Chromium). When
none is found:

- add an engine subcommand **`gnaw browser ensure`** that runs
  `node_modules/playwright-core/cli.js install chromium` with
  `PLAYWRIGHT_BROWSERS_PATH` set to the browser cache, emitting NDJSON progress
  events (staying within the existing Swift↔engine contract),
- the app, on a "no browser found" condition, shows a friendly dialog
  ("Gnaw needs to download its browser engine (~150MB)"), runs `browser ensure`,
  shows a progress bar, then proceeds automatically,
- clear, actionable message when offline.

`playwright-core` ships this `install` CLI (verified), so no extra dependency is
needed.

### 5. Packaging pipeline — `script/package_dmg.sh`

Produces `dist/Gnaw.dmg`:

1. `npm run build`.
2. Stage engine: copy `dist/engine` + `package.json`; `npm ci --omit=dev` for
   production `node_modules`.
3. Prepare universal Node: fetch + `lipo` + ad-hoc sign (cached).
4. `xcodegen generate` + `xcodebuild -configuration Release` with
   `ARCHS = arm64 x86_64`, `ONLY_ACTIVE_ARCH = NO` → universal `Gnaw.app`.
5. Copy staged engine + node into `Contents/Resources/`.
6. Ad-hoc sign **inside-out** (embedded node first, then nested helpers, then the
   app bundle — avoid deprecated `--deep`).
7. `hdiutil create` → `dist/Gnaw.dmg` with an `/Applications` symlink and a short
   first-launch README/background.

`project.yml` gains a Release universal configuration and keeps
`ENABLE_HARDENED_RUNTIME: NO` (hardened runtime's library validation would kill the
ad-hoc-signed bundled Node). Deployment target stays macOS 14.0.

## Distribution & first-launch UX

Everything technical is invisible: no repo, no terminal, no Node install; Chromium
downloads itself on demand with a progress bar.

### Residual friction (honest)

With ad-hoc / un-notarized distribution there is exactly **one** unavoidable step,
and it is not specific to Gnaw: for any unsigned app downloaded from the internet,
macOS requires a one-time confirmation on first launch
(*System Settings → Privacy & Security → "Open Anyway"*). After that the app behaves
like any normal app on that machine.

Mitigations:

- **Office colleagues**: the person handing over the app performs the one-time
  "Open Anyway" during setup (~30s).
- **GitHub users**: the DMG background and README show a 2-step, screenshot-backed
  instruction.

### Future: notarization upgrade path

The packaging is structured so that, if an Apple Developer account is added later,
the only change is swapping ad-hoc signing for Developer ID signing + notarization +
stapling in `package_dmg.sh`. This removes the "Open Anyway" step entirely. No
architectural rework required.

## Verification

- `lipo -info` on the app binary and bundled node → both `arm64` and `x86_64`.
- **Self-containment test**: copy the app outside the repo, unset
  `GNAW_PROJECT_ROOT`, temporarily rename the repo, launch, and run a capture — it
  must succeed using bundled engine + node.
- **Smoke test in the script**: mount the built DMG, copy the app to a temp
  location, run in `--verify` mode (launch + `pgrep`).
- **No-browser path**: with no system Chromium, confirm the warning + download flow
  installs Chromium into the cache and capture then succeeds.
- Existing Swift and engine test suites continue to pass.

## Risks / open items

- **Size**: universal Node is ~100MB → DMG ~80–120MB even without Chromium.
  Accepted.
- **Downloaded Chromium on Apple Silicon**: handled by Playwright, but to be
  validated on a real Apple Silicon machine.
- **Node version pin**: exact Node 22 LTS patch to be pinned in the plan.
- **Inside-out signing order**: enumerate every nested Mach-O to sign; avoid
  `--deep`.
