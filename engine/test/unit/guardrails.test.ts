import { describe, expect, it } from "vitest";
import {
  DEFAULT_GUARDRAILS,
  assetTooLargeWarning,
  evaluateMaxPages,
  evaluateMaxTotalBytes
} from "../../src/capture/guardrails";

describe("capture guardrails", () => {
  it("exposes M1 default limits from the spec", () => {
    expect(DEFAULT_GUARDRAILS).toEqual({
      maxPages: 200,
      maxTotalBytes: 2147483648,
      maxAssetBytes: 104857600
    });
  });

  it("returns partial decisions when page or total byte limits are hit", () => {
    expect(evaluateMaxPages({ pagesCaptured: 199 })).toEqual({ hit: false });
    expect(evaluateMaxPages({ pagesCaptured: 200 })).toEqual({
      hit: true,
      result: "partial",
      reason: "max_pages",
      limit: 200,
      observed: 200
    });

    expect(evaluateMaxTotalBytes({ totalBytes: 2147483647, nextBytes: 1 })).toEqual({
      hit: false
    });
    expect(evaluateMaxTotalBytes({ totalBytes: 2147483647, nextBytes: 2 })).toEqual({
      hit: true,
      result: "partial",
      reason: "max_total_bytes",
      limit: 2147483648,
      observed: 2147483649
    });
  });

  it("builds asset-too-large warning data for skipped assets", () => {
    expect(assetTooLargeWarning({ url: "https://example.com/video.mp4", sizeBytes: 104857600 })).toBeNull();
    expect(assetTooLargeWarning({ url: "https://example.com/video.mp4", sizeBytes: 104857601 })).toEqual({
      type: "warning",
      code: "asset_too_large",
      url: "https://example.com/video.mp4",
      sizeBytes: 104857601,
      limit: 104857600,
      action: "skipped"
    });
  });
});
