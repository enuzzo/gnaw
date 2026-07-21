# Gnaw audit & improvement evaluation — 2026-07-21

Triggered by a real failure: a captured single-page 3D app (`lampmaker.app`) would
not run from gnaw's own capture. Root cause was a redaction bug that corrupted the
captured JavaScript. This document records what was fixed, the broader bug hunt it
prompted (4 parallel review passes across redaction, capture, output, and the
engine), and a prioritized improvement roadmap.

Severity legend: **P0** ship-blocking / data-integrity, **P1** important,
**P2** quality/robustness, **P3** cosmetic/latent. "LEAK" = a secret is not
redacted (safety-model violation). "CORRUPTION" = captured bytes are altered so
the artifact no longer faithfully represents the site.

---

## 1. Fixed this session (with regression tests)

| # | Type | File | What |
|---|------|------|------|
| F1 | CORRUPTION P0 | `engine/src/redaction/redact.ts:59-60` | The `localStorage`/`sessionStorage` assignment rule treated a JS comparison `===` as an assignment `=` and greedily consumed across `;}catch(e){return`, turning captured JS into invalid syntax (`getItem(KEY)=[REDACTED] false;` → `Uncaught SyntaxError`). This aborted the whole inline script, so the app never ran. Fixed: exclude comparison operators via lookbehind/lookahead; stop the value at `;`. |
| F2 | CORRUPTION P1 | `engine/src/redaction/redact.ts:59-60` | Same rule still over-reached: `localStorage; document.title = X;` redacted the unrelated `X`. Fixed by restricting the prefix to a real storage access expression (`.ident` / `['key']` / space-key) instead of arbitrary `[^\n=]*`, and accepting quoted or bare values. |
| F3 | DATA-LOSS P1 | `engine/src/capture/capture.ts:248` | `response.body().catch(() => Buffer.alloc(0))` masked a failed body fetch as a genuine empty asset. On a served-from-cache duplicate reference, `body()` rejects → a 0-byte asset was recorded (sha256 of empty string) and could overwrite the real file. Fixed: on rejection, skip the asset (log, no write, no manifest record). |
| F4 | DATA-LOSS P1 | `engine/src/assets/writeAsset.ts:45` | No guard against a smaller body clobbering a larger existing capture at the same path (the race that produced 0-byte fonts). Fixed: refuse to overwrite when the existing file is larger; keep the good bytes and report them. |
| F5 | LEAK P0 | `engine/src/redaction/redact.ts:61` | JSON key allow-list missed `access_token`/`refresh_token`/`id_token`/`api_key`/`client_secret`/`csrfToken`/… (was R1). Fixed: match sensitive keys exactly or by credential-bearing suffix, closing-quote–anchored so `author`, `session_active`, `idempotency_key` stay untouched. |
| F6 | LEAK P0 | `engine/src/redaction/redact.ts:57` | `password` value rule failed on quoted or spaced values (was R2). Fixed: accept a quoted string or a bare token. |
| F7 | LEAK P1 | `engine/src/redaction/redact.ts:54` | `Authorization:` without `Bearer`/`Basic` (e.g. GitHub `token …`, raw API key) was never redacted (was R3). Fixed: a line-anchored generic `Authorization:` rule covering any scheme, anchored to line start so a mid-line mention in captured code is not corrupted. |
| F8 | ROBUSTNESS P0 | `engine/src/capture/capture.ts` crawl loop | One failed sub-page (`page.goto` reject) aborted the whole crawl and mis-attributed a fatal error to the entrypoint (was E1). Fixed: per-page try/catch records a NON-fatal error and continues; the entrypoint (depth 0) stays fatal. Also fixed a follow-on Playwright race it exposed — a failed navigation's async error-page commit interrupted the *next* page's `goto`; a bounded, condition-based settle (wait for the pending navigation to commit, observed via URL change) prevents one bad page from cascading into its successor. |

