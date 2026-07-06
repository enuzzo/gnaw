import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { isCliEntrypoint, runCli, createCliProgram } from "../../src/cli";

describe("CLI surface", () => {
  it("registers capture and auth commands", () => {
    const program = createCliProgram();

    expect(program.commands.map((command) => command.name()).sort()).toEqual([
      "auth",
      "capture"
    ]);
    expect(program.commands.find((command) => command.name() === "auth")?.commands.map((command) => command.name()).sort()).toEqual([
      "delete",
      "list",
      "login"
    ]);
  });

  it("runs capture with NDJSON events on stdout and logs on stderr", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const calls: unknown[] = [];
    const program = createCliProgram({
      stdout: captureStream(stdout),
      stderr: captureStream(stderr),
      capture: async (options) => {
        calls.push(options);
        options.eventSink({ v: 2, type: "done", result: "complete" });
        options.logSink("Capture complete");
        return { haulPath: "/tmp/haul" };
      }
    });

    await program.parseAsync([
      "node",
      "gnaw",
      "capture",
      "http://127.0.0.1:43110/",
      "--mode",
      "study",
      "--depth",
      "0",
      "--out",
      "/tmp/gnaw",
      "--max-pages",
      "3",
      "--max-bytes",
      "1000",
      "--max-asset-bytes",
      "500",
      "--block",
      "/private",
      "--unblock",
      "/cart"
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      entrypoint: "http://127.0.0.1:43110/",
      outDir: "/tmp/gnaw",
      modes: ["study"],
      depth: 0,
      maxPages: 3,
      maxTotalBytes: 1000,
      maxAssetBytes: 500,
      blockPatterns: expect.arrayContaining(["/logout", "/private"])
    });
    expect((calls[0] as { blockPatterns: string[] }).blockPatterns).not.toContain("/cart");
    expect(JSON.parse(stdout.join("").trim())).toMatchObject({
      v: 2,
      type: "done",
      result: "complete"
    });
    expect(stderr.join("")).toBe("Capture complete\n");
  });

  it("defaults capture to Study mode until navigable rewriting is implemented", async () => {
    const calls: unknown[] = [];

    await runCli(["node", "gnaw", "capture", "http://127.0.0.1:43110/"], {
      capture: async (options) => {
        calls.push(options);
        options.eventSink({ v: 2, type: "done", result: "complete" });
        return { haulPath: "/tmp/haul" };
      },
      stdout: captureStream([]),
      stderr: captureStream([])
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ modes: ["study"] });
  });

  it("detects when the compiled CLI file is the process entrypoint", () => {
    expect(isCliEntrypoint("file:///tmp/gnaw/dist/engine/src/cli.js", "/tmp/gnaw/dist/engine/src/cli.js")).toBe(true);
    expect(isCliEntrypoint("file:///tmp/gnaw/dist/engine/src/cli.js", "/tmp/gnaw/dist/engine/src/other.js")).toBe(false);
  });

  it("rejects invalid capture modes before invoking capture", async () => {
    const calls: unknown[] = [];
    const program = createCliProgram({
      capture: async (options) => {
        calls.push(options);
        return { haulPath: "/tmp/haul" };
      }
    });

    await expect(
      program.parseAsync(["node", "gnaw", "capture", "http://127.0.0.1:43110/", "--mode", "nope"])
    ).rejects.toThrow(/invalid mode/i);
    expect(calls).toEqual([]);
  });

  it("wires stdin cancel commands to the capture abort signal", async () => {
    const stdin = new PassThrough();
    const stdout: string[] = [];
    const calls: unknown[] = [];
    const program = createCliProgram({
      stdin,
      stdout: captureStream(stdout),
      capture: async (options) => {
        calls.push(options);
        stdin.write('{"cmd":"cancel"}\n');
        await new Promise((resolve) => setImmediate(resolve));
        options.eventSink({ v: 2, type: "done", result: "canceled" });
        return { haulPath: "/tmp/haul" };
      }
    });

    await program.parseAsync(["node", "gnaw", "capture", "http://127.0.0.1:43110/", "--mode", "study"]);

    expect(calls).toHaveLength(1);
    expect((calls[0] as { signal?: AbortSignal }).signal?.aborted).toBe(true);
    expect(stdout.join("").trim().split("\n").map((line) => JSON.parse(line))).toEqual([
      { v: 2, type: "state", state: "canceled" },
      { v: 2, type: "done", result: "canceled" }
    ]);
  });
});

function captureStream(lines: string[]): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    }
  });
}
