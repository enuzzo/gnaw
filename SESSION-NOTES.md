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
