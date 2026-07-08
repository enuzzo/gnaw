# Gnaw

Gnaw captures websites through a real browser engine and writes offline "hauls" that follow [`CONTRACT.md`](CONTRACT.md).

Unlike static mirroring tools, Gnaw lets Chromium execute the page, observes the browser's network traffic, and saves the assets the browser actually downloads. It produces two useful outputs:

- `study`: raw assets, rendered DOM snapshots, beautified code, `MANIFEST.json`, `waterfall.ndjson`, and an LLM-ready `context.md`.
- `navigable`: a browsable offline mirror with rewritten local links.

[`SPEC.md`](SPEC.md) is the authoritative product and engineering spec for this repository.

## Status

This repo currently contains the TypeScript/Playwright reference engine, contract schemas, local fixture sites, auth profile support, redaction logic, and a golden-snapshot harness.

The macOS app shell is reserved under `app/Gnaw/`; the CLI and engine are the current working surface.

## Safety Model

Gnaw is an archival and study tool. Use it only on sites you own, operate, or have permission to inspect.

For authenticated sites, Gnaw uses named browser profiles:

- The user logs in manually in a visible browser window.
- Gnaw stores browser session state, not plaintext passwords.
- Cookies, bearer tokens, authorization headers, localStorage, sessionStorage, and password values are redacted from events, logs, manifests, and hauls.
- Profile data is stored outside captured hauls.

## Requirements

- Node.js 20+
- npm
- A local Chromium-family browser, such as Google Chrome, Microsoft Edge, or Chromium

## Install

```bash
npm install
```

## Build

```bash
npm run build
```

The compiled CLI entrypoint is:

```bash
node dist/engine/src/cli.js
```

## Test

```bash
npm test
```

The integration tests start local loopback fixture servers. In restricted sandboxes, they may need permission to listen on `127.0.0.1`.

## Capture A Public Page

```bash
node dist/engine/src/cli.js capture https://example.com/ \
  --mode study,navigable \
  --depth 1 \
  --max-pages 20 \
  --out output/example
```

## Capture With A Login Profile

Create or refresh a local profile:

```bash
node dist/engine/src/cli.js auth login https://example.com/login --profile example
```

Log in manually in the browser window, then close that window when the session is ready. Capture with the saved profile:

```bash
node dist/engine/src/cli.js capture https://example.com/dashboard \
  --profile example \
  --mode study,navigable \
  --depth 1 \
  --max-pages 20 \
  --out output/example-auth
```

Manage profiles:

```bash
node dist/engine/src/cli.js auth list
node dist/engine/src/cli.js auth delete example
```

## Study A Dynamic Render/Export Site

For sites that render a user file into a model, preview, report, or export, use a two-layer workflow:

1. Capture the public app shell and bundles:

```bash
node dist/engine/src/cli.js capture https://example.com/ \
  --mode study,navigable \
  --depth 1 \
  --max-pages 30 \
  --out output/example-public
```

2. If exports or account state matter, create a named profile in a visible browser. Type credentials only in the browser window, never in commands, fixtures, logs, or committed files:

```bash
node dist/engine/src/cli.js auth login https://example.com/login --profile example
```

3. Run the scenario with a local test file and save browser network responses to `output/`. This can be a manual Playwright script, a future Gnaw app flow, or a small one-off probe. Keep input fixtures in ignored local paths such as `studies/`.

4. Analyze the scenario trace:

```bash
node dist/engine/src/cli.js scenario analyze \
  --network output/example-scenario/network.ndjson \
  --body output/example-scenario/download-error.json \
  --out output/example-scenario/scenario-report.md
```

The report classifies common dynamic-app pipeline endpoints:

- `parse`: input-file parsing such as GPX/CSV/document upload validation.
- `generate`: render/model generation requests.
- `status`: polling endpoints for asynchronous jobs.
- `preview`: preview mesh, image, points, or other render artifacts.
- `downloadIntent`: UI/account gate checks before export.
- `download`: direct export endpoints.

If the report says `Auth gate: required`, repeat the scenario after a confirmed profile login. A direct export returning `401`, `403`, `auth_required`, or a sign-in/signup prompt means the backend is enforcing auth; do not treat it as only a frontend lock.

## Output Naming

Organize generated study artifacts by domain, date, session, and artifact type:

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

Put the date first, then the project name, then the time. Example export:

```text
output/trailmark3d.com/2026-07-08/2026-07-08__Granforcora_2026__08-42-43/exports/2026-07-08__Granforcora_2026__08-42-43.3mf
```

## Repository Layout

```text
contract/   JSON Schemas for manifests, events, and waterfall rows
engine/     TypeScript Playwright capture engine and CLI
fixtures/   Local fixture sites used by tests
harness/    Contract validation and golden-snapshot checks
app/Gnaw/   Reserved macOS app workspace
```
