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

## Repository Layout

```text
contract/   JSON Schemas for manifests, events, and waterfall rows
engine/     TypeScript Playwright capture engine and CLI
fixtures/   Local fixture sites used by tests
harness/    Contract validation and golden-snapshot checks
app/Gnaw/   Reserved macOS app workspace
```
