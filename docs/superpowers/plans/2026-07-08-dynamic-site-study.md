# Dynamic Site Study Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach Gnaw to turn dynamic-site interaction traces into reusable study reports that identify render pipelines, export endpoints, auth gates, and safe next actions.

**Architecture:** Add a focused `engine/src/scenario/` module that reads browser network NDJSON plus optional response bodies and emits a structured analysis. Keep capture unchanged; the new CLI command consumes artifacts from manual or scripted probes, so similar sites can be studied without hardcoding domain-specific knowledge.

**Tech Stack:** TypeScript, Node fs/promises, Commander, Vitest, existing Gnaw redaction and CLI patterns.

---

## File Structure

- Create `engine/src/scenario/analyze.ts`: parse scenario artifacts, classify endpoints, detect auth gates, generate report data.
- Create `engine/src/scenario/report.ts`: render markdown for humans/agents.
- Create `engine/test/unit/scenarioAnalyze.test.ts`: unit tests for endpoint classification and auth-gate detection.
- Create `engine/test/unit/scenarioReport.test.ts`: unit tests for report rendering and redaction-friendly output.
- Modify `engine/src/cli.ts`: add `scenario analyze` command.
- Modify `engine/test/unit/cli.test.ts`: verify CLI wiring and NDJSON/stdout behavior.
- Modify `README.md`: document the dynamic-site study workflow and Trailmark3D-shaped playbook without credentials.

## Task 1: Scenario Analysis Core

**Files:**
- Create: `engine/src/scenario/analyze.ts`
- Test: `engine/test/unit/scenarioAnalyze.test.ts`

- [ ] **Step 1: Write failing tests**

Create tests with synthetic network rows:

```ts
await analyzeScenario({
  networkLogPath,
  responseBodyPaths: [authBodyPath]
});
```

Expected behavior:
- `POST /parse` is classified as `parse`.
- `POST /upload?...` is classified as `generate`.
- `GET /status/<job>` is classified as `status`.
- `GET /preview_mesh/<job>/terrain` is classified as `preview`.
- `GET /download/<job>/3mf` is classified as `download`.
- A body containing `auth_required` marks `authGate.required === true`.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run engine/test/unit/scenarioAnalyze.test.ts --pool=threads --poolOptions.threads.singleThread=true
```

Expected: fail because `engine/src/scenario/analyze.ts` does not exist.

- [ ] **Step 3: Implement minimal analyzer**

Implement:
- `ScenarioEndpointKind`
- `ScenarioFinding`
- `ScenarioAnalysis`
- `analyzeScenario(options)`
- JSONL parsing that skips malformed rows rather than crashing.
- Response body scanning for `auth_required`, `Sign in`, `Signup to download`, `log in`, and `401`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npx vitest run engine/test/unit/scenarioAnalyze.test.ts --pool=threads --poolOptions.threads.singleThread=true
```

Expected: all tests pass.

## Task 2: Markdown Report

**Files:**
- Create: `engine/src/scenario/report.ts`
- Test: `engine/test/unit/scenarioReport.test.ts`

- [ ] **Step 1: Write failing report tests**

Expected markdown includes:
- `# Dynamic Site Study`
- endpoint sections for parse/generate/status/preview/download
- `Auth gate: required`
- recommended next actions for authenticated export testing.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run engine/test/unit/scenarioReport.test.ts --pool=threads --poolOptions.threads.singleThread=true
```

Expected: fail because report renderer does not exist.

- [ ] **Step 3: Implement report renderer**

Implement `renderScenarioReport(analysis)` with concise markdown tables and next-action bullets.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npx vitest run engine/test/unit/scenarioReport.test.ts --pool=threads --poolOptions.threads.singleThread=true
```

Expected: all tests pass.

## Task 3: CLI Integration

**Files:**
- Modify: `engine/src/cli.ts`
- Modify: `engine/test/unit/cli.test.ts`

- [ ] **Step 1: Write failing CLI test**

Expected command:

```bash
gnaw scenario analyze --network network.ndjson --body auth.json --out report.md
```

Behavior:
- writes a markdown report to `--out`
- emits a schema-shaped NDJSON event on stdout: `{ v: 2, type: "scenario_analysis", ... }`
- writes no secrets or human chatter to stdout.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run engine/test/unit/cli.test.ts --pool=threads --poolOptions.threads.singleThread=true
```

Expected: fail because `scenario` command is missing.

- [ ] **Step 3: Implement CLI command**

Add a `scenario analyze` subcommand with required `--network`, optional repeatable `--body`, and optional `--out`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npx vitest run engine/test/unit/cli.test.ts --pool=threads --poolOptions.threads.singleThread=true
```

Expected: all CLI tests pass.

## Task 4: Documentation And Final Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the workflow**

Add “Study A Dynamic Render/Export Site” with:
- public capture
- auth profile login
- scripted/manual scenario run
- `scenario analyze`
- interpretation of `auth_required`.

- [ ] **Step 2: Run verification**

Run:

```bash
npx vitest run engine/test/unit harness/test/unit --pool=threads --poolOptions.threads.singleThread=true
npm run build
```

Expected: all tests pass and TypeScript compiles.

- [ ] **Step 3: Commit and push**

Commit message:

```bash
git commit -m "Add dynamic site study analysis"
```

Push branch:

```bash
git push -u origin codex/site-study-autonomy
```
