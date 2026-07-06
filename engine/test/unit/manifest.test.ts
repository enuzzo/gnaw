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
      assets: []
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
    expect(validateManifest(manifest).valid).toBe(true);
  });
});
