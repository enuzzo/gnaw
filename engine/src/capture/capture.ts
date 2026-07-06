import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type Request } from "playwright-core";
import { classifyKind } from "../assets/classifyKind.js";
import { writeAsset, type WriteAssetResult } from "../assets/writeAsset.js";
import { resolveBrowser } from "../browser/resolveBrowser.js";
import { createPathNormalizer } from "../paths/normalizePath.js";
import { writeRenderedSnapshot } from "../render/renderedSnapshot.js";
import { engineIdentity } from "../identity.js";
import { appendWaterfallRow, type WaterfallRow } from "./waterfall.js";
import {
  buildManifest,
  defaultCaptureConfig,
  type CaptureMode,
  type ManifestAsset,
  type ManifestPage
} from "./manifest.js";

export type CaptureEventSink = (event: { v: 2; type: string; [key: string]: unknown }) => void;
export type CaptureLogSink = (line: string) => void;

export type CaptureOptions = {
  entrypoint: string;
  outDir: string;
  modes: CaptureMode[];
  depth?: number;
  signal?: AbortSignal;
  control?: {
    waitIfPaused(): Promise<void>;
  };
  maxPages?: number;
  maxTotalBytes?: number;
  maxAssetBytes?: number;
  eventSink: CaptureEventSink;
  logSink: CaptureLogSink;
};

export type CaptureResult = {
  haulPath: string;
};

