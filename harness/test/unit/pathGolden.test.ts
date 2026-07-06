import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  createPathNormalizer,
  type NormalizedPath,
} from "../../../engine/src/paths/normalizePath";

type GoldenCase = {
  kind: "page" | "rendered" | "asset";
  url: string;
  contentType?: string | null;
  expected: NormalizedPath;
};

describe("path normalization goldens", () => {
  it("matches the authoritative URL-to-path cases", async () => {
    const raw = await readFile(
      "harness/goldens/path-normalization.json",
      "utf8",
    );
    const cases = JSON.parse(raw) as GoldenCase[];
    const normalizer = createPathNormalizer();

    for (const entry of cases) {
      const actual =
        entry.kind === "page"
          ? normalizer.normalizePage(entry.url)
          : entry.kind === "rendered"
            ? normalizer.normalizeRendered(entry.url)
            : normalizer.normalizeAsset(entry.url, entry.contentType ?? null);

      expect(actual, entry.url).toEqual(entry.expected);
    }
  });
});
