import { describe, expect, it } from "vitest";
import {
  validateEvent,
  validateManifest,
  validateWaterfallRow
} from "../../src/contract/validate";

const kinds = ["HTML", "JS", "CSS", "IMG", "FONT", "JSON", "MEDIA", "WASM", "OTHER"];

describe("contract schemas", () => {
  it("accepts a manifest v2 with every required contract section", () => {
    expect(validateManifest(validManifest()).valid).toBe(true);
  });

  it("rejects unknown manifest result, unknown kind, and negative byte counts", () => {
    expect(validateManifest({ ...validManifest(), result: "failed" }).valid).toBe(false);
    expect(
      validateManifest({
        ...validManifest(),
        assets: [{ ...validManifest().assets[0], kind: "SCRIPT" }]
      }).valid
    ).toBe(false);
    expect(
      validateManifest({
        ...validManifest(),
        stats: { ...validManifest().stats, bytes: -1 }
      }).valid
    ).toBe(false);
    expect(
      validateManifest({
        ...validManifest(),
        assets: [{ ...validManifest().assets[0], bytes: -1 }]
      }).valid
    ).toBe(false);
    expect(
      validateManifest({
        ...validManifest(),
        auth: { ...validManifest().auth, redacted: false }
      }).valid
    ).toBe(false);
    expect(
      validateManifest({
        ...validManifest(),
        config: { ...validManifest().config, authProfile: "client-a" },
        auth: undefined
      }).valid
    ).toBe(false);
    expect(
      validateManifest({
        ...validManifest(),
        config: { ...validManifest().config, authProfile: null },
        auth: validManifest().auth
      }).valid
    ).toBe(false);
    expect(
      validateManifest({
        ...validManifest(),
        config: { ...validManifest().config, authProfile: "client-a" },
        auth: { ...validManifest().auth, profileName: "client-b" }
      }).valid
    ).toBe(false);
  });

  it("accepts all stdout event types with v2 and forward-compatible fields", () => {
    for (const event of validEvents()) {
      expect(validateEvent({ ...event, futureField: "allowed" }).valid).toBe(true);
    }
  });

  it("rejects non-object stdout events and unknown event versions or types", () => {
    expect(validateEvent("plain stdout text").valid).toBe(false);
    expect(validateEvent({ v: 1, type: "hello" }).valid).toBe(false);
    expect(validateEvent({ v: 2, type: "mystery" }).valid).toBe(false);
    expect(validateEvent({ v: 2, type: "done", result: "complete" }).valid).toBe(false);
  });

  it("accepts request before asset event shapes", () => {
    expect(
      validateEvent({
        v: 2,
        type: "request",
        id: "r-0001",
        url: "http://127.0.0.1:43111/app.js",
        method: "GET"
      }).valid
    ).toBe(true);

    expect(
      validateEvent({
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
      }).valid
    ).toBe(true);
  });

  it("accepts auth profile management events", () => {
    expect(
      validateEvent({
        v: 2,
        type: "auth_profile",
        profileName: "client-a",
        lastVerifiedUrl: "http://127.0.0.1:43114/protected/",
        lastVerifiedAt: "2026-07-06T10:22:31.000Z",
        locked: false
      }).valid
    ).toBe(true);
    expect(
      validateEvent({
        v: 2,
        type: "auth_deleted",
        profileName: "client-a"
      }).valid
    ).toBe(true);
  });

  it("accepts a waterfall response row and rejects secrets or bodies", () => {
    expect(validateWaterfallRow(validWaterfallRow()).valid).toBe(true);
    expect(validateWaterfallRow({ ...validWaterfallRow(), requestHeaders: {} }).valid).toBe(false);
    expect(validateWaterfallRow({ ...validWaterfallRow(), responseHeaders: {} }).valid).toBe(false);
    expect(validateWaterfallRow({ ...validWaterfallRow(), cookies: [] }).valid).toBe(false);
    expect(validateWaterfallRow({ ...validWaterfallRow(), body: "secret" }).valid).toBe(false);
    expect(validateWaterfallRow({ ...validWaterfallRow(), bytes: -1 }).valid).toBe(false);
  });
});

