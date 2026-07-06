# Gnaw M0-M3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement SPEC.md v2 milestones M0 through M3, with the contract, TypeScript Playwright engine, local fixtures, harness, auth profiles, and redaction tests complete and merged milestone by milestone.

**Architecture:** The engine is the only capture implementation. It exposes the CLI and the NDJSON event protocol, writes hauls to disk, and validates outputs against schemas in `contract/`. The harness owns local fixture orchestration, schema validation, golden snapshot comparison, and planted-secret checks.

**Tech Stack:** Node 20+, TypeScript, Playwright Chromium, Commander, AJV JSON Schema validation, Vitest, Prettier, local Node HTTP fixture servers, Bun compile only after the engine is testable.

---

## Source Of Truth

- Follow `SPEC.md` v2 dated 2026-07-06.
- Treat `docs/superpowers/specs/` as historical record only.
- Do not build SwiftUI UI in this run. `app/Gnaw/` may exist as an empty skeleton only.
- Do not add engine behavior that requires GUI capture logic. The engine interface is only the contract files, haul files, stdin commands, stdout NDJSON events, and stderr logs.
- Preserve existing working-tree changes outside the touched milestone files unless the user explicitly says to include them.

## Execution Rules

- Work one milestone branch at a time: `m0-contract`, `m1-engine-core`, `m2-engine-complete`, `m3-auth`.
- Each branch starts from the reviewed and merged previous milestone.
- Commit small green slices. Each commit must pass the relevant test command before commit.
- Use TDD for production code: write the failing test, verify it fails for the expected reason, implement minimal code, verify it passes.
- Use systematic debugging for any failure: root cause first, one hypothesis at a time, no guess loops.
- Use subagent-driven development for implementation tasks. Use dispatching-parallel-agents only for independent work that writes disjoint files or produces a patch/design artifact for sequential integration.
- Every milestone gets two reviews before merge: spec compliance review first, then code quality review.
- Every merge to `main` is fast-forward only.
- Never force push.

## Global File Structure

Create or modify these paths over M0-M3:

- `CONTRACT.md`: human-readable contract for haul layout, manifest, event stream, control channel, waterfall, redaction, and path rules.
- `contract/manifest.schema.json`: JSON Schema for `MANIFEST.json`.
- `contract/events.schema.json`: JSON Schema for stdout engine events.
- `contract/waterfall.schema.json`: JSON Schema for each `waterfall.ndjson` row, required by SPEC.md section 4.4.
- `package.json`: Node scripts, dependencies, and CLI bin.
- `tsconfig.json`: strict TypeScript configuration.
- `vitest.config.ts`: unit and integration test configuration.
- `engine/src/cli.ts`: `gnaw` command entrypoint.
- `engine/src/capture/capture.ts`: capture orchestration.
- `engine/src/capture/controller.ts`: stdin command and SIGTERM control state.
- `engine/src/capture/events.ts`: NDJSON event writer and stderr logger mirror.
- `engine/src/capture/manifest.ts`: manifest builder.
- `engine/src/capture/waterfall.ts`: waterfall row writer.
- `engine/src/capture/redact.ts`: redaction utilities.
- `engine/src/paths/normalizePath.ts`: deterministic URL to file path normalization.
- `engine/src/assets/classifyKind.ts`: asset kind classifier.
- `engine/src/assets/writeAsset.ts`: raw asset persistence and hash calculation.
- `engine/src/render/renderedSnapshot.ts`: post-JS DOM snapshot writer.
- `engine/src/render/navigableRewrite.ts`: relative navigable mirror rewriting.
- `engine/src/render/beautify.ts`: JS and CSS beautification.
- `engine/src/render/sourceMaps.ts`: source map detection and copy.
- `engine/src/context/contextMd.ts`: Study mode `context.md` generation.
- `engine/src/safety/blocklist.ts`: navigation safety blocklist.
- `engine/src/stacks/detectStack.ts`: stack detector.
- `engine/src/stacks/stacks.json`: weighted stack detection rules.
- `engine/src/auth/profiles.ts`: profile storage, metadata, permissions, and locking.
- `engine/src/auth/login.ts`: visible Chromium login flow.
- `engine/src/browser/resolveBrowser.ts`: browser resolution and metadata.
- `engine/test/unit/*.test.ts`: unit tests.
- `engine/test/integration/*.test.ts`: capture and auth integration tests.
- `fixtures/src/server.ts`: local fixture server launcher.
- `fixtures/src/registry.ts`: fixture definitions and ports.
- `fixtures/sites/static/public/*`: static baseline site.
- `fixtures/sites/spa/public/*`: Next-style SPA fixture.
- `fixtures/sites/wordpress/public/*`: WordPress and Elementor-style fixture.
- `fixtures/sites/lazy/public/*`: delayed and scroll-loaded asset fixture.
- `fixtures/sites/auth/public/*`: login, protected routes, cookies, localStorage, blocked routes.
- `fixtures/sites/hostile-paths/public/*`: query variants, case collisions, long paths, cross-origin assets.
- `harness/src/cli.ts`: harness runner.
- `harness/src/contract/validate.ts`: schema validation helpers.
- `harness/src/golden/compare.ts`: deterministic golden comparison.
- `harness/src/golden/sanitize.ts`: timestamp and ordering normalizer for golden manifests.
- `harness/src/redaction/grepSecrets.ts`: planted secret scanner.
- `harness/goldens/path-normalization.json`: path normalization golden cases.
- `harness/goldens/hauls/*`: fixture haul goldens from M1 onward.
- `SESSION-NOTES.md`: final run notes after M3.
- `README.md`: basic repository and CLI usage notes, no GUI implementation.
- `app/Gnaw/.gitkeep`: app skeleton only, no SwiftUI code.

## Spec-Derived Implementation Decisions

- `contract/waterfall.schema.json` is added even though the milestone short label lists only manifest and events schemas, because SPEC.md section 4.4 says `waterfall.ndjson` has a schema.
- Extensionless raw assets use the response content type to choose a suffix when needed. Example: JSON response from `/api/products?locale=en` maps to `api/products~qa241e79a.json`, matching SPEC.md section 4.9.
- Path segment length hashing uses the decoded and sanitized segment before truncation. The truncated segment is first 80 characters, then `~`, then the first 8 hex characters of the SHA-256 hash.
- Tests set `GNAW_HOME` and fixture output directories to temporary paths so auth profiles never touch the real user profile directory.

## Parallel Subagent Plan

Use dispatching-parallel-agents after the M0 package and schema validator base exists:

- Schema authoring subagent: `CONTRACT.md`, `contract/*.schema.json`, schema samples.
- Fixture sites subagent: `fixtures/sites/*`, `fixtures/src/*`, no engine code.
- Path normalization subagent: `engine/src/paths/*`, `engine/test/unit/normalizePath.test.ts`, `harness/goldens/path-normalization.json`.
- Kind classifier subagent: `engine/src/assets/classifyKind.ts`, focused tests.
- Stack detection subagent: `engine/src/stacks/*`, focused tests.
- Harness subagent: `harness/src/*`, focused tests.

Controller integrates one subagent result at a time, runs the focused test, runs the milestone test set, then requests spec and quality reviews before marking that task complete.

---

## M0: Contract, Schemas, Skeleton, Fixture Scaffold