Verification: 110 unit + 26 integration tests green (was 104+25; +7 new tests —
6 redaction/asset unit tests plus the E1 crawl-continuation integration test);
full suite 136 tests.
Redactor run over the real `index.html` → valid JS (`node --check`), secrets still
redacted; an over-redaction battery of benign inputs (`author`, `session_active`,
`idempotency_key`, `Authorized users`, comparisons) confirms nothing legitimate is
touched. A fresh live re-capture produced full-size fonts, 8 presets, zero
corruption, and ran offline with no `SyntaxError`.

**Note on repo state:** the working tree carried pre-existing uncommitted changes
from earlier sessions (`cli.ts`, `README`, `SESSION-NOTES`, the
`minimumDynamicSecretLength` guard, etc.). This session added only
`redaction/redact.ts`, `assets/writeAsset.ts`, `capture/capture.ts`, and their
tests. Nothing was committed.

---

## 2. Open findings — redaction (`engine/src/redaction/redact.ts`)

All verified by running the built redactor over the exact input.
(R1, R2, R3 were fixed this session — see F5/F6/F7 above.)

- **R4 — CORRUPTION P1. `Cookie`/`Set-Cookie` rule eats to end of line.**
  `redact.ts:56` `[^\r\n]+` swallows the rest of any line containing `Cookie:`,
  including source: `console.log("Cookie: " + name);` → `console.log("Cookie: [REDACTED]`
  (unterminated string). Fix: anchor real header rules to line start (`(^|\n)`), so
  they don't fire on the substring inside captured code.

- **R5 — CORRUPTION P2. `redactUrl` re-serializes every matched URL.**
  `redact.ts:51,100-118` run `new URL(x).href` on every `http(s)://…` even when
  nothing sensitive is present, lowercasing hosts, adding trailing `/`,
  percent-encoding. `href="https://GitHub.com"` → `https://github.com/`. Also the
  mechanism behind output bug O2 below. Fix: only re-serialize when a value was
  actually redacted.

- **R6 — LEAK P3. `<input type=password>` edge cases.** `type="password "`
  (trailing space) or `value="pa'ss"` (embedded quote) leak. `redact.ts:62-63`.

- **R7 — LATENT P3. Dead `wasm`/`=== false` guard.** `redact.ts:148-153`. The
  sub-expression `type.includes("wasm") === false && …` can never change the
  result; it *looks* like a wasm guard but isn't. A future `&&`→`||` edit would
  silently classify wasm as text and corrupt it. Rewrite `isTextContent` as an
  explicit allow-list with a real binary/wasm exclusion.

Architectural note: regex redaction over arbitrary captured source is inherently
both leak-prone (misses secrets) and corruption-prone (over-matches). See §5.

---

## 3. Open findings — capture engine (`engine/src/capture/*`, `cli.ts`)

- **E1 — FIXED this session (F8).** One failed sub-page used to abort the whole
  crawl; now per-page failures are non-fatal and the crawl continues.

- **E2 — P1. `--rate-limit`, `--subdomains`, `--robots` are silent no-ops.**
  Defined at `cli.ts:54-56` but never passed to `capture()`; `CaptureOptions` has
  no fields for them. No delay is ever inserted (no `setTimeout` in the crawl path),
  robots.txt is never fetched (yet the schema defines an unused `"robots"` skip
  reason), and `MANIFEST.json.config` always reports `rateLimitMs:250,
  includeSubdomains:false, respectRobots:false` regardless of flags. Fix: wire and
  implement them, or remove the flags (misreporting config is worse than absence).

- **E3 — P1. Subdomain scoping is hardcoded strict-equality.** `capture.ts:425`
  compares `hostname !== host`; `www.example.com` is out-of-scope from
  `example.com`. Depends on E2.

- **E4 — P2. Fragment / trailing-slash variants defeat crawl dedup.**
  `capture.ts:597-609` only filter `#…`/`mailto:`/`tel:` and dedup on full `.href`.
  `/p#a` and `/p#b` → two `page.goto`s, two `ManifestPage` rows, two units of the
  `maxPages` budget, and (because file naming strips the fragment) the rendered
  snapshots overwrite each other. `/foo` vs `/foo/` likewise. Fix: normalize
  (strip fragment; canonicalize trailing slash) before enqueue/dedup.

