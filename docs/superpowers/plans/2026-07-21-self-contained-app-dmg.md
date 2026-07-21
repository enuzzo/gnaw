# Self-contained Gnaw `.app` + `.dmg` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a self-contained, universal `Gnaw.app` packaged as `dist/Gnaw.dmg` that runs on any Mac with no repo, no terminal, and no Node install, downloading Chromium itself when no browser is present.

**Architecture:** Bundle the compiled Node engine, its production `node_modules`, and a universal Node 22 runtime inside `Gnaw.app/Contents/Resources`. `EngineClient` resolves those bundled binaries first and falls back to the current repo/dev resolution so `build_and_run.sh` keeps working. A `script/package_dmg.sh` builds a universal Release app, embeds engine + node, ad-hoc signs inside-out, and produces `dist/Gnaw.dmg`. When no system Chromium is found, the app warns and downloads Chromium via `playwright-core`'s installer, driven by the already-defined `browser` NDJSON event.

**Tech Stack:** SwiftUI/AppKit (macOS 14+), Xcode 16 + XcodeGen, TypeScript/Node engine (vitest), `playwright-core`, `hdiutil`, `lipo`, `codesign`.

## Global Constraints

- Signing: **ad-hoc only** (`codesign --force --sign -`). No notarization, no paid Apple account.
- Architecture: **universal** — `ARCHS = "arm64 x86_64"`, `ONLY_ACTIVE_ARCH = NO` for Release.
- Node runtime: **`v22.13.0`** (overridable via `NODE_VERSION` env), universal via `lipo`, ad-hoc signed.
- `ENABLE_HARDENED_RUNTIME: NO` stays off (library validation would kill the ad-hoc bundled Node).
- Deployment target: **macOS 14.0** (unchanged).
- Browser cache: `~/Library/Application Support/Gnaw/browsers` via `PLAYWRIGHT_BROWSERS_PATH`.
- Bundle layout mirrors the repo root so Node module resolution works unchanged:
  `Contents/Resources/engine/{package.json, node_modules/, dist/engine/...}` and
  `Contents/Resources/node/bin/node`.
- Output `dist/` is git-ignored; the DMG stays local. Do not commit build artifacts.
- The dev loop (`script/build_and_run.sh`) MUST keep working after every task.
- Commit after each task. Branch off `main` before the first commit (do not commit to `main` directly).

---

## Phase A — Self-contained core

Produces a universal, self-contained DMG that runs with zero friction on any Mac that already has a Chromium-family browser (Chrome/Edge). Phase B then covers Macs with no browser.

### Task 1: Copy non-TS runtime assets on build

`detectStack` reads `stacks.json` at runtime via a path relative to the compiled
`detectStack.js` (`engine/src/stack/detectStack.ts:26`), but `tsc` does not copy
`.json` files that are read with `readFileSync` (only *imported* JSON). `npm run
build` therefore does not reproduce `dist/engine/src/stack/stacks.json`; the current
copy in `dist` is stale/manual. Make the build reproduce it so both dev and
packaging are correct.

**Files:**
- Create: `script/copy-engine-assets.mjs`
- Modify: `package.json` (add `postbuild` script)
- Test: `engine/test/unit/copyEngineAssets.test.ts`

**Interfaces:**
- Produces: `dist/engine/src/stack/stacks.json` present after `npm run build`.

- [ ] **Step 1: Write the failing test**

```ts
// engine/test/unit/copyEngineAssets.test.ts
import { existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const asset = new URL("../../../dist/engine/src/stack/stacks.json", import.meta.url);

describe("copy-engine-assets", () => {
  it("copies stacks.json into dist after running the script", () => {
    rmSync(fileURLToPath(asset), { force: true });
    execFileSync("node", ["script/copy-engine-assets.mjs"], { cwd: root });
    expect(existsSync(fileURLToPath(asset))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run engine/test/unit/copyEngineAssets.test.ts`
Expected: FAIL (script does not exist yet → `execFileSync` throws).

- [ ] **Step 3: Write the copy script**

```js
// script/copy-engine-assets.mjs
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

// Non-TS runtime data files that tsc does not emit. Add new entries here.
const assets = ["engine/src/stack/stacks.json"];

for (const rel of assets) {
  const from = join(root, rel);
  const to = join(root, "dist", rel);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
  console.log(`copied ${rel} -> dist/${rel}`);
}
```

- [ ] **Step 4: Wire it into the build**

In `package.json`, add a `postbuild` script (runs automatically after `build`):

```json
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "postbuild": "node script/copy-engine-assets.mjs",
    "test": "vitest run",
    "test:unit": "vitest run engine/test/unit harness/test/unit",
    "test:integration": "vitest run engine/test/integration harness/test/integration --passWithNoTests",
    "harness": "tsx harness/src/cli.ts"
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run build && npx vitest run engine/test/unit/copyEngineAssets.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add script/copy-engine-assets.mjs package.json engine/test/unit/copyEngineAssets.test.ts
git commit -m "build: copy non-TS engine assets (stacks.json) into dist"
```

---

### Task 2: Bundle-aware resolution in `EngineClient`

Make `EngineClient` prefer the bundled Node + engine (inside `Contents/Resources`)
and fall back to the current dev resolution. Introduce a single shared process
builder that all engine invocations (capture now; `browser check`/`ensure` in Phase
B) reuse, and set `PLAYWRIGHT_BROWSERS_PATH` on every engine child so a downloaded
Chromium is found by both the installer and the capture.

**Files:**
- Modify: `app/Gnaw/Sources/Services/EngineClient.swift`
- Test: `app/Gnaw/Tests/EngineClientResolutionTests.swift` (new)

**Interfaces:**
- Produces (used by Task 8/9 and existing capture):
  - `struct ResolvedEngine { let node: URL; let cli: URL; let engineRoot: URL }`
  - `func resolveEngine() throws -> ResolvedEngine`
  - `static var browserCachePath: URL` → `~/Library/Application Support/Gnaw/browsers`
  - `func makeProcess(arguments: [String]) throws -> (Process, stdout: Pipe, stderr: Pipe, stdin: Pipe)`
    — builds a `Process` whose `executableURL` is the resolved node, first argv is the
    resolved `cli.js`, `currentDirectoryURL` is a writable dir, and `environment`
    includes `PLAYWRIGHT_BROWSERS_PATH`.

