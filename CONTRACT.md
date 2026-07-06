# Gnaw Contract v2

Date: 2026-07-06

`SPEC.md` v2 is authoritative. This document is the shared contract for the engine, GUI, harness, and any future engine. The GUI consumes files and NDJSON events only. It does not perform capture logic.

## Haul Layout

A capture writes one haul folder, by default under `~/Gnaw/`:

```text
haul-<host>-<YYYYMMDD-HHMMSS>/
  navigable/
    index.html
    <path>/index.html
    _assets/<host>/<path>
  study/
    raw/<host>/<path>
    beautified/<host>/<path>
    rendered/<host>/<path>
    sourcemaps/<host>/<path>
  MANIFEST.json
  context.md
  waterfall.ndjson
  gnaw.log
```

`navigable/` exists only when Navigable mode is selected. `study/`, `context.md`, and study subfolders exist only when Study mode is selected. `MANIFEST.json`, `waterfall.ndjson`, and `gnaw.log` are haul-level files. Host namespacing is mandatory for all captured assets, including cross-origin CDN assets.

## URL Normalization

Engines normalize URLs to paths deterministically:

1. Strip the fragment.
2. Lowercase the host. The host is the first component under study asset paths.
3. Map `/` to `index.html`. Map paths ending in `/` to `<path>/index.html`.
4. Map page URLs without a file extension to `<path>/index.html` in `navigable/` and `study/rendered/`.
5. If a query string is present, append `~q<sha256-first8-of-query>` before the extension.
6. Percent-decode, then replace every character outside `[A-Za-z0-9._-]`, plus non-ASCII characters, with `_`.
7. If the normalized path collides on case-insensitive APFS with a path that differs only by case, append `~c<sha256-first8-of-original-url>` before the extension.
8. If any path segment exceeds 100 characters, truncate it to 80 characters and suffix `~<sha256-first8>`.
9. Do not deduplicate identical bodies in v1. Record each asset and its `sha256`.

## MANIFEST.json

`MANIFEST.json` is written last. Its presence with a `result` marks a finished haul, even when the haul is partial or canceled. It validates against `contract/manifest.schema.json`.

Required top-level fields:

- `schemaVersion`: always `2`.
- `gnawVersion`: Gnaw release version.
- `engine`: engine name, engine version, and resolved browser string.
- `entrypoint`, `host`, `startedAt`, `finishedAt`, `durationMs`.
- `result`: `complete`, `partial`, or `canceled`.
- `modes`: selected output modes, `navigable` and/or `study`.
- `config`: capture configuration, including defaults for depth, scope, robots, rate limit, byte caps, user agent, and auth profile.
- `stack`: primary detected technology and detected entries with confidence and signals.
- `stats`: total page count, asset count, byte count, and `byKind` counts for `HTML`, `JS`, `CSS`, `IMG`, `FONT`, `JSON`, `MEDIA`, `WASM`, and `OTHER`.
- `pages`: captured page records.
- `assets`: captured asset records.
- `auth`: optional profile metadata only.
- `safety.skippedUrls`: skipped navigation URLs and reasons.
- `errors`: structured error records.

Kinds are exactly `HTML`, `JS`, `CSS`, `IMG`, `FONT`, `JSON`, `MEDIA`, `WASM`, and `OTHER`. Byte counts and durations are non-negative integers. Unknown `result` and unknown `kind` values are invalid.

## Waterfall Rows

`waterfall.ndjson` contains one JSON object per network response, in completion order. Each row validates against `contract/waterfall.schema.json`.

Required row fields:

- `t`: milliseconds since capture start.
- `url`, `method`, `status`, `kind`, `contentType`.
- `bytes`, `durationMs`.
- `fromCache`, `viaJs`.
- `referrer`, `page`.

Rows must not contain `requestHeaders`, `responseHeaders`, `cookies`, or `body`. Bodies live under `study/raw/` when Study mode is enabled. Secrets never appear in the waterfall.

## Stdout Events

The engine writes stdout as NDJSON only: one JSON object per line. Non-object stdout text is invalid. Every event has `"v": 2` and validates against `contract/events.schema.json`.

Supported event types:

- `hello`
- `browser`
- `start`
- `page_start`
- `request`
- `asset`
- `page_done`
- `stack`
- `progress`
- `skip`
- `warning`
- `error`
- `state`
- `done`

Extra fields are allowed for forward compatibility. Consumers ignore fields and event types they do not understand. `request` precedes `asset` with the same `id` so the GUI can render in-flight waterfall rows. `progress` is authoritative for totals and is throttled to at most four events per second.

`skip.reason` values are `blocked_pattern`, `out_of_scope`, `robots`, `max_pages`, and `max_depth`. Stable error codes include `nav_timeout`, `dns`, `tls`, `http_error`, `write_failed`, `browser_crash`, and `profile_locked`. `fatal: true` means the job is ending, but a `done` event still follows whenever a manifest could be written.

## Stdin Control Commands

The GUI writes NDJSON commands to stdin:

```json
{ "cmd": "pause" }
{ "cmd": "resume" }
{ "cmd": "cancel" }
```

Pause and resume are honored at page boundaries. Cancel is graceful: the engine stops navigating, finishes bodies already in flight, writes `MANIFEST.json` with `result: "canceled"`, emits `done`, and exits 0.

SIGTERM behaves like `cancel`. A canceled haul is a valid haul.

## Auth Profiles

Auth profiles are named local browser sessions stored outside hauls at `~/Library/Application Support/Gnaw/profiles/<name>/` with `0700` permissions. The user logs in manually through a visible browser window. Gnaw stores browser state, not passwords.

The manifest `auth` block records metadata only:

- `mode`: `profile`.
- `profileName`.
- `storageStateUsed`.
- `redacted`: always true when auth metadata is present.

A profile is locked during capture. Concurrent captures using the same profile fail with `profile_locked`.

## Redaction

Redaction is absolute. Plaintext passwords, cookie values, bearer tokens, authorization headers, localStorage values, and sessionStorage values must not appear in `MANIFEST.json`, `context.md`, `waterfall.ndjson`, `gnaw.log`, stderr, or stdout events. Profile directories are never written inside a haul.

The redaction test captures the auth fixture, then greps the entire haul for planted secrets. Any match fails the build.

## Stderr and gnaw.log

stdout is reserved for NDJSON events. Human-readable logs go to stderr only and are mirrored into `gnaw.log`. stderr and `gnaw.log` follow the same redaction rules as every other output. They may include progress notes, warnings, and diagnostics, but never structured event lines required by the GUI.
