# Gnaw Spec, v2

> Gnaw any site down to the bone.
> A native macOS app that drives a real browser, lets the page's JavaScript run, and saves every asset the browser actually downloads. Two outputs: a browsable offline mirror, and a study bundle made to be fed to an LLM.

Date: 2026-07-06
Status: authoritative. Supersedes `GNAW-SPEC-v1.md` and absorbs `docs/superpowers/specs/2026-07-06-gnaw-product-design.md` (kept as historical record).

Repo: `enuzzo/gnaw` (public)
App name: Gnaw. CLI command: `gnaw`. Mascot: Gnawty.
Bundle id: `studio.netmilk.gnaw`
License: MIT.

All code, filenames, routes, schemas, and identifiers are in English. UI strings are English for v1.

---

## 0. What changed from v1 (summary)

1. The Rust rewrite is deferred to post-1.0. v1 ships the TypeScript/Playwright engine inside the app. The contract makes the engine swappable later; the user never has to know which engine runs. Rationale in section 10.
2. The GUI moves from milestone M7 to M4. It is the product; it gets a full design chapter (section 8) instead of one paragraph.
3. Event protocol v2: versioned handshake, request lifecycle events (a real waterfall needs in-flight rows), throttled progress, structured error codes, and a stdin control channel (pause, resume, cancel). Cancel always produces a valid partial haul.
4. Manifest v2: `schemaVersion`, engine identity, timings, `result` (complete, partial, canceled), error records, richer page entries.
5. Contract gaps closed: cross-origin assets are namespaced by host (v1 would have collided or lost CDN assets), URL to file path normalization is fully specified (query strings, APFS case-insensitivity, length caps), `waterfall.ndjson` gets a schema, size and page-count guardrails get defaults.
6. Scope semantics clarified: `sameDomainOnly` governs which pages get crawled. Assets referenced by an in-scope page are always captured, whatever their origin.
7. The parity harness becomes useful immediately: it is a golden-snapshot regression harness for the single engine now, and becomes a parity harness the day a second engine exists.
8. `context.md` upgraded: observed API endpoints, file tree, token estimate.
9. Machine-checkable contract: JSON Schemas for the manifest and the event protocol live in `contract/` and are validated in CI.

---

## 1. Why this exists

Tools like SiteSucker, HTTrack, and `wget --mirror` stop at the static HTML. They parse markup and follow links, but they never run the page's JavaScript, so anything loaded dynamically (fetch calls, lazy assets, JS-injected resources) is invisible to them and never gets saved.

Gnaw flips the approach: it does not parse HTML to guess assets. It opens the page in a real headless Chromium, lets all the JavaScript run, and hooks the network layer to save every response the browser fetches. Nothing dynamic slips through.

Framing: Gnaw only records what a real browser downloads on its own. It is an archival and study tool. The user is responsible for respecting the target's terms of service and copyright. The UI says this once, clearly, and does not nag.

Authenticated sites are a first-class use case. Gnaw supports login-gated sites through named browser session profiles. It does not store passwords, bypass access controls, or submit login forms automatically.

## 2. Product principles

- Easy by default, powerful on demand. Paste a URL, press one button, get a haul. Every advanced control exists, but behind a disclosure, never in the way.
- Capture reality, not guesses. Observe Chromium's network traffic; never infer assets from static HTML.
- The GUI is the product. The CLI is the same engine binary and stays first-class for automation, but every design decision optimizes the app experience.
- The contract is law. GUI, engine, harness, and any future engine speak only through the files and NDJSON events defined in `CONTRACT.md`. The GUI holds zero capture logic.
- A haul is always valid. Whether a capture completes, fails halfway, or is canceled, the folder on disk has a manifest that says exactly what happened.
- Never mutate the target. No form submission, no arbitrary clicking, no unsafe routes, GET navigation only.
- Never leak secrets. Auth state lives in local profiles; tokens, cookies, and storage values never appear in any output file.