- [ ] **Step 1: Write the failing test**

```swift
// app/Gnaw/Tests/EngineClientResolutionTests.swift
import XCTest
@testable import Gnaw

final class EngineClientResolutionTests: XCTestCase {
    func testBrowserCachePathIsUnderApplicationSupportGnaw() {
        let path = EngineClient.browserCachePath.path
        XCTAssertTrue(path.hasSuffix("Application Support/Gnaw/browsers"), path)
    }

    func testMakeProcessInjectsBrowsersPathAndUsesResolvedNode() throws {
        let client = EngineClient()
        let built = try client.makeProcess(arguments: ["browser", "check"])
        XCTAssertEqual(built.0.executableURL, try client.resolveEngine().node)
        let env = built.0.environment ?? [:]
        XCTAssertEqual(env["PLAYWRIGHT_BROWSERS_PATH"], EngineClient.browserCachePath.path)
        XCTAssertEqual(built.0.arguments?.first, try client.resolveEngine().cli.path)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run (direct XCTest runner used by this project — see `SESSION-NOTES.md`):
`./script/build_and_run.sh` is for launching; run the app tests with:
`xcodebuild -project app/Gnaw/Gnaw.xcodeproj -scheme Gnaw -configuration Debug -derivedDataPath "${TMPDIR:-/tmp}/GnawDerivedData-$UID" test -only-testing:GnawTests/EngineClientResolutionTests`
Expected: FAIL — `resolveEngine`, `browserCachePath`, `makeProcess` do not exist.

- [ ] **Step 3: Add resolution + process builder**

Replace the resolution internals of `EngineClient` (`EngineClient.swift`). Keep the
public `start(...)` behavior identical, but route it through the new builder.

```swift
struct ResolvedEngine {
    let node: URL
    let cli: URL
    let engineRoot: URL
}

extension EngineClient {
    static var browserCachePath: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Gnaw/browsers", isDirectory: true)
    }

    func resolveEngine() throws -> ResolvedEngine {
        // 1. Bundled resources (packaged app).
        if let resources = Bundle.main.resourceURL {
            let engineRoot = resources.appendingPathComponent("engine", isDirectory: true)
            let cli = engineRoot.appendingPathComponent("dist/engine/src/cli.js")
            let node = resources.appendingPathComponent("node/bin/node")
            if FileManager.default.fileExists(atPath: cli.path),
               FileManager.default.isExecutableFile(atPath: node.path) {
                return ResolvedEngine(node: node, cli: cli, engineRoot: engineRoot)
            }
        }
        // 2. Dev fallback: repo root + system node (keeps build_and_run.sh working).
        let root = try resolveProjectRoot()
        let cli = root.appendingPathComponent("dist/engine/src/cli.js")
        guard FileManager.default.fileExists(atPath: cli.path) else {
            throw EngineClientError.engineNotBuilt(cli.path)
        }
        let node = try resolveNode()
        return ResolvedEngine(node: node, cli: cli, engineRoot: root)
    }

    func makeProcess(arguments: [String]) throws -> (Process, Pipe, Pipe, Pipe) {
        let resolved = try resolveEngine()
        try FileManager.default.createDirectory(
            at: Self.browserCachePath, withIntermediateDirectories: true)

        let process = Process()
        let stdout = Pipe(), stderr = Pipe(), stdin = Pipe()
        process.executableURL = resolved.node
        process.arguments = [resolved.cli.path] + arguments
        process.currentDirectoryURL = FileManager.default.temporaryDirectory
        var env = ProcessInfo.processInfo.environment
        env["PLAYWRIGHT_BROWSERS_PATH"] = Self.browserCachePath.path
        process.environment = env
        process.standardOutput = stdout
        process.standardError = stderr
        process.standardInput = stdin
        return (process, stdout, stderr, stdin)
    }
}
```

- [ ] **Step 4: Route `start(...)` through the builder**

In `start(...)`, replace the manual `Process()`/`executableURL`/`arguments`
construction (`EngineClient.swift:46-63`) with:

```swift
        let (process, stdout, stderr, stdin) = try makeProcess(arguments: [
            "capture",
            configuration.url,
            "--mode", configuration.modes,
            "--depth", String(configuration.preset.depth),
            "--max-pages", String(configuration.maxPages),
            "--out", configuration.outputDirectory
        ])
        try FileManager.default.createDirectory(
            atPath: configuration.outputDirectory, withIntermediateDirectories: true)
```

Keep the existing reader/termination-handler wiring below it unchanged (it already
references `stdout`, `stderr`, `stdin`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `xcodebuild ... test -only-testing:GnawTests/EngineClientResolutionTests`
Expected: PASS. Then run the full suite: `xcodebuild ... -scheme Gnaw test` → all Swift tests PASS.

- [ ] **Step 6: Verify dev loop still works**

Run: `./script/build_and_run.sh --verify`
Expected: builds, launches, `pgrep -x Gnaw` succeeds (uses dev fallback — no bundled resources yet).

- [ ] **Step 7: Commit**

```bash
git add app/Gnaw/Sources/Services/EngineClient.swift app/Gnaw/Tests/EngineClientResolutionTests.swift
git commit -m "app: resolve bundled node+engine first, add shared engine process builder"
```

---

### Task 3: Universal Node fetch/lipo/sign helper

Standalone script that downloads the pinned Node for both arches, fuses them into a
universal binary, ad-hoc signs it, and caches the result.

**Files:**
- Create: `script/fetch_universal_node.sh`

**Interfaces:**
- Produces: `<dest>/bin/node` — a universal, ad-hoc-signed Node binary. Consumed by Task 4.
- Usage: `script/fetch_universal_node.sh <version> <dest-dir>`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
set -euo pipefail

VERSION="$1"      # e.g. v22.13.0
DEST="$2"         # cache dir; produces $DEST/bin/node

if [[ -x "$DEST/bin/node" ]]; then
  echo "universal node already cached at $DEST/bin/node"
  lipo -info "$DEST/bin/node"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

for ARCH in arm64 x64; do
  URL="https://nodejs.org/dist/$VERSION/node-$VERSION-darwin-$ARCH.tar.gz"
  echo "downloading $URL"
  curl -fsSL "$URL" -o "$TMP/node-$ARCH.tar.gz"
  mkdir -p "$TMP/$ARCH"
  tar -xzf "$TMP/node-$ARCH.tar.gz" -C "$TMP/$ARCH" --strip-components=1
done

mkdir -p "$DEST/bin"
lipo -create "$TMP/arm64/bin/node" "$TMP/x64/bin/node" -output "$DEST/bin/node"
chmod +x "$DEST/bin/node"
codesign --force --sign - "$DEST/bin/node"
lipo -info "$DEST/bin/node"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x script/fetch_universal_node.sh`