export async function captureSite(options: CaptureOptions): Promise<CaptureResult> {
  const started = Date.now();
  const entrypoint = new URL(options.entrypoint);
  const host = entrypoint.hostname.toLowerCase();
  const haulPath = join(options.outDir, `haul-${host}-${formatHaulTimestamp(new Date(started))}`);
  const normalizer = createPathNormalizer();
  const pages: ManifestPage[] = [];
  const assets: ManifestAsset[] = [];
  const skippedUrls: Array<{ url: string; reason: string }> = [];
  const errors: Array<{ code: string; url?: string; message: string; fatal?: boolean }> = [];
  const logLines: string[] = [];
  const requestIds = new WeakMap<Request, string>();
  const responseTasks: Array<Promise<void>> = [];
  let requestCounter = 0;
  let totalBytes = 0;
  let result: "complete" | "partial" | "canceled" = "complete";
  let canceled = options.signal?.aborted ?? false;
  let finalized = false;
  let guardrailStopped = false;
  let browser: Browser | undefined;
  let manifestBrowser = "unknown";
  const captureConfig = defaultCaptureConfig({
    depth: options.depth ?? 1,
    maxPages: options.maxPages ?? 200,
    maxTotalBytes: options.maxTotalBytes ?? 2147483648,
    maxAssetBytes: options.maxAssetBytes ?? 104857600
  });
  options.signal?.addEventListener("abort", () => {
    canceled = true;
    result = "canceled";
  });

  await mkdir(haulPath, { recursive: true });
  await writeFile(join(haulPath, "waterfall.ndjson"), "", "utf8");

  const log = (line: string) => {
    logLines.push(line);
    options.logSink(line);
  };

  const setPartial = () => {
    if (result !== "canceled") {
      result = "partial";
    }
  };

  const finalize = async (finalResult: "complete" | "partial" | "canceled" = result) => {
    if (finalized) {
      return;
    }
    finalized = true;
    const effectiveResult = canceled ? "canceled" : finalResult;
    const finishedAt = new Date();
    const manifest = buildManifest({
      entrypoint: options.entrypoint,
      host,
      startedAt: new Date(started).toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - started,
      result: effectiveResult,
      modes: options.modes,
      config: captureConfig,
      browser: manifestBrowser,
      pages,
      assets,
      skippedUrls,
      errors
    });
    await writeFile(join(haulPath, "gnaw.log"), logLines.length === 0 ? "" : `${logLines.join("\n")}\n`, "utf8");
    await writeFile(join(haulPath, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    options.eventSink({
      v: 2,
      type: "done",
      result: effectiveResult,
      summary: manifest.stats,
      haulPath
    });
  };

  try {
    options.eventSink({ v: 2, type: "hello", engine: { name: engineIdentity.name, version: engineIdentity.version }, contract: engineIdentity.contract });
    const browserInfo = resolveBrowser();
    manifestBrowser = browserInfo.label;
    options.eventSink({ v: 2, type: "browser", status: "found", detail: browserInfo.label });
    options.eventSink({
      v: 2,
      type: "start",
      jobId: "j-fixture",
      entrypoint: options.entrypoint,
      modes: options.modes,
      config: captureConfig,
      haulPath
    });

    if (options.signal?.aborted) {
      canceled = true;
      result = "canceled";
      log("Capture canceled");
      await finalize("canceled");
      return { haulPath };
    }

    if (captureConfig.maxPages <= 0) {
      setPartial();
      skippedUrls.push({ url: options.entrypoint, reason: "max_pages" });
      options.eventSink({ v: 2, type: "skip", url: options.entrypoint, reason: "max_pages" });
      log("Capture partial: max pages reached");
      await finalize("partial");
      return { haulPath };
    }

    await options.control?.waitIfPaused();
    if (options.signal?.aborted) {
      canceled = true;
      result = "canceled";
      log("Capture canceled");
      await finalize("canceled");
      return { haulPath };
    }

    options.eventSink({ v: 2, type: "page_start", url: options.entrypoint, depth: 0 });

    browser = await chromium.launch({
      executablePath: browserInfo.executablePath,
      headless: true,
      args: ["--no-sandbox"]
    });
    manifestBrowser = `${browserInfo.label} ${browser.version()}`;
    const context = await browser.newContext({ userAgent: captureConfig.userAgent });
    const page = await context.newPage();

    page.on("request", (request) => {
      if (request.method() !== "GET") {
        return;
      }
      const id = `r-${String(++requestCounter).padStart(4, "0")}`;
      requestIds.set(request, id);
      options.eventSink({ v: 2, type: "request", id, url: request.url(), method: request.method() });
    });

    page.on("response", (response) => {
      const task = (async () => {
        const request = response.request();
        if (request.method() !== "GET") {
          return;
        }
        const id = requestIds.get(request) ?? `r-${String(++requestCounter).padStart(4, "0")}`;
        const requestStarted = Date.now();
        const url = response.url();
        const contentType = response.headers()["content-type"] ?? "application/octet-stream";
        const body = await response.body().catch(() => Buffer.alloc(0));
        const kind = classifyKind(url, contentType);
        const maxAssetBytes = captureConfig.maxAssetBytes;
        const maxTotalBytes = captureConfig.maxTotalBytes;

        await options.control?.waitIfPaused();
        if (options.signal?.aborted) {
          return;
        }

        if (guardrailStopped || totalBytes + body.byteLength > maxTotalBytes) {
          guardrailStopped = true;
          setPartial();
          options.eventSink({
            v: 2,
            type: "warning",
            id,
            code: "max_total_bytes",
            url,
            message: `Skipped asset after ${maxTotalBytes} byte total limit`
          });
          return;
        }

        if (body.byteLength > maxAssetBytes) {
          setPartial();
          options.eventSink({
            v: 2,
            type: "warning",
            id,
            code: "asset_too_large",
            url,
            message: `Skipped ${body.byteLength} byte asset`
          });
          return;
        }

        totalBytes += body.byteLength;
        const write = await writeAsset({
          outputRoot: haulPath,
          url,
          contentType,
          body,
          normalizedPath: normalizer.normalizeAsset(url, contentType).relativePath
        });
        const asset = toManifestAsset({
          url,
          kind,
          status: response.status(),
          contentType,
          write,
          referrer: request.headers()["referer"] ?? null,
          viaJs: request.resourceType() === "xhr" || request.resourceType() === "fetch",
          fromCache: false
        });
        assets.push(asset);
        await appendWaterfallRow(haulPath, {
          t: requestStarted - started,
          url,
          method: "GET",
          status: response.status(),
          kind,
          contentType,
          bytes: body.byteLength,
          durationMs: Date.now() - requestStarted,
          fromCache: false,
          viaJs: asset.viaJs,
          referrer: asset.referrer,
          page: options.entrypoint
        });
        options.eventSink({
          v: 2,
          type: "asset",
          id,
          url,
          kind,
          bytes: body.byteLength,
          status: response.status(),
          fromCache: false,
          viaJs: asset.viaJs,
          rawPath: asset.rawPath
        });
      })().catch((error: unknown) => {
        setPartial();
        const record = toCaptureError(error, response.url(), false);
        errors.push(record);
        options.eventSink({ v: 2, type: "error", ...record });
        log(`Capture warning: ${record.message}`);
      });
      responseTasks.push(task);
    });

    const response = await page.goto(options.entrypoint, { waitUntil: "load" });
    await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => undefined);
    await Promise.allSettled(responseTasks);
    const html = await page.content();
    const renderedPath = `study/rendered/${normalizer.normalizeRendered(options.entrypoint).relativePath}`;
    await writeRenderedSnapshot({ haulPath, renderedPath, html });

    pages.push({
      url: options.entrypoint,
      title: extractTitle(html),
      depth: 0,
      status: response?.status() ?? 0,
      discoveredFrom: null,
      renderedPath
    });

    if (canceled) {
      result = "canceled";
    }
    options.eventSink({ v: 2, type: "page_done", url: options.entrypoint, title: pages[0].title, assets: assets.length });
    options.eventSink({ v: 2, type: "progress", pages: pages.length, assets: assets.length, bytes: totalBytes, queued: 0, elapsedMs: Date.now() - started });
    log(captureResultLog(result));
    await browser.close();
    browser = undefined;
    await finalize(result);
  } catch (error) {
    if (options.signal?.aborted || canceled) {
      canceled = true;
      result = "canceled";
      log("Capture canceled");
      await Promise.allSettled(responseTasks);
      await finalize("canceled");
      return { haulPath };
    }

    setPartial();
    const record = toCaptureError(error, options.entrypoint, true);
    errors.push(record);
    options.eventSink({ v: 2, type: "error", ...record });
    log(`Capture failed: ${record.message}`);
    await Promise.allSettled(responseTasks);
    await finalize("partial");
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }

  return { haulPath };
}

function toCaptureError(error: unknown, url: string, fatal: boolean): { code: string; url: string; message: string; fatal: boolean } {
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: classifyErrorCode(message),
    url,
    message,
    fatal
  };
}

