# GNAW-SPEC-v1.md

> Gnaw any site down to the bone.
> A native macOS tool that drives a real headless browser, executes the page's JavaScript, and saves every asset the browser actually downloads. Two output modes: a browsable offline mirror, and a study bundle made to be fed to an LLM.

Repo: `enuzzo/gnaw` (public)
CLI command: `gnaw`
Mascot: Gnawty
Bundle id: `studio.netmilk.gnaw`
License: choose at init (MIT or Apache-2.0)

All code, filenames, routes, schemas, and identifiers are in English. UI strings can stay English for v1.

Product priority: the CLI is the reference and automation surface, but the macOS GUI is the primary product surface. Every CLI capability should map cleanly to a GUI workflow.

---

## 1. Why this exists

Tools like SiteSucker, HTTrack, and `wget --mirror` stop at the static HTML. They parse markup and follow links, but they never run the page's JavaScript, so anything loaded dynamically (fetch calls, lazy assets, JS injected resources) is invisible to them and never gets saved.

Gnaw flips the approach: it does not parse HTML to guess assets. It opens the page in a real headless Chromium, lets all the JavaScript run, and hooks the network layer to save every response the browser fetches. Nothing dynamic slips through.

Framing: Gnaw only records what a real browser downloads on its own. It is an archival and study tool. The user is responsible for respecting the target's terms of service and copyright.

Authenticated sites are a first-class use case. Gnaw supports login-gated sites through named browser session profiles. It does not store passwords, bypass access controls, or submit login forms automatically.

---

## 2. Two-track development strategy

This is the core of the build plan. Two engines, one shared contract, a parity harness between them.

### Track A: the reference engine (the tutor)
- Built in Node with Playwright.
- Fast to write, powerful immediately.
- Implements the full capture pipeline first.
- Its output is treated as the golden reference: the definition, by example, of correct output.
- Runs against a fixed corpus of target sites to produce golden fixtures.

### Track B: the production engine (the student)
- Built in Rust (`gnaw-core`), the real shippable product.
- Reimplements the same pipeline, module by module.
- Each module is validated against the golden fixtures produced by Track A.

### The parity harness (the examiner)
- Runs both engines on the same URL set.
- Diffs their output:
  - same set of files captured (tree equality),
  - same MANIFEST fields (structural equality),
  - byte equality where the content is deterministic, structural equality where it is not (timestamps, ordering).
- Reports pass or fail per module, so Rust can grow safely one slice at a time.

The point: the two engines do not need to look alike internally. They need to satisfy the same contract (see section 4). Playwright satisfies it first, Rust satisfies it second, the harness proves they agree.

---

## 3. High level architecture

```
SwiftUI app (the face)
      |
      |  spawns engine as a child process
      |  reads an NDJSON event stream from stdout
      v
gnaw engine (the teeth)        <- Track A (Playwright) or Track B (Rust)
      |
      |  drives headless Chromium over CDP
      |  intercepts every network response
      v
disk: a "haul" folder (navigable mirror and/or study bundle)
```

The GUI never does the capture itself. It launches the engine, listens to events, and renders progress live (the waterfall, byte counter, stack badge, mascot). The engine writes the haul to disk and reports back.

---

## 4. The contract (single source of truth)

Define this once in `CONTRACT.md`. Both engines implement it. The harness checks it.

### 4.1 Output folder layout

A capture produces one "haul" folder:

```
haul-<host>-<YYYYMMDD-HHMMSS>/
  navigable/            (only if Navigable mode selected)
    index.html
    <path>/index.html
    _assets/            (rewritten to relative paths)
  study/                (only if Study mode selected)
    raw/                (assets at their original paths, untouched)
    beautified/         (de-minified JS and CSS, mirrors raw/)
    rendered/           (post-JS DOM snapshot per page, *.html)
    sourcemaps/         (any source maps the site exposes)
  MANIFEST.json
  context.md            (only if Study mode selected)
  waterfall.ndjson      (full request/response log)
  gnaw.log
```

