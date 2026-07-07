import { createHash } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, posix, relative, resolve, sep } from "node:path";
import prettier from "prettier";
import type { Manifest, ManifestAsset, ManifestPage } from "../capture/manifest.js";

export async function writeBeautifiedAsset({
  haulPath,
  asset,
  body,
  redactText = (value: string) => value
}: {
  haulPath: string;
  asset: Pick<ManifestAsset, "kind" | "rawPath">;
  body: Buffer;
  redactText?: (value: string) => string;
}): Promise<string | undefined> {
  if (asset.kind !== "JS" && asset.kind !== "CSS") {
    return undefined;
  }

  const parser = asset.kind === "JS" ? "babel" : "css";
  const source = body.toString("utf8");
  const formatted = await prettier.format(source, { parser }).catch(() => source);
  const path = asset.rawPath.replace(/^study\/raw\//, "study/beautified/");
  await writeTextInsideHaul(haulPath, path, redactText(formatted));
  return path;
}

export async function writeSourceMapIfPresent({
  haulPath,
  assetUrl,
  rawPath,
  body,
  normalizeSourceMapPath,
  redactText = (value: string) => value,
  fetchText = fetchTextUrl
}: {
  haulPath: string;
  assetUrl: string;
  rawPath: string;
  body: Buffer;
  normalizeSourceMapPath(url: string): string;
  redactText?: (value: string) => string;
  fetchText?: (url: string) => Promise<string | null>;
}): Promise<string | undefined> {
  const sourceMapUrl = findSourceMapUrl(body.toString("utf8"), assetUrl);
  if (!sourceMapUrl) {
    return undefined;
  }

  const text = await fetchText(sourceMapUrl);
  if (text === null) {
    return undefined;
  }

  const sourceMapPath = `study/sourcemaps/${normalizeSourceMapPath(sourceMapUrl)}`;
  const redactedText = redactText(text);
  await writeTextInsideHaul(haulPath, sourceMapPath, redactedText.endsWith("\n") ? redactedText : `${redactedText}\n`);
  return sourceMapPath;
}

export async function writeContextMarkdown(haulPath: string, manifest: Manifest): Promise<void> {
  const stack = manifest.stack.detected.length === 0
    ? "None detected."
    : manifest.stack.detected
      .map((item) => `${item.name} (confidence ${item.confidence}). Signals: ${item.signals.join(", ")}.`)
      .join("\n");
  const pages = manifest.pages
    .map((page) => `- ${urlPath(page.url)} "${page.title}" (rendered: ${page.renderedPath ?? "none"})`)
    .join("\n");
  const assetsByKind = Object.entries(manifest.stats.byKind)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${kind}: ${count}`)
    .join(", ");
  const keyBundles = manifest.assets
    .filter((asset) => asset.kind === "JS" && asset.beautifiedPath)
    .sort((a, b) => b.bytes - a.bytes || a.rawPath.localeCompare(b.rawPath))
    .slice(0, 10)
    .map((asset) => `- ${asset.beautifiedPath} (${formatBytes(asset.bytes)})`)
    .join("\n");
  const apiEndpoints = manifest.assets
    .filter((asset) => asset.viaJs || asset.kind === "JSON")
    .sort((a, b) => a.rawPath.localeCompare(b.rawPath))
    .map((asset) => `- GET ${urlPath(asset.url)} (${asset.kind}, ${formatBytes(asset.bytes)}, ${asset.rawPath})`)
    .join("\n");
  const textBytes = manifest.assets
    .filter((asset) => ["HTML", "JS", "CSS", "JSON"].includes(asset.kind))
    .reduce((total, asset) => total + asset.bytes, 0);
  const tree = await fileTree(haulPath, "study", 3);

  await writeTextInsideHaul(
    haulPath,
    "context.md",
    [
      `# Captured site: ${manifest.host}`,
      "",
      "Captured by Gnaw. This bundle contains rendered pages and browser-downloaded assets.",
      "",
      "## Detected stack",
      stack,
      "",
      "## Page inventory",
      pages || "- No pages captured.",
      "",
      "## Key JavaScript bundles (largest first, beautified)",
      keyBundles || "- None captured.",
      "",
      "## Observed API endpoints",
      "Fetch/XHR responses captured during rendering:",
      apiEndpoints || "- None observed.",
      "",
      "## Asset summary",
      `${assetsByKind || "No assets captured."}. Total ${formatBytes(manifest.stats.bytes)}.`,
      `Rough size of text assets: ~${Math.ceil(textBytes / 4).toLocaleString("en-US")} tokens. Read selectively.`,
      "",
      "## File tree (depth 3)",
      tree || "study/",
      "",
      "## How to use this bundle",
      "You are given a captured website to study. Read the rendered HTML and the beautified JavaScript.",
      "Explain how the relevant behaviour is implemented, then propose a clean reimplementation we can drop into our own repo.",
      ""
    ].join("\n")
  );
}

