import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import { createCliProgram } from "../../src/cli.js";

function sink() {
  const chunks: string[] = [];
  const stream = new Writable({ write(c, _e, cb) { chunks.push(String(c)); cb(); } });
  return { stream, lines: () => chunks.join("").trim().split("\n").filter(Boolean) };
}

describe("gnaw browser ensure", () => {
  it("emits downloading then found using injected deps", async () => {
    const out = sink();
    let installed = false;
    const program = createCliProgram({
      stdout: out.stream,
      resolveBrowser: () => { if (!installed) throw new Error("missing"); return { executablePath: "/x", label: "Google Chrome" }; },
      installBrowser: async () => { installed = true; }
    });
    await program.parseAsync(["node", "gnaw", "browser", "ensure"]);
    const events = out.lines().map((l) => JSON.parse(l));
    expect(events.map((e) => e.type)).toEqual(["browser", "browser"]);
    expect(events.map((e) => e.status)).toEqual(["downloading", "found"]);
  });
});