### Task M0.1: Branch And Package/Test Skeleton

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `README.md`
- Create: `app/Gnaw/.gitkeep`
- Create: `engine/src/cli.ts`
- Create: `engine/test/unit/smoke.test.ts`
- Create: `harness/src/contract/validate.ts`
- Create: `harness/test/unit/contractValidator.test.ts`

- [ ] **Step 1: Create milestone branch**

Run:

```bash
git status --short --branch
git switch -c m0-contract
```

Expected:

```text
## m0-contract
```

Success criteria:

- The branch is `m0-contract`.
- Existing changes in `docs/superpowers/specs/` and old spec files are not reverted.
- No app source is created beyond `.gitkeep`.

- [ ] **Step 2: Write failing smoke and validator tests**

`engine/test/unit/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { engineIdentity } from "../../src/cli";

describe("engine skeleton", () => {
  it("exposes the Gnaw Playwright engine identity", () => {
    expect(engineIdentity).toEqual({
      name: "gnaw-playwright",
      version: "1.0.0",
      contract: "2.0"
    });
  });
});
```

`harness/test/unit/contractValidator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadContractSchemas } from "../../src/contract/validate";

describe("contract schema loader", () => {
  it("loads manifest, events, and waterfall schemas", async () => {
    const schemas = await loadContractSchemas();

    expect(Object.keys(schemas).sort()).toEqual([
      "events",
      "manifest",
      "waterfall"
    ]);
  });
});
```

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
npm test -- engine/test/unit/smoke.test.ts harness/test/unit/contractValidator.test.ts
```

Expected:

```text
FAIL
Cannot find module
```

- [ ] **Step 4: Add minimal package and TypeScript files**

`package.json` must include:

```json
{
  "name": "gnaw",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "bin": {
    "gnaw": "dist/cli.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:unit": "vitest run engine/test/unit harness/test/unit",
    "test:integration": "vitest run engine/test/integration harness/test/integration",
    "harness": "tsx harness/src/cli.ts"
  },
  "dependencies": {
    "ajv": "^8.17.1",
    "commander": "^12.1.0",
    "playwright": "^1.45.0",
    "prettier": "^3.3.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

`engine/src/cli.ts`:

```ts
export const engineIdentity = {
  name: "gnaw-playwright",
  version: "1.0.0",
  contract: "2.0"
} as const;
```

`harness/src/contract/validate.ts` starts with a real loader that reads `contract/manifest.schema.json`, `contract/events.schema.json`, and `contract/waterfall.schema.json`.

- [ ] **Step 5: Run tests and build to verify GREEN**

Run:

```bash
npm test -- engine/test/unit/smoke.test.ts harness/test/unit/contractValidator.test.ts
npm run build
```

Expected:

```text
Test Files  2 passed
```

- [ ] **Step 6: Commit**

Run:

```bash
git add package.json tsconfig.json vitest.config.ts README.md app/Gnaw/.gitkeep engine/src/cli.ts engine/test/unit/smoke.test.ts harness/src/contract/validate.ts harness/test/unit/contractValidator.test.ts
git commit -m "chore: add project skeleton"
```

### Task M0.2: Contract Document And JSON Schemas

**Files:**
- Create: `CONTRACT.md`
- Create: `contract/manifest.schema.json`
- Create: `contract/events.schema.json`
- Create: `contract/waterfall.schema.json`
- Create: `harness/test/unit/contractSchemas.test.ts`

- [ ] **Step 1: Write failing schema validation tests**

`harness/test/unit/contractSchemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  validateEvent,
  validateManifest,
  validateWaterfallRow
} from "../../src/contract/validate";

describe("contract schemas", () => {
  it("accepts a valid complete manifest", async () => {
    const result = validateManifest({
      schemaVersion: 2,
      gnawVersion: "1.0.0",
      engine: {
        name: "gnaw-playwright",
        version: "1.0.0",
        browser: "Chrome 126.0.6478.62"
      },
      entrypoint: "http://127.0.0.1:43111/",
      host: "127.0.0.1",
      startedAt: "2026-07-06T10:22:31Z",
      finishedAt: "2026-07-06T10:24:02Z",
      durationMs: 91000,
      result: "complete",
      modes: ["navigable", "study"],
      config: {
        depth: 1,
        sameDomainOnly: true,
        includeSubdomains: false,
        respectRobots: false,
        rateLimitMs: 250,
        maxPages: 200,
        maxTotalBytes: 2147483648,
        maxAssetBytes: 104857600,
        userAgent: "GnawTest/1.0",
        authProfile: null
      },
      stack: {
        primary: null,
        detected: []
      },
      stats: {
        pages: 1,
        assets: 0,
        bytes: 0,
        byKind: {
          HTML: 1,
          JS: 0,
          CSS: 0,
          IMG: 0,
          FONT: 0,
          JSON: 0,
          MEDIA: 0,
          WASM: 0,
          OTHER: 0
        }
      },
      pages: [
        {
          url: "http://127.0.0.1:43111/",
          title: "Static fixture",
          depth: 0,
          status: 200,
          discoveredFrom: null,
          navigablePath: "navigable/index.html",
          renderedPath: "study/rendered/127.0.0.1/index.html"
        }
      ],
      assets: [],
      safety: {
        skippedUrls: []
      },
      errors: []
    });

    expect(result.valid).toBe(true);
  });

  it("rejects stdout text that is not an event object", async () => {
    const result = validateEvent("Starting capture");

    expect(result.valid).toBe(false);
  });

  it("accepts request before asset event shapes", async () => {
    expect(validateEvent({
      v: 2,
      type: "request",
      id: "r-0001",
      url: "http://127.0.0.1:43111/app.js",
      method: "GET"
    }).valid).toBe(true);

    expect(validateEvent({
      v: 2,
      type: "asset",
      id: "r-0001",
      url: "http://127.0.0.1:43111/app.js",
      kind: "JS",
      bytes: 42,
      status: 200,
      fromCache: false,
      viaJs: false,
      rawPath: "study/raw/127.0.0.1/app.js"
    }).valid).toBe(true);
  });

  it("accepts a waterfall response row without headers or bodies", async () => {
    const result = validateWaterfallRow({
      t: 12894,
      url: "http://127.0.0.1:43111/app.js",
      method: "GET",
      status: 200,
      kind: "JS",
      contentType: "application/javascript",
      bytes: 42,
      durationMs: 142,
      fromCache: false,
      viaJs: false,
      referrer: "http://127.0.0.1:43111/",
      page: "http://127.0.0.1:43111/"
    });

    expect(result.valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm test -- harness/test/unit/contractSchemas.test.ts
```

Expected:

```text
FAIL
schema file not found
```

- [ ] **Step 3: Write schemas and CONTRACT.md**

`CONTRACT.md` must cover:

- Haul folder layout from SPEC.md section 4.1.
- URL normalization rules from SPEC.md section 4.2.
- Manifest fields, result enum, asset kind enum, auth block, safety block, and errors.
- Waterfall row shape and forbidden data: request headers, credential response headers, cookies, bodies.
- Stdout event protocol, including `v: 2`, request lifecycle, progress throttle, skip reasons, errors, and done.
- Stdin control commands: pause, resume, cancel.
- Cancel and SIGTERM finalization rules.
- Auth profile metadata and redaction rule.
- Human logs on stderr and mirrored into `gnaw.log`.

Schema requirements:

- `manifest.schema.json` rejects missing `schemaVersion`, unknown `result`, unknown asset kind, negative byte counts, and auth secrets.
- `events.schema.json` validates each event type listed in SPEC.md section 4.5 and ignores unknown extra fields for forward compatibility.
- `waterfall.schema.json` validates one row per response and rejects `requestHeaders`, `responseHeaders`, `cookies`, and `body` fields.

- [ ] **Step 4: Run schema tests and build**

Run:

```bash
npm test -- harness/test/unit/contractSchemas.test.ts harness/test/unit/contractValidator.test.ts
npm run build
```

Expected:

```text
Test Files  2 passed
```

- [ ] **Step 5: Commit**

Run:

```bash
git add CONTRACT.md contract/manifest.schema.json contract/events.schema.json contract/waterfall.schema.json harness/src/contract/validate.ts harness/test/unit/contractSchemas.test.ts
git commit -m "feat: define gnaw contract schemas"
```

### Task M0.3: Fixture Scaffold And Local-Only Guard

**Files:**
- Create: `fixtures/README.md`
- Create: `fixtures/src/registry.ts`
- Create: `fixtures/src/server.ts`
- Create: `fixtures/sites/static/public/index.html`
- Create: `fixtures/sites/spa/public/index.html`
- Create: `fixtures/sites/wordpress/public/index.html`
- Create: `fixtures/sites/lazy/public/index.html`
- Create: `fixtures/sites/auth/public/index.html`
- Create: `fixtures/sites/hostile-paths/public/index.html`
- Create: `harness/test/unit/fixtures.test.ts`

- [ ] **Step 1: Write failing fixture registry tests**

`harness/test/unit/fixtures.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fixtureRegistry } from "../../fixtures/src/registry";

describe("fixture corpus scaffold", () => {
  it("defines every fixture required by SPEC.md section 11", () => {
    expect(fixtureRegistry.map((fixture) => fixture.name).sort()).toEqual([
      "auth",
      "hostile-paths",
      "lazy",
      "spa",
      "static",
      "wordpress"
    ]);
  });

  it("uses local loopback origins only", () => {
    for (const fixture of fixtureRegistry) {
      expect(fixture.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      for (const extraOrigin of fixture.extraOrigins ?? []) {
        expect(extraOrigin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      }
    }
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm test -- harness/test/unit/fixtures.test.ts
```

Expected:

```text
FAIL
Cannot find module
```

- [ ] **Step 3: Add fixture registry and minimal pages**

`fixtures/src/registry.ts` exports exactly the six fixture names from the test. `hostile-paths` includes one `extraOrigins` entry for the cross-origin asset server.

Each `index.html` contains valid HTML, a title with the fixture name, and only relative or loopback URLs. Keep fixture behavior minimal in M0. M1 through M3 add specific assets and routes.

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- harness/test/unit/fixtures.test.ts
npm run build
```

Expected:

```text
Test Files  1 passed
```

- [ ] **Step 5: Commit**

Run:

```bash
git add fixtures README.md harness/test/unit/fixtures.test.ts
git commit -m "test: scaffold local fixture corpus"
```

### Task M0.4: M0 Review Gate And Merge

**Files:**
- No new files.

- [ ] **Step 1: Run full M0 verification**

Run:

```bash
npm test
npm run build
```

Expected:

```text
Test Files  all passed
```

- [ ] **Step 2: Request spec compliance review**

Review prompt must include:

- `SPEC.md` sections 4, 11, 12 M0, 13, 14, 15.
- Diff from branch base to `m0-contract`.
- Explicit check: no SwiftUI app code was created.
- Explicit check: historical docs are not used as requirements.

Success criteria:

- Reviewer says M0 contract and scaffolding comply with SPEC.md.
- Any Critical or Important findings are fixed and re-reviewed.

- [ ] **Step 3: Request code quality review**

Success criteria:

- Reviewer approves schema quality, test clarity, file boundaries, and no stdout/stderr contract violations in skeleton code.
- Any Critical or Important findings are fixed and re-reviewed.

- [ ] **Step 4: Fast-forward merge M0**

Run:

```bash
git switch main
git merge --ff-only m0-contract
npm test
npm run build
```

Expected:

```text
Test Files  all passed
```

---

## M1: Engine Core

### Task M1.1: Branch, CLI Shape, And Event Writer

**Files:**
- Modify: `engine/src/cli.ts`
- Create: `engine/src/capture/events.ts`
- Create: `engine/test/unit/events.test.ts`
- Create: `engine/test/integration/stdoutContract.test.ts`

- [ ] **Step 1: Create milestone branch**

Run:

```bash
git switch main
git switch -c m1-engine-core
```

- [ ] **Step 2: Write failing event writer unit test**

`engine/test/unit/events.test.ts`:

```ts
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createEventWriter } from "../../src/capture/events";

describe("event writer", () => {
  it("writes one JSON event per stdout line and human logs to stderr", () => {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        stdoutLines.push(chunk.toString());
        callback();
      }
    });
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        stderrLines.push(chunk.toString());
        callback();
      }
    });

    const writer = createEventWriter({ stdout, stderr });
    writer.event({ v: 2, type: "hello", engine: { name: "gnaw-playwright", version: "1.0.0" }, contract: "2.0" });
    writer.log("Starting capture");

    expect(stdoutLines.join("")).toBe('{"v":2,"type":"hello","engine":{"name":"gnaw-playwright","version":"1.0.0"},"contract":"2.0"}\n');
    expect(stderrLines.join("")).toBe("Starting capture\n");
  });
});
```

- [ ] **Step 3: Verify RED**

Run:

```bash
npm test -- engine/test/unit/events.test.ts
```

Expected:

```text
FAIL
Cannot find module
```

- [ ] **Step 4: Implement event writer and minimal CLI command registration**

`createEventWriter` accepts injected streams, serializes events with `JSON.stringify`, appends `\n`, and never writes human strings to stdout.

`engine/src/cli.ts` registers:

```text
gnaw capture <url>
gnaw auth login <url> --profile <name>
gnaw auth list
gnaw auth delete <name>
```

Auth commands may return "not implemented" on stderr in M1, but capture exists for M1 tasks.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npm test -- engine/test/unit/events.test.ts
npm run build
git add engine/src/cli.ts engine/src/capture/events.ts engine/test/unit/events.test.ts engine/test/integration/stdoutContract.test.ts
git commit -m "feat: add engine event writer"
```

