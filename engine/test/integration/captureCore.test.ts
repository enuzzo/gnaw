import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startFixture, type RunningFixture } from "../../../harness/test/helpers/fixtures";
import {
  validateEvent,
  validateManifest,
  validateWaterfallRow
} from "../../../harness/src/contract/validate";
import { captureSite } from "../../src/capture/capture";

describe("capture core", () => {
  const tmpRoots: string[] = [];
  const fixtures: RunningFixture[] = [];

  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
    await Promise.all(tmpRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function tempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "gnaw-capture-"));
    tmpRoots.push(root);
    return root;
  }

  it("captures the static fixture in Study mode with schema-valid outputs", async () => {
    const fixture = await startFixture("static");
    fixtures.push(fixture);
    const outDir = await tempRoot();
    const stdout: unknown[] = [];
    const stderr: string[] = [];

    const result = await captureSite({
      entrypoint: `${fixture.origin}/`,
      outDir,
      modes: ["study"],
      depth: 0,
      eventSink: (event) => stdout.push(event),
      logSink: (line) => stderr.push(line)
    });

    const manifest = JSON.parse(await readFile(join(result.haulPath, "MANIFEST.json"), "utf8"));
    const waterfallRows = (await readFile(join(result.haulPath, "waterfall.ndjson"), "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    expect(stdout.every((event) => validateEvent(event).valid)).toBe(true);
    expect(stdout[0]).toMatchObject({ v: 2, type: "hello" });
    expect(stdout.at(-1)).toMatchObject({ v: 2, type: "done", result: "complete" });
    expect(stderr.join("\n")).toContain("Capture complete");
    expect(validateManifest(manifest).valid).toBe(true);
    expect(manifest.engine.browser).toMatch(/Chrome|Chromium|Edge/);
    expect(manifest.engine.browser).not.toBe("unknown");
    expect(waterfallRows.map((row: { url: string }) => new URL(row.url).pathname)).toEqual(
      expect.arrayContaining(["/", "/style.css", "/theme.css", "/logo.svg", "/app.js"])
    );
    expect(waterfallRows.every((row) => validateWaterfallRow(row).valid)).toBe(true);
    expect(manifest.result).toBe("complete");
    expect(manifest.pages).toHaveLength(1);
    expect(manifest.assets.map((asset: { kind: string }) => asset.kind).sort()).toEqual([
      "CSS",
      "CSS",
      "HTML",
      "IMG",
      "JS"
    ]);
    expect(manifest.pages[0].renderedPath).toBe("study/rendered/127.0.0.1/index.html");
    const renderedHtml = await readFile(join(result.haulPath, "study", "rendered", "127.0.0.1", "index.html"), "utf8");
    expect(renderedHtml).toContain("<title>Static Fixture</title>");
    expect(renderedHtml).toContain('data-static-fixture="ready"');
    expect(await readdir(join(result.haulPath, "study", "raw", "127.0.0.1"))).toEqual(
      expect.arrayContaining(["app.js", "index.html", "logo.svg", "style.css", "theme.css"])
    );
  });

  it("writes a schema-valid canceled haul when canceled before navigation", async () => {
    const fixture = await startFixture("static");
    fixtures.push(fixture);
    const outDir = await tempRoot();
    const stdout: unknown[] = [];

    const result = await captureSite({
      entrypoint: `${fixture.origin}/`,
      outDir,
      modes: ["study"],
      depth: 0,
      signal: AbortSignal.abort(),
      eventSink: (event) => stdout.push(event),
      logSink: () => undefined
    });

    const manifest = JSON.parse(await readFile(join(result.haulPath, "MANIFEST.json"), "utf8"));
    expect(validateManifest(manifest).valid).toBe(true);
    expect(manifest.result).toBe("canceled");
    expect(stdout).not.toContainEqual(expect.objectContaining({ type: "page_start" }));
    expect(stdout.at(-1)).toMatchObject({ v: 2, type: "done", result: "canceled" });
  });

  it("does not navigate when a paused capture is canceled before page_start", async () => {
    const fixture = await startFixture("static");
    fixtures.push(fixture);
    const outDir = await tempRoot();
    const abortController = new AbortController();
    const stdout: unknown[] = [];

    const result = await captureSite({
      entrypoint: `${fixture.origin}/`,
      outDir,
      modes: ["study"],
      depth: 0,
      signal: abortController.signal,
      control: {
        async waitIfPaused() {
          abortController.abort();
        }
      },
      eventSink: (event) => stdout.push(event),
      logSink: () => undefined
    });

    const manifest = JSON.parse(await readFile(join(result.haulPath, "MANIFEST.json"), "utf8"));
    expect(validateManifest(manifest).valid).toBe(true);
    expect(manifest.result).toBe("canceled");
    expect(stdout).not.toContainEqual(expect.objectContaining({ type: "page_start" }));
    expect(stdout.at(-1)).toMatchObject({ v: 2, type: "done", result: "canceled" });
  });

  it("writes a valid partial haul and done event when navigation fails", async () => {
    const outDir = await tempRoot();
    const stdout: unknown[] = [];
    const stderr: string[] = [];

    const result = await captureSite({
      entrypoint: "http://127.0.0.1:1/",
      outDir,
      modes: ["study"],
      depth: 0,
      eventSink: (event) => stdout.push(event),
      logSink: (line) => stderr.push(line)
    });

    const manifest = JSON.parse(await readFile(join(result.haulPath, "MANIFEST.json"), "utf8"));
    expect(validateManifest(manifest).valid).toBe(true);
    expect(manifest.result).toBe("partial");
    expect(manifest.errors[0]).toMatchObject({ code: "nav_timeout", fatal: true });
    expect(stdout).toContainEqual(expect.objectContaining({ type: "error", fatal: true }));
    expect(stdout.at(-1)).toMatchObject({ v: 2, type: "done", result: "partial" });
    expect(stderr.join("\n")).toContain("Capture failed");
  });

  it("marks the haul partial and emits a warning when an asset exceeds maxAssetBytes", async () => {
    const fixture = await startFixture("static");
    fixtures.push(fixture);
    const outDir = await tempRoot();
    const stdout: unknown[] = [];

    const result = await captureSite({
      entrypoint: `${fixture.origin}/`,
      outDir,
      modes: ["study"],
      depth: 0,
      maxAssetBytes: 1,
      eventSink: (event) => stdout.push(event),
      logSink: () => undefined
    });

    const manifest = JSON.parse(await readFile(join(result.haulPath, "MANIFEST.json"), "utf8"));
    expect(validateManifest(manifest).valid).toBe(true);
    expect(manifest.result).toBe("partial");
    expect(manifest.config.maxAssetBytes).toBe(1);
    expect(stdout).toContainEqual(expect.objectContaining({ type: "warning", code: "asset_too_large" }));
    expect(stdout.at(-1)).toMatchObject({ v: 2, type: "done", result: "partial" });
  });

  it("marks the haul partial and emits a warning when maxTotalBytes is reached", async () => {
    const fixture = await startFixture("static");
    fixtures.push(fixture);
    const outDir = await tempRoot();
    const stdout: unknown[] = [];

    const result = await captureSite({
      entrypoint: `${fixture.origin}/`,
      outDir,
      modes: ["study"],
      depth: 0,
      maxTotalBytes: 1,
      eventSink: (event) => stdout.push(event),
      logSink: () => undefined
    });

    const manifest = JSON.parse(await readFile(join(result.haulPath, "MANIFEST.json"), "utf8"));
    expect(validateManifest(manifest).valid).toBe(true);
    expect(manifest.result).toBe("partial");
    expect(manifest.config.maxTotalBytes).toBe(1);
    expect(stdout).toContainEqual(expect.objectContaining({ type: "warning", code: "max_total_bytes" }));
    expect(stdout.at(-1)).toMatchObject({ v: 2, type: "done", result: "partial" });
  });

  it("marks the haul partial when maxPages prevents navigation", async () => {
    const fixture = await startFixture("static");
    fixtures.push(fixture);
    const outDir = await tempRoot();
    const stdout: unknown[] = [];

    const result = await captureSite({
      entrypoint: `${fixture.origin}/`,
      outDir,
      modes: ["study"],
      depth: 0,
      maxPages: 0,
      eventSink: (event) => stdout.push(event),
      logSink: () => undefined
    });

    const manifest = JSON.parse(await readFile(join(result.haulPath, "MANIFEST.json"), "utf8"));
    expect(validateManifest(manifest).valid).toBe(true);
    expect(manifest.result).toBe("partial");
    expect(manifest.safety.skippedUrls).toEqual([
      { url: `${fixture.origin}/`, reason: "max_pages" }
    ]);
    expect(stdout).toContainEqual(expect.objectContaining({ type: "skip", reason: "max_pages" }));
    expect(stdout.at(-1)).toMatchObject({ v: 2, type: "done", result: "partial" });
  });

  it("writes a canceled haul when cancellation arrives during capture", async () => {
    const fixture = await startFixture("static");
    fixtures.push(fixture);
    const outDir = await tempRoot();
    const abortController = new AbortController();
    const stdout: unknown[] = [];

    const result = await captureSite({
      entrypoint: `${fixture.origin}/`,
      outDir,
      modes: ["study"],
      depth: 0,
      signal: abortController.signal,
      eventSink: (event) => {
        stdout.push(event);
        if (event.type === "asset") {
          abortController.abort();
        }
      },
      logSink: () => undefined
    });

    const manifest = JSON.parse(await readFile(join(result.haulPath, "MANIFEST.json"), "utf8"));
    expect(validateManifest(manifest).valid).toBe(true);
    expect(manifest.result).toBe("canceled");
    expect(stdout.at(-1)).toMatchObject({ v: 2, type: "done", result: "canceled" });
  });
});
