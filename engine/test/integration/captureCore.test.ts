import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
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

  it("writes M2 study and navigable outputs for the static fixture", async () => {
    const fixture = await startFixture("static");
    fixtures.push(fixture);
    const outDir = await tempRoot();

    const result = await captureSite({
      entrypoint: `${fixture.origin}/`,
      outDir,
      modes: ["study", "navigable"],
      depth: 0,
      eventSink: () => undefined,
      logSink: () => undefined
    });

    const manifest = JSON.parse(await readFile(join(result.haulPath, "MANIFEST.json"), "utf8"));
    expect(validateManifest(manifest).valid).toBe(true);
    expect(manifest.pages[0].navigablePath).toBe("navigable/index.html");
    expect(manifest.assets.find((asset: { rawPath: string }) => asset.rawPath.endsWith("/app.js"))).toMatchObject({
      beautifiedPath: "study/beautified/127.0.0.1/app.js",
      navigablePath: "navigable/_assets/127.0.0.1/app.js",
      sourceMapPath: "study/sourcemaps/127.0.0.1/app.js.map"
    });

    const navigableHtml = await readFile(join(result.haulPath, "navigable", "index.html"), "utf8");
    expect(navigableHtml).toContain("_assets/127.0.0.1/style.css");
    expect(navigableHtml).toContain("_assets/127.0.0.1/app.js");
    await expect(stat(join(result.haulPath, "navigable", "_assets", "127.0.0.1", "app.js"))).resolves.toBeTruthy();

    const beautifiedJs = await readFile(join(result.haulPath, "study", "beautified", "127.0.0.1", "app.js"), "utf8");
    expect(beautifiedJs).toContain("document.documentElement.dataset.staticFixture");
    expect(await readFile(join(result.haulPath, "study", "sourcemaps", "127.0.0.1", "app.js.map"), "utf8")).toContain(
      '"version": 3'
    );
    expect(await readFile(join(result.haulPath, "context.md"), "utf8")).toContain("# Captured site: 127.0.0.1");
  });

  it("writes only navigable artifacts when Study mode is not selected", async () => {
    const fixture = await startFixture("static");
    fixtures.push(fixture);
    const outDir = await tempRoot();

    const result = await captureSite({
      entrypoint: `${fixture.origin}/`,
      outDir,
      modes: ["navigable"],
      depth: 0,
      eventSink: () => undefined,
      logSink: () => undefined
    });

    const manifest = JSON.parse(await readFile(join(result.haulPath, "MANIFEST.json"), "utf8"));
    expect(validateManifest(manifest).valid).toBe(true);
    expect(manifest.pages[0].navigablePath).toBe("navigable/index.html");
    expect(manifest.pages[0].renderedPath).toBeUndefined();
    await expect(stat(join(result.haulPath, "navigable", "index.html"))).resolves.toBeTruthy();
    await expect(stat(join(result.haulPath, "navigable", "_assets", "127.0.0.1", "app.js"))).resolves.toBeTruthy();
    await expect(stat(join(result.haulPath, "study"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(result.haulPath, "context.md"))).rejects.toMatchObject({ code: "ENOENT" });
  }, 15000);

  it("detects stacks and records context for SPA and WordPress fixtures", async () => {
    const spa = await startFixture("spa");
    const wordpress = await startFixture("wordpress");
    fixtures.push(spa, wordpress);
    const outDir = await tempRoot();

    const spaResult = await captureSite({
      entrypoint: `${spa.origin}/`,
      outDir,
      modes: ["study"],
      depth: 0,
      eventSink: () => undefined,
      logSink: () => undefined
    });
    const wordpressResult = await captureSite({
      entrypoint: `${wordpress.origin}/`,
      outDir,
      modes: ["study"],
      depth: 0,
      eventSink: () => undefined,
      logSink: () => undefined
    });

    const spaManifest = JSON.parse(await readFile(join(spaResult.haulPath, "MANIFEST.json"), "utf8"));
    const wordpressManifest = JSON.parse(await readFile(join(wordpressResult.haulPath, "MANIFEST.json"), "utf8"));
    expect(spaManifest.stack.primary).toBe("Next.js");
    expect(wordpressManifest.stack.primary).toBe("WordPress");
    expect(await readFile(join(wordpressResult.haulPath, "context.md"), "utf8")).toContain("WordPress");
  });

  it("skips blocked navigation links during depth-one crawling", async () => {
    const fixture = await startFixture("auth");
    fixtures.push(fixture);
    const outDir = await tempRoot();
    const stdout: unknown[] = [];

    const result = await captureSite({
      entrypoint: `${fixture.origin}/`,
      outDir,
      modes: ["study"],
      depth: 1,
      eventSink: (event) => stdout.push(event),
      logSink: () => undefined
    });

    const manifest = JSON.parse(await readFile(join(result.haulPath, "MANIFEST.json"), "utf8"));
    expect(validateManifest(manifest).valid).toBe(true);
    expect(manifest.safety.skippedUrls).toContainEqual({ url: `${fixture.origin}/logout`, reason: "blocked_pattern" });
    expect(stdout).toContainEqual(expect.objectContaining({ type: "skip", url: `${fixture.origin}/logout`, reason: "blocked_pattern" }));
    expect(manifest.pages.map((page: { url: string }) => page.url)).not.toContain(`${fixture.origin}/logout`);
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
