# Gnaw Session Notes

Date: 2026-07-07

## Built

- M0: contract and repo skeleton, including `CONTRACT.md`, JSON Schemas, fixtures scaffold, and schema validation wiring.
- M1: engine core capture for local fixtures, raw and rendered study output, manifest, waterfall, stdout NDJSON events, stdin control, cancellation, guardrails, and deterministic path normalization.
- M2: navigable rewriting, beautified study output, source maps, `context.md`, stack detection rules, and navigation safety blocklist controls.
- M3: auth profile storage and locking, `gnaw auth` commands, profile-backed capture, auth manifest metadata, recursive redaction, and auth fixture redaction coverage.

## Decisions

- The engine remains the only interface to future UI work. The GUI should consume only contract files and stdout NDJSON events.
- Auth profiles are stored outside hauls under the configured profile root, defaulting to `~/Library/Application Support/Gnaw/profiles`.
- Profile directories are created with `0700` permissions and guarded by `.gnaw-profile.lock`.
- `auth_profile` and `auth_deleted` are contract event types so auth management output remains NDJSON-only on stdout.
- `MANIFEST.json` requires `auth` when `config.authProfile` is set, rejects `auth` when no profile is configured, and requires `auth.profileName` to match `config.authProfile`.
- Redaction happens at stream, manifest, waterfall, raw body, rendered HTML, navigable HTML, beautified asset, source map, context, and log output boundaries.
- OAuth-style query and fragment tokens are redacted, including SPA hash routes such as `#/callback?access_token=...`.

## Deviations

- No known deviations from `SPEC.md` for M0-M3.
- `auth login` records the last verified URL after redaction, so stored metadata may contain `[REDACTED]` in sensitive query or fragment values.

## Verification

- `npm run build` passed on `main`.
- `npm run test:unit` passed on `main`: 21 test files, 89 tests.
- `npm run test:integration` passed on `main`: 3 test files, 25 tests.
- Integration includes fixture golden snapshots, manifest and waterfall schema validation, auth profile capture, profile lock behavior, and whole-haul plus stdout/stderr planted-secret redaction.

## M4 Notes

- The SwiftUI app should launch the engine as a child process and treat stdout as NDJSON events only.
- Human logs are on stderr and mirrored to `gnaw.log`; the app should never parse stderr for contract state.
- Use `CONTRACT.md` and `contract/*.schema.json` as the UI boundary.
- Profile management UI can call the same engine commands: `gnaw auth login`, `gnaw auth list`, and `gnaw auth delete`.
- The app should show `profile_locked` and `profile_not_found` as recoverable auth-profile errors.
- Do not place profile directories inside hauls or expose profile file contents in the UI.

## 2026-07-17 App Library Progress

- Added a persistent sidebar library that scans the configured output folder for completed hauls.
- Added historical result loading, waterfall search, native table columns, Finder reveal, and re-gnaw configuration reuse.
- Added output-folder selection and persistence, current-capture selection, library refresh, and haul menu commands.
- Added Swift tests for haul discovery, sorting, configuration mapping, waterfall parsing, malformed input, and folder-timestamp recovery.
- Fixed dynamic secret redaction so short values such as `1` cannot corrupt timestamps and other ordinary output text. Known credential structures remain redacted, while blanket dynamic-secret replacement now requires a token-like minimum length.

### Verification

- The SwiftUI app builds, launches, and has been visually inspected with live historical haul data.
- `HaulLibraryTests`: 4 tests passed.
- `GnawEventTests`: 4 tests passed.
- The complete engine suite passes: 28 test files, 122 tests.

## 2026-07-17 Compact UI and Asset Preview

- Reduced vertical spacing across result, capture, and new-capture screens while preserving native controls and readable secondary descriptions.
- Replaced the large completed-capture action cards with a compact metric strip and action bar.
- Added delayed hover previews for captured raster images, SVG files, and highlighted HTML, CSS, JavaScript, and JSON source.
- Local files can also be clicked to open the preview, providing a discoverable fallback to hover.
- Preview popovers use vertical adaptive placement so they stay inside the app window.
- SVG files damaged by capture-time redaction fall back to highlighted, selectable source with a clear warning instead of a broken thumbnail.
- Source previews use a native AppKit text view for reliable multiline layout and two-axis scrolling.
- SVG previewing uses a narrow WebKit bridge with JavaScript disabled, a non-persistent data store, and a restrictive Content Security Policy.
- Waterfall rows expose contextual Open File, Reveal in Finder, and Copy Request URL actions.
- Preview paths are resolved from manifest asset records and rejected when absolute, traversing, or escaping through a symbolic link.
- Three 1200×800 off-screen AppKit render tests guard setup, live capture, and compact result layouts, including their native SwiftUI tables.
- The macOS app builds successfully and all 11 Swift tests pass through the direct XCTest runner.

## 2026-07-21 Self-contained app + DMG packaging

Made the app self-contained and universal so it can be handed to colleagues (or downloaded from GitHub) and run like a normal Mac app — no repo, no terminal, no Node install. Design and plan are under `docs/superpowers/`.