- **E5 — P2. Total-bytes guardrail measured on raw body, accounted on redacted body.**
  `capture.ts:258` checks `totalBytes + rawBody`, `capture.ts:286` adds
  `redactedBody`. The cap and the reported totals drift by the redaction delta.

- **E6 — P2. `guardrails.ts` is dead / divergent.** Its `evaluateMaxPages` /
  `evaluateMaxTotalBytes` / `assetTooLargeWarning` are only used by their own unit
  test; `capture.ts` re-implements the checks inline. The tests validate code that
  never runs. Fix: use the module in `capture.ts`, or delete it and test the real
  path.

- **E7 — P3. Manifest-write failure suppresses the `done` event.**
  `capture.ts:117-158` sets `finalized=true` before writing `MANIFEST.json`; if the
  write throws, the outer catch's `finalize("partial")` is a no-op → no `done` is
  ever emitted → a consumer awaiting `done` hangs. Set `finalized` only after the
  writes succeed.

- **E8 — P3. Non-numeric limit args silently disable guards.** `cli.ts:80-83`
  `Number.parseInt` with no NaN check: `--max-pages abc` → `NaN`, and
  `size >= NaN` is always false → the page cap is removed. Validate and reject.

- **E9 — P3.** `responseTasks` grows unbounded and is re-awaited every page
  (`capture.ts:368,398`) — O(n²) on large crawls. **E10 — P3.**
  `javascript:`/`data:` hrefs are recorded as `out_of_scope` rather than dropped.

- **B-dedup — P2. No asset-level dedup.** The same URL captured on multiple pages
  (or referenced twice) yields duplicate `MANIFEST.json` records and redundant
  writes — e.g. the reference haul has `favicon-32.png ×3`, `_vercel script ×3`
  (23 records for 19 unique URLs). Dedup by normalized path, preferring the first
  non-empty capture. (Fixes F3/F4 stopped the *empty* duplicate; same-body
  duplicates remain.)

---

## 4. Open findings — study / navigable output (`engine/src/study/outputs.ts`)

The `navigable` offline mirror has the most correctness debt.

- **O1 — P0. Inter-page navigation links are never rewritten.** `outputs.ts:172`
  builds the rewrite map from `assets` only (excludes HTML pages); `pages`
  (carrying `navigablePath`) is never consulted. In any multi-page crawl, an
  `<a href="/other-page">` never reaches the local mirror of that page — it breaks
  under `file://` or silently returns to the live site. Biggest gap in the feature.

- **O2 — P1. Redaction ordering breaks rewriting for URLs with sensitive query keys.**
  `capture.ts:401` redacts the page HTML (turning `?token=…` into `?token=[REDACTED]`)
  *before* `rewriteAssetUrls` runs; the rewrite map is keyed on the real,
  unredacted `asset.url`, so the lookup misses and the asset is left as a broken
  `[REDACTED]` absolute URL in the output. Common for signed CDN/image URLs.

- **O3 — P1. CSS `url()` is never rewritten.** Neither external `.css` (copied
  byte-for-byte into `_assets`) nor inline `<style>`/`style=""`. `@font-face`,
  `background-image`, `@import` all keep pointing at the live site — this is why
  the offline mirror still fetches Google Fonts remotely. Fix: a CSS-aware `url()`
  pass over both.

- **O4 — P1. Runtime-constructed URLs (`img.src='/presets/'+id+'.webp'`) 404 offline.**
  The original observed symptom. The static rewriter can't see URLs the JS builds
  at view time, and same-origin assets are only mirrored under `_assets/<host>/…`,
  not at their root-relative path. Recommended fix (works under `file://`): a small
  injected bootstrap script that patches `HTMLImageElement.src` /
  `HTMLScriptElement.src` / `fetch` / `XHR.open` against an embedded
  original-URL→navigable-path map, paired with O3's CSS pass.

- **O5 — P2.** HTML rewrite misses `srcset`/`imagesrcset`/`<video poster>`/
  `<object data>`/meta-refresh (`outputs.ts:176` only matches `src`/`href`).

