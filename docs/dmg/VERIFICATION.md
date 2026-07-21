# Self-containment verification

This documents the repeatable check that the packaged `Gnaw.app` (built by
`script/package_dmg.sh`) is self-contained: it carries its own universal
(x86_64 + arm64) Node runtime and a production engine tree, and it launches
with no repo checkout present and no `GNAW_PROJECT_ROOT` / `GNAW_NODE`
environment overrides.

## Automated: `--verify` smoke step

`script/package_dmg.sh` now accepts an optional `--verify` flag. When passed,
after building the DMG it:

1. Copies the freshly built `Gnaw.app` out of the repo tree into a `mktemp -d`
   scratch directory.
2. Eagerly asserts the copy's bundled resources exist: the bundled Node
   executable (`Contents/Resources/node/bin/node`) and the engine's compiled
   CLI entrypoint and stack-detection data file
   (`Contents/Resources/engine/dist/engine/src/cli.js` and
   `.../stack/stacks.json`).
3. Launches that copy with `open -n`, in a subshell with `GNAW_PROJECT_ROOT`
   and `GNAW_NODE` explicitly unset.
4. Waits 3 seconds, then uses `pgrep -f` scoped to the scratch directory's
   path to confirm that *this specific copy* — not just any Gnaw process
   that happened to be running — actually launched.
5. Prints `smoke OK: packaged Gnaw launched ...` on success and kills only
   that copy's process (by PID, not by name), leaving any other running
   Gnaw instance untouched. A `trap` on `EXIT` removes the scratch copy
   even if an earlier assertion fails.

Run it with:

```bash
./script/package_dmg.sh --verify
```

Note: this re-runs the full packaging pipeline (engine build, universal node
fetch/cache check, xcodebuild universal Release build, ad-hoc signing, DMG
creation — roughly 2-3 minutes) and only then runs the smoke step. The smoke
step alone is fast; the packaging step dominates the wall-clock time.

This proves two things: (a) the copied app bundle actually contains its
bundled resources (Node + engine files), verified by direct file assertions,
and (b) the universal app bundle launches cleanly outside the repo tree with
no repo environment variables set. It does **not** exercise an actual
capture, and it does **not** prove the running process successfully resolves
and invokes those resources at runtime — the app only calls
`resolveEngine()` and starts its engine process when the user initiates a
capture from its setup screen. So this is a resource-presence-plus-launch
smoke test, not an end-to-end capture test. See "Manual" below for that.

### Result (run on 2026-07-21)

Command: `./script/package_dmg.sh --verify`

Relevant tail of output:

```
==> 7/7 build DMG
created: /Users/enuzzo/Library/CloudStorage/Dropbox/Mitnick/gnaw/dist/Gnaw.dmg
==> smoke: launch packaged app from a copy, no repo env
smoke: bundled node + engine resources present in the copy
smoke OK: packaged Gnaw launched from a repo-free copy (pid 15062)
Built /Users/enuzzo/Library/CloudStorage/Dropbox/Mitnick/gnaw/dist/Gnaw.dmg
```

Full run also completed steps 1/7 through 7/7 (engine build, staged
production engine tree, universal node prep, universal Release xcodebuild,
embed + ad-hoc codesign with `codesign verify OK`, DMG creation) without
error before the smoke step ran.

## Universal binary check (`lipo -info`)

Both the app's main executable and the bundled Node runtime are fat
binaries containing both Apple Silicon and Intel slices:

```
$ lipo -info ".build/dmg/DerivedData/Build/Products/Release/Gnaw.app/Contents/MacOS/Gnaw"
Architectures in the fat file: .../Gnaw.app/Contents/MacOS/Gnaw are: x86_64 arm64

$ lipo -info ".build/dmg/DerivedData/Build/Products/Release/Gnaw.app/Contents/Resources/node/bin/node"
Architectures in the fat file: .../Gnaw.app/Contents/Resources/node/bin/node are: x86_64 arm64
```

## Bundled engine resource check

The app bundle carries a full production engine tree under
`Contents/Resources/engine`, including the compiled CLI entrypoint and the
stack-detection data file the engine reads at runtime:

