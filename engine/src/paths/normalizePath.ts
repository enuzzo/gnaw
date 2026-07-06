import { createHash } from "node:crypto";
import path from "node:path";

export type NormalizedPath = {
  host: string;
  relativePath: string;
};

type NormalizerMode = "page" | "rendered" | "asset";

export function createPathNormalizer(): {
  normalizePage(url: string): NormalizedPath;
  normalizeRendered(url: string): NormalizedPath;
  normalizeAsset(url: string, contentType: string | null): NormalizedPath;
} {
  function normalize(url: string, mode: NormalizerMode, contentType: string | null): NormalizedPath {
    const originalUrl = stripFragment(url);
    const parsed = new URL(originalUrl);
    const host = sanitizeSegment(parsed.hostname.toLowerCase());
    const pathParts = buildPathParts(parsed, mode, contentType);
    const relativePath = applyDeterministicCollisionSuffix([host, ...pathParts].join("/"), originalUrl);

    return { host, relativePath };
  }

  return {
    normalizePage(url) {
      return normalize(url, "page", null);
    },
    normalizeRendered(url) {
      return normalize(url, "rendered", null);
    },
    normalizeAsset(url, contentType) {
      return normalize(url, "asset", contentType);
    }
  };
}

function buildPathParts(parsed: URL, mode: NormalizerMode, contentType: string | null): string[] {
  const rawSegments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  const decoded = rawSegments.map(normalizeSegment);
  const queryHash = parsed.search.length > 1 ? hash8(parsed.search.slice(1)) : null;

  if (mode !== "asset" && shouldMapPageToIndex(parsed.pathname, decoded)) {
    if (queryHash !== null) {
      return [...decoded, `index~q${queryHash}.html`];
    }
    return [...decoded, "index.html"];
  }

  if (decoded.length === 0) {
    return [queryHash === null ? "index.html" : `index~q${queryHash}${extensionForContentType(contentType)}`];
  }

  const parts = [...decoded];
  const last = parts[parts.length - 1] ?? "index.html";
  const withContentExtension = mode === "asset" ? ensureAssetExtension(last, contentType) : last;
  parts[parts.length - 1] = truncateSegment(
    queryHash === null ? withContentExtension : appendSuffixBeforeExtension(withContentExtension, `~q${queryHash}`)
  );
  return parts;
}

function shouldMapPageToIndex(pathname: string, decoded: string[]): boolean {
  if (pathname === "/" || pathname.endsWith("/")) {
    return true;
  }

  const last = decoded[decoded.length - 1];
  return last === undefined || path.extname(last) === "";
}

function ensureAssetExtension(fileName: string, contentType: string | null): string {
  if (path.extname(fileName) !== "") {
    return fileName;
  }

  return `${fileName}${extensionForContentType(contentType)}`;
}

function extensionForContentType(contentType: string | null): string {
  const mediaType = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";

  if (mediaType === "text/html" || mediaType === "application/xhtml+xml") return ".html";
  if (mediaType === "application/javascript" || mediaType === "text/javascript") return ".js";
  if (mediaType === "text/css") return ".css";
  if (mediaType === "application/json" || mediaType.endsWith("+json")) return ".json";
  if (mediaType === "application/wasm") return ".wasm";
  return "";
}

function stripFragment(url: string): string {
  const hashIndex = url.indexOf("#");
  return hashIndex === -1 ? url : url.slice(0, hashIndex);
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function normalizeSegment(segment: string): string {
  const decoded = decodeSegment(segment);
  const sanitized = sanitizeSegment(decoded);
  const unique = sanitized === decoded
    ? sanitized
    : appendSuffixBeforeExtension(sanitized, `~u${hash8(decoded)}`);
  return truncateSegment(unique);
}

function sanitizeSegment(segment: string): string {
  return segment.replace(/[^A-Za-z0-9._-]/g, "_").replace(/[^\x00-\x7F]/g, "_");
}

function truncateSegment(segment: string): string {
  if (segment.length <= 100) {
    return segment;
  }

  return `${segment.slice(0, 80)}~${hash8(segment)}`;
}

function applyDeterministicCollisionSuffix(relativePath: string, originalUrl: string): string {
  if (!/[A-Z]/.test(relativePath)) {
    return relativePath;
  }

  return capFinalSegment(appendSuffixBeforeExtension(relativePath, `~c${hash8(originalUrl)}`));
}

function capFinalSegment(filePath: string): string {
  const slashIndex = filePath.lastIndexOf("/");
  const directory = slashIndex === -1 ? "" : filePath.slice(0, slashIndex + 1);
  const fileName = slashIndex === -1 ? filePath : filePath.slice(slashIndex + 1);
  return `${directory}${truncateSegment(fileName)}`;
}

function appendSuffixBeforeExtension(filePath: string, suffix: string): string {
  const slashIndex = filePath.lastIndexOf("/");
  const directory = slashIndex === -1 ? "" : filePath.slice(0, slashIndex + 1);
  const fileName = slashIndex === -1 ? filePath : filePath.slice(slashIndex + 1);
  const extension = path.extname(fileName);

  if (extension === "") {
    return `${directory}${fileName}${suffix}`;
  }

  return `${directory}${fileName.slice(0, -extension.length)}${suffix}${extension}`;
}

function hash8(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}