### Task M1.2: URL Path Normalization With Goldens

**Files:**
- Create: `engine/src/paths/normalizePath.ts`
- Create: `engine/test/unit/normalizePath.test.ts`
- Create: `harness/goldens/path-normalization.json`
- Create: `harness/test/unit/pathGolden.test.ts`

- [ ] **Step 1: Write failing normalization tests**

`engine/test/unit/normalizePath.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createPathNormalizer } from "../../src/paths/normalizePath";

describe("URL to file path normalization", () => {
  it("lowercases the host and maps root to index.html", () => {
    const normalizer = createPathNormalizer();
    expect(normalizer.normalizePage("https://Example.COM/").relativePath).toBe("example.com/index.html");
  });

  it("maps extensionless page paths to index.html", () => {
    const normalizer = createPathNormalizer();
    expect(normalizer.normalizePage("https://example.com/about").relativePath).toBe("example.com/about/index.html");
  });

  it("appends query hash before an existing extension", () => {
    const normalizer = createPathNormalizer();
    expect(normalizer.normalizeAsset("https://example.com/app.js?v=3", "application/javascript").relativePath).toBe("example.com/app~q951eba4f.js");
  });

  it("uses content type extension for extensionless JSON assets", () => {
    const normalizer = createPathNormalizer();
    expect(normalizer.normalizeAsset("https://example.com/api/products?locale=en", "application/json").relativePath).toBe("example.com/api/products~qa241e79a.json");
  });

  it("percent-decodes then replaces unsafe and non-ASCII characters", () => {
    const normalizer = createPathNormalizer();
    expect(normalizer.normalizeAsset("https://example.com/a%20b/caf%C3%A9.js", "application/javascript").relativePath).toBe("example.com/a_b/caf_.js");
  });

  it("adds a case collision suffix on APFS-style collisions", () => {
    const normalizer = createPathNormalizer();
    expect(normalizer.normalizeAsset("https://example.com/img/Logo.png", "image/png").relativePath).toBe("example.com/img/Logo.png");
    expect(normalizer.normalizeAsset("https://example.com/img/logo.png", "image/png").relativePath).toBe("example.com/img/logo~c58960a8d.png");
  });

  it("truncates path segments longer than 100 characters", () => {
    const segment = "a".repeat(120);
    const normalizer = createPathNormalizer();
    expect(normalizer.normalizeAsset(`https://example.com/${segment}.js`, "application/javascript").relativePath).toBe(`example.com/${"a".repeat(80)}~2f3d3354.js`);
  });

  it("strips fragments", () => {
    const normalizer = createPathNormalizer();
    expect(normalizer.normalizePage("https://example.com/docs#install").relativePath).toBe("example.com/docs/index.html");
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- engine/test/unit/normalizePath.test.ts
```

Expected:

```text
FAIL
Cannot find module
```

- [ ] **Step 3: Implement the normalizer**

API:

```ts
export type NormalizedPath = {
  host: string;
  relativePath: string;
};

export function createPathNormalizer(): {
  normalizePage(url: string): NormalizedPath;
  normalizeRendered(url: string): NormalizedPath;
  normalizeAsset(url: string, contentType: string | null): NormalizedPath;
};
```

Implementation requirements:

- Strip fragments before hashing query strings.
- Hash the raw query string without the leading `?`.
- Percent-decode before sanitizing.
- Preserve path case unless an APFS-style collision occurs.
- Track case-insensitive paths per normalizer instance.
- Never return absolute paths or `..` segments.

- [ ] **Step 4: Add path golden file and test**

`harness/goldens/path-normalization.json` stores the expected inputs and output paths from Step 1.

`harness/test/unit/pathGolden.test.ts` loads the golden file and replays every case through `createPathNormalizer`.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npm test -- engine/test/unit/normalizePath.test.ts harness/test/unit/pathGolden.test.ts
npm run build
git add engine/src/paths/normalizePath.ts engine/test/unit/normalizePath.test.ts harness/goldens/path-normalization.json harness/test/unit/pathGolden.test.ts
git commit -m "feat: normalize capture paths"
```

### Task M1.3: Kind Classifier And Asset Writer

**Files:**
- Create: `engine/src/assets/classifyKind.ts`
- Create: `engine/src/assets/writeAsset.ts`
- Create: `engine/test/unit/classifyKind.test.ts`
- Create: `engine/test/unit/writeAsset.test.ts`

- [ ] **Step 1: Write failing classifier tests**

Test cases:

- `text/html` -> `HTML`
- `application/javascript` -> `JS`
- `text/css` -> `CSS`
- `image/png` -> `IMG`
- `font/woff2` -> `FONT`
- `application/json` -> `JSON`
- `video/mp4` -> `MEDIA`
- `application/wasm` -> `WASM`
- unknown content type with `.js` URL -> `JS`
- unknown content type with unknown extension -> `OTHER`

- [ ] **Step 2: Write failing asset writer test**

`writeAsset` receives a URL, content type, body buffer, and output root, then writes `study/raw/<host>/<normalized path>`, returns bytes and SHA-256, and never writes outside the haul root.

- [ ] **Step 3: Verify RED**

Run:

```bash
npm test -- engine/test/unit/classifyKind.test.ts engine/test/unit/writeAsset.test.ts
```

- [ ] **Step 4: Implement classifier and writer**

Keep classifier pure. Keep file writing isolated in `writeAsset.ts`.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npm test -- engine/test/unit/classifyKind.test.ts engine/test/unit/writeAsset.test.ts
npm run build
git add engine/src/assets engine/test/unit/classifyKind.test.ts engine/test/unit/writeAsset.test.ts
git commit -m "feat: classify and persist assets"
```

### Task M1.4: Local Fixture Servers For Engine Core

**Files:**
- Modify: `fixtures/src/server.ts`
- Modify: `fixtures/sites/static/public/*`
- Modify: `fixtures/sites/spa/public/*`
- Modify: `fixtures/sites/lazy/public/*`
- Modify: `fixtures/sites/hostile-paths/public/*`
- Create: `harness/test/integration/fixtureServer.test.ts`

- [ ] **Step 1: Write failing fixture server integration test**

The test starts static and hostile-path fixtures, fetches:

- `/`
- `/style.css`
- `/app.js?v=3`
- `/api/products?locale=en`
- `/lazy.html`
- a cross-origin asset from the hostile fixture extra origin

Assert all origins are loopback and all responses are deterministic.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- harness/test/integration/fixtureServer.test.ts
```

- [ ] **Step 3: Implement fixture server**

Use Node HTTP or a small dependency-free static server. Do not introduce live URLs. The hostile fixture must provide:

- Query variants for the same filename.
- `/img/Logo.png` and `/img/logo.png`.
- One segment longer than 100 characters.
- A second loopback origin for cross-origin assets.

- [ ] **Step 4: Run tests and commit**

Run:

```bash
npm test -- harness/test/integration/fixtureServer.test.ts
npm run build
git add fixtures harness/test/integration/fixtureServer.test.ts
git commit -m "test: serve core fixture corpus"
```

### Task M1.5: Capture Pipeline Core

**Files:**
- Create: `engine/src/capture/capture.ts`
- Create: `engine/src/capture/controller.ts`
- Create: `engine/src/capture/manifest.ts`
- Create: `engine/src/capture/waterfall.ts`
- Create: `engine/src/render/renderedSnapshot.ts`
- Create: `engine/test/unit/manifest.test.ts`
- Create: `engine/test/integration/captureCore.test.ts`
- Modify: `engine/src/cli.ts`

- [ ] **Step 1: Write failing manifest builder unit test**

Assert:

- `schemaVersion` is `2`.
- `result` accepts `complete`, `partial`, `canceled`.
- `stats.byKind` includes all kind enum keys.
- `config` defaults match SPEC.md: depth `1`, same domain `true`, subdomains `false`, robots `false`, rate limit `250`, max pages `200`, max total bytes `2147483648`, max asset bytes `104857600`.
- Output validates against `contract/manifest.schema.json`.

- [ ] **Step 2: Write failing capture integration test**

Test:

```text
gnaw capture <static fixture URL> --mode study --depth 0 --out <tmp>
```

Assert:

- stdout lines are JSON only and each validates against `events.schema.json`.
- stderr contains human text.
- haul contains `study/raw`, `study/rendered`, `MANIFEST.json`, `waterfall.ndjson`, and `gnaw.log`.
- `MANIFEST.json` validates against schema.
- every `waterfall.ndjson` row validates against schema.
- raw files contain original bytes.
- rendered snapshot is post-JS DOM HTML.
- final event is `done` with `result: "complete"`.

- [ ] **Step 3: Verify RED**

Run:

```bash
npm test -- engine/test/unit/manifest.test.ts engine/test/integration/captureCore.test.ts
```

- [ ] **Step 4: Implement capture core**

Requirements:

- Resolve Chromium through Playwright for tests.
- Attach network listeners before navigation.
- Emit `hello`, `browser`, `start`, `page_start`, `request`, `asset`, `page_done`, throttled `progress`, and `done`.
- Save every response body available from Playwright under `study/raw`.
- Append waterfall rows in response completion order.
- Snapshot rendered DOM after load plus network quiet and auto-scroll.
- Extract in-scope links from rendered DOM.
- Apply depth and same-domain page navigation rules.
- Capture cross-origin assets referenced by in-scope pages.
- Write `MANIFEST.json` last.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npm test -- engine/test/unit/manifest.test.ts engine/test/integration/captureCore.test.ts
npm run build
git add engine/src/capture engine/src/render/renderedSnapshot.ts engine/src/cli.ts engine/test/unit/manifest.test.ts engine/test/integration/captureCore.test.ts
git commit -m "feat: capture fixture pages"
```

### Task M1.6: Control Channel, SIGTERM, And Guardrails

**Files:**
- Modify: `engine/src/capture/controller.ts`
- Modify: `engine/src/capture/capture.ts`
- Create: `engine/test/integration/controlChannel.test.ts`
- Create: `engine/test/integration/guardrails.test.ts`

- [ ] **Step 1: Write failing control tests**

Tests:

- Spawn `gnaw capture` against the lazy fixture, write `{"cmd":"pause"}\n`, assert a `state` event with `paused`.
- Write `{"cmd":"resume"}\n`, assert a `state` event resumes capture.
- Write `{"cmd":"cancel"}\n`, assert exit code `0`, final `done.result` is `canceled`, and manifest validates with `result: "canceled"`.
- Send SIGTERM during capture, assert same result as cancel.

- [ ] **Step 2: Write failing guardrail tests**

Tests:

- `--max-pages 1` on a depth 2 fixture ends with `partial` and emits skip reason `max_pages`.
- `--max-bytes 1` ends with `partial`.
- `--max-asset-bytes 1` skips larger assets and emits warning code `asset_too_large`.

- [ ] **Step 3: Verify RED**

Run:

```bash
npm test -- engine/test/integration/controlChannel.test.ts engine/test/integration/guardrails.test.ts
```

- [ ] **Step 4: Implement control and guardrails**

Rules:

- Pause and resume are honored at page boundaries.
- Cancel stops enqueuing and navigation, finishes in-flight body writes, writes manifest, emits `done`, exits `0`.
- SIGTERM calls the same cancel path.
- Hitting guardrails produces `partial`, not `canceled`.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npm test -- engine/test/integration/controlChannel.test.ts engine/test/integration/guardrails.test.ts
npm run build
git add engine/src/capture engine/test/integration/controlChannel.test.ts engine/test/integration/guardrails.test.ts
git commit -m "feat: support capture control channel"
```

### Task M1.7: Harness Golden Snapshots From Day One

**Files:**
- Create: `harness/src/cli.ts`
- Create: `harness/src/golden/compare.ts`
- Create: `harness/src/golden/sanitize.ts`
- Create: `harness/test/integration/goldenHarness.test.ts`
- Create: `harness/goldens/hauls/static/*`
- Create: `harness/goldens/hauls/hostile-paths/*`

- [ ] **Step 1: Write failing harness test**

The test runs:

```bash
npm run harness -- capture-fixture static --mode study --depth 0
npm run harness -- capture-fixture hostile-paths --mode study --depth 1
npm run harness -- diff-golden static
npm run harness -- diff-golden hostile-paths
```

Assert:

- Trees match after timestamp sanitization.
- Manifest structural equality ignores timestamps, duration, job id, and ordering where allowed.
- Raw deterministic bytes match byte-for-byte.
- Event streams and manifests validate schemas.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- harness/test/integration/goldenHarness.test.ts
```

- [ ] **Step 3: Implement harness**

Commands:

```text
harness capture-fixture <name> --mode <study|navigable|study,navigable> --depth <n>
harness update-golden <name>
harness diff-golden <name>
harness validate-haul <path>
```

- [ ] **Step 4: Generate initial goldens**

Run:

```bash
npm run harness -- update-golden static
npm run harness -- update-golden hostile-paths
npm test -- harness/test/integration/goldenHarness.test.ts
```

Expected:

```text
Test Files  1 passed
```

- [ ] **Step 5: Commit**

Run:

```bash
git add harness harness/goldens
git commit -m "test: add core capture goldens"
```

### Task M1.8: M1 Review Gate And Merge

**Files:**
- No new files.

- [ ] **Step 1: Run full M1 verification**

Run:

```bash
npm test
npm run build
```

Expected:

```text
Test Files  all passed
```

- [ ] **Step 2: Request spec compliance review**

Reviewer checks:

- SPEC.md sections 4.1 through 4.6 and 5 are implemented for M1 scope.
- stdout contains NDJSON events only.
- cancellation and SIGTERM produce valid canceled hauls.
- path normalization covers all section 4.2 cases.
- every manifest, event stream, and waterfall validates schemas.
- fixtures are local only.

- [ ] **Step 3: Request code quality review**

Reviewer checks:

- capture orchestration is readable and not GUI-coupled.
- file writing is rooted under haul output.
- event writer cannot accidentally log human text to stdout.
- tests are deterministic.

- [ ] **Step 4: Fast-forward merge M1**

Run:

```bash
git switch main
git merge --ff-only m1-engine-core
npm test
npm run build
```

---

## M2: Engine Complete

### Task M2.1: Branch And Safety Blocklist

**Files:**
- Create: `engine/src/safety/blocklist.ts`
- Create: `engine/test/unit/blocklist.test.ts`
- Create: `engine/test/integration/safetyBlocklist.test.ts`
- Modify: `engine/src/capture/capture.ts`
- Modify: `fixtures/sites/auth/public/*`

- [ ] **Step 1: Create milestone branch**

Run:

```bash
git switch main
git switch -c m2-engine-complete
```

- [ ] **Step 2: Write failing blocklist unit tests**

Assert case-insensitive path segment matches for:

- `/logout`
- `/signout`
- `/sign-out`
- `/delete`
- `/remove`
- `/checkout`
- `/cart`
- `/billing`
- `/account/delete`
- `/unsubscribe`

Assert assets are not blocklisted by this module when called with asset context.

- [ ] **Step 3: Write failing integration test**

Fixture page links to `/logout` and `/cart`. Capture depth 1. Assert:

- skipped URLs are emitted as `skip` events with `reason: "blocked_pattern"`.
- skipped URLs appear in `MANIFEST.json.safety.skippedUrls`.
- skipped pages are not fetched as pages.
- result remains `complete` if no guardrail or fatal error occurs.

- [ ] **Step 4: Implement and commit**

Run:

```bash
npm test -- engine/test/unit/blocklist.test.ts engine/test/integration/safetyBlocklist.test.ts
npm run build
git add engine/src/safety engine/src/capture/capture.ts fixtures/sites/auth engine/test/unit/blocklist.test.ts engine/test/integration/safetyBlocklist.test.ts
git commit -m "feat: block unsafe navigation routes"
```

### Task M2.2: Navigable Rewriting

**Files:**
- Create: `engine/src/render/navigableRewrite.ts`
- Create: `engine/test/unit/navigableRewrite.test.ts`
- Create: `engine/test/integration/navigableCapture.test.ts`
- Modify: `engine/src/capture/capture.ts`
- Modify: `fixtures/sites/static/public/*`
- Modify: `fixtures/sites/spa/public/*`

- [ ] **Step 1: Write failing rewrite tests**

Test HTML with:

- stylesheet link.
- script src.
- image src.
- anchor to captured page.
- cross-origin asset.

Assert rewritten output:

- Uses relative paths.
- Points page links to `navigable/<page>/index.html`.
- Points assets to `navigable/_assets/<host>/<path>`.
- Contains no loopback absolute URLs for captured assets or pages.

- [ ] **Step 2: Write failing integration test**

Capture static fixture with `--mode study,navigable`. Assert:

- `navigable/index.html` exists.
- `navigable/_assets/<host>/...` exists for all assets.
- Rewritten HTML references only existing files.

- [ ] **Step 3: Implement and commit**

Run:

```bash
npm test -- engine/test/unit/navigableRewrite.test.ts engine/test/integration/navigableCapture.test.ts
npm run build
git add engine/src/render/navigableRewrite.ts engine/src/capture/capture.ts engine/test/unit/navigableRewrite.test.ts engine/test/integration/navigableCapture.test.ts fixtures/sites/static fixtures/sites/spa
git commit -m "feat: write navigable mirrors"
```

### Task M2.3: Beautified Study Output And Source Maps

**Files:**
- Create: `engine/src/render/beautify.ts`
- Create: `engine/src/render/sourceMaps.ts`
- Create: `engine/test/unit/beautify.test.ts`
- Create: `engine/test/unit/sourceMaps.test.ts`
- Create: `engine/test/integration/studyPostprocess.test.ts`
- Modify: `engine/src/capture/capture.ts`
- Modify: `fixtures/sites/spa/public/*`

- [ ] **Step 1: Write failing beautify tests**

Assert minified JS and CSS raw files produce readable files under `study/beautified/<host>/<path>` and leave non-JS/CSS assets alone.

- [ ] **Step 2: Write failing source map tests**

Assert:

- `//# sourceMappingURL=app.js.map` is detected.
- `/*# sourceMappingURL=style.css.map */` is detected.
- discovered maps are saved under `study/sourcemaps/<host>/<path>`.
- missing maps produce a warning, not fatal failure.

- [ ] **Step 3: Implement and commit**

Run:

```bash
npm test -- engine/test/unit/beautify.test.ts engine/test/unit/sourceMaps.test.ts engine/test/integration/studyPostprocess.test.ts
npm run build
git add engine/src/render/beautify.ts engine/src/render/sourceMaps.ts engine/src/capture/capture.ts engine/test/unit/beautify.test.ts engine/test/unit/sourceMaps.test.ts engine/test/integration/studyPostprocess.test.ts fixtures/sites/spa
git commit -m "feat: postprocess study assets"
```

### Task M2.4: Stack Detection Ruleset

**Files:**
- Create: `engine/src/stacks/stacks.json`
- Create: `engine/src/stacks/detectStack.ts`
- Create: `engine/test/unit/stackDetection.test.ts`
- Create: `engine/test/integration/stackEvent.test.ts`
- Modify: `engine/src/capture/capture.ts`
- Modify: `fixtures/sites/spa/public/*`
- Modify: `fixtures/sites/wordpress/public/*`

- [ ] **Step 1: Write failing stack unit tests**

Cases:

- Next.js: `/_next/` path and `window.__NEXT_DATA__` produce confidence above `0.6`.
- Vercel: `server: Vercel` contributes signal.
- WordPress: `/wp-content/` and `/wp-json/` paths produce WordPress detection.
- Elementor: body class or Elementor markup produces Elementor detection.
- Webflow: `data-wf-*` produces Webflow detection.
- Shopify: `cdn.shopify.com` and `window.Shopify` produce Shopify detection.
- Highest-confidence result becomes `primary`.
- Confidence is capped at `1.0`.

- [ ] **Step 2: Write failing integration test**

Capture SPA fixture and WordPress fixture. Assert:

- stack event emits after confidence crosses `0.6`.
- manifest stack block includes primary and detected signals.

- [ ] **Step 3: Implement and commit**

Run:

```bash
npm test -- engine/test/unit/stackDetection.test.ts engine/test/integration/stackEvent.test.ts
npm run build
git add engine/src/stacks engine/src/capture/capture.ts engine/test/unit/stackDetection.test.ts engine/test/integration/stackEvent.test.ts fixtures/sites/spa fixtures/sites/wordpress
git commit -m "feat: detect captured site stacks"
```

### Task M2.5: context.md Generation

**Files:**
- Create: `engine/src/context/contextMd.ts`
- Create: `engine/test/unit/contextMd.test.ts`
- Create: `engine/test/integration/contextMdCapture.test.ts`
- Modify: `engine/src/capture/capture.ts`
- Modify: `harness/src/golden/sanitize.ts`

- [ ] **Step 1: Write failing context unit test**

Given a manifest and captured file tree, assert `context.md` contains:

- `# Captured site: <host>`.
- Detected stack and signals.
- Page inventory with rendered paths.
- Largest beautified JS bundles.
- Observed API endpoints from JSON Fetch/XHR responses.
- Asset summary and token estimate.
- File tree to depth 3.
- How-to-use prompt text from SPEC.md section 4.9.

Assert it does not inline file contents.

- [ ] **Step 2: Write failing integration test**

Capture SPA fixture in Study mode. Assert `context.md` exists, validates no long dash characters, references existing files, and includes API endpoint rows.

- [ ] **Step 3: Implement and commit**

Run:

```bash
npm test -- engine/test/unit/contextMd.test.ts engine/test/integration/contextMdCapture.test.ts
npm run build
git add engine/src/context engine/src/capture/capture.ts engine/test/unit/contextMd.test.ts engine/test/integration/contextMdCapture.test.ts harness/src/golden/sanitize.ts
git commit -m "feat: generate study context"
```

### Task M2.6: Complete Fixture Goldens

**Files:**
- Modify: `harness/goldens/hauls/*`
- Create: `harness/test/integration/allFixtureGoldens.test.ts`

- [ ] **Step 1: Write failing all-fixture golden test**

Run harness over:

- `static`
- `spa`
- `wordpress`
- `lazy`
- `hostile-paths`

Modes:

- `static`: `study,navigable`, depth 1.
- `spa`: `study,navigable`, depth 1.
- `wordpress`: `study`, depth 1.
- `lazy`: `study`, depth 0.
- `hostile-paths`: `study,navigable`, depth 1.

Assert every manifest, event stream, and waterfall row validates schemas.

- [ ] **Step 2: Generate or update goldens**

Run:

```bash
npm run harness -- update-golden static
npm run harness -- update-golden spa
npm run harness -- update-golden wordpress
npm run harness -- update-golden lazy
npm run harness -- update-golden hostile-paths
```

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm test -- harness/test/integration/allFixtureGoldens.test.ts
npm test
npm run build
git add harness/goldens harness/test/integration/allFixtureGoldens.test.ts
git commit -m "test: update engine fixture goldens"
```

### Task M2.7: M2 Review Gate And Merge

**Files:**
- No new files.

- [ ] **Step 1: Run full M2 verification**

Run:

```bash
npm test
npm run build
```

- [ ] **Step 2: Request spec compliance review**

Reviewer checks:

- SPEC.md M2 scope is complete: navigable rewriting, beautified output, source maps, `context.md`, stack detection, safety blocklist.
- No GUI logic is introduced.
- All new fixture outputs are deterministic and local.

- [ ] **Step 3: Request code quality review**

Reviewer checks:

- HTML rewriting is scoped and deterministic.
- Stack rules live in data.
- `context.md` generator has no secret-prone fields.
- Source map handling cannot escape the haul directory.

- [ ] **Step 4: Fast-forward merge M2**

Run:

```bash
git switch main
git merge --ff-only m2-engine-complete
npm test
npm run build
```

---

## M3: Auth Profiles And Redaction

### Task M3.1: Branch And Profile Storage

**Files:**
- Create: `engine/src/auth/profiles.ts`
- Create: `engine/test/unit/authProfiles.test.ts`
- Modify: `engine/src/cli.ts`

- [ ] **Step 1: Create milestone branch**

Run:

```bash
git switch main
git switch -c m3-auth
```

- [ ] **Step 2: Write failing profile tests**

Tests:

- Profile root defaults to `~/Library/Application Support/Gnaw/profiles`.
- `GNAW_HOME` test override relocates profiles under a temp directory.
- Created profile directories use `0700` permissions.
- Profile names allow letters, numbers, `_`, `-`, and reject path separators.
- Metadata records profile name, last verified URL, and timestamp.
- `listProfiles` never returns cookie, storage, or token values.
- `deleteProfile` removes only the named profile under the profile root.

- [ ] **Step 3: Implement and commit**

Run:

```bash
npm test -- engine/test/unit/authProfiles.test.ts
npm run build
git add engine/src/auth/profiles.ts engine/src/cli.ts engine/test/unit/authProfiles.test.ts
git commit -m "feat: manage auth profile storage"
```

### Task M3.2: Profile Locking

**Files:**
- Modify: `engine/src/auth/profiles.ts`
- Create: `engine/test/unit/profileLocking.test.ts`
- Create: `engine/test/integration/profileLocked.test.ts`
- Modify: `engine/src/capture/capture.ts`

- [ ] **Step 1: Write failing locking tests**

Tests:

- Acquiring an unlocked profile creates a lock file.
- A second acquisition fails with error code `profile_locked`.
- Releasing a lock removes the lock file.
- Capture using a locked profile emits error code `profile_locked`, writes a valid manifest if a haul path exists, emits `done`, and exits without leaking profile internals.

- [ ] **Step 2: Implement and commit**

Run:

```bash
npm test -- engine/test/unit/profileLocking.test.ts engine/test/integration/profileLocked.test.ts
npm run build
git add engine/src/auth/profiles.ts engine/src/capture/capture.ts engine/test/unit/profileLocking.test.ts engine/test/integration/profileLocked.test.ts
git commit -m "feat: lock auth profiles during capture"
```

### Task M3.3: Auth CLI Commands

**Files:**
- Create: `engine/src/auth/login.ts`
- Create: `engine/test/unit/authCli.test.ts`
- Create: `engine/test/integration/authCommands.test.ts`
- Modify: `engine/src/cli.ts`

- [ ] **Step 1: Write failing command tests**

Tests:

- `gnaw auth list` prints profile metadata to stdout as NDJSON or JSON according to the contract chosen in `CONTRACT.md`, and no secrets.
- `gnaw auth delete client-a` deletes the profile and logs human confirmation to stderr.
- `gnaw auth login <url> --profile client-a` calls the visible browser login flow with the right URL and profile name using an injected launcher in unit tests.

- [ ] **Step 2: Implement commands**

Requirements:

- `auth login` opens visible Chromium for real runs.
- The user logs in manually.
- The resulting Playwright persistent context is stored in the profile directory.
- `auth login` records last verified URL and timestamp.
- Tests inject the browser launcher rather than adding unsupported CLI flags.

- [ ] **Step 3: Run tests and commit**

Run:

```bash
npm test -- engine/test/unit/authCli.test.ts engine/test/integration/authCommands.test.ts
npm run build
git add engine/src/auth/login.ts engine/src/cli.ts engine/test/unit/authCli.test.ts engine/test/integration/authCommands.test.ts
git commit -m "feat: add auth profile commands"
```

### Task M3.4: Auth Fixture

**Files:**
- Modify: `fixtures/sites/auth/public/*`
- Modify: `fixtures/src/server.ts`
- Create: `harness/test/integration/authFixture.test.ts`

- [ ] **Step 1: Write failing auth fixture test**

Fixture behavior:

- `/login` accepts a local form post in the fixture server.
- Successful login sets cookie `fixture_session=PLANTED_COOKIE_SECRET`.
- Successful login writes a protected page that sets `localStorage.fixtureToken = "PLANTED_LOCAL_STORAGE_SECRET"`.
- Protected route `/dashboard` returns `401` without valid auth state.
- Protected route includes lazy asset and links to `/logout` and `/account/delete`.
- API endpoint checks auth but returns non-secret JSON.

Test asserts protected route requires auth and blocked routes exist.

- [ ] **Step 2: Implement fixture**

Keep planted secrets in cookie and storage state only. Do not put planted secret strings in page body, asset body, URL, or API response.

- [ ] **Step 3: Run tests and commit**

Run:

```bash
npm test -- harness/test/integration/authFixture.test.ts
npm run build
git add fixtures/sites/auth fixtures/src/server.ts harness/test/integration/authFixture.test.ts
git commit -m "test: add authenticated fixture"
```

### Task M3.5: Capture With Auth Profile

**Files:**
- Modify: `engine/src/capture/capture.ts`
- Modify: `engine/src/capture/manifest.ts`
- Create: `engine/test/integration/authCapture.test.ts`

- [ ] **Step 1: Write failing auth capture test**

Test setup:

- Start auth fixture.
- Create a temp `GNAW_HOME`.
- Use Playwright in the test to create a persistent context profile by logging into the auth fixture manually through fixture routes.
- Run `gnaw capture <auth fixture dashboard> --profile client-a --mode study,navigable --out <tmp>`.

Assert:

- protected dashboard captures successfully.
- manifest includes `auth.mode: "profile"`, `profileName: "client-a"`, `storageStateUsed: true`, `redacted: true`.
- profile directory is outside the haul.
- skipped safety routes include `/logout` and `/account/delete`.
- schemas validate.

- [ ] **Step 2: Implement auth capture**

Use the named profile as Playwright persistent context. Refuse concurrent locked profile use. Never copy profile files into the haul.

- [ ] **Step 3: Run tests and commit**

Run:

```bash
npm test -- engine/test/integration/authCapture.test.ts
npm run build
git add engine/src/capture engine/test/integration/authCapture.test.ts
git commit -m "feat: capture with auth profiles"
```

### Task M3.6: Absolute Redaction And Planted Secret Grep

**Files:**
- Create: `engine/src/capture/redact.ts`
- Create: `engine/test/unit/redaction.test.ts`
- Create: `harness/src/redaction/grepSecrets.ts`
- Create: `harness/test/integration/redactionSecrets.test.ts`
- Modify: `engine/src/capture/events.ts`
- Modify: `engine/src/capture/manifest.ts`
- Modify: `engine/src/capture/waterfall.ts`
- Modify: `engine/src/context/contextMd.ts`

- [ ] **Step 1: Write failing redaction unit tests**

Assert redaction removes or replaces:

- `Cookie`
- `Set-Cookie`
- `Authorization`
- bearer tokens in strings.
- localStorage and sessionStorage values.
- known planted strings: `PLANTED_COOKIE_SECRET`, `PLANTED_LOCAL_STORAGE_SECRET`, `PLANTED_AUTH_HEADER_SECRET`.

- [ ] **Step 2: Write failing planted-secret grep test**

Capture the auth fixture. Then scan every file in the haul for:

```text
PLANTED_COOKIE_SECRET
PLANTED_LOCAL_STORAGE_SECRET
PLANTED_AUTH_HEADER_SECRET
fixture_session=
Bearer 
Authorization
Set-Cookie
```

Expected:

- The scanner finds zero matches.
- It scans `MANIFEST.json`, `context.md`, `waterfall.ndjson`, `gnaw.log`, `study/raw`, `study/rendered`, `study/beautified`, and `navigable`.

- [ ] **Step 3: Implement redaction**

Rules:

- Do not include request headers in events, waterfall, manifest, context, or logs.
- Do not include response credential headers in events, waterfall, manifest, context, or logs.
- Do not serialize Playwright storage state into hauls.
- Do not log full browser context options when auth is used.
- Rendered pages are captured as browser DOM. The auth fixture must not put planted secrets in DOM, and the grep test proves engine outputs do not leak storage/cookie values.

- [ ] **Step 4: Run tests and commit**

Run:

```bash
npm test -- engine/test/unit/redaction.test.ts harness/test/integration/redactionSecrets.test.ts
npm test
npm run build
git add engine/src/capture engine/src/context harness/src/redaction engine/test/unit/redaction.test.ts harness/test/integration/redactionSecrets.test.ts
git commit -m "feat: redact auth secrets from hauls"
```

### Task M3.7: Auth Goldens

**Files:**
- Modify: `harness/goldens/hauls/auth/*`
- Create: `harness/test/integration/authGolden.test.ts`

- [ ] **Step 1: Write failing auth golden test**

The harness creates a temp auth profile, captures the auth fixture in `study,navigable`, validates schemas, runs planted-secret grep, and diffs against `harness/goldens/hauls/auth`.

- [ ] **Step 2: Generate auth golden**

Run:

```bash
npm run harness -- update-golden auth
npm test -- harness/test/integration/authGolden.test.ts
```

- [ ] **Step 3: Commit**

Run:

```bash
git add harness/goldens/hauls/auth harness/test/integration/authGolden.test.ts
git commit -m "test: add auth capture golden"
```

### Task M3.8: Session Notes And Final M3 Verification

**Files:**
- Create: `SESSION-NOTES.md`

- [ ] **Step 1: Write SESSION-NOTES.md**

Required sections:

- `# Session Notes`
- `## Built`
- `## Decisions`
- `## Deviations From SPEC.md`
- `## Verification`
- `## M4 App Notes`

Content requirements:

- List M0 through M3 features implemented.
- List decisions from this plan, including waterfall schema file and content-type suffixes for extensionless raw assets.
- State deviations from SPEC.md. If none, write `None`.
- Include exact verification commands and latest passing summaries.
- Tell M4 that the app must treat the engine contract as the only interface, parse unknown event fields leniently, and never add capture logic.

- [ ] **Step 2: Run final suite**

Run:

```bash
npm test
npm run build
npm run harness -- diff-golden static
npm run harness -- diff-golden spa
npm run harness -- diff-golden wordpress
npm run harness -- diff-golden lazy
npm run harness -- diff-golden hostile-paths
npm run harness -- diff-golden auth
```

Expected:

```text
Test Files  all passed
All golden diffs passed
```

- [ ] **Step 3: Commit**

Run:

```bash
git add SESSION-NOTES.md
git commit -m "docs: add session notes"
```

### Task M3.9: M3 Review Gate And Merge

**Files:**
- No new files.

- [ ] **Step 1: Request spec compliance review**

Reviewer checks:

- `gnaw auth` commands match SPEC.md section 4.7 and section 7.
- Profile storage is outside hauls and uses `0700`.
- Profile locking emits `profile_locked`.
- Redaction test scans whole haul and fails on planted secrets.
- Auth fixture covers cookies, localStorage, protected routes, lazy assets, and blocked safety routes.
- No SwiftUI app was built.

- [ ] **Step 2: Request code quality review**

Reviewer checks:

- Auth profile paths cannot escape `GNAW_HOME` or the default profile root.
- Locking cleans up on capture completion and failure.
- Redaction is centralized enough to audit.
- Integration tests do not depend on live network.

- [ ] **Step 3: Fast-forward merge M3**

Run:

```bash
git switch main
git merge --ff-only m3-auth
npm test
npm run build
npm run harness -- diff-golden static
npm run harness -- diff-golden spa
npm run harness -- diff-golden wordpress
npm run harness -- diff-golden lazy
npm run harness -- diff-golden hostile-paths
npm run harness -- diff-golden auth
```

Expected:

```text
Test Files  all passed
All golden diffs passed
```

---

## Final Definition Of Done For This Run

- `main` contains merged `m0-contract`, `m1-engine-core`, `m2-engine-complete`, and `m3-auth`.
- Full unit suite passes.
- Full contract validation passes for every produced manifest, event stream, and waterfall.
- Full integration suite passes against local fixtures only.
- Golden snapshot diffs pass.
- Auth redaction planted-secret grep passes.
- `SESSION-NOTES.md` exists at the repo root and includes M4 app notes.
- No SwiftUI implementation exists beyond an app folder placeholder.

## Self-Review Checklist For This Plan

- SPEC.md section 4 contract: covered by M0 schemas, M1 capture, M2 post-processing, M3 auth/redaction.
- SPEC.md section 5 pipeline: covered by M1 core and M2 post-process tasks.
- SPEC.md section 6 stack detection: covered by M2.4.
- SPEC.md section 7 CLI: covered by M1 capture CLI and M3 auth CLI.
- SPEC.md section 8 GUI: intentionally not implemented, only M4 notes.
- SPEC.md section 9 engine and harness stack: covered by skeleton and harness tasks.
- SPEC.md section 11 fixture corpus: covered by M0 scaffold, M1/M2 fixture behavior, M3 auth fixture.
- SPEC.md section 12 M0-M3 milestones: covered in order with review gates.
- SPEC.md section 13 testing strategy: unit, contract, integration, golden, and redaction tests are included.
- SPEC.md section 14 repo layout: covered without building app.
- SPEC.md section 15 naming and prose: English-only docs and no long dash checks are included where generated prose matters.