### Phase A — self-contained core

- Bundle the compiled engine + production `node_modules` + a universal (arm64+x86_64) Node 22 runtime inside `Gnaw.app/Contents/Resources`.
- `EngineClient.resolveEngine()` prefers the bundled node+engine and falls back to the dev repo/system-node resolution, so `./script/build_and_run.sh` still works.
- `PLAYWRIGHT_BROWSERS_PATH` = `~/Library/Application Support/Gnaw/browsers` is set on every engine child process.
- `npm run build` now copies non-TS runtime assets (`stacks.json`) into `dist` via a `postbuild` step.
- `script/fetch_universal_node.sh` fetches, `lipo`-fuses, and ad-hoc-signs a universal Node; `script/package_dmg.sh` builds a universal Release app, embeds engine+node, signs inside-out (ad-hoc), and writes `dist/Gnaw.dmg` with an Applications symlink and a first-launch note.

### Phase B — browser auto-download

- New engine subcommands `gnaw browser check` (exit 0/3) and `gnaw browser ensure` (streams the existing `browser` NDJSON event — no contract-schema change).
- The app warns and downloads Chromium on first capture when no Chrome/Edge/Chromium is found, with a spinner, a Cancel button, and a 10-minute timeout. Cancel kills the download (SIGTERM propagated to the playwright child) and never surfaces a false failure.

### Distribution decision

- Unsigned / ad-hoc, no notarization (no paid Apple account). The only residual friction is a one-time "Open Anyway" per Mac. `package_dmg.sh` isolates signing so it can be swapped for Developer ID + notarization later without rework.

### Verification

- Engine suite: 31 test files, 128 tests pass.
- New Swift logic tests pass (`EngineClientResolutionTests`, `BrowserDownloadStateTests`, `GnawEventTests`, `HaulLibraryTests`). The 6 `ResultViewRenderTests` HiDPI render tests fail only in headless/off-screen environments — not a regression.
- `./script/package_dmg.sh --verify`: universal `dist/Gnaw.dmg` (87MB), `codesign verify OK`, self-containment smoke passed (bundled node+engine resources present; app launches from a repo-free copy).
- Full user/verification docs: [`docs/dmg/INSTALL.md`](docs/dmg/INSTALL.md), [`docs/dmg/VERIFICATION.md`](docs/dmg/VERIFICATION.md).

## 2026-07-22 Capture-integrity + safety hardening

Triggered by a real failure: a captured single-page app (`lampmaker.app`) would not
run from gnaw's own capture. Root-caused and fixed a cluster of engine bugs, then
ran a broader multi-perspective audit. Full changelog: [`CHANGELOG.md`](CHANGELOG.md);
full findings & roadmap: [`docs/reviews/2026-07-21-gnaw-audit.md`](docs/reviews/2026-07-21-gnaw-audit.md).

### Fixed (all TDD)

- **Redaction corrupted captured JS** — `localStorage`/`sessionStorage` rules mistook
  `===` for assignment and ate across statement boundaries, producing invalid JS that
  killed a captured app's inline script; also stopped the same rule over-reaching to an
  unrelated later assignment. (`engine/src/redaction/redact.ts`)
- **Capture lost asset bytes** — a failed response-body fetch was masked as a 0-byte
  asset that could clobber a real capture (0-byte fonts); now skipped, plus a
  `writeAsset` guard against a smaller body overwriting a larger file.
- **Redaction leaked common secrets** — now redacts OAuth/API JSON keys, quoted/spaced
  `password` values, and non-Bearer `Authorization:` headers, without over-redacting
  benign keys or mid-line code.
- **One failed sub-page aborted the whole crawl** — per-page failures are now non-fatal
  and the crawl continues (entrypoint stays fatal); fixed a follow-on Playwright race
  where a failed nav's error page interrupted the next page's load.

### Verification

- Engine suite: 110 unit + 26 integration = **136 tests pass**. Redactor produces valid
  JS on the real `lampmaker.app` capture; a fresh live re-capture runs offline with full
  fonts, all presets, no `Uncaught SyntaxError`. Independent check-plan run
  ([`docs/checks/post-fix-checkplan.md`](docs/checks/post-fix-checkplan.md)) all green.
- Golden capture refreshed at `rokuro/studies/lampmaker/haul-lampmaker.app-20260721-215814`.

### Housekeeping

- Added a **Release routine** to [`CLAUDE.md`](CLAUDE.md): after significant work, update
  `CHANGELOG.md` and rebuild the DMG (needs full Xcode).
- **DMG for this cycle is PENDING** — the shippable `dist/Gnaw.dmg` predates these engine
  fixes and must be rebuilt with `./script/package_dmg.sh --verify` on the Xcode machine
  (this dev box has Command Line Tools only). Swift app unchanged; engine-only re-bundle.
- Note: the working tree's git index had been desynced (files `rm --cached` but present on
  disk, likely from `.git` syncing through Dropbox across machines). Healed with a plain
  `git reset` before committing — no content was lost (all affected files were identical
  to HEAD).
