import { describe, expect, it } from "vitest";
import { buildBlockPatterns, DEFAULT_BLOCK_PATTERNS, isBlockedNavigationUrl } from "../../src/safety/blocklist";

describe("safety blocklist", () => {
  it("matches default dangerous path segments case-insensitively", () => {
    expect(isBlockedNavigationUrl("http://127.0.0.1:43114/logout")).toBe(true);
    expect(isBlockedNavigationUrl("http://127.0.0.1:43114/Account/Delete")).toBe(true);
    expect(isBlockedNavigationUrl("http://127.0.0.1:43114/products/remove")).toBe(true);
  });

  it("does not block asset-like partial words", () => {
    expect(isBlockedNavigationUrl("http://127.0.0.1:43114/catalog/logout-icon.svg")).toBe(false);
    expect(isBlockedNavigationUrl("http://127.0.0.1:43114/cartoon")).toBe(false);
  });

  it("allows capture-specific extra patterns", () => {
    expect(isBlockedNavigationUrl("http://127.0.0.1:43114/private", buildBlockPatterns({ add: ["/private"] }))).toBe(true);
  });

  it("can remove a default pattern without disabling the rest", () => {
    const patterns = buildBlockPatterns({ remove: ["/logout"] });

    expect(isBlockedNavigationUrl("http://127.0.0.1:43114/logout", patterns)).toBe(false);
    expect(isBlockedNavigationUrl("http://127.0.0.1:43114/cart", patterns)).toBe(true);
  });
});