export async function writeNavigablePages({
  haulPath,
  pages,
  pageHtml,
  assets,
  redactText = (value: string) => value
}: {
  haulPath: string;
  pages: ManifestPage[];
  pageHtml: Map<string, string>;
  assets: ManifestAsset[];
  redactText?: (value: string) => string;
}): Promise<void> {
  for (const page of pages) {
    const html = pageHtml.get(page.url);
    if (!html) {
      continue;
    }
    const navigablePath = normalizeNavigablePagePath(page.url);
    page.navigablePath = navigablePath;
    await writeTextInsideHaul(haulPath, navigablePath, redactText(rewriteAssetUrls(html, navigablePath, page.url, assets)));
  }
}

async function fetchTextUrl(url: string): Promise<string | null> {
  const response = await fetch(url).catch(() => null);
  if (!response || !response.ok) {
    return null;
  }
  return response.text();
}

function findSourceMapUrl(source: string, assetUrl: string): string | null {
  const match = source.match(/sourceMappingURL=([^\s*]+)/);
  if (!match || match[1].startsWith("data:")) {
    return null;
  }
  return new URL(match[1], assetUrl).href;
}

function rewriteAssetUrls(html: string, navigablePath: string, pageUrl: string, assets: ManifestAsset[]): string {
  const pageDir = posix.dirname(navigablePath);
  const replacements = new Map<string, string>();

  for (const asset of assets.filter((candidate) => candidate.kind !== "HTML" && candidate.navigablePath)) {
    replacements.set(asset.url, posix.relative(pageDir, asset.navigablePath!));
  }

  return html.replace(/\b(src|href)\s*=\s*(["'])(.*?)\2/gi, (match, attribute: string, quote: string, value: string) => {
    const absolute = safeAbsoluteUrl(value, pageUrl);
    const replacement = absolute ? replacements.get(absolute) : undefined;
    if (!replacement) {
      return match;
    }
    return `${attribute}=${quote}${replacement}${quote}`;
  });
}

function safeAbsoluteUrl(value: string, baseUrl: string): string | null {
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return null;
  }
}

function normalizeNavigablePagePath(url: string): string {
  const parsed = new URL(url);
  const segments = parsed.pathname.split("/").filter(Boolean).map(sanitizePathSegment);
  const queryHash = parsed.search.length > 1 ? `~q${hash8(parsed.search.slice(1))}` : "";

  if (segments.length === 0) {
    return `navigable/index${queryHash}.html`;
  }

  const last = segments[segments.length - 1];
  if (last.includes(".")) {
    segments[segments.length - 1] = appendSuffixBeforeExtension(last, queryHash);
    return `navigable/${segments.join("/")}`;
  }

  return `navigable/${[...segments, `index${queryHash}.html`].join("/")}`;
}

function sanitizePathSegment(segment: string): string {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    decoded = segment;
  }
  return decoded.replace(/[^A-Za-z0-9._-]/g, "_").replace(/[^\x00-\x7F]/g, "_");
}

function appendSuffixBeforeExtension(fileName: string, suffix: string): string {
  if (suffix === "") {
    return fileName;
  }
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex === -1) {
    return `${fileName}${suffix}`;
  }
  return `${fileName.slice(0, dotIndex)}${suffix}${fileName.slice(dotIndex)}`;
}

function hash8(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

async function writeTextInsideHaul(haulPath: string, relativePath: string, text: string): Promise<void> {
  const safePath = validateRelativePath(relativePath);
  const outputRoot = resolve(haulPath);
  const outputPath = resolve(outputRoot, ...safePath.split("/"));
  if (!isInside(outputRoot, outputPath)) {
    throw new Error(`Refusing to write outside haul: ${relativePath}`);
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, text, "utf8");
}

function validateRelativePath(filePath: string): string {
  if (isAbsolute(filePath)) {
    throw new Error(`Refusing to write outside haul: ${filePath}`);
  }
  const parts = filePath.split(/[\\/]+/);
  if (parts.length === 0 || parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Refusing to write outside haul: ${filePath}`);
  }
  return parts.join("/");
}

function isInside(root: string, target: string): boolean {
  const relativePath = relative(root, target);
  return relativePath !== "" && !relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath);
}

function urlPath(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function fileTree(haulPath: string, rootName: string, maxDepth: number): Promise<string> {
  const lines: string[] = [rootName];
  await appendTree(resolve(haulPath, rootName), rootName, 1, maxDepth, lines);
  return lines.join("\n");
}

async function appendTree(path: string, display: string, depth: number, maxDepth: number, lines: string[]): Promise<void> {
  if (depth > maxDepth) {
    return;
  }
  let entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  entries = entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const childDisplay = `${display}/${entry.name}`;
    lines.push(childDisplay);
    if (entry.isDirectory()) {
      await appendTree(resolve(path, entry.name), childDisplay, depth + 1, maxDepth, lines);
    }
  }
}
