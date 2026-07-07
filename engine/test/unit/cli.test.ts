import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { isCliEntrypoint, runCli, createCliProgram } from "../../src/cli";
import type { ProfileStore } from "../../src/auth/profiles";

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
      profileName: undefined,
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

  it("passes capture profile names to the engine without writing human text to stdout", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const calls: unknown[] = [];
    const program = createCliProgram({
      stdout: captureStream(stdout),
      stderr: captureStream(stderr),
      capture: async (options) => {
        calls.push(options);
        options.eventSink({ v: 2, type: "done", result: "complete", summary: { pages: 0, assets: 0, bytes: 0 }, haulPath: "/tmp/haul" });
        return { haulPath: "/tmp/haul" };
      }
    });

    await program.parseAsync([
      "node",
      "gnaw",
      "capture",
      "http://127.0.0.1:43114/protected/",
      "--profile",
      "client-a"
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ profileName: "client-a" });
    expect(stdout.join("").trim().split("\n").map((line) => JSON.parse(line))).toEqual([
      { v: 2, type: "done", result: "complete", summary: { pages: 0, assets: 0, bytes: 0 }, haulPath: "/tmp/haul" }
    ]);
    expect(stderr.join("")).toBe("");
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

  it("runs auth list, delete, and login as schema-shaped NDJSON events", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const deleted: string[] = [];
    let loginStore: ProfileStore | undefined;
    const profileStore: ProfileStore = {
      root: "/tmp/gnaw-profiles",
      profileDir: (name) => `/tmp/gnaw-profiles/${name}`,
      ensureProfileDir: async (name) => `/tmp/gnaw-profiles/${name}`,
      saveMetadata: async (input) => ({
        schemaVersion: 1,
        name: input.name,
        lastVerifiedUrl: input.lastVerifiedUrl,
        lastVerifiedAt: input.lastVerifiedAt
      }),
      readMetadata: async (name) => ({
        schemaVersion: 1,
        name,
        lastVerifiedUrl: "http://127.0.0.1:43114/protected/",
        lastVerifiedAt: "2026-07-06T10:22:31.000Z"
      }),
      listProfiles: async () => [
        {
          schemaVersion: 1,
          name: "client-a",
          lastVerifiedUrl: "http://127.0.0.1:43114/protected/",
          lastVerifiedAt: "2026-07-06T10:22:31.000Z",
          locked: false
        }
      ],
      deleteProfile: async (name) => {
        deleted.push(name);
      },
      acquireLock: async () => ({
        release: async () => undefined
      })
    };
    const program = createCliProgram({
      stdout: captureStream(stdout),
      stderr: captureStream(stderr),
      profileStore,
      authLogin: async ({ profileName, url, store }) => {
        loginStore = store;
        return {
          schemaVersion: 1,
          name: profileName,
          lastVerifiedUrl: url,
          lastVerifiedAt: "2026-07-06T10:22:32.000Z"
        };
      }
    });

    await program.parseAsync(["node", "gnaw", "auth", "list"]);
    await program.parseAsync(["node", "gnaw", "auth", "delete", "client-a"]);
    await program.parseAsync(["node", "gnaw", "auth", "login", "http://127.0.0.1:43114/", "--profile", "client-b"]);

    expect(stdout.join("").trim().split("\n").map((line) => JSON.parse(line))).toEqual([
      {
        v: 2,
        type: "auth_profile",
        profileName: "client-a",
        lastVerifiedUrl: "http://127.0.0.1:43114/protected/",
        lastVerifiedAt: "2026-07-06T10:22:31.000Z",
        locked: false
      },
      {
        v: 2,
        type: "auth_deleted",
        profileName: "client-a"
      },
      {
        v: 2,
        type: "auth_profile",
        profileName: "client-b",
        lastVerifiedUrl: "http://127.0.0.1:43114/",
        lastVerifiedAt: "2026-07-06T10:22:32.000Z",
        locked: false
      }
    ]);
    expect(stderr.join("")).toBe("Deleted auth profile client-a\nSaved auth profile client-b\n");
    expect(deleted).toEqual(["client-a"]);
    expect(loginStore).toBe(profileStore);
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