- [ ] **Step 3: Run it and verify a universal binary**

Run:
```bash
script/fetch_universal_node.sh v22.13.0 .build/node/v22.13.0
lipo -info .build/node/v22.13.0/bin/node
.build/node/v22.13.0/bin/node --version
```
Expected: `lipo -info` prints `Architectures in the fat file: ... are: x86_64 arm64`; `--version` prints `v22.13.0`.
(If the version 404s, bump `v22.13.0` to the latest available Node 22 LTS patch and update the Global Constraints value.)

- [ ] **Step 4: Commit**

```bash
git add script/fetch_universal_node.sh
git commit -m "build: add universal Node fetch/lipo/ad-hoc-sign helper"
```

---

### Task 4: Packaging script + universal Release config → `dist/Gnaw.dmg`

Build a universal Release app, embed the staged engine + universal node, ad-hoc sign
inside-out, and produce the DMG with an Applications symlink and a first-launch note.

**Files:**
- Create: `script/package_dmg.sh`
- Create: `docs/dmg/FIRST-LAUNCH.txt`
- Modify: `app/Gnaw/project.yml` (Release universal config)

**Interfaces:**
- Consumes: `script/fetch_universal_node.sh` (Task 3), `npm run build` + `postbuild` (Task 1), bundled resolution (Task 2).
- Produces: `dist/Gnaw.dmg` and a self-contained `Gnaw.app` at
  `.build/dmg/DerivedData/Build/Products/Release/Gnaw.app`.

- [ ] **Step 1: Add a Release universal config to `project.yml`**

Add a `configs` block and a per-config Release override to `app/Gnaw/project.yml`
(insert after the top-level `settings:` block, keeping existing keys):

```yaml
configs:
  Debug: debug
  Release: release
settings:
  base:
    SWIFT_VERSION: "5.0"
    MACOSX_DEPLOYMENT_TARGET: "14.0"
  configs:
    Release:
      ARCHS: "arm64 x86_64"
      ONLY_ACTIVE_ARCH: NO
```

- [ ] **Step 2: Write the first-launch note**

```text
# docs/dmg/FIRST-LAUNCH.txt
Opening Gnaw the first time
===========================

Gnaw is a free, unsigned app, so on first launch macOS asks you to confirm it.
You only do this ONCE per Mac. After that it opens like any normal app.

1. Drag Gnaw onto the Applications folder (in this window).
2. Open Applications and double-click Gnaw. macOS will say it can't verify it.
3. Open  Menu > System Settings > Privacy & Security.
4. Scroll down to the message about "Gnaw" and click "Open Anyway".
5. Confirm. Gnaw opens — and stays trusted from now on.

The first time you capture a site, if no browser engine is found, Gnaw offers to
download one (~150MB). That download happens automatically with a progress bar.
```

- [ ] **Step 3: Write the packaging script**

```bash
#!/usr/bin/env bash
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-v22.13.0}"
APP_NAME="Gnaw"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="$ROOT_DIR/app/$APP_NAME"
BUILD_DIR="$ROOT_DIR/.build/dmg"
DERIVED_DATA="$BUILD_DIR/DerivedData"
STAGE_ENGINE="$BUILD_DIR/engine"
NODE_CACHE="$ROOT_DIR/.build/node/$NODE_VERSION"
DIST_DIR="$ROOT_DIR/dist"

echo "==> 1/7 build engine"
cd "$ROOT_DIR"
npm run build

echo "==> 2/7 stage production engine tree"
rm -rf "$STAGE_ENGINE"
mkdir -p "$STAGE_ENGINE/dist"
cp -R "$ROOT_DIR/dist/engine" "$STAGE_ENGINE/dist/engine"
cp "$ROOT_DIR/package.json" "$STAGE_ENGINE/package.json"
cp "$ROOT_DIR/package-lock.json" "$STAGE_ENGINE/package-lock.json"
( cd "$STAGE_ENGINE" && npm ci --omit=dev --ignore-scripts )

echo "==> 3/7 prepare universal node"
"$ROOT_DIR/script/fetch_universal_node.sh" "$NODE_VERSION" "$NODE_CACHE"

echo "==> 4/7 build universal Release app"
xcodegen generate --spec "$PROJECT_DIR/project.yml"
xcodebuild \
  -project "$PROJECT_DIR/$APP_NAME.xcodeproj" \
  -scheme "$APP_NAME" \
  -configuration Release \
  -derivedDataPath "$DERIVED_DATA" \
  ARCHS="arm64 x86_64" ONLY_ACTIVE_ARCH=NO \
  CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY="-" \
  CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=YES \
  build

APP_BUNDLE="$DERIVED_DATA/Build/Products/Release/$APP_NAME.app"
RES="$APP_BUNDLE/Contents/Resources"

echo "==> 5/7 embed engine + node"
rm -rf "$RES/engine" "$RES/node"
mkdir -p "$RES/engine" "$RES/node/bin"
cp -R "$STAGE_ENGINE/." "$RES/engine/"
cp "$NODE_CACHE/bin/node" "$RES/node/bin/node"
chmod +x "$RES/node/bin/node"

echo "==> 6/7 ad-hoc sign inside-out"
codesign --force --sign - "$RES/node/bin/node"
# Sign any native Mach-O shipped in node_modules (defensive; prod deps are pure JS).
find "$RES/engine" -type f -perm +111 -print0 | while IFS= read -r -d '' f; do
  if file "$f" | grep -q "Mach-O"; then codesign --force --sign - "$f"; fi
done
codesign --force --sign - "$APP_BUNDLE"
codesign --verify --deep --strict "$APP_BUNDLE" && echo "codesign verify OK"

echo "==> 7/7 build DMG"
mkdir -p "$DIST_DIR"
DMG_PATH="$DIST_DIR/$APP_NAME.dmg"
STAGE_DMG="$BUILD_DIR/dmg-root"
rm -f "$DMG_PATH"
rm -rf "$STAGE_DMG"; mkdir -p "$STAGE_DMG"
cp -R "$APP_BUNDLE" "$STAGE_DMG/"
ln -s /Applications "$STAGE_DMG/Applications"
cp "$ROOT_DIR/docs/dmg/FIRST-LAUNCH.txt" "$STAGE_DMG/How to open Gnaw.txt"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE_DMG" -ov -format UDZO "$DMG_PATH"

echo "Built $DMG_PATH"
```