- **O6 — P2. Filename collision: leaf asset vs directory.** `normalizePath.ts:75-92`
  only adds an extension for known content-types; the `application/octet-stream`
  fallback (`capture.ts:247`, used when a response has no `Content-Type`) leaves a
  bare segment. Capturing both `/api/users` (a file) and `/api/users/123` (needs a
  dir) makes `ensureSafeDirectory` throw → one asset dropped, haul `partial`.

- **O7 — P3.** `caseFoldedPaths` dedup map is shared across the four output roots
  (`normalizePath.ts:16`) — an entry from one root can force an unnecessary
  `~c<hash>` suffix in another. Cosmetic. **O8 — P3.** `writeTextInsideHaul`
  (`outputs.ts:248-257`) has a weaker traversal guard than its siblings; not
  currently exploitable but inconsistent defense-in-depth.

- **O9 — P2. Declared-but-not-fetched head/meta assets are missed.** `manifest.webmanifest`,
  `apple-touch-icon`, `favicon-16`, `<meta og:image>` are referenced in `<head>`
  but the browser never requests them on a normal load, so gnaw never captures
  them. Add a post-render "static reference sweep": parse the final DOM + manifest
  for `<link rel=icon|apple-touch-icon|manifest|preload>` and `<meta og:image>`
  targets not already in the waterfall, and fetch them in the same context.

---

## 5. Improvement roadmap (how to make gnaw better)

**Immediate (P0/P1), in suggested order**
1. ~~Redaction leaks R1–R3~~ — **DONE this session (F5/F6/F7)**, with a
   table-driven test matrix plus a benign over-redaction battery. Remaining
   redaction hardening: R4 (Cookie EOL), R5 (URL re-serialization), R6/R7.
2. ~~Crawl robustness E1~~ — **DONE this session (F8)**: per-page failures no
   longer nuke a multi-page haul.
3. Navigable correctness O1–O4 — inter-page links, redaction-vs-rewrite ordering,
   CSS `url()`, and runtime-URL bootstrap. This is what makes "offline browsable
   mirror" actually true.
4. Flag honesty E2/E3 — implement or remove `--rate-limit`/`--subdomains`/`--robots`;
   never let `MANIFEST.json.config` misreport the run.

**Test robustness (observed):** the integration test "detects stacks … SPA and
WordPress fixtures" has a tight 5s timeout on real-browser captures and can flake
under machine load (seen this session; passes cleanly isolated at ~4.9s). Bump the
per-test timeout for browser-capture integration tests.

**Structural**
- **Redaction strategy.** Move from free-text regex over captured source toward
  (a) structured redaction at known boundaries (headers, cookies, storage calls,
  known JSON secret keys), plus (b) a value registry: capture concrete secret
  values seen in auth/headers and redact *those exact strings* (already the
  `secrets` set, with a good length/entropy guard) — this catches secrets without
  guessing at syntax and without corrupting unrelated code. Treat "never corrupt
  captured JS/CSS/HTML" and "never leak a known credential" as two explicit,
  separately-tested contracts.
- **Single source of truth for guardrails** (E6) and **asset dedup** (B-dedup):
  one code path, one place to test, deterministic manifests.
- **Golden fidelity harness.** Add a fixture that captures a self-contained
  JS-driven app (three.js-style) and asserts (i) inline JS passes `node --check`,
  (ii) runtime-constructed asset URLs resolve in the served navigable mirror,
  (iii) no `[REDACTED]` appears inside `<script>`/`<style>` bodies. This class of
  regression (captured app won't run) had no coverage before this session.

**Process**
- The current test suite validates a lot but missed all four fixed bugs because
  none exercised "does the captured artifact actually run / faithfully round-trip."
  The check plan in `docs/checks/post-fix-checkplan.md` adds that; fold its C6–C8
  into CI.

---

## Appendix — method
Four independent review passes (redaction, capture asset-write, study/navigable
output, broad engine) ran in parallel; each finding above was re-verified against
the code or by running the built redactor over the exact triggering input before
being recorded. Speculative items were dropped.
