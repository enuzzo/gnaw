import type { AssetKind } from "../assets/classifyKind.js";

export type CaptureMode = "study" | "navigable";
export type CaptureResult = "complete" | "partial" | "canceled";

export type CaptureConfig = {
  depth: number;
  sameDomainOnly: boolean;
  includeSubdomains: boolean;
  respectRobots: boolean;
  rateLimitMs: number;
  maxPages: number;
  maxTotalBytes: number;
  maxAssetBytes: number;
  userAgent: string;
  authProfile: string | null;
};

export type ManifestPage = {
  url: string;
  title: string;
  depth: number;
  status: number;
  discoveredFrom: string | null;
  navigablePath?: string;
  renderedPath?: string;
};

export type ManifestAsset = {
  url: string;
  kind: AssetKind;
  status: number;
  contentType: string;
  bytes: number;
  sha256: string;
  rawPath: string;
  beautifiedPath?: string;
  referrer: string | null;
  viaJs: boolean;
  fromCache: boolean;
};

export type Manifest = ReturnType<typeof buildManifest>;

const kinds: AssetKind[] = ["HTML", "JS", "CSS", "IMG", "FONT", "JSON", "MEDIA", "WASM", "OTHER"];

export function defaultCaptureConfig(overrides: Partial<CaptureConfig> = {}): CaptureConfig {
  return {
    depth: 1,
    sameDomainOnly: true,
    includeSubdomains: false,
    respectRobots: false,
    rateLimitMs: 250,
    maxPages: 200,
    maxTotalBytes: 2147483648,
    maxAssetBytes: 104857600,
    userAgent: "Gnaw/1.0.0",
    authProfile: null,
    ...overrides
  };
}

export function buildManifest(input: {
  entrypoint: string;
  host: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  result: CaptureResult;
  modes: CaptureMode[];
  config: CaptureConfig;
  browser?: string;
  pages: ManifestPage[];
  assets: ManifestAsset[];
  skippedUrls?: Array<{ url: string; reason: string }>;
  errors?: Array<{ code: string; url?: string; message: string; fatal?: boolean }>;
}) {
  return {
    schemaVersion: 2,
    gnawVersion: "1.0.0",
    engine: {
      name: "gnaw-playwright",
      version: "1.0.0",
      browser: input.browser ?? "unknown"
    },
    entrypoint: input.entrypoint,
    host: input.host,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: input.durationMs,
    result: input.result,
    modes: input.modes,
    config: input.config,
    stack: {
      primary: null,
      detected: []
    },
    stats: {
      pages: input.pages.length,
      assets: input.assets.length,
      bytes: input.assets.reduce((total, asset) => total + asset.bytes, 0),
      byKind: countByKind(input.pages, input.assets)
    },
    pages: input.pages,
    assets: input.assets,
    safety: {
      skippedUrls: input.skippedUrls ?? []
    },
    errors: input.errors ?? []
  };
}

function countByKind(_pages: ManifestPage[], assets: ManifestAsset[]): Record<AssetKind, number> {
  const counts = Object.fromEntries(kinds.map((kind) => [kind, 0])) as Record<AssetKind, number>;

  for (const asset of assets) {
    counts[asset.kind] += 1;
  }

  return counts;
}