## 3. High-level architecture

```
SwiftUI app (the face)
      |
      |  spawns the engine as a child process
      |  writes control commands to stdin (pause/resume/cancel)
      |  reads an NDJSON event stream from stdout
      v
gnaw engine (the teeth)         TypeScript + Playwright, single binary
      |
      |  drives headless Chromium over CDP
      |  intercepts every network response
      v
disk: a "haul" folder (navigable mirror and/or study bundle)
```

The GUI never captures anything itself. It launches the engine, streams events, renders progress live (waterfall, counters, stack badge, Gnawty), and operates on finished hauls. The engine writes everything to disk and reports back.

The same engine binary is the `gnaw` CLI. The app can install a `gnaw` shim into the user's PATH (like VS Code's `code` command).

### Browser resolution

The .app stays small by not bundling Chromium. At startup the engine resolves a browser in this order:

1. Google Chrome, then Microsoft Edge, then Chromium, if installed.
2. Otherwise it downloads a pinned Chromium build into `~/Library/Application Support/Gnaw/browser/` (one time, with progress reported over the event stream).

The resolved browser and version are recorded in the manifest.

## 4. The contract (single source of truth)

Defined once in `CONTRACT.md`, with machine-checkable JSON Schemas in `contract/manifest.schema.json` and `contract/events.schema.json`. The engine implements it, the GUI consumes it, the harness enforces it, CI validates real output against the schemas.

### 4.1 Haul folder layout

A capture produces one haul folder (default location `~/Gnaw/`, configurable):

```
haul-<host>-<YYYYMMDD-HHMMSS>/
  navigable/                  (only if Navigable mode selected)
    index.html
    <path>/index.html
    _assets/<host>/<path>     (all assets, any origin, rewritten to relative links)
  study/                      (only if Study mode selected)
    raw/<host>/<path>         (every response body, original bytes, namespaced by host)
    beautified/<host>/<path>  (de-minified JS and CSS, mirrors raw/)
    rendered/<host>/<path>    (post-JS DOM snapshot per page, *.html)
    sourcemaps/<host>/<path>  (any source maps the site exposes)
  MANIFEST.json
  context.md                  (only if Study mode selected)
  waterfall.ndjson            (full request/response log)
  gnaw.log                    (human-readable engine log, mirror of stderr)
```

Both modes can be selected at once. Namespacing by host is mandatory: a page on `example.com` routinely pulls assets from CDNs, and those must be captured without collisions.

### 4.2 URL to file path normalization

Deterministic, identical across engines, specified here so the harness can diff trees byte-for-byte.

1. Strip the fragment.
2. Lowercase the host. The host becomes the first path component (`study/raw/cdn.shopify.com/...`).
3. A path ending in `/` maps to `<path>/index.html`. The root `/` maps to `index.html`.
4. A page URL with no file extension maps to `<path>/index.html` in `navigable/` and `rendered/`.
5. Query strings: if non-empty, append `~q<sha256-first8-of-query>` before the extension (`app.js?v=3` becomes `app~q1a2b3c4d.js`). Two URLs differing only in query never collide.
6. Percent-decode, then replace any character outside `[A-Za-z0-9._-]` and non-ASCII with `_`.
7. APFS is case-insensitive: if a normalized path collides with an already-written path that differs only in case, append `~c<sha256-first8-of-original-url>` before the extension.
8. Any path segment longer than 100 chars is truncated to 80 and suffixed with `~<sha256-first8>`.
9. No deduplication of identical bodies in v1: fidelity first. The manifest records `sha256` per asset so dedup analysis is possible downstream.

### 4.3 MANIFEST.json schema