function captureResultLog(result: "complete" | "partial" | "canceled"): string {
  if (result === "canceled") return "Capture canceled";
  if (result === "partial") return "Capture partial";
  return "Capture complete";
}

function classifyErrorCode(message: string): string {
  if (message.includes("ERR_NAME_NOT_RESOLVED")) return "dns";
  if (message.includes("ERR_CERT") || message.includes("SSL") || message.includes("TLS")) return "tls";
  if (message.includes("HTTP")) return "http_error";
  if (message.includes("write") || message.includes("EACCES") || message.includes("ENOENT")) return "write_failed";
  if (message.includes("Target page") || message.includes("browser")) return "browser_crash";
  return "nav_timeout";
}

function toManifestAsset(input: {
  url: string;
  kind: ManifestAsset["kind"];
  status: number;
  contentType: string;
  write: WriteAssetResult;
  referrer: string | null;
  viaJs: boolean;
  fromCache: boolean;
}): ManifestAsset {
  return {
    url: input.url,
    kind: input.kind,
    status: input.status,
    contentType: input.contentType,
    bytes: input.write.bytes,
    sha256: input.write.sha256,
    rawPath: input.write.rawPath,
    referrer: input.referrer,
    viaJs: input.viaJs,
    fromCache: input.fromCache
  };
}

function extractTitle(html: string): string {
  return html.match(/<title>(.*?)<\/title>/i)?.[1] ?? "";
}


function formatHaulTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}
