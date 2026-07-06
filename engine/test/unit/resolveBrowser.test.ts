import { describe, expect, it } from "vitest";
import { resolveBrowser } from "../../src/browser/resolveBrowser";

describe("browser resolver", () => {
  it("prefers the Playwright Chromium executable when it exists", () => {
    const browser = resolveBrowser({
      env: {},
      playwrightExecutablePath: () => "/pw/chromium",
      exists: (path) => path === "/pw/chromium"
    });

    expect(browser).toEqual({
      executablePath: "/pw/chromium",
      label: "Playwright Chromium"
    });
  });

  it("allows GNAW_CHROME_PATH to override local application fallbacks", () => {
    const browser = resolveBrowser({
      env: { GNAW_CHROME_PATH: "/custom/chrome" },
      playwrightExecutablePath: () => "/missing/pw",
      exists: (path) => path === "/custom/chrome"
    });

    expect(browser).toEqual({
      executablePath: "/custom/chrome",
      label: "Custom Chromium"
    });
  });
});
