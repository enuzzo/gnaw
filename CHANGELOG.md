# Changelog

All notable changes to Gnaw are recorded here, newest first.
Updated whenever significant work is completed (see `CLAUDE.md` → Release routine).

Each entry should note the state of the shippable DMG: **built** (with date/host) or
**pending** (needs a rebuild on a machine with full Xcode).

## [Unreleased] — 2026-07-22

Capture-integrity + safety hardening. Full engine suite green: **136 tests**.
Remaining known issues are catalogued in
[`docs/reviews/2026-07-21-gnaw-audit.md`](docs/reviews/2026-07-21-gnaw-audit.md).

### Fixed
- **Redaction no longer corrupts captured JavaScript.** The `localStorage`/
  `sessionStorage` rules mistook a JS comparison (`===`) for an assignment and ate
  across statement boundaries, producing invalid JS (`getItem(KEY)=[REDACTED] false;`)
  that aborted a captured app's inline script. Also stopped the same rule from
  reaching across statements to redact an unrelated later assignment. (F1, F2)
- **Capture no longer loses asset bytes.** A failed response-body fetch was masked
  as a genuine empty (0-byte) asset that could overwrite a real capture of the same
  URL (seen as 0-byte fonts). Failed fetches are now skipped, and `writeAsset`
  refuses to let a smaller body clobber a larger existing file. (F3, F4)
- **Redaction no longer leaks common secrets.** Now redacts OAuth/API JSON keys
  (`access_token`, `refresh_token`, `id_token`, `api_key`, `client_secret`,
  `csrfToken`, …), quoted/spaced `password` values, and non-Bearer `Authorization:`
  headers (e.g. GitHub `token …`, raw API keys) — while leaving benign keys
  (`author`, `session_active`, `idempotency_key`) and mid-line code untouched.
  (F5, F6, F7)
- **A single failing sub-page no longer aborts the whole crawl.** Per-page nav
  failures are now recorded as non-fatal and the crawl continues; the entrypoint
  stays fatal. Also fixed a follow-on Playwright race where a failed navigation's
  async error page interrupted the next page's load. (F8)

### Verification
- Engine: 110 unit + 26 integration tests green (136 total); redactor produces
  valid JS on the real `lampmaker.app` capture; a fresh live re-capture runs offline
  with full fonts, all presets, and no `Uncaught SyntaxError`.
- Reference/golden capture refreshed at
  `rokuro/studies/lampmaker/haul-lampmaker.app-20260721-215814`.

### DMG
- **PENDING.** The shippable `dist/Gnaw.dmg` still predates these fixes (built
  2026-07-21 15:57, before the engine changes). It must be rebuilt with
  `./script/package_dmg.sh --verify` on a machine with **full Xcode** (the current
  dev machine has Command Line Tools only, so `xcodebuild` cannot run here).
  The Swift app was not changed this cycle — only the bundled engine.