Both modes can be selected at once. The harness treats `navigable/` and `study/raw/` as the two trees to diff.

### 4.2 MANIFEST.json schema

```json
{
  "gnawVersion": "1.0.0",
  "entrypoint": "https://example.com/",
  "host": "example.com",
  "capturedAt": "2026-06-14T10:22:31Z",
  "modes": ["navigable", "study"],
  "config": {
    "depth": 3,
    "sameDomainOnly": true,
    "includeSubdomains": false,
    "respectRobots": false,
    "rateLimitMs": 250,
    "userAgent": "..."
  },
  "stack": {
    "name": "Next.js",
    "confidence": 0.92,
    "signals": ["/_next/ paths", "window.__NEXT_DATA__"]
  },
  "stats": {
    "pages": 14,
    "assets": 147,
    "bytes": 8810342,
    "byKind": { "HTML": 14, "JS": 38, "CSS": 6, "IMG": 71, "FONT": 4, "JSON": 9, "MEDIA": 2, "OTHER": 3 }
  },
  "pages": [
    { "url": "https://example.com/", "localPath": "navigable/index.html", "status": 200 }
  ],
  "assets": [
    {
      "url": "https://example.com/_next/static/chunks/app.4f2a.js",
      "kind": "JS",
      "status": 200,
      "contentType": "application/javascript",
      "bytes": 184320,
      "sha256": "…",
      "rawPath": "study/raw/_next/static/chunks/app.4f2a.js",
      "beautifiedPath": "study/beautified/_next/static/chunks/app.4f2a.js",
      "referrer": "https://example.com/",
      "viaJs": true
    }
  ]
}
```

Asset `kind` enum: `HTML, JS, CSS, IMG, FONT, JSON, MEDIA, OTHER`.

### 4.3 Event protocol (engine to GUI)

Engine writes one JSON object per line (NDJSON) to stdout. The GUI reads line by line.

```json
{ "type": "start", "entrypoint": "...", "modes": ["study"], "config": { } }
{ "type": "stack_detected", "name": "Next.js", "confidence": 0.92 }
{ "type": "asset", "url": "...", "kind": "JS", "bytes": 184320, "status": 200, "fromCache": false, "localPath": "..." }
{ "type": "progress", "assets": 147, "bytes": 8810342, "queued": 12 }
{ "type": "page_done", "url": "..." }
{ "type": "error", "url": "...", "message": "..." }
{ "type": "done", "summary": { "pages": 14, "assets": 147, "bytes": 8810342 } }
```

Log lines (human readable) go to stderr, never stdout, so the NDJSON stream stays clean.

### 4.4 Auth profiles

Auth profiles are named local browser sessions used for captures behind login.

CLI shape:

```bash
gnaw auth login https://example.com --profile client-a
gnaw capture https://example.com/dashboard --profile client-a --mode study,navigable
gnaw auth list
gnaw auth delete client-a
```

`gnaw auth login` opens a visible Chromium window. The user logs in manually, including SSO, 2FA, consent screens, or CAPTCHA. Gnaw stores the resulting browser state in a named local profile and reuses it for later captures.

Gnaw must never save plaintext passwords or write cookie values, bearer tokens, authorization headers, or localStorage/sessionStorage values into `MANIFEST.json`, `context.md`, `waterfall.ndjson`, or `gnaw.log`.

Manifest auth metadata:

```json
{
  "auth": {
    "mode": "profile",
    "profileName": "client-a",
    "storageStateUsed": true,
    "redacted": true
  }
}
```

The GUI exposes this as an auth profile manager: add login profile, open login window, show last verified URL and timestamp, use profile for capture, delete profile.

### 4.5 Safety records

Gnaw should avoid obvious destructive or account-mutating routes by default. Suggested default blocklist patterns:

- `/logout`
- `/signout`
- `/delete`
- `/remove`
- `/checkout`
- `/cart`
- `/billing`
- `/account/delete`

