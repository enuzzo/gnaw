import { describe, it, expect, vi } from "vitest";
import { checkBrowser, ensureBrowser, type BrowserStatusEvent } from "../../src/browser/browserCommands.js";

const found = () => ({ executablePath: "/x/chrome", label: "Google Chrome" });
const missing = () => { throw new Error("No supported Chromium browser found"); };

describe("checkBrowser", () => {
  it("reports found with a label", () => {
    expect(checkBrowser({ resolveBrowser: found })).toEqual({ found: true, detail: "Google Chrome" });
  });
  it("reports not found when resolution throws", () => {
    expect(checkBrowser({ resolveBrowser: missing })).toEqual({ found: false });
  });
});

describe("ensureBrowser", () => {
  it("emits only found and skips install when a browser exists", async () => {
    const events: BrowserStatusEvent[] = [];
    const install = vi.fn(async () => {});
    await ensureBrowser((e) => events.push(e), { resolveBrowser: found, installChromium: install });
    expect(install).not.toHaveBeenCalled();
    expect(events).toEqual([{ v: 2, type: "browser", status: "found", detail: "Google Chrome" }]);
  });

  it("downloads then reports found when no browser exists", async () => {
    const events: BrowserStatusEvent[] = [];
    let installed = false;
    const resolve = () => { if (!installed) throw new Error("missing"); return found(); };
    const install = vi.fn(async () => { installed = true; });
    await ensureBrowser((e) => events.push(e), { resolveBrowser: resolve, installChromium: install });
    expect(install).toHaveBeenCalledOnce();
    expect(events.map((e) => e.status)).toEqual(["downloading", "found"]);
    expect(events[1].detail).toBe("Google Chrome");
  });
});