```json
{
  "schemaVersion": 2,
  "gnawVersion": "1.0.0",
  "engine": { "name": "gnaw-playwright", "version": "1.0.0", "browser": "Chrome 126.0.6478.62" },
  "entrypoint": "https://example.com/",
  "host": "example.com",
  "startedAt": "2026-07-06T10:22:31Z",
  "finishedAt": "2026-07-06T10:24:02Z",
  "durationMs": 91000,
  "result": "complete",
  "modes": ["navigable", "study"],
  "config": {
    "depth": 1,
    "sameDomainOnly": true,
    "includeSubdomains": false,
    "respectRobots": false,
    "rateLimitMs": 250,
    "maxPages": 200,
    "maxTotalBytes": 2147483648,
    "maxAssetBytes": 104857600,
    "userAgent": "...",
    "authProfile": null
  },
  "stack": {
    "primary": "Next.js",
    "detected": [
      { "name": "Next.js", "confidence": 0.92, "signals": ["/_next/ paths", "window.__NEXT_DATA__"] },
      { "name": "Vercel", "confidence": 0.7, "signals": ["server: Vercel header"] }
    ]
  },
  "stats": {
    "pages": 14,
    "assets": 147,
    "bytes": 8810342,
    "byKind": { "HTML": 14, "JS": 38, "CSS": 6, "IMG": 71, "FONT": 4, "JSON": 9, "MEDIA": 2, "WASM": 0, "OTHER": 3 }
  },
  "pages": [
    {
      "url": "https://example.com/",
      "title": "Example",
      "depth": 0,
      "status": 200,
      "discoveredFrom": null,
      "navigablePath": "navigable/index.html",
      "renderedPath": "study/rendered/example.com/index.html"
    }
  ],
  "assets": [
    {
      "url": "https://example.com/_next/static/chunks/app.4f2a.js",
      "kind": "JS",
      "status": 200,
      "contentType": "application/javascript",
      "bytes": 184320,
      "sha256": "...",
      "rawPath": "study/raw/example.com/_next/static/chunks/app.4f2a.js",
      "beautifiedPath": "study/beautified/example.com/_next/static/chunks/app.4f2a.js",
      "referrer": "https://example.com/",
      "viaJs": true,
      "fromCache": false
    }
  ],
  "auth": {
    "mode": "profile",
    "profileName": "client-a",
    "storageStateUsed": true,
    "redacted": true
  },
  "safety": {
    "skippedUrls": [
      { "url": "https://example.com/logout", "reason": "blocked_pattern" }
    ]
  },
  "errors": [
    { "code": "nav_timeout", "url": "https://example.com/slow", "message": "Navigation timed out after 30s" }
  ]
}
```

Notes:

- `result` is one of `complete`, `partial` (a cap or non-fatal errors cut it short), `canceled`.
- `auth` is present only when a profile was used; `errors` and `safety.skippedUrls` may be empty arrays.
- Asset `kind` enum: `HTML, JS, CSS, IMG, FONT, JSON, MEDIA, WASM, OTHER`.

### 4.4 waterfall.ndjson schema

One JSON object per network response, in completion order:

```json
{ "t": 12894, "url": "...", "method": "GET", "status": 200, "kind": "JS",
  "contentType": "application/javascript", "bytes": 184320, "durationMs": 142,
  "fromCache": false, "viaJs": true, "referrer": "https://example.com/", "page": "https://example.com/" }
```

`t` is milliseconds since capture start. Request headers, response headers with credentials, cookies, and bodies never appear here (bodies live in `study/raw/`, secrets nowhere).

### 4.5 Event protocol (engine to GUI, NDJSON on stdout)

One JSON object per line. Every event carries `"v": 2`. Human-readable logs go to stderr only, mirrored into `gnaw.log`.

