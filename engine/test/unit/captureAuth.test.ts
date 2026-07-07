import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateEvent, validateManifest } from "../../../harness/src/contract/validate";
import { createProfileStore } from "../../src/auth/profiles";
import { captureSite } from "../../src/capture/capture";

describe("capture auth profiles", () => {
  const tmpRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tmpRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function tempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "gnaw-capture-auth-"));
    tmpRoots.push(root);
    return root;
  }

  it("refuses locked profiles with profile_locked while writing a valid haul", async () => {
    const outDir = await tempRoot();
    const profileRoot = await tempRoot();
    const store = createProfileStore({ root: profileRoot });
    await store.saveMetadata({
      name: "client-a",
      lastVerifiedUrl: "http://127.0.0.1:43114/protected/",
      lastVerifiedAt: "2026-07-06T10:22:31.000Z"
    });
    const lock = await store.acquireLock("client-a");
    const stdout: unknown[] = [];
    const stderr: string[] = [];

    try {
      const result = await captureSite({
        entrypoint: "http://127.0.0.1:43114/protected/",
        outDir,
        modes: ["study"],
        depth: 0,
        profileName: "client-a",
        profileRoot,
        eventSink: (event) => stdout.push(event),
        logSink: (line) => stderr.push(line)
      });

      const manifest = JSON.parse(await readFile(join(result.haulPath, "MANIFEST.json"), "utf8"));
      expect(validateManifest(manifest).valid).toBe(true);
      expect(stdout.every((event) => validateEvent(event).valid)).toBe(true);
      expect(manifest.result).toBe("partial");
      expect(manifest.config.authProfile).toBe("client-a");
      expect(manifest.auth).toEqual({
        mode: "profile",
        profileName: "client-a",
        storageStateUsed: false,
        redacted: true
      });
      expect(manifest.errors[0]).toMatchObject({ code: "profile_locked", fatal: true });
      expect(stdout).toContainEqual(expect.objectContaining({ type: "error", code: "profile_locked", fatal: true }));
      expect(stdout.at(-1)).toMatchObject({ v: 2, type: "done", result: "partial" });
      expect(stderr.join("\n")).toContain("Capture failed");
    } finally {
      await lock.release();
    }
  });

  it("refuses missing profiles with profile_not_found while writing a valid haul", async () => {
    const outDir = await tempRoot();
    const profileRoot = await tempRoot();
    const stdout: unknown[] = [];

    const result = await captureSite({
      entrypoint: "http://127.0.0.1:43114/protected/",
      outDir,
      modes: ["study"],
      depth: 0,
      profileName: "missing",
      profileRoot,
      eventSink: (event) => stdout.push(event),
      logSink: () => undefined
    });

    const manifest = JSON.parse(await readFile(join(result.haulPath, "MANIFEST.json"), "utf8"));
    expect(validateManifest(manifest).valid).toBe(true);
    expect(stdout.every((event) => validateEvent(event).valid)).toBe(true);
    expect(manifest.result).toBe("partial");
    expect(manifest.auth).toEqual({
      mode: "profile",
      profileName: "missing",
      storageStateUsed: false,
      redacted: true
    });
    expect(manifest.errors[0]).toMatchObject({ code: "profile_not_found", fatal: true });
    expect(stdout.at(-1)).toMatchObject({ v: 2, type: "done", result: "partial" });
  });
});
