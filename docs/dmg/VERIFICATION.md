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
2. Launches that copy with `open -n`, in a subshell with `GNAW_PROJECT_ROOT`
   and `GNAW_NODE` explicitly unset.
3. Waits 3 seconds, then checks `pgrep -x Gnaw` to confirm the process is
   actually running.
4. Prints `smoke OK: Gnaw is running` on success, kills the process, and
   removes the scratch copy.

Run it with:

```bash
./script/package_dmg.sh --verify
```

Note: this re-runs the full packaging pipeline (engine build, universal node
fetch/cache check, xcodebuild universal Release build, ad-hoc signing, DMG
creation — roughly 2-3 minutes) and only then runs the smoke step. The smoke
step alone is fast; the packaging step dominates the wall-clock time.

This proves the universal app bundle launches and finds its bundled
resources (Node + engine) outside the repo. It does **not** exercise an
actual capture — the app only starts its engine process when the user
initiates one from its setup screen — so this is a launch/resource-resolution
smoke test, not an end-to-end capture test. See "Manual" below for that.

### Result (run on 2026-07-21)

Command: `./script/package_dmg.sh --verify`

Relevant tail of output:

```
==> 7/7 build DMG
created: /Users/enuzzo/Library/CloudStorage/Dropbox/Mitnick/gnaw/dist/Gnaw.dmg
==> smoke: launch packaged app from a copy, no repo env
smoke OK: Gnaw is running
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