```
Contents/Resources/
├── engine/
│   ├── dist/engine/src/cli.js               (present)
│   ├── dist/engine/src/stack/stacks.json    (present)
│   ├── node_modules/                        (production deps, npm ci --omit=dev)
│   ├── package.json
│   └── package-lock.json
└── node/
    └── bin/node                              (universal, ad-hoc signed)
```

Confirmed present via:

```bash
find Gnaw.app/Contents/Resources/engine -iname "cli.js" -o -iname "stacks.json"
```

which returned (among playwright-core's own bundled `cli.js`, which is
unrelated and expected):

```
.../engine/dist/engine/src/cli.js
.../engine/dist/engine/src/stack/stacks.json
```

## Manual: end-to-end capture from a copied app (not executed here)

**This step was NOT run as part of this task.** It requires a real browser
window and a person driving the GUI (choosing a capture template, watching
the run complete, checking `~/Gnaw` for output) — it is not something that
can be legitimately automated or claimed from a non-interactive session.
Run it by hand to confirm the bundled Node + engine actually perform a
capture, not just launch:

```bash
# Copy the app out of the repo tree, then temporarily hide the repo dist
# to prove the copy doesn't depend on it.
cp -R ".build/dmg/DerivedData/Build/Products/Release/Gnaw.app" "$HOME/Desktop/Gnaw.app"
mv dist dist.hidden

open -n "$HOME/Desktop/Gnaw.app"
# In the app: capture https://example.com/ with the "This page" template.
# It must complete.

mv dist.hidden dist
```

Expected result: the capture completes using the bundled engine, and a haul
directory appears under `~/Gnaw`.

This requires a system Chrome/Edge install, or Phase B (browser
auto-download) to be implemented — Phase B is a separate, not-yet-built
piece of work. If neither is available, the expected outcome is a
"No supported browser engine found" error, which is not a failure of this
task's scope (bundle self-containment / launchability) but rather the known
gap that Phase B is meant to close.

## Phase B: final packaging run (browser auto-download included)

Phase B added the engine's `gnaw browser check` / `gnaw browser ensure`
subcommands and the app's warn-then-download flow (`EngineClient.checkBrowser`
/ `EngineClient.ensureBrowser` in
`app/Gnaw/Sources/Services/EngineClient.swift`, consumed by `AppModel` in
`app/Gnaw/Sources/Stores/AppModel.swift` and surfaced as the "Download
browser engine?" alert in `app/Gnaw/Sources/Views/NewCaptureView.swift`).
These are the engine commands backing the app's download flow described in
[`INSTALL.md`](INSTALL.md): `browser check` reports whether a supported
Chromium-family browser is already available, and `browser ensure` performs
the ~150MB Chromium download (streaming progress via the existing `browser`
NDJSON event type) into the cache at
`~/Library/Application Support/Gnaw/browsers`.

This task (Task 10) reran the full packaging pipeline from scratch so the
shipped DMG includes this Phase B code, then re-executed the same
`--verify` smoke step documented above.

### Result (run on 2026-07-21, Phase B)

Command: `./script/package_dmg.sh --verify`

The run completed all 7 packaging steps (engine build, staged production
engine tree, cached universal node reuse, universal Release xcodebuild,
embed + ad-hoc codesign, DMG creation) followed by the smoke step, ending
with the four expected success lines:

```
codesign verify OK
created: /Users/enuzzo/Library/CloudStorage/Dropbox/Mitnick/gnaw/dist/Gnaw.dmg
==> smoke: launch packaged app from a copy, no repo env
smoke: bundled node + engine resources present in the copy
smoke OK: packaged Gnaw launched from a repo-free copy (pid 27617)
Built /Users/enuzzo/Library/CloudStorage/Dropbox/Mitnick/gnaw/dist/Gnaw.dmg
```

Final DMG size:

```
$ ls -lh dist/Gnaw.dmg
-rw-r--r--@ 1 enuzzo  staff    87M Jul 21 13:11 dist/Gnaw.dmg
```

As with the earlier run, this proves the packaged app bundle contains its
Node + engine resources (now including the Phase B `browser` subcommands)
and launches cleanly outside the repo tree. It does not itself exercise a
live Chromium download — see "Manual: end-to-end capture from a copied app"
above for the manual, GUI-driven check that would exercise
`browser check` / `browser ensure` against a real network.
