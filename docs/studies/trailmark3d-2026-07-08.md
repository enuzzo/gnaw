# Trailmark3D Study Notes - 2026-07-08

This note records the work performed while studying `trailmark3d.com` with Gnaw, plus the decisions that should guide future dynamic render/export studies.

## Goals

- Capture Trailmark3D as both a public and authenticated site.
- Test a real GPX-to-3MF user flow with `studies/Granforcora_2026.gpx`.
- Learn the render/export pipeline well enough for Gnaw to analyze similar sites.
- Keep credentials, profile state, GPX inputs, screenshots, downloaded 3MF files, and browser traces out of Git.
- Keep the repo portable across the Dropbox-synced Intel and Apple Silicon Macs.

## Repository And Sync Constraints

- Workspace: `/Users/enuzzo/Library/CloudStorage/Dropbox/Mitnick/gnaw`.
- The checkout is shared across two Macs via Dropbox.
- `node_modules/`, `dist/`, `/output/`, local profiles, secrets, and test artifacts stay ignored.
- Native or generated machine-local artifacts should not be committed unless they are intentionally portable.
- `.gitignore` uses root-scoped output rules such as `/output/` so source modules under `engine/src/output/` remain trackable.

## Credentials And Auth Profile Decisions

- Trailmark3D credentials are stored locally under `.gnaw-secrets/trailmark3d.env`.
- `.gnaw-secrets/` is ignored and the credential file is mode `600`.
- Gnaw's browser profile is named `trailmark3d`.
- Auth profile state lives outside hauls under the Gnaw profile root, not in captured output.
- Plaintext passwords should not appear in scripts, committed files, reports, command output, manifests, logs, or hauls.

## Capture And Flow Results

### Public And Authenticated Site Captures

- Public shell capture:
  `output/trailmark3d.com/2026-07-08/2026-07-08__site-public__00-12-44/site/`
- Auth shell capture:
  `output/trailmark3d.com/2026-07-08/2026-07-08__site-auth__00-30-59/site/`
- User-authenticated workspace capture:
  `output/trailmark3d.com/2026-07-08/2026-07-08__site-user__08-40-59/site/`

The authenticated capture observed account endpoints such as `/auth/me`, `/jobs/active`, `/dashboard`, and `/dashboard/jobs`.

### GPX Flow

Test input:

```text
studies/Granforcora_2026.gpx
```

Successful user flow session:

```text
output/trailmark3d.com/2026-07-08/2026-07-08__Granforcora_2026__08-42-43/
```

Important files:

- 3MF export:
  `exports/2026-07-08__Granforcora_2026__08-42-43.3mf`
- Screenshots:
  `screenshots/2026-07-08__Granforcora_2026__08-42-43__uploaded.png`
  `screenshots/2026-07-08__Granforcora_2026__08-42-43__generated.png`
  `screenshots/2026-07-08__Granforcora_2026__08-42-43__after-download.png`
- Network trace:
  `network/2026-07-08__Granforcora_2026__08-42-43__network.ndjson`
- Scenario report:
  `reports/2026-07-08__Granforcora_2026__08-42-43__scenario-report.md`

The exported 3MF was verified as a ZIP/3MF archive and was about 543 KB.

## Learned Trailmark3D Pipeline

Authenticated successful flow:

1. `GET /auth/me`
2. `GET /jobs/active`
3. `POST /parse`
4. `POST /upload?...`
5. `GET /status/<job_id>`
6. `GET /preview_mesh/<job_id>/terrain`
7. `GET /preview_mesh/<job_id>/trail`
8. `GET /preview_points/<job_id>`
9. `POST /register_download/<job_id>`
10. `GET /download/<job_id>/3mf`

Anonymous or not-fully-authenticated export attempts can reach preview but are blocked at export. The UI can show a signup prompt, and direct backend export probes can return auth-required responses.

## Gnaw Changes Made

### Dynamic Scenario Analysis

Added `gnaw scenario analyze` to classify dynamic render/export traces from browser network logs and optional response/UI bodies.

Endpoint categories:

- `parse`
- `generate`
- `status`
- `preview`
- `downloadIntent`
- `download`
- `auth`
- `api`
- `page`
- `asset`
- `unknown`

Important implementation decision:

- `register_download` is treated as `downloadIntent` because Trailmark3D requires it before successful `/download/<job_id>/3mf`.

Related files:

- `engine/src/scenario/analyze.ts`
- `engine/src/scenario/report.ts`
- `engine/test/unit/scenarioAnalyze.test.ts`
- `engine/test/unit/scenarioReport.test.ts`
- `contract/events.schema.json`
- `CONTRACT.md`

### Output Naming

Adopted date-first session naming:

```text
output/<domain>/<YYYY-MM-DD>/<YYYY-MM-DD>__<project>__<HH-mm-ss>/
  site/
  screenshots/
  exports/
  reports/
  network/
  bodies/
  logs/
```

Example:

```text
output/trailmark3d.com/2026-07-08/2026-07-08__Granforcora_2026__08-42-43/exports/2026-07-08__Granforcora_2026__08-42-43.3mf
```

Related files:

- `engine/src/output/naming.ts`
- `engine/test/unit/outputNaming.test.ts`
- `README.md`

## Verification Commands Used

Core verification:

```bash
npm run build
npx vitest run engine/test/unit harness/test/unit --pool=threads --poolOptions.threads.singleThread=true
```

The full unit suite was run outside the restricted sandbox when needed because fixture tests bind to `127.0.0.1`.

## Key Commits

- `820f302` - Fix auth profile launcher
- `f2d9056` - Add dynamic site study analysis
- `3f063d8` - Recognize registered download intents
- `a0a046e` - Ignore local Gnaw secrets
- `5b774e8` - Add date-first output naming

## Future Work

- Add a first-class scenario runner command so the one-off Playwright flow can become a reusable Gnaw command.
- Teach the scenario runner to read `.gnaw-secrets/<profile>.env` only from ignored local paths.
- Consider writing a small `manifest.json` per output session with domain, project, timestamp, profile, and artifact pointers.
- Add optional 3MF inspection helpers so exported files can be summarized without opening slicer software.
