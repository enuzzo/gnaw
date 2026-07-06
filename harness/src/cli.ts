import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import {
  validateManifest,
  validateWaterfallRow
} from "./contract/validate";

export type HaulValidationSummary = {
  manifests: number;
  waterfallRows: number;
};

export type HaulGoldenSummary = {
  files: string[];
  fileHashes: Record<string, string>;
  manifest: {
    result: string;
    modes: string[];
    stats: {
      pages: number;
      assets: number;
      byKind: unknown;
    };
    safety: {
      skippedUrls: unknown[];
    };
    errors: unknown[];
    stack: unknown;
    pages: Array<{
      urlPath: string;
      title: string;
      depth: number;
      status: number;
      renderedPath?: string;
      navigablePath?: string;
    }>;
    assets: Array<{
      urlPath: string;
      kind: string;
      status: number;
      contentType: string;
      bytes: number;
      sha256: string;
      rawPath: string;
      navigablePath?: string;
      beautifiedPath?: string;
      sourceMapPath?: string;
      referrerPath: string | null;
      viaJs: boolean;
      fromCache: boolean;
    }>;
  };
  waterfall: {
    rowCount: number;
    rows: Array<{
      urlPath: string;
      method: string;
      status: number;
      kind: string;
      contentType: string;
      bytes: number;
      fromCache: boolean;
      viaJs: boolean;
      referrerPath: string | null;
      pagePath: string;
    }>;
  };
  rendered: Array<{
    path: string;
    title: string | null;
    markers: string[];
  }>;
};

export async function validateHaul(haulPath: string): Promise<HaulValidationSummary> {
  const manifest = JSON.parse(await readFile(join(haulPath, "MANIFEST.json"), "utf8"));
  const manifestResult = validateManifest(manifest);
  if (!manifestResult.valid) {
    throw new Error(`Invalid MANIFEST.json: ${JSON.stringify(manifestResult.errors)}`);
  }

  const waterfallRaw = await readFile(join(haulPath, "waterfall.ndjson"), "utf8");
  const rows = waterfallRaw.trim().length === 0 ? [] : waterfallRaw.trim().split("\n").map((line) => JSON.parse(line));

  for (const row of rows) {
    const rowResult = validateWaterfallRow(row);
    if (!rowResult.valid) {
      throw new Error(`Invalid waterfall row: ${JSON.stringify(rowResult.errors)}`);
    }
  }

  return {
    manifests: 1,
    waterfallRows: rows.length
  };
}

export async function summarizeHaulForGolden(haulPath: string): Promise<HaulGoldenSummary> {
  const manifest = JSON.parse(await readFile(join(haulPath, "MANIFEST.json"), "utf8"));
  const waterfallRows = await readWaterfallRows(haulPath);
  const files = await listFiles(haulPath);
  const rendered = await Promise.all(
    manifest.pages.map(async (page: { renderedPath: string }) => {
      const html = await readFile(join(haulPath, page.renderedPath), "utf8");
      return {
        path: page.renderedPath,
        title: extractTitle(html),
        markers: extractKnownMarkers(html)
      };
    })
  );

  return {
    files,
    fileHashes: await hashDeterministicFiles(haulPath, files),
    manifest: {
      result: manifest.result,
      modes: [...manifest.modes].sort(),
      stats: {
        pages: manifest.stats.pages,
        assets: manifest.stats.assets,
        byKind: manifest.stats.byKind
      },
      safety: {
        skippedUrls: manifest.safety.skippedUrls
      },
      errors: manifest.errors ?? [],
      stack: manifest.stack,
      pages: manifest.pages.map((page: {
        url: string;
        title: string;
        depth: number;
        status: number;
        renderedPath?: string;
        navigablePath?: string;
      }) => ({
        urlPath: urlPath(page.url),
        title: page.title,
        depth: page.depth,
        status: page.status,
        ...(page.renderedPath ? { renderedPath: page.renderedPath } : {}),
        ...(page.navigablePath ? { navigablePath: page.navigablePath } : {})
      })).sort((a: { urlPath: string }, b: { urlPath: string }) => a.urlPath.localeCompare(b.urlPath)),
      assets: manifest.assets.map((asset: {
        url: string;
        kind: string;
        status: number;
        contentType: string;
        bytes: number;
        sha256: string;
        rawPath: string;
        navigablePath?: string;
        beautifiedPath?: string;
        sourceMapPath?: string;
        referrer: string | null;
        viaJs: boolean;
        fromCache: boolean;
      }) => ({
        urlPath: urlPath(asset.url),
        kind: asset.kind,
        status: asset.status,
        contentType: asset.contentType,
        bytes: asset.bytes,
        sha256: asset.sha256,
        rawPath: asset.rawPath,
        ...(asset.navigablePath ? { navigablePath: asset.navigablePath } : {}),
        ...(asset.beautifiedPath ? { beautifiedPath: asset.beautifiedPath } : {}),
        ...(asset.sourceMapPath ? { sourceMapPath: asset.sourceMapPath } : {}),
        referrerPath: nullableUrlPath(asset.referrer),
        viaJs: asset.viaJs,
        fromCache: asset.fromCache
      })).sort((a: { rawPath: string }, b: { rawPath: string }) => a.rawPath.localeCompare(b.rawPath))
    },
    waterfall: {
      rowCount: waterfallRows.length,
      rows: waterfallRows.map((row) => ({
        urlPath: urlPath(row.url),
        method: row.method,
        status: row.status,
        kind: row.kind,
        contentType: row.contentType,
        bytes: row.bytes,
        fromCache: row.fromCache,
        viaJs: row.viaJs,
        referrerPath: nullableUrlPath(row.referrer),
        pagePath: urlPath(row.page)
      })).sort((a, b) => a.urlPath.localeCompare(b.urlPath))
    },
    rendered
  };
}

type WaterfallGoldenRow = {
  url: string;
  method: string;
  status: number;
  kind: string;
  contentType: string;
  bytes: number;
  fromCache: boolean;
  viaJs: boolean;
  referrer: string | null;
  page: string;
};

async function readWaterfallRows(haulPath: string): Promise<WaterfallGoldenRow[]> {
  const waterfallRaw = await readFile(join(haulPath, "waterfall.ndjson"), "utf8");
  return waterfallRaw.trim().length === 0 ? [] : waterfallRaw.trim().split("\n").map((line) => JSON.parse(line));
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  await walk(root, root, files);
  return files.sort();
}

async function hashDeterministicFiles(haulPath: string, files: string[]): Promise<Record<string, string>> {
  const deterministicFiles = files.filter((file) =>
    file === "context.md" ||
    file.startsWith("navigable/") ||
    file.startsWith("study/raw/") ||
    file.startsWith("study/rendered/") ||
    file.startsWith("study/beautified/") ||
    file.startsWith("study/sourcemaps/")
  );
  const entries = await Promise.all(
    deterministicFiles.map(async (file) => [file, sha256(await readFile(join(haulPath, file)))] as const)
  );
  return Object.fromEntries(entries);
}

async function walk(root: string, path: string, files: string[]): Promise<void> {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      await walk(root, child, files);
      continue;
    }
    files.push(relative(root, child).split(sep).join("/"));
  }
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title>([^<]*)<\/title>/i);
  return match?.[1] ?? null;
}

function extractKnownMarkers(html: string): string[] {
  return ["data-static-fixture=\"ready\""].filter((marker) => html.includes(marker));
}

function urlPath(value: string): string {
  const parsed = new URL(value);
  return `${parsed.pathname}${parsed.search}`;
}

function nullableUrlPath(value: string | null): string | null {
  return value === null ? null : urlPath(value);
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