- [ ] **Step 4: Make it executable and run it**

Run:
```bash
chmod +x script/package_dmg.sh
./script/package_dmg.sh
```
Expected: ends with `Built .../dist/Gnaw.dmg` and `codesign verify OK`.

- [ ] **Step 5: Verify the app binary and node are universal**

Run:
```bash
APP=".build/dmg/DerivedData/Build/Products/Release/Gnaw.app"
lipo -info "$APP/Contents/MacOS/Gnaw"
lipo -info "$APP/Contents/Resources/node/bin/node"
ls "$APP/Contents/Resources/engine/dist/engine/src/cli.js" "$APP/Contents/Resources/engine/dist/engine/src/stack/stacks.json"
```
Expected: both binaries report `x86_64 arm64`; both engine files exist.

- [ ] **Step 6: Commit**

```bash
git add script/package_dmg.sh docs/dmg/FIRST-LAUNCH.txt app/Gnaw/project.yml
git commit -m "build: package universal self-contained Gnaw.dmg (ad-hoc signed)"
```

---

### Task 5: Self-containment verification

Prove the packaged app runs with no repo present and no `GNAW_PROJECT_ROOT`, using
its bundled node + engine. This is a verification task; its deliverable is a
documented, repeatable check plus a `--verify` smoke mode in the packaging script.

**Files:**
- Modify: `script/package_dmg.sh` (add optional `--verify` smoke step)
- Modify: `SESSION-NOTES.md` (record the verification recipe + result)

**Interfaces:**
- Consumes: `dist/Gnaw.dmg` and the built app from Task 4.

- [ ] **Step 1: Add a `--verify` smoke step to the packaging script**

Append to `script/package_dmg.sh` (before the final `echo`):

```bash
if [[ "${1:-}" == "--verify" ]]; then
  echo "==> smoke: launch packaged app from a copy, no repo env"
  SMOKE_DIR="$(mktemp -d)"
  cp -R "$APP_BUNDLE" "$SMOKE_DIR/"
  ( unset GNAW_PROJECT_ROOT GNAW_NODE
    /usr/bin/open -n "$SMOKE_DIR/$APP_NAME.app" )
  sleep 3
  pgrep -x "$APP_NAME" >/dev/null && echo "smoke OK: $APP_NAME is running"
  pkill -x "$APP_NAME" >/dev/null 2>&1 || true
  rm -rf "$SMOKE_DIR"
fi
```

- [ ] **Step 2: Run the packaged smoke test**

Run: `./script/package_dmg.sh --verify`
Expected: prints `smoke OK: Gnaw is running`.

- [ ] **Step 3: Manual end-to-end capture from a copied app (no repo)**