Skipped URLs are recorded in the manifest:

```json
{
  "safety": {
    "skippedUrls": [
      { "url": "https://example.com/logout", "reason": "blocked_pattern" }
    ]
  }
}
```

For v1, Gnaw does not click arbitrary controls or submit forms during crawl. Later versions can add user-approved interaction recipes for controlled clicks, scrolls, waits, and route-specific capture steps.

### 4.6 context.md format (the LLM-ready bundle)

Generated in Study mode. Pre-formatted so it can be pasted straight into an LLM. Template:

```markdown
# Captured site: <host>

Captured by Gnaw on <date>. This bundle contains the rendered pages and every
asset the browser downloaded. Use it to study how the site is built and to
replicate a specific behaviour.

## Detected stack
<name> (confidence <0.xx>). Signals: <list>.

## Page inventory
- / (rendered: study/rendered/index.html)
- /about (rendered: study/rendered/about.html)
...

## Key JavaScript bundles
- /_next/static/chunks/app.4f2a.js  (184 KB, beautified)
...

## Asset summary
HTML 14, JS 38, CSS 6, IMG 71, FONT 4, JSON 9, MEDIA 2, OTHER 3. Total 8.4 MB.

## How to use this bundle
You are given a captured website to study. Read the rendered HTML and the
beautified JavaScript. Explain how <behaviour> is implemented, then propose a
clean reimplementation we can drop into our own repo.
```

---

## 5. Capture pipeline (both engines implement this)

1. Launch headless Chromium (CDP).
2. Set user agent, viewport, optional throttling.
3. Attach network interception before navigation.
4. Navigate to the entrypoint, wait for network idle.
5. For every response: classify `kind`, record url, status, content type, bytes, sha256, whether it was triggered by JS (`viaJs`), and save the body to `study/raw/` at its original path.
6. Auto-scroll to trigger lazy assets.
7. Snapshot the post-JS DOM to `study/rendered/`.
8. Extract in-scope links from the rendered DOM, skip unsafe routes, enqueue the rest subject to depth and domain rules.
9. Repeat until the queue drains.
10. Post process:
   - Navigable mode: rewrite all URLs to relative paths into `navigable/`.
   - Study mode: beautify JS and CSS into `study/beautified/`, pull source maps, write `context.md`.
11. Write `MANIFEST.json` and `waterfall.ndjson`.

### Scope and politeness
- `depth`: link distance from the entrypoint.
- `sameDomainOnly` and `includeSubdomains`.
- `respectRobots`: off by default, present as a toggle.
- `rateLimitMs`: delay between requests.
- Custom `userAgent`.

---

## 6. Stack detection heuristics

Emit `stack_detected` as soon as enough signal is present. Signals to check:
- Response headers: `X-Powered-By`, `Server`.
- Path patterns: `/_next/` (Next.js), `/wp-content/` and `/wp-json/` (WordPress), Elementor body classes, Webflow `data-wf-*` attributes, Shopify `cdn.shopify.com`.
- Meta tag: `<meta name="generator">`.
- JS globals in the rendered page: `window.__NEXT_DATA__`, `window.Shopify`, `window.wp`.

Confidence is a simple weighted sum of matched signals, capped at 1.0.

---

## 7. Tech stack

### Track A: reference engine (`reference/playwright/`)
- Node 20+, TypeScript.
- `playwright` (Chromium), bundled browser.
- `commander` for the CLI.
- Output strictly conforms to `CONTRACT.md`.
- Auth profiles implemented with Playwright persistent browser contexts or storage state, with sensitive output redaction.

### Track B: production engine (`crates/`)
Rust workspace:
- `gnaw-core`: the engine library.
  - `chromiumoxide` + `tokio` for CDP control and async.
  - `serde` / `serde_json` for manifest and events.
  - `url` for URL handling, `lol_html` for streaming HTML rewriting (Navigable mode).
  - `swc_ecma_parser` + `swc_ecma_codegen` to de-minify JavaScript (parse then pretty print).
  - `lightningcss` to pretty print CSS.
  - `sha2` for hashing, `tracing` for logs (to stderr).