function validManifest() {
  return {
    schemaVersion: 2,
    gnawVersion: "1.0.0",
    engine: {
      name: "gnaw-playwright",
      version: "1.0.0",
      browser: "Chrome 126.0.6478.62"
    },
    entrypoint: "https://example.com/",
    host: "example.com",
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
      userAgent: "Gnaw Test",
      authProfile: "client-a"
    },
    stack: {
      primary: "Next.js",
      detected: [
        {
          name: "Next.js",
          confidence: 0.92,
          signals: ["/_next/ paths", "window.__NEXT_DATA__"]
        }
      ]
    },
    stats: {
      pages: 14,
      assets: 147,
      bytes: 8810342,
      byKind: Object.fromEntries(kinds.map((kind) => [kind, kind === "HTML" ? 14 : 0]))
    },
    pages: [
      {
        url: "https://example.com/",
        title: "Example",
        depth: 0,
        status: 200,
        discoveredFrom: null,
        navigablePath: "navigable/index.html",
        renderedPath: "study/rendered/example.com/index.html"
      }
    ],
    assets: [
      {
        url: "https://example.com/_next/static/chunks/app.4f2a.js",
        kind: "JS",
        status: 200,
        contentType: "application/javascript",
        bytes: 184320,
        sha256: "abc123",
        rawPath: "study/raw/example.com/_next/static/chunks/app.4f2a.js",
        beautifiedPath: "study/beautified/example.com/_next/static/chunks/app.4f2a.js",
        referrer: "https://example.com/",
        viaJs: true,
        fromCache: false
      }
    ],
    auth: {
      mode: "profile",
      profileName: "client-a",
      storageStateUsed: true,
      redacted: true
    },
    safety: {
      skippedUrls: [
        {
          url: "https://example.com/logout",
          reason: "blocked_pattern"
        }
      ]
    },
    errors: [
      {
        code: "nav_timeout",
        url: "https://example.com/slow",
        message: "Navigation timed out after 30s"
      }
    ]
  };
}

function validWaterfallRow() {
  return {
    t: 12894,
    url: "https://example.com/_next/static/chunks/app.4f2a.js",
    method: "GET",
    status: 200,
    kind: "JS",
    contentType: "application/javascript",
    bytes: 184320,
    durationMs: 142,
    fromCache: false,
    viaJs: true,
    referrer: "https://example.com/",
    page: "https://example.com/"
  };
}

function validEvents() {
  return [
    {
      v: 2,
      type: "hello",
      engine: { name: "gnaw-playwright", version: "1.0.0" },
      contract: "2.0"
    },
    {
      v: 2,
      type: "browser",
      status: "found",
      detail: "Playwright Chromium"
    },
    {
      v: 2,
      type: "start",
      jobId: "j-test",
      entrypoint: "http://127.0.0.1:43110/",
      modes: ["study"],
      config: {},
      haulPath: "/tmp/haul"
    },
    {
      v: 2,
      type: "page_start",
      url: "http://127.0.0.1:43110/",
      depth: 0
    },
    {
      v: 2,
      type: "request",
      id: "r-0001",
      url: "http://127.0.0.1:43110/app.js",
      method: "GET"
    },
    {
      v: 2,
      type: "asset",
      id: "r-0001",
      url: "http://127.0.0.1:43110/app.js",
      kind: "JS",
      bytes: 42,
      status: 200,
      fromCache: false,
      viaJs: false,
      rawPath: "study/raw/127.0.0.1/app.js"
    },
    {
      v: 2,
      type: "page_done",
      url: "http://127.0.0.1:43110/",
      title: "Static Fixture",
      assets: 1
    },
    {
      v: 2,
      type: "stack",
      primary: "Next.js",
      detected: [{ name: "Next.js", confidence: 0.92, signals: ["__NEXT_DATA__"] }]
    },
    {
      v: 2,
      type: "progress",
      pages: 1,
      assets: 1,
      bytes: 42,
      queued: 0,
      elapsedMs: 100
    },
    {
      v: 2,
      type: "skip",
      url: "http://127.0.0.1:43110/logout",
      reason: "blocked_pattern"
    },
    {
      v: 2,
      type: "warning",
      code: "asset_too_large",
      url: "http://127.0.0.1:43110/video.mp4",
      message: "Skipped 212 MB video"
    },
    {
      v: 2,
      type: "error",
      code: "nav_timeout",
      url: "http://127.0.0.1:43110/slow",
      message: "Navigation timed out",
      fatal: false
    },
    {
      v: 2,
      type: "state",
      state: "paused"
    },
    {
      v: 2,
      type: "done",
      result: "complete",
      summary: { pages: 1, assets: 1, bytes: 42, durationMs: 100 },
      haulPath: "/tmp/haul"
    }
  ];
}