Do this once by hand to confirm bundled node+engine actually capture:
```bash
# Copy the app out of the repo tree, then temporarily hide the repo dist to prove independence.
cp -R ".build/dmg/DerivedData/Build/Products/Release/Gnaw.app" "$HOME/Desktop/Gnaw.app"
mv dist dist.hidden
open -n "$HOME/Desktop/Gnaw.app"
# In the app: capture https://example.com/ with "This page". It must complete.
mv dist.hidden dist
```
Expected: capture completes using the bundled engine; a haul appears in `~/Gnaw`.
(Requires a system Chrome/Edge OR Phase B installed. If neither, expect the
"No supported browser engine found" error — that is Phase B's job.)

- [ ] **Step 4: Record the result**

Add a short `## 2026-07-21 Self-contained packaging` section to `SESSION-NOTES.md`
listing: `lipo -info` outputs, `smoke OK`, and the manual capture result.

- [ ] **Step 5: Commit**

```bash
git add script/package_dmg.sh SESSION-NOTES.md
git commit -m "build: add packaged-app smoke verification and record results"
```

---

## Phase B — Browser auto-download

Covers Macs with no Chromium at all: the app warns, downloads Chromium via
`playwright-core`, shows progress via the existing `browser` NDJSON event, then
proceeds with the capture. No contract-schema change (the `browser` event already
exists in `contract/events.schema.json`).

### Task 6: Engine `browser` command logic (pure functions)

**Files:**
- Create: `engine/src/browser/browserCommands.ts`
- Test: `engine/test/unit/browserCommands.test.ts`

**Interfaces:**
- Produces (consumed by Task 7):
  - `type BrowserStatusEvent = { v: 2; type: "browser"; status: "found" | "downloading"; detail?: string; progress?: number }`
  - `function checkBrowser(deps?): { found: boolean; detail?: string }`
  - `function ensureBrowser(emit: (e: BrowserStatusEvent) => void, deps?): Promise<void>`
  - deps: `{ resolveBrowser?: () => ResolvedBrowser; installChromium?: () => Promise<void> }`

- [ ] **Step 1: Write the failing test**

```ts
// engine/test/unit/browserCommands.test.ts
import { describe, it, expect, vi } from "vitest";
import { checkBrowser, ensureBrowser, type BrowserStatusEvent } from "../../src/browser/browserCommands.js";

const found = () => ({ executablePath: "/x/chrome", label: "Google Chrome" });
const missing = () => { throw new Error("No supported Chromium browser found"); };

describe("checkBrowser", () => {
  it("reports found with a label", () => {
    expect(checkBrowser({ resolveBrowser: found })).toEqual({ found: true, detail: "Google Chrome" });
  });
  it("reports not found when resolution throws", () => {
    expect(checkBrowser({ resolveBrowser: missing })).toEqual({ found: false });
  });
});

describe("ensureBrowser", () => {
  it("emits only found and skips install when a browser exists", async () => {
    const events: BrowserStatusEvent[] = [];
    const install = vi.fn(async () => {});
    await ensureBrowser((e) => events.push(e), { resolveBrowser: found, installChromium: install });
    expect(install).not.toHaveBeenCalled();
    expect(events).toEqual([{ v: 2, type: "browser", status: "found", detail: "Google Chrome" }]);
  });

  it("downloads then reports found when no browser exists", async () => {
    const events: BrowserStatusEvent[] = [];
    let installed = false;
    const resolve = () => { if (!installed) throw new Error("missing"); return found(); };
    const install = vi.fn(async () => { installed = true; });
    await ensureBrowser((e) => events.push(e), { resolveBrowser: resolve, installChromium: install });
    expect(install).toHaveBeenCalledOnce();
    expect(events.map((e) => e.status)).toEqual(["downloading", "found"]);
    expect(events[1].detail).toBe("Google Chrome");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run engine/test/unit/browserCommands.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the commands**

```ts
// engine/src/browser/browserCommands.ts
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { resolveBrowser as defaultResolveBrowser, type ResolvedBrowser } from "./resolveBrowser.js";

export type BrowserStatusEvent = {
  v: 2;
  type: "browser";
  status: "found" | "downloading";
  detail?: string;
  progress?: number;
};

export type BrowserCommandDeps = {
  resolveBrowser?: () => ResolvedBrowser;
  installChromium?: () => Promise<void>;
};

export function checkBrowser({ resolveBrowser = defaultResolveBrowser }: BrowserCommandDeps = {}): {
  found: boolean;
  detail?: string;
} {
  try {
    return { found: true, detail: resolveBrowser().label };
  } catch {
    return { found: false };
  }
}

export async function ensureBrowser(
  emit: (event: BrowserStatusEvent) => void,
  { resolveBrowser = defaultResolveBrowser, installChromium = defaultInstallChromium }: BrowserCommandDeps = {}
): Promise<void> {
  const existing = checkBrowser({ resolveBrowser });
  if (existing.found) {
    emit({ v: 2, type: "browser", status: "found", detail: existing.detail });
    return;
  }
  emit({ v: 2, type: "browser", status: "downloading", detail: "Downloading browser engine…" });
  await installChromium();
  emit({ v: 2, type: "browser", status: "found", detail: resolveBrowser().label });
}

async function defaultInstallChromium(): Promise<void> {
  const require = createRequire(import.meta.url);
  // playwright-core exposes ./package.json; cli.js sits beside it.
  const cliPath = join(dirname(require.resolve("playwright-core/package.json")), "cli.js");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, "install", "chromium"], {
      stdio: ["ignore", "inherit", "inherit"],
      env: process.env
    });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`chromium install failed (exit ${code})`))));
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run engine/test/unit/browserCommands.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/src/browser/browserCommands.ts engine/test/unit/browserCommands.test.ts
git commit -m "engine: add checkBrowser/ensureBrowser browser command logic"
```

---

### Task 7: Wire `gnaw browser check` and `gnaw browser ensure` into the CLI

**Files:**
- Modify: `engine/src/cli.ts`
- Test: `engine/test/unit/cliBrowser.test.ts` (new)

**Interfaces:**
- Consumes: `checkBrowser`, `ensureBrowser` (Task 6); `createEventWriter` (existing).
- Produces: CLI subcommands `browser check` (exit 3 when missing) and `browser ensure`
  (streams `browser` events; exit 4 on install failure). New injectable deps on
  `CliDependencies`: `resolveBrowser?`, `installBrowser?`.

- [ ] **Step 1: Write the failing test**

```ts
// engine/test/unit/cliBrowser.test.ts
import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import { createCliProgram } from "../../src/cli.js";

function sink() {
  const chunks: string[] = [];
  const stream = new Writable({ write(c, _e, cb) { chunks.push(String(c)); cb(); } });
  return { stream, lines: () => chunks.join("").trim().split("\n").filter(Boolean) };
}

