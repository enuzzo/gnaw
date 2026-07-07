import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page, type Request } from "playwright-core";
import { classifyKind } from "../assets/classifyKind.js";
import { writeAsset, type WriteAssetResult } from "../assets/writeAsset.js";
import { createProfileStore, ProfileLockedError, ProfileNotFoundError, type ProfileLock } from "../auth/profiles.js";
import { resolveBrowser } from "../browser/resolveBrowser.js";
import { createPathNormalizer } from "../paths/normalizePath.js";
import { writeRenderedSnapshot } from "../render/renderedSnapshot.js";
import { createRedactor, type Redactor } from "../redaction/redact.js";
import { isBlockedNavigationUrl } from "../safety/blocklist.js";
import { detectStack, type DetectedStack } from "../stack/detectStack.js";
import {
  writeBeautifiedAsset,
  writeContextMarkdown,
  writeNavigablePages,
  writeSourceMapIfPresent
} from "../study/outputs.js";
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
  blockPatterns?: string[];
  profileName?: string;
  profileRoot?: string;
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
  const redactor = createRedactor();
  const pageHtml = new Map<string, string>();
  const responseHeaders: Record<string, string> = {};
  const requestIds = new WeakMap<Request, string>();
  const responseTasks: Array<Promise<void>> = [];
  const seenPageUrls = new Set<string>();
  let requestCounter = 0;
  let totalBytes = 0;
  let result: "complete" | "partial" | "canceled" = "complete";
  let canceled = options.signal?.aborted ?? false;
  let finalized = false;
  let guardrailStopped = false;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let profileLock: ProfileLock | undefined;
  let storageStateUsed = false;
  let manifestBrowser = "unknown";
  let stack: DetectedStack = { primary: null, detected: [] };
  const wantsStudy = options.modes.includes("study");
  const wantsNavigable = options.modes.includes("navigable");
  const captureConfig = defaultCaptureConfig({
    depth: options.depth ?? 1,
    maxPages: options.maxPages ?? 200,
    maxTotalBytes: options.maxTotalBytes ?? 2147483648,
    maxAssetBytes: options.maxAssetBytes ?? 104857600,
    authProfile: options.profileName ?? null
  });
  options.signal?.addEventListener("abort", () => {
    canceled = true;
    result = "canceled";
  });

  await mkdir(haulPath, { recursive: true });
  await writeFile(join(haulPath, "waterfall.ndjson"), "", "utf8");

  const log = (line: string) => {
    const redactedLine = redactor.redactText(line);
    logLines.push(redactedLine);
    options.logSink(redactedLine);
  };

  const emit = (event: { v: 2; type: string; [key: string]: unknown }) => {
    options.eventSink(redactor.redactObject(event));
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
    const auth = options.profileName
      ? {
        mode: "profile" as const,
        profileName: options.profileName,
        storageStateUsed,
        redacted: true as const
      }
      : undefined;
    const manifest = redactor.redactObject(buildManifest({
      entrypoint: options.entrypoint,
      host,
      startedAt: new Date(started).toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - started,
      result: effectiveResult,
      modes: options.modes,
      config: captureConfig,
      browser: manifestBrowser,
      stack,
      auth,
      pages,
      assets,
      skippedUrls,
      errors
    }));
    await writeFile(join(haulPath, "gnaw.log"), logLines.length === 0 ? "" : `${logLines.join("\n")}\n`, "utf8");
    await writeFile(join(haulPath, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    emit({
      v: 2,
      type: "done",
      result: effectiveResult,
      summary: manifest.stats,
      haulPath
    });
  };

  try {
    emit({ v: 2, type: "hello", engine: { name: engineIdentity.name, version: engineIdentity.version }, contract: engineIdentity.contract });
    const browserInfo = resolveBrowser();
    manifestBrowser = browserInfo.label;
    emit({ v: 2, type: "browser", status: "found", detail: browserInfo.label });
    emit({
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
      emit({ v: 2, type: "skip", url: options.entrypoint, reason: "max_pages" });
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

    if (options.profileName) {
      const profileStore = createProfileStore({ root: options.profileRoot });
      await profileStore.readMetadata(options.profileName);
      profileLock = await profileStore.acquireLock(options.profileName);
      const profileDir = await profileStore.ensureProfileDir(options.profileName);
      context = await chromium.launchPersistentContext(profileDir, {
        executablePath: browserInfo.executablePath,
        headless: true,
        args: ["--no-sandbox"],
        userAgent: captureConfig.userAgent
      });
      storageStateUsed = true;
      manifestBrowser = `${browserInfo.label} ${context.browser()?.version() ?? "unknown"}`;
      await addContextSecrets(context, options.entrypoint, redactor);
    } else {
      browser = await chromium.launch({
        executablePath: browserInfo.executablePath,
        headless: true,
        args: ["--no-sandbox"]
      });
      manifestBrowser = `${browserInfo.label} ${browser.version()}`;
      context = await browser.newContext({ userAgent: captureConfig.userAgent });
    }
    const page = await context.newPage();
    let activePageUrl = options.entrypoint;

    page.on("request", (request) => {
      if (request.method() !== "GET") {
        return;
      }
      const id = `r-${String(++requestCounter).padStart(4, "0")}`;
      requestIds.set(request, id);
      emit({ v: 2, type: "request", id, url: request.url(), method: request.method() });
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
        const headers = response.headers();
        Object.assign(responseHeaders, headers);
        const contentType = headers["content-type"] ?? "application/octet-stream";
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
          emit({
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
          emit({
            v: 2,
            type: "warning",
            id,
            code: "asset_too_large",
            url,
            message: `Skipped ${body.byteLength} byte asset`
          });
          return;
        }

        const redactedBody = redactor.redactBuffer(body, contentType);
        totalBytes += redactedBody.byteLength;
        const normalizedAssetPath = normalizer.normalizeAsset(url, contentType).relativePath;
        const studyWrite = wantsStudy
          ? await writeAsset({
            outputRoot: haulPath,
            url,
            contentType,
            body: redactedBody,
            rootPrefix: "study/raw",
            normalizedPath: normalizedAssetPath
          })
          : undefined;
        const navigableWrite = wantsNavigable
          ? await writeAsset({
            outputRoot: haulPath,
            url,
            contentType,
            body: redactedBody,
            rootPrefix: "navigable/_assets",
            normalizedPath: normalizedAssetPath
          })
          : undefined;
        const write = studyWrite ?? navigableWrite;
        if (!write) {
          throw new Error("No output mode selected for asset write");
        }
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
        asset.navigablePath = navigableWrite?.rawPath;
        if (wantsStudy && studyWrite) {
          asset.beautifiedPath = await writeBeautifiedAsset({ haulPath, asset, body: redactedBody, redactText: redactor.redactText });
          asset.sourceMapPath = await writeSourceMapIfPresent({
            haulPath,
            assetUrl: url,
            rawPath: asset.rawPath,
            body: redactedBody,
            normalizeSourceMapPath: (sourceMapUrl) => normalizer.normalizeAsset(sourceMapUrl, "application/json").relativePath,
            redactText: redactor.redactText
          });
        }
        assets.push(asset);
        await appendWaterfallRow(haulPath, {
          t: requestStarted - started,
          url: redactor.redactText(url),
          method: "GET",
          status: response.status(),
          kind,
          contentType,
          bytes: redactedBody.byteLength,
          durationMs: Date.now() - requestStarted,
          fromCache: false,
          viaJs: asset.viaJs,
          referrer: asset.referrer ? redactor.redactText(asset.referrer) : null,
          page: redactor.redactText(activePageUrl)
        });
        emit({
          v: 2,
          type: "asset",
          id,
          url,
          kind,
          bytes: redactedBody.byteLength,
          status: response.status(),
          fromCache: false,
          viaJs: asset.viaJs,
          rawPath: asset.rawPath
        });
      })().catch((error: unknown) => {
        setPartial();
        const record = toCaptureError(error, response.url(), false);
        errors.push(record);
        emit({ v: 2, type: "error", ...record });
        log(`Capture warning: ${record.message}`);
      });
      responseTasks.push(task);
    });

    const queue: Array<{ url: string; depth: number; discoveredFrom: string | null }> = [
      { url: options.entrypoint, depth: 0, discoveredFrom: null }
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (seenPageUrls.has(current.url)) {
        continue;
      }
      if (seenPageUrls.size >= captureConfig.maxPages) {
        setPartial();
        skippedUrls.push({ url: current.url, reason: "max_pages" });
        emit({ v: 2, type: "skip", url: current.url, reason: "max_pages" });
        continue;
      }
      await options.control?.waitIfPaused();
      if (options.signal?.aborted) {
        canceled = true;
        result = "canceled";
        break;
      }

      activePageUrl = current.url;
      seenPageUrls.add(current.url);
      emit({ v: 2, type: "page_start", url: current.url, depth: current.depth });
      const response = await page.goto(current.url, { waitUntil: "load" });
      await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => undefined);
      await Promise.allSettled(responseTasks);
      await addPageStorageSecrets(page, redactor);
      const rawHtml = await page.content();
      const html = redactor.redactText(rawHtml);
      const renderedPath = wantsStudy ? `study/rendered/${normalizer.normalizeRendered(current.url).relativePath}` : undefined;
      if (renderedPath) {
        await writeRenderedSnapshot({ haulPath, renderedPath, html });
      }
      pageHtml.set(current.url, html);

      pages.push({
        url: current.url,
        title: extractTitle(html),
        depth: current.depth,
        status: response?.status() ?? 0,
        discoveredFrom: current.discoveredFrom,
        ...(renderedPath ? { renderedPath } : {})
      });

      emit({ v: 2, type: "page_done", url: current.url, title: pages[pages.length - 1].title, assets: assets.length });
      emit({ v: 2, type: "progress", pages: pages.length, assets: assets.length, bytes: totalBytes, queued: queue.length, elapsedMs: Date.now() - started });

      if (current.depth < captureConfig.depth) {
        for (const link of extractNavigationLinks(rawHtml, current.url)) {
          if (seenPageUrls.has(link) || queue.some((queued) => queued.url === link)) {
            continue;
          }
          if (new URL(link).hostname.toLowerCase() !== host) {
            skippedUrls.push({ url: link, reason: "out_of_scope" });
            emit({ v: 2, type: "skip", url: link, reason: "out_of_scope" });
            continue;
          }
          if (isBlockedNavigationUrl(link, options.blockPatterns)) {
            skippedUrls.push({ url: link, reason: "blocked_pattern" });
            emit({ v: 2, type: "skip", url: link, reason: "blocked_pattern" });
            continue;
          }
          queue.push({ url: link, depth: current.depth + 1, discoveredFrom: current.url });
        }
      }
    }

    stack = detectStack({
      html: [...pageHtml.values()].join("\n"),
      assetUrls: assets.map((asset) => asset.url),
      headers: responseHeaders
    });
    if (stack.primary !== null) {
      emit({ v: 2, type: "stack", primary: stack.primary, detected: stack.detected });
    }

    if (canceled) {
      result = "canceled";
    }
    if (options.modes.includes("navigable")) {
      await writeNavigablePages({ haulPath, pages, pageHtml, assets, redactText: redactor.redactText });
    }
    if (options.modes.includes("study")) {
      const previewManifest = redactor.redactObject(buildManifest({
        entrypoint: options.entrypoint,
        host,
        startedAt: new Date(started).toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        result,
        modes: options.modes,
        config: captureConfig,
        browser: manifestBrowser,
        stack,
        auth: options.profileName
          ? {
            mode: "profile",
            profileName: options.profileName,
            storageStateUsed,
            redacted: true
          }
          : undefined,
        pages,
        assets,
        skippedUrls,
        errors
      }));
      await writeContextMarkdown(haulPath, previewManifest);
    }
    log(captureResultLog(result));
    await context.close();
    context = undefined;
    await browser?.close();
    browser = undefined;
    await profileLock?.release();
    profileLock = undefined;
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
    emit({ v: 2, type: "error", ...record });
    log(`Capture failed: ${record.message}`);
    await Promise.allSettled(responseTasks);
    await finalize("partial");
  } finally {
    if (context) {
      await context.close().catch(() => undefined);
    }
    if (browser) {
      await browser.close().catch(() => undefined);
    }
    if (profileLock) {
      await profileLock.release().catch(() => undefined);
    }
  }

  return { haulPath };
}

function toCaptureError(error: unknown, url: string, fatal: boolean): { code: string; url: string; message: string; fatal: boolean } {
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: classifyErrorCode(message, error),
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

function classifyErrorCode(message: string, error?: unknown): string {
  if (error instanceof ProfileLockedError || (typeof error === "object" && error !== null && "code" in error && error.code === "profile_locked")) {
    return "profile_locked";
  }
  if (error instanceof ProfileNotFoundError || (typeof error === "object" && error !== null && "code" in error && error.code === "profile_not_found")) {
    return "profile_not_found";
  }
  if (message.includes("ERR_NAME_NOT_RESOLVED")) return "dns";
  if (message.includes("ERR_CERT") || message.includes("SSL") || message.includes("TLS")) return "tls";
  if (message.includes("HTTP")) return "http_error";
  if (message.includes("write") || message.includes("EACCES") || message.includes("ENOENT")) return "write_failed";
  if (message.includes("Target page") || message.includes("browser")) return "browser_crash";
  return "nav_timeout";
}

async function addContextSecrets(context: BrowserContext, entrypoint: string, redactor: Redactor): Promise<void> {
  const cookies = await context.cookies(entrypoint).catch(() => []);
  for (const cookie of cookies) {
    redactor.addSecret(cookie.value);
  }

  const page = await context.newPage();
  try {
    await page.goto(new URL(entrypoint).origin, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    await addPageStorageSecrets(page, redactor);
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function addPageStorageSecrets(page: Page, redactor: Redactor): Promise<void> {
  const values = await page.evaluate(() => {
    const storageValues: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key) {
        const value = localStorage.getItem(key);
        if (value) storageValues.push(value);
      }
    }
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (key) {
        const value = sessionStorage.getItem(key);
        if (value) storageValues.push(value);
      }
    }
    for (const cookie of document.cookie.split(";")) {
      const value = cookie.split("=").slice(1).join("=").trim();
      if (value) storageValues.push(decodeURIComponent(value));
    }
    return storageValues;
  }).catch(() => []);

  for (const value of values) {
    redactor.addSecret(value);
  }
}

function extractNavigationLinks(html: string, baseUrl: string): string[] {
  const links = new Set<string>();
  const anchorPattern = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match = anchorPattern.exec(html);
  while (match) {
    const href = match[1];
    if (!href.startsWith("#") && !href.startsWith("mailto:") && !href.startsWith("tel:")) {
      links.add(new URL(href, baseUrl).href);
    }
    match = anchorPattern.exec(html);
  }
  return [...links];
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