```json
{ "v": 2, "type": "hello", "engine": { "name": "gnaw-playwright", "version": "1.0.0" }, "contract": "2.0" }
{ "v": 2, "type": "browser", "status": "found", "detail": "Chrome 126 at /Applications/Google Chrome.app" }
{ "v": 2, "type": "browser", "status": "downloading", "progress": 0.42 }
{ "v": 2, "type": "start", "jobId": "j-8f2c", "entrypoint": "...", "modes": ["study"], "config": { }, "haulPath": "/Users/x/Gnaw/haul-example.com-20260706-102231" }
{ "v": 2, "type": "page_start", "url": "...", "depth": 1 }
{ "v": 2, "type": "request", "id": "r-0192", "url": "...", "method": "GET" }
{ "v": 2, "type": "asset", "id": "r-0192", "url": "...", "kind": "JS", "bytes": 184320, "status": 200, "fromCache": false, "viaJs": true, "rawPath": "..." }
{ "v": 2, "type": "page_done", "url": "...", "title": "...", "assets": 31 }
{ "v": 2, "type": "stack", "primary": "Next.js", "detected": [ { "name": "Next.js", "confidence": 0.92, "signals": ["..."] } ] }
{ "v": 2, "type": "progress", "pages": 3, "assets": 147, "bytes": 8810342, "queued": 12, "elapsedMs": 42000 }
{ "v": 2, "type": "skip", "url": "...", "reason": "blocked_pattern" }
{ "v": 2, "type": "warning", "code": "asset_too_large", "url": "...", "message": "Skipped 212 MB video" }
{ "v": 2, "type": "error", "code": "nav_timeout", "url": "...", "message": "...", "fatal": false }
{ "v": 2, "type": "state", "state": "paused" }
{ "v": 2, "type": "done", "result": "complete", "summary": { "pages": 14, "assets": 147, "bytes": 8810342, "durationMs": 91000 }, "haulPath": "..." }
```

Rules:

- `request` before `asset` with a shared `id` lets the GUI render in-flight waterfall rows.
- `progress` is throttled to at most 4 per second; the GUI must not need any other event to keep counters correct (progress is authoritative for totals).
- `skip.reason` enum: `blocked_pattern`, `out_of_scope`, `robots`, `max_pages`, `max_depth`.
- `error.code` enum (non-exhaustive, stable): `nav_timeout`, `dns`, `tls`, `http_error`, `write_failed`, `browser_crash`, `profile_locked`. `fatal: true` means the job is ending; a `done` event with `result` still follows whenever a manifest could be written.
- Unknown event types and unknown fields must be ignored by consumers (forward compatibility).

### 4.6 Control channel (GUI to engine, NDJSON on stdin)

```json
{ "cmd": "pause" }
{ "cmd": "resume" }
{ "cmd": "cancel" }
```

`cancel` is graceful: the engine stops navigating, finishes writing bodies already in flight, writes `MANIFEST.json` with `result: "canceled"`, emits `done`, exits 0. SIGTERM behaves like `cancel`. A canceled haul is a valid haul.

### 4.7 Auth profiles

Named local browser sessions for captures behind login.

CLI shape (the GUI drives the same engine functions):

```bash
gnaw auth login https://example.com --profile client-a
gnaw capture https://example.com/dashboard --profile client-a --mode study,navigable
gnaw auth list
gnaw auth delete client-a
```

`gnaw auth login` opens a visible Chromium window. The user logs in manually (SSO, 2FA, consent screens, CAPTCHA included). Gnaw stores the resulting browser state as a Playwright persistent context in `~/Library/Application Support/Gnaw/profiles/<name>/` with `0700` permissions, and records the last verified URL and timestamp per profile.

A profile is locked while a capture uses it (concurrent captures on the same profile are refused with `profile_locked`).

Redaction is absolute: no plaintext passwords, cookie values, bearer tokens, authorization headers, or localStorage/sessionStorage values in `MANIFEST.json`, `context.md`, `waterfall.ndjson`, `gnaw.log`, or any event. Profile directories are never inside a haul. The manifest records only the metadata block shown in 4.3.

### 4.8 Safety rules

Gnaw navigates with GET only and never clicks controls or submits forms during a crawl. Default blocklist patterns, matched case-insensitively against path segments of navigation URLs (not asset requests):