describe("gnaw browser ensure", () => {
  it("emits downloading then found using injected deps", async () => {
    const out = sink();
    let installed = false;
    const program = createCliProgram({
      stdout: out.stream,
      resolveBrowser: () => { if (!installed) throw new Error("missing"); return { executablePath: "/x", label: "Google Chrome" }; },
      installBrowser: async () => { installed = true; }
    });
    await program.parseAsync(["node", "gnaw", "browser", "ensure"]);
    const events = out.lines().map((l) => JSON.parse(l));
    expect(events.map((e) => e.type)).toEqual(["browser", "browser"]);
    expect(events.map((e) => e.status)).toEqual(["downloading", "found"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run engine/test/unit/cliBrowser.test.ts`
Expected: FAIL — `browser` command and the new deps do not exist.

- [ ] **Step 3: Extend `CliDependencies` and imports**

In `engine/src/cli.ts`, add imports and deps. After the existing imports:

```ts
import { checkBrowser, ensureBrowser } from "./browser/browserCommands.js";
import { resolveBrowser as defaultResolveBrowser, type ResolvedBrowser } from "./browser/resolveBrowser.js";
```

Extend `CliDependencies`:

```ts
export type CliDependencies = {
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
  capture?: (options: CaptureOptions) => Promise<CaptureResult>;
  profileStore?: ProfileStore;
  authLogin?: AuthLogin;
  resolveBrowser?: () => ResolvedBrowser;
  installBrowser?: () => Promise<void>;
};
```

Add the two params to the `createCliProgram` destructure (with defaults):

```ts
  resolveBrowser = defaultResolveBrowser,
  installBrowser
```

- [ ] **Step 4: Register the `browser` command**

Insert before `return program;` in `createCliProgram`:

```ts
  const browser = program.command("browser");

  browser.command("check").action(() => {
    const writer = createEventWriter({ stdout, stderr });
    const result = checkBrowser({ resolveBrowser });
    if (result.found) {
      writer.event({ v: 2, type: "browser", status: "found", detail: result.detail });
    } else {
      writer.log("No supported browser engine found.");
      process.exitCode = 3;
    }
  });

  browser.command("ensure").action(async () => {
    const writer = createEventWriter({ stdout, stderr });
    try {
      await ensureBrowser((event) => writer.event(event), { resolveBrowser, installChromium: installBrowser });
    } catch (error) {
      writer.log(error instanceof Error ? error.message : String(error));
      process.exitCode = 4;
    }
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run engine/test/unit/cliBrowser.test.ts && npm run test:unit`
Expected: new test PASS; existing unit suite still PASS.

- [ ] **Step 6: Manual CLI check**

Run: `npm run build && node dist/engine/src/cli.js browser check; echo "exit=$?"`
Expected: if you have Chrome/Edge → emits a `browser`/`found` JSON line, `exit=0`; if not → logs the message on stderr, `exit=3`.

- [ ] **Step 7: Commit**

```bash
git add engine/src/cli.ts engine/test/unit/cliBrowser.test.ts
git commit -m "engine: add 'gnaw browser check' and 'gnaw browser ensure' subcommands"
```

---

### Task 8: Decode `browser` events in the Swift model

`GnawEvent` currently decodes `status` only as `Int` (browser's string status becomes
`nil`) and has no `detail`/`progress`. Add string status + fields so the app can
render the download.

**Files:**
- Modify: `app/Gnaw/Sources/Models/CaptureModels.swift`
- Test: `app/Gnaw/Tests/GnawEventTests.swift` (add cases)

**Interfaces:**
- Produces (consumed by Task 9): `GnawEvent.statusText: String?`, `GnawEvent.detail: String?`, `GnawEvent.progress: Double?`.

- [ ] **Step 1: Add failing test cases**

Append to `app/Gnaw/Tests/GnawEventTests.swift`:

```swift
    func testDecodesBrowserDownloadingEvent() throws {
        let json = #"{"v":2,"type":"browser","status":"downloading","detail":"Downloading browser engine…","progress":0.5}"#
        let event = try JSONDecoder().decode(GnawEvent.self, from: Data(json.utf8))
        XCTAssertEqual(event.type, "browser")
        XCTAssertEqual(event.statusText, "downloading")
        XCTAssertEqual(event.detail, "Downloading browser engine…")
        XCTAssertEqual(event.progress, 0.5)
        XCTAssertNil(event.status) // integer status must stay nil for string status
    }

    func testDecodesBrowserFoundEvent() throws {
        let json = #"{"v":2,"type":"browser","status":"found","detail":"Google Chrome"}"#
        let event = try JSONDecoder().decode(GnawEvent.self, from: Data(json.utf8))
        XCTAssertEqual(event.statusText, "found")
        XCTAssertEqual(event.detail, "Google Chrome")
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `xcodebuild -project app/Gnaw/Gnaw.xcodeproj -scheme Gnaw -configuration Debug -derivedDataPath "${TMPDIR:-/tmp}/GnawDerivedData-$UID" test -only-testing:GnawTests/GnawEventTests`
Expected: FAIL — `statusText`, `detail`, `progress` do not exist.

- [ ] **Step 3: Add the fields**

In `CaptureModels.swift`, add stored properties to `GnawEvent`:

```swift
    let statusText: String?
    let detail: String?
    let progress: Double?
```

Add to `CodingKeys` (extend the existing two lines):

```swift
        case v, type, id, url, method, kind, bytes, status, rawPath
        case pages, assets, queued, elapsedMs, state, result, summary
        case haulPath, primary, code, message, reason, entrypoint
        case detail, progress
```

In `init(from:)`, right after the existing `status` line, add:

```swift
        statusText = try? container.decode(String.self, forKey: .status)
        detail = try container.decodeIfPresent(String.self, forKey: .detail)
        progress = try container.decodeIfPresent(Double.self, forKey: .progress)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `xcodebuild ... test -only-testing:GnawTests/GnawEventTests`
Expected: PASS (including existing `GnawEventTests` cases).

- [ ] **Step 5: Commit**

```bash
git add app/Gnaw/Sources/Models/CaptureModels.swift app/Gnaw/Tests/GnawEventTests.swift
git commit -m "app: decode browser status/detail/progress from engine events"
```

---

### Task 9: App download flow — check, warn, download, then capture

Before a capture, check for a browser. If missing, warn and (on confirm) download
Chromium with a progress indicator, then start the capture. Reuses the shared process
builder (Task 2) and the `browser` subcommands (Task 7).

**Files:**
- Modify: `app/Gnaw/Sources/Services/EngineClient.swift` (add `checkBrowser`, `ensureBrowser`)
- Modify: `app/Gnaw/Sources/Stores/AppModel.swift` (orchestration + state reducer)
- Modify: `app/Gnaw/Sources/Views/NewCaptureView.swift` (alert + progress overlay)
- Test: `app/Gnaw/Tests/BrowserDownloadStateTests.swift` (new)

**Interfaces:**
- Consumes: `makeProcess(arguments:)` (Task 2); `browser check`/`ensure` (Task 7); `GnawEvent.statusText/detail` (Task 8).
- Produces: `AppModel.browserDownload: BrowserDownloadState`; `AppModel.consumeBrowserEvent(_:)`; alert-driven `confirmBrowserDownload()` / `cancelBrowserDownload()`.

- [ ] **Step 1: Write the failing reducer test**

```swift
// app/Gnaw/Tests/BrowserDownloadStateTests.swift
import XCTest
@testable import Gnaw

@MainActor
final class BrowserDownloadStateTests: XCTestCase {
    private func event(_ json: String) throws -> GnawEvent {
        try JSONDecoder().decode(GnawEvent.self, from: Data(json.utf8))
    }

    func testDownloadingEventSetsDownloadingDetail() throws {
        let model = AppModel()
        model.consumeBrowserEvent(try event(#"{"v":2,"type":"browser","status":"downloading","detail":"Downloading browser engine…"}"#))
        guard case .downloading(let detail) = model.browserDownload else {
            return XCTFail("expected .downloading, got \(model.browserDownload)")
        }
        XCTAssertEqual(detail, "Downloading browser engine…")
    }

    func testFoundEventClearsDownloadState() throws {
        let model = AppModel()
        model.consumeBrowserEvent(try event(#"{"v":2,"type":"browser","status":"downloading","detail":"x"}"#))
        model.consumeBrowserEvent(try event(#"{"v":2,"type":"browser","status":"found","detail":"Google Chrome"}"#))
        XCTAssertEqual(model.browserDownload, .idle)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `xcodebuild ... test -only-testing:GnawTests/BrowserDownloadStateTests`
Expected: FAIL — `browserDownload`, `BrowserDownloadState`, `consumeBrowserEvent` do not exist.

- [ ] **Step 3: Add the state + reducer to `AppModel`**

Add near the other `@Published` properties in `AppModel`:

```swift
    @Published var browserDownload: BrowserDownloadState = .idle
```

Add the enum (top level in the same file, outside the class):

```swift
enum BrowserDownloadState: Equatable {
    case idle
    case confirming
    case downloading(String)
    case failed(String)
}
```

Add the reducer method to `AppModel`:

```swift
    func consumeBrowserEvent(_ event: GnawEvent) {
        switch event.statusText {
        case "downloading":
            browserDownload = .downloading(event.detail ?? "Downloading browser engine…")
        case "found":
            browserDownload = .idle
        default:
            break
        }
    }
```

- [ ] **Step 4: Run reducer test to verify it passes**

Run: `xcodebuild ... test -only-testing:GnawTests/BrowserDownloadStateTests`
Expected: PASS.

- [ ] **Step 5: Add `checkBrowser`/`ensureBrowser` to `EngineClient`**

Append to `EngineClient` (uses the shared builder from Task 2):

```swift
    /// Runs `gnaw browser check`. Calls back with true if a browser is available.
    func checkBrowser(completion: @escaping (Bool) -> Void) {
        do {
            let (process, _, _, _) = try makeProcess(arguments: ["browser", "check"])
            process.terminationHandler = { proc in completion(proc.terminationStatus == 0) }
            try process.run()
        } catch {
            completion(false)
        }
    }

    /// Runs `gnaw browser ensure`, streaming `browser` events via onEvent.
    func ensureBrowser(
        onEvent: @escaping (GnawEvent) -> Void,
        onExit: @escaping (Int32) -> Void
    ) {
        do {
            let (process, stdout, _, _) = try makeProcess(arguments: ["browser", "ensure"])
            let decoder = JSONDecoder()
            let reader = NDJSONLineReader(handle: stdout.fileHandleForReading) { line in
                guard let data = line.data(using: .utf8),
                      let event = try? decoder.decode(GnawEvent.self, from: data) else { return }
                onEvent(event)
            }
            process.terminationHandler = { proc in reader.finish(); onExit(proc.terminationStatus) }
            self.ensureReader = reader
            reader.start()
            try process.run()
        } catch {
            onExit(-1)
        }
    }
```

Add a stored property for the reader near the other private vars in `EngineClient`:

```swift
    private var ensureReader: NDJSONLineReader?
```

(`NDJSONLineReader` is already defined at the bottom of `EngineClient.swift`. Change
its `private final class` to `final class` so it is visible to these methods within
the module — it is in the same file, so no access change is actually required; leave
as-is.)

- [ ] **Step 6: Gate `startCapture()` behind the browser check**

In `AppModel.startCapture()`, replace the direct `engine.start(...)` invocation with a
check-first flow. Rename the current engine-start body into `beginEngineCapture()` and
call it after the browser is confirmed:

```swift
    func startCapture() {
        guard canStart else {
            errorMessage = "Enter the website address you want to capture."
            return
        }
        configuration.url = normalizedURL(configuration.url)
        commitOutputDirectory()
        resetJob()
        engine.checkBrowser { [weak self] hasBrowser in
            DispatchQueue.main.async {
                guard let self else { return }
                if hasBrowser {
                    self.beginEngineCapture()
                } else {
                    self.browserDownload = .confirming
                }
            }
        }
    }

    func confirmBrowserDownload() {
        browserDownload = .downloading("Preparing…")
        engine.ensureBrowser(
            onEvent: { [weak self] event in
                DispatchQueue.main.async { self?.consumeBrowserEvent(event) }
            },
            onExit: { [weak self] status in
                DispatchQueue.main.async {
                    guard let self else { return }
                    if status == 0 {
                        self.browserDownload = .idle
                        self.beginEngineCapture()
                    } else {
                        self.browserDownload = .failed(
                            "Couldn't download the browser engine. Check your internet connection and try again.")
                    }
                }
            }
        )
    }

    func cancelBrowserDownload() {
        browserDownload = .idle
    }
```

Move the existing `phase = .capturing` … `engine.start(...) { … }` block into a new
method `beginEngineCapture()` (same body that `startCapture()` used before this task):

```swift
    private func beginEngineCapture() {
        phase = .capturing
        sidebarSelection = .currentCapture
        engineState = "starting"
        do {
            try engine.start(
                configuration: configuration,
                onEvent: { [weak self] event in DispatchQueue.main.async { self?.consume(event) } },
                onLog: { [weak self] line in DispatchQueue.main.async { self?.appendLog(line) } },
                onExit: { [weak self] status in DispatchQueue.main.async { self?.engineExited(status) } }
            )
        } catch {
            errorMessage = error.localizedDescription
            phase = .setup
            engineState = "failed"
        }
    }
```

- [ ] **Step 7: Add the alert + progress overlay to `NewCaptureView`**

In `NewCaptureView.swift`, attach to the view's root (use the existing
`@EnvironmentObject`/`@ObservedObject var model: AppModel`; match the file's actual
property name):

```swift
        .alert("Download browser engine?", isPresented: Binding(
            get: { model.browserDownload == .confirming },
            set: { if !$0 { model.cancelBrowserDownload() } }
        )) {
            Button("Download") { model.confirmBrowserDownload() }
            Button("Cancel", role: .cancel) { model.cancelBrowserDownload() }
        } message: {
            Text("Gnaw needs a browser engine to capture sites and none was found. Download Chromium now? This is a one-time ~150MB download.")
        }
        .overlay {
            if case .downloading(let detail) = model.browserDownload {
                VStack(spacing: 12) {
                    ProgressView().controlSize(.large)
                    Text(detail).font(.callout).foregroundStyle(.secondary)
                }
                .padding(24)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .alert("Download failed", isPresented: Binding(
            get: { if case .failed = model.browserDownload { return true } else { return false } },
            set: { if !$0 { model.cancelBrowserDownload() } }
        )) {
            Button("OK", role: .cancel) { model.cancelBrowserDownload() }
        } message: {
            if case .failed(let message) = model.browserDownload { Text(message) }
        }
```

- [ ] **Step 8: Build and run the full Swift suite**

Run: `xcodebuild -project app/Gnaw/Gnaw.xcodeproj -scheme Gnaw -configuration Debug -derivedDataPath "${TMPDIR:-/tmp}/GnawDerivedData-$UID" test`
Expected: all Swift tests PASS.

- [ ] **Step 9: Manual no-browser verification**

On a machine/state with no Chrome/Edge/Chromium and an empty
`~/Library/Application Support/Gnaw/browsers`, run `./script/build_and_run.sh`, start a
capture, confirm the download alert appears, the progress overlay shows, Chromium
downloads, and the capture then runs. (If you have Chrome installed, temporarily test
by pointing `GNAW_CHROME_PATH` at a non-existent path and moving `/Applications/Google Chrome.app` aside — restore afterward.)

- [ ] **Step 10: Commit**

```bash
git add app/Gnaw/Sources/Services/EngineClient.swift app/Gnaw/Sources/Stores/AppModel.swift app/Gnaw/Sources/Views/NewCaptureView.swift app/Gnaw/Tests/BrowserDownloadStateTests.swift
git commit -m "app: warn and download Chromium on first capture when no browser is found"
```

---

### Task 10: Repackage + document

Rebuild the DMG with Phase B included and update user-facing docs.

**Files:**
- Modify: `README.md` (distribution / first-launch section)
- Modify: `SESSION-NOTES.md` (record Phase B verification)

- [ ] **Step 1: Rebuild and smoke-test the DMG**

Run: `./script/package_dmg.sh --verify`
Expected: `codesign verify OK`, `smoke OK: Gnaw is running`, `Built .../dist/Gnaw.dmg`.

- [ ] **Step 2: Add a "Download the app" section to `README.md`**

Document: download `Gnaw.dmg`, drag to Applications, the one-time "Open Anyway" step
(reference `FIRST-LAUNCH.txt`), and that Chromium auto-downloads on first capture if
no browser is installed. Note that Node is **not** required for the packaged app
(only for building from source).

- [ ] **Step 3: Record Phase B verification in `SESSION-NOTES.md`**

Note the `browser check`/`ensure` behavior, the download flow result, and the final
DMG size.

- [ ] **Step 4: Commit**

```bash
git add README.md SESSION-NOTES.md
git commit -m "docs: document self-contained DMG install and Chromium auto-download"
```

---

## Self-Review

**Spec coverage:**
- Bundle engine → Task 4 (embed) + Task 1 (assets). ✅
- Bundle universal Node → Task 3 + Task 4. ✅
- `EngineClient` bundled resolution + dev fallback → Task 2. ✅
- Browser fallback + first-run download + warning → Tasks 6–9. ✅
- `browser ensure` engine subcommand emitting NDJSON progress → Tasks 6–7 (reuses existing `browser` event; no schema change). ✅
- Browser cache at `~/Library/Application Support/Gnaw/browsers` via `PLAYWRIGHT_BROWSERS_PATH` → Task 2 (env) consumed by Tasks 7/9. ✅
- `package_dmg.sh` (build → stage prod deps → universal node → Release universal app → embed → ad-hoc inside-out sign → hdiutil DMG + Applications symlink + first-launch note) → Task 4. ✅
- `project.yml` Release universal, hardened runtime off → Task 4 (Global Constraints keep hardened runtime off; project.yml unchanged there). ✅
- Verification (lipo, self-containment, smoke, no-browser) → Tasks 5, 9, 10. ✅
- Dev loop preserved → Task 2 Step 6. ✅
- Residual friction (one-time "Open Anyway") documented for users → Task 4 (FIRST-LAUNCH.txt) + Task 10 (README). ✅
- Notarization upgrade path → out of scope by decision; ad-hoc signing is isolated in `package_dmg.sh`/`fetch_universal_node.sh` so it can later be swapped. ✅

**Placeholder scan:** No TBD/TODO; every code step shows real code; every command has expected output. Node version pinned (`v22.13.0`) with an explicit bump instruction if it 404s.

**Type consistency:** `makeProcess(arguments:)`, `resolveEngine()`, `browserCachePath`, `checkBrowser`, `ensureBrowser`, `BrowserStatusEvent`, `GnawEvent.statusText/detail/progress`, `BrowserDownloadState`, `consumeBrowserEvent`, `beginEngineCapture()` are defined once and referenced consistently across tasks.
