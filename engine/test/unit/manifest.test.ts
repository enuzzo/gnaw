import { describe, expect, it } from "vitest";
import { validateManifest } from "../../../harness/src/contract/validate";
import { buildManifest, defaultCaptureConfig } from "../../src/capture/manifest";

describe("manifest builder", () => {
  it("builds schema-valid manifest v2 with M1 defaults", () => {
    const manifest = buildManifest({
      entrypoint: "http://127.0.0.1:43110/",
      host: "127.0.0.1",
      startedAt: "2026-07-06T10:22:31Z",
      finishedAt: "2026-07-06T10:22:32Z",
      durationMs: 1000,
      result: "complete",
      modes: ["study"],
      config: defaultCaptureConfig(),
      pages: [
        {
          url: "http://127.0.0.1:43110/",
          title: "Static Fixture",
          depth: 0,
          status: 200,
          discoveredFrom: null,
          renderedPath: "study/rendered/127.0.0.1/index.html"
        }
      ],
      assets: [
        {
          url: "http://127.0.0.1:43110/",
          kind: "HTML",
          status: 200,
          contentType: "text/html",
          bytes: 10,
          sha256: "abc123",
          rawPath: "study/raw/127.0.0.1/index.html",
          referrer: null,
          viaJs: false,
          fromCache: false
        }
      ]
    });

    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.config).toEqual({
      depth: 1,
      sameDomainOnly: true,
      includeSubdomains: false,
      respectRobots: false,
      rateLimitMs: 250,
      maxPages: 200,
      maxTotalBytes: 2147483648,
      maxAssetBytes: 104857600,
      userAgent: "Gnaw/1.0.0",
      authProfile: null
    });
    expect(manifest.stats.byKind).toEqual({
      HTML: 1,
      JS: 0,
      CSS: 0,
      IMG: 0,
      FONT: 0,
      JSON: 0,
      MEDIA: 0,
      WASM: 0,
      OTHER: 0
    });
    expect(manifest.stats.assets).toBe(1);
    expect(manifest.stats.bytes).toBe(10);
    expect(validateManifest(manifest).valid).toBe(true);
  });

  it("adds auth metadata when a profile is used", () => {
    const manifest = buildManifest({
      entrypoint: "http://127.0.0.1:43114/protected/",
      host: "127.0.0.1",
      startedAt: "2026-07-06T10:22:31Z",
      finishedAt: "2026-07-06T10:22:32Z",
      durationMs: 1000,
      result: "complete",
      modes: ["study"],
      config: defaultCaptureConfig({ authProfile: "client-a" }),
      auth: {
        mode: "profile",
        profileName: "client-a",
        storageStateUsed: true,
        redacted: true
      },
      pages: [],
      assets: []
    });

    expect(manifest.auth).toEqual({
      mode: "profile",
      profileName: "client-a",
      storageStateUsed: true,
      redacted: true
    });
    expect(JSON.stringify(manifest)).not.toContain("gnaw_cookie_secret_DO_NOT_LEAK");
    expect(validateManifest(manifest).valid).toBe(true);
  });
});