`/logout`, `/signout`, `/sign-out`, `/delete`, `/remove`, `/checkout`, `/cart`, `/billing`, `/account/delete`, `/unsubscribe`

The list is user-editable per capture (add or remove patterns). Every skipped URL is recorded in the manifest and emitted as a `skip` event.

Guardrails with sane defaults, all configurable: `maxPages` 200, `maxTotalBytes` 2 GB, `maxAssetBytes` 100 MB (larger assets are skipped with a `warning`). Hitting a guardrail ends the capture with `result: "partial"`.

`respectRobots` is a toggle, off by default for local study workflows. Interaction recipes (user-approved clicks, scrolls, waits per route) are deferred, see section 12.

### 4.9 context.md format (the LLM-ready bundle)

Generated in Study mode. Pre-formatted to paste straight into an LLM, links out to files instead of inlining them.

```markdown
# Captured site: <host>

Captured by Gnaw on <date>. This bundle contains the rendered pages and every
asset the browser downloaded after JavaScript ran. Use it to study how the
site is built and to replicate specific behaviour.

## Detected stack
Next.js (confidence 0.92), Vercel (0.7). Signals: /_next/ paths, window.__NEXT_DATA__, server header.

## Page inventory
- / "Example Home" (rendered: study/rendered/example.com/index.html)
- /about "About us" (rendered: study/rendered/example.com/about/index.html)

## Key JavaScript bundles (largest first, beautified)
- study/beautified/example.com/_next/static/chunks/app.4f2a.js (184 KB)

## Observed API endpoints
Fetch/XHR responses captured during rendering:
- GET /api/products (JSON, 12 KB, study/raw/example.com/api/products~q....json)

## Asset summary
HTML 14, JS 38, CSS 6, IMG 71, FONT 4, JSON 9, MEDIA 2. Total 8.4 MB.
Rough size of text assets: ~310k tokens. Read selectively.

## File tree (depth 3)
<abridged tree of study/>

## How to use this bundle
You are given a captured website to study. Read the rendered HTML and the
beautified JavaScript. Explain how <behaviour> is implemented, then propose a
clean reimplementation we can drop into our own repo.
```

## 5. Capture pipeline

1. Resolve the browser (section 3), launch headless Chromium over CDP.
2. Create or reuse a browser context; apply user agent, viewport, rate limit, and optional auth profile.
3. Attach network interception before any navigation.
4. Navigate to the entrypoint, wait for load plus network quiet.
5. For every response: classify `kind`, record url, method, status, content type, bytes, sha256, `viaJs`, `fromCache`; save the body under `study/raw/<host>/<path>`; emit `request`/`asset` events; append to `waterfall.ndjson`.
6. Auto-scroll to the bottom to trigger lazy assets, wait for quiet again.
7. Snapshot the post-JS DOM to `study/rendered/`.
8. Extract in-scope links from the rendered DOM. Scope: `sameDomainOnly` and `includeSubdomains` apply to page navigation only; assets are always captured regardless of origin. Skip blocked patterns, respect depth, enqueue the rest.
9. Repeat until the queue drains or a guardrail hits. Honor pause/resume/cancel at page boundaries.
10. Post-process:
    - Navigable mode: rewrite URLs to relative paths into `navigable/` (pages and `_assets/<host>/...`).
    - Study mode: beautify JS and CSS into `study/beautified/`, pull source maps into `study/sourcemaps/`, write `context.md`.
11. Write `MANIFEST.json` last (its presence with a `result` marks a finished haul).

## 6. Stack detection

Detection rules live in a data file inside the engine (`stacks.json`), each rule: a signal matcher plus a weight. Signals:

- Response headers: `X-Powered-By`, `Server`.
- Path patterns: `/_next/` (Next.js), `/wp-content/`, `/wp-json/` (WordPress), Elementor body classes, Webflow `data-wf-*`, Shopify `cdn.shopify.com`.
- `<meta name="generator">`.
- JS globals in the rendered page: `window.__NEXT_DATA__`, `window.Shopify`, `window.wp`.