- `gnaw-cli`: the `gnaw` binary (`clap`), wraps `gnaw-core`, emits NDJSON to stdout.

### The app (`app/Gnaw/`)
- SwiftUI, macOS 14+.
- XcodeGen (`project.yml`), consistent with CRUST.
- Spawns the engine with `Process`, reads the stdout pipe line by line, decodes NDJSON into an `@Observable` view model.
- Ships the Rust binary inside the `.app` (universal binary), notarized, distributed via GitHub Releases. Optional Homebrew cask later.
- Primary user surface for normal use. The app manages capture options, auth profiles, live progress, and output actions.

### Parity harness (`parity/`)
- `parity/fixtures/`: the target corpus (see section 8).
- `parity/harness/`: a small Rust or Node tool that runs an engine, snapshots the haul, and diffs two hauls (tree, manifest, byte or structural equality per file kind).

---

## 8. Fixture corpus

A small fixed set of targets that exercise the hard cases. Suggested:
- A plain static HTML site (baseline).
- A Next.js or other React SPA (heavy JS, dynamic assets).
- A WordPress + Elementor site (the studio's bread and butter).
- A JS heavy app that lazy loads assets after scroll or interaction.
- A local authenticated fixture with login, protected routes, cookies, localStorage, lazy assets, and blocked safety routes.

For deterministic parity, prefer self hosted or recorded targets where possible, so the golden fixtures do not drift when a live site changes.

---

## 9. Repo layout

```
gnaw/
  Cargo.toml                 (workspace)
  CONTRACT.md                (the shared output and event contract)
  GNAW-SPEC-v1.md            (this file)
  README.md
  crates/
    gnaw-core/
    gnaw-cli/
  reference/
    playwright/              (Track A)
  parity/
    fixtures/
    harness/
  app/
    Gnaw/                    (SwiftUI, project.yml)
```

---

## 10. Build order (milestones)

- M0: write `CONTRACT.md` (manifest schema, event protocol, folder layout). Everything else depends on this.
- M1: Track A Playwright engine implementing the contract, both modes, NDJSON output. Generate golden fixtures from the corpus.
- M2: Auth profiles in the Playwright engine (`auth login`, `auth list`, `auth delete`, capture with `--profile`), with redaction and authenticated fixture coverage.
- M3: parity harness (run an engine, snapshot, diff two hauls).
- M4: Rust `gnaw-core` capture core: CDP control, network interception, raw save. Validate raw capture parity against golden.
- M5: Rust Navigable mode: HTML rewriting with `lol_html`. Parity.
- M6: Rust Study extras: beautify (swc, lightningcss), source map pull, MANIFEST writer, `context.md` builder, stack detection. Parity.
- M7: SwiftUI app wired to the Rust engine over NDJSON. Build the GUI (URL bar, mode toggle, auth profile manager, scope controls, live waterfall, stack badge, mascot, output actions).
- M8: polish: rate limit, robots toggle, scope rules, notarization, GitHub Release, optional Homebrew cask.

---

## 11. GUI behaviour (M6 summary)

Single window. URL bar with a "Gnaw it" button. A Navigable / Study toggle. Auth profile selector and manager. Scope controls (depth, same domain, include subdomains). The main area is the live capture waterfall: each captured asset appears as a row with a coloured kind chip, the running asset count and byte total, and a stack badge that pops when detected. Gnawty animates while capturing. When done, actions on the haul: open the navigable mirror, reveal in Finder, copy `context.md`, open `MANIFEST.json`.

The GUI is a pure renderer of the engine's NDJSON event stream. It holds no capture logic.

---

## 12. Writing and naming conventions

- All identifiers, paths, routes, and schema keys in English.
- Device and project naming follows the studio convention.
- In any prose or docs: no long dashes. Use short hyphens, commas, parentheses, or colons.
