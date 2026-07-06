import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPathNormalizer } from "../../src/paths/normalizePath";

const hash8 = (value: string): string =>
  createHash("sha256").update(value).digest("hex").slice(0, 8);

describe("path normalizer", () => {
  it("normalizes root, trailing slash, extensionless pages, and fragments", () => {
    const normalizer = createPathNormalizer();

    expect(normalizer.normalizePage("https://EXAMPLE.com/#top")).toEqual({
      host: "example.com",
      relativePath: "example.com/index.html",
    });
    expect(
      normalizer.normalizePage("https://Example.COM/docs/#chapter"),
    ).toEqual({
      host: "example.com",
      relativePath: "example.com/docs/index.html",
    });
    expect(normalizer.normalizeRendered("https://Example.COM/about")).toEqual({
      host: "example.com",
      relativePath: "example.com/about/index.html",
    });
  });

  it("appends a raw-query hash before the extension", () => {
    const normalizer = createPathNormalizer();

    expect(
      normalizer.normalizeAsset("https://example.com/app.js?v=3&lang=en", null),
    ).toEqual({
      host: "example.com",
      relativePath: `example.com/app~q${hash8("v=3&lang=en")}.js`,
    });
    expect(
      normalizer.normalizePage("https://example.com/search?q=Gnaw"),
    ).toEqual({
      host: "example.com",
      relativePath: `example.com/search/index~q${hash8("q=Gnaw")}.html`,
    });
  });

  it("percent-decodes then replaces unsafe and non-ASCII characters", () => {
    const normalizer = createPathNormalizer();

    expect(
      normalizer.normalizeAsset(
        "https://cdn.example.com/a%20b/%E2%82%AC?x=1",
        null,
      ),
    ).toEqual({
      host: "cdn.example.com",
      relativePath: `cdn.example.com/a_b~u${hash8("a b")}/_~u${hash8("€")}~q${hash8("x=1")}`,
    });
  });

  it("suffixes APFS case-insensitive collisions only after a conflicting path is seen", () => {
    const normalizer = createPathNormalizer();
    const loneUpperUrl = "https://example.com/Images/Icon.png";
    expect(normalizer.normalizeAsset(loneUpperUrl, null).relativePath).toBe("example.com/Images/Icon.png");

    const lowerUrl = "https://example.com/images/logo.png";
    expect(normalizer.normalizeAsset(lowerUrl, null).relativePath).toBe("example.com/images/logo.png");

    const upperUrl = "https://example.com/Images/Logo.png";
    expect(normalizer.normalizeAsset(upperUrl, null).relativePath).toBe(`example.com/Images/Logo~c${hash8(upperUrl)}.png`);
  });

  it("truncates path segments longer than 100 characters", () => {
    const normalizer = createPathNormalizer();
    const segment = "a".repeat(101);

    expect(normalizer.normalizePage(`https://example.com/${segment}`)).toEqual({
      host: "example.com",
      relativePath: `example.com/${"a".repeat(80)}~${hash8(segment)}/index.html`,
    });
  });

  it("uses content type to add a JSON extension for extensionless assets", () => {
    const normalizer = createPathNormalizer();

    expect(
      normalizer.normalizeAsset(
        "https://api.example.com/v1/feed?limit=10",
        "application/json; charset=utf-8",
      ),
    ).toEqual({
      host: "api.example.com",
      relativePath: `api.example.com/v1/feed~q${hash8("limit=10")}.json`,
    });
  });

  it("keeps final suffixed segments within the 100 character cap", () => {
    const normalizer = createPathNormalizer();
    const stem = "a".repeat(100);
    const queryHash = hash8("v=1");
    const fullQueryName = `${stem}~q${queryHash}.json`;

    expect(
      normalizer.normalizeAsset(`https://example.com/${stem}?v=1`, "application/json"),
    ).toEqual({
      host: "example.com",
      relativePath: `example.com/${fullQueryName.slice(0, 80)}~${hash8(fullQueryName)}`,
    });

    const firstFile = `${"a".repeat(96)}.png`;
    const upperFile = `${"A".repeat(96)}.png`;
    const upperUrl = `https://example.com/${upperFile}`;
    normalizer.normalizeAsset(`https://example.com/${firstFile}`, "image/png");
    const fullCaseName = `${"A".repeat(96)}~c${hash8(upperUrl)}.png`;

    expect(normalizer.normalizeAsset(upperUrl, "image/png")).toEqual({
      host: "example.com",
      relativePath: `example.com/${fullCaseName.slice(0, 80)}~${hash8(fullCaseName)}`,
    });
  });

  it("prevents exact collisions from lossy sanitization", () => {
    const normalizer = createPathNormalizer();

    expect(normalizer.normalizeAsset("https://example.com/a%20b", null).relativePath).toBe(
      `example.com/a_b~u${hash8("a b")}`,
    );
    expect(normalizer.normalizeAsset("https://example.com/a_b", null).relativePath).toBe(
      "example.com/a_b",
    );
    expect(normalizer.normalizeAsset("https://example.com/a%2Fb", null).relativePath).toBe(
      `example.com/a_b~u${hash8("a/b")}`,
    );
  });
});