Confidence per technology is a weighted sum capped at 1.0. Multiple detections coexist (WordPress and Elementor, Next.js and Vercel); `stack.primary` is the highest-confidence entry. Emit the `stack` event as soon as confidence crosses 0.6, update it if a better candidate appears.

## 7. CLI surface

The CLI is the engine binary itself, first-class for automation and CI:

```bash
gnaw capture <url> [--mode study,navigable] [--depth N] [--profile name]
              [--subdomains] [--robots] [--rate-limit ms] [--out dir]
              [--max-pages N] [--max-bytes N] [--block pattern]...
gnaw auth login <url> --profile <name>
gnaw auth list | gnaw auth delete <name>
```

Flags map one-to-one to GUI controls. `--json` is implicit: stdout is always the NDJSON event stream; a human summary goes to stderr at the end.

## 8. The GUI

Single-window macOS app, three states in the main area, a sidebar that makes Gnaw a library rather than a one-shot tool. The design target: a focused studio instrument. Calm when idle, alive when chewing, obvious when done. Easy by default, powerful on demand.

### 8.1 Layout

```
+------------+---------------------------------------------+
| Sidebar    |  Main area (state-driven)                   |
|            |                                             |
| HAULS      |   State 1: New Gnaw (setup)                 |
|  example…  |   State 2: Capturing (live)                 |
|  client-a… |   State 3: Haul (results)                   |
|            |                                             |
| PROFILES   |                                             |
|  client-a  |                                             |
+------------+---------------------------------------------+
```

- Sidebar, collapsible: list of past hauls (favicon, host, date, size, result badge) sorted by date; selecting one shows State 3 for it. Context menu: Reveal in Finder, Re-gnaw (same config), Delete. Below, auth profiles with last-verified info; context menu: Open login window, Delete.
- The haul library is populated by scanning the output folder for `MANIFEST.json` files; the manifest is the single source of truth, no separate app database in v1.

### 8.2 State 1: New Gnaw

Centered, generous whitespace. Gnawty idles (subtle blink loop).

- Big URL field, autofocused. Paste anywhere in the app inserts here; dropping a link onto the window or Dock icon prefills it.
- Preset segmented control: `Page` (depth 0), `Skim` (depth 1, default), `Site` (depth 3).
- Two mode chips, both on by default: `Navigable`, `Study`.
- Auth profile popup: `No login` plus saved profiles, with a `Manage…` item.
- `Advanced` disclosure (collapsed by default): depth stepper, same domain and subdomains toggles, robots toggle, rate limit, max pages, max bytes, blocklist editor, custom user agent, output folder.
- Primary button: `Gnaw it`. Return key triggers it. Validation is inline and forgiving (missing scheme gets `https://` prepended).

### 8.3 State 2: Capturing

The screen where Gnaw earns its keep. Everything updates live from the event stream, nothing blocks.

- Header: entrypoint, elapsed time, stack badge slot (pops in with a soft spring when the `stack` event lands; click shows detected technologies and signals).
- Stats strip: pages, assets, bytes (monospaced digits, ticking), queue depth, and a bytes-per-second sparkline.
- The waterfall: a virtualized table fed by `request`/`asset` events. Columns: kind chip, path (middle-truncated), size, status, time. In-flight rows shimmer until their `asset` event arrives. Filter bar: kind chips act as toggles, plus a search field (⌘F). Auto-scroll follows the tail; any manual scroll pins the view and shows a "Jump to live" pill.
- Errors and skips appear as amber and gray rows inline, never as modals. A counter in the stats strip opens an errors drawer.
- Controls: `Pause`/`Resume` (space), `Cancel` (⌘.). Cancel warns nothing and loses nothing: it finalizes a valid partial haul.
- Gnawty chews in a corner, chewing speed loosely tied to throughput; frozen mid-bite while paused.

### 8.4 State 3: Haul

- Summary card: result badge (complete, partial, canceled), pages, assets, duration, total bytes, and a horizontal bar of bytes by kind using the kind colors.
- Stack badge with confidence; popover lists signals.
- Skipped URLs and errors in collapsible lists.
- Action row: `Open Mirror` (default browser), `Reveal in Finder`, `Copy context.md`, `Export .zip`.
- The waterfall remains browsable and filterable for the finished haul (read from `waterfall.ndjson`).

### 8.5 Design language

- Native macOS 14+, SwiftUI, standard toolbar and sidebar; supports light and dark, designed dark-first.
- Type: SF Pro for UI, SF Mono for URLs, paths, and all numerals (tabular figures, no jitter while counting).
- Accent: amber/orange (Gnawty's palette). Kind chip colors, consistent everywhere (waterfall, summary bar, filters): HTML orange, JS yellow, CSS blue, IMG green, JSON purple, FONT pink, MEDIA teal, WASM brown, OTHER gray.
- Motion: subtle springs for state transitions and the stack badge; the only persistent animation is Gnawty. Everything respects Reduce Motion (Gnawty falls back to static poses).
- No modal dialogs except destructive confirms (delete haul, delete profile).
- Empty states are drawn, not blank: the empty library shows Gnawty with "Nothing gnawed yet".

### 8.6 Keyboard and system integration

- ⌘N new capture, ⏎ start, space pause/resume, ⌘. cancel, ⌘F filter waterfall, ⌘R reveal haul, ⌘⇧C copy context.md.
- Drag a URL onto window or Dock icon to start a capture setup.
- Notification on completion when the app is in the background ("example.com gnawed: 147 assets, 8.4 MB").
- First run: if no browser is found, a friendly one-time setup card shows Chromium download progress (driven by `browser` events).

### 8.7 GUI to engine wiring

The app spawns the engine with `Process`, decodes NDJSON lines into typed Swift events (`Codable`, unknown fields ignored), feeds an `@Observable` job model. One capture at a time in v1; the model is designed so multiple concurrent jobs are a v1.x change, not a rewrite. If the engine dies without `done`, the app reports the crash and points at the partial haul and `gnaw.log`.

## 9. Tech stack

### Engine (`engine/`)

- Node 20+ / TypeScript, Playwright (Chromium over CDP), `commander` for the CLI.
- Beautify: `prettier` (or `js-beautify`) for JS and CSS in Study mode.
- Compiled to a single self-contained binary with `bun build --compile` (fallback: `pkg`), shipped inside the .app at `Contents/Resources/engine/gnaw`.
- stdout: NDJSON events only. stderr: human logs, mirrored to `gnaw.log`.

### App (`app/Gnaw/`)

- SwiftUI, macOS 14+, XcodeGen (`project.yml`), consistent with CRUST.
- Spawns the engine, streams events, renders. Holds no capture logic.
- Universal binary, hardened runtime, notarized, distributed via GitHub Releases. Homebrew cask after 1.0 stabilizes.

### Harness (`harness/`)

- A small Node tool that runs the engine against the fixture corpus and snapshots hauls (golden fixtures).
- Diff modes: tree equality, manifest structural equality (ignoring timestamps and ordering), byte equality where content is deterministic.
- Today it is the regression suite for the engine. The day a second engine exists, the same tool diffs the two: it becomes the parity harness with zero extra work.

## 10. The Rust question (deferred, deliberately)

v1 of this spec planned two engines: Playwright as tutor, Rust as the shippable student, with the GUI waiting until milestone M7. That ordering optimized for engine purity and starved the actual product.

Facts that changed the call:

- Both engines need Chromium; the heavy lifting is the browser either way. Rust buys a smaller sidecar binary (~10 MB vs ~60 MB), not a different capability.
- The contract makes the engine swappable behind the GUI at any time, invisibly.
- The user-facing goal is the app. Shipping it months earlier beats shipping a thinner sidecar.

So: the TypeScript engine is the v1 shipping engine, not a throwaway reference. The Rust engine (`chromiumoxide`, `lol_html`, `swc`, `lightningcss`) remains the intended long-term core and gets built after 1.0, module by module, validated by the harness against golden fixtures exactly as originally planned. Nothing in the contract or the app changes when it lands.

## 11. Fixture corpus (`fixtures/`)

Self-hosted local fixture sites, so goldens never drift:

- Static: plain HTML/CSS baseline.
- SPA: a small Next.js-style app with client-side fetches and hashed chunks.
- WordPress-like: template with Elementor-style markup and `wp-content` paths (the studio's bread and butter).
- Lazy: assets loaded on scroll and after delays.
- Auth: login form, cookies, localStorage, protected routes, lazy assets, and blocked safety routes (`/logout` etc.).
- Hostile paths: query-string variants, case collisions, very long URLs, cross-origin assets from a second local origin (exercises section 4.2 fully).

One or two live public sites are used for manual smoke tests only, never for goldens.

## 12. Milestones

- M0, Contract: write `CONTRACT.md` plus JSON Schemas in `contract/`. Set up the repo skeleton and fixtures scaffold. Everything depends on this.
- M1, Engine core: `gnaw capture` on the fixture corpus. Raw capture, rendered snapshots, manifest, waterfall, NDJSON events, control channel, guardrails, path normalization. Golden snapshots in the harness from day one.
- M2, Engine complete: navigable rewriting, beautified study output, source maps, `context.md`, stack detection, safety blocklist.
- M3, Auth: `gnaw auth` commands, profile storage and locking, redaction everywhere, auth fixture coverage.
- M4, App alpha: SwiftUI shell wired to the engine. States 1 to 3 functional, waterfall live, cancel/pause working. Usable daily even if plain.
- M5, App polish: haul library, presets, filters, exports, keyboard map, notifications, empty states, Gnawty animations, first-run browser setup, accessibility pass.
- M6, Ship 1.0: engine embedded in the .app, CLI shim installer, notarization, GitHub Release.
- Post-1.0 (v1.x, in rough order): HAR export from the waterfall, Re-gnaw with haul diffing (what changed since last capture), concurrent jobs, interaction recipes (user-approved clicks, scrolls, waits per route), Homebrew cask, the Rust engine behind the parity harness.

## 13. Testing strategy

- Unit: URL normalization (the whole of 4.2), kind classification, stack detection, manifest building, redaction, blocklist matching.
- Contract: every manifest and event stream produced in CI validates against the JSON Schemas.
- Integration: engine against every local fixture, including auth and hostile-paths.
- Golden snapshots: harness-diffed hauls per fixture; any intentional output change updates goldens explicitly in the same PR.
- GUI: unit-test the NDJSON decoding and job state machine; manual verification checklist against a public site, a JS-heavy site, and the auth fixture; verify cancel-produces-valid-haul and engine-crash handling.
- Redaction test: capture the auth fixture, then grep the entire haul for known planted secrets; the build fails if any appear.

## 14. Repo layout

```
gnaw/
  SPEC.md                    (this file)
  CONTRACT.md                (shared output and event contract)
  contract/                  (manifest.schema.json, events.schema.json)
  README.md
  engine/                    (TypeScript + Playwright: shipping engine and CLI)
  harness/                   (golden snapshot / future parity tool)
  fixtures/                  (local fixture sites)
  app/
    Gnaw/                    (SwiftUI, project.yml)
  docs/
```

## 15. Writing and naming conventions

- All identifiers, paths, routes, and schema keys in English.
- Device and project naming follows the studio convention.
- In any prose or docs: no long dashes. Use short hyphens, commas, parentheses, or colons.
