import { mkdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createProfileStore, ProfileLockedError, ProfileNotFoundError } from "../../src/auth/profiles";

describe("auth profiles", () => {
  const tmpRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tmpRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function tempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "gnaw-profiles-"));
    tmpRoots.push(root);
    return root;
  }

  it("stores profile metadata in a 0700 profile directory outside hauls", async () => {
    const root = await tempRoot();
    const store = createProfileStore({ root });

    const metadata = await store.saveMetadata({
      name: "client-a",
      lastVerifiedUrl: "http://127.0.0.1:43114/protected/",
      lastVerifiedAt: "2026-07-06T10:22:31.000Z"
    });

    expect(metadata).toEqual({
      schemaVersion: 1,
      name: "client-a",
      lastVerifiedUrl: "http://127.0.0.1:43114/protected/",
      lastVerifiedAt: "2026-07-06T10:22:31.000Z"
    });
    expect((await stat(store.profileDir("client-a"))).mode & 0o777).toBe(0o700);
    expect(JSON.parse(await readFile(join(store.profileDir("client-a"), "gnaw-profile.json"), "utf8"))).toEqual(metadata);
  });

  it("lists profiles with lock status and deletes a profile directory", async () => {
    const root = await tempRoot();
    const store = createProfileStore({ root });
    await store.saveMetadata({
      name: "client-a",
      lastVerifiedUrl: "http://127.0.0.1:43114/",
      lastVerifiedAt: "2026-07-06T10:22:31.000Z"
    });

    const lock = await store.acquireLock("client-a");
    expect(await store.listProfiles()).toEqual([
      {
        schemaVersion: 1,
        name: "client-a",
        lastVerifiedUrl: "http://127.0.0.1:43114/",
        lastVerifiedAt: "2026-07-06T10:22:31.000Z",
        locked: true
      }
    ]);

    await lock.release();
    await store.deleteProfile("client-a");
    expect(await store.listProfiles()).toEqual([]);
  });

  it("refuses concurrent locks with profile_locked", async () => {
    const root = await tempRoot();
    const store = createProfileStore({ root });
    await mkdir(store.profileDir("client-a"), { recursive: true });
    const first = await store.acquireLock("client-a");

    await expect(store.acquireLock("client-a")).rejects.toBeInstanceOf(ProfileLockedError);
    await expect(store.acquireLock("client-a")).rejects.toMatchObject({ code: "profile_locked" });

    await first.release();
  });

  it("refuses deleting a locked profile with profile_locked", async () => {
    const root = await tempRoot();
    const store = createProfileStore({ root });
    await store.saveMetadata({
      name: "client-a",
      lastVerifiedUrl: "http://127.0.0.1:43114/",
      lastVerifiedAt: "2026-07-06T10:22:31.000Z"
    });
    const lock = await store.acquireLock("client-a");

    try {
      await expect(store.deleteProfile("client-a")).rejects.toBeInstanceOf(ProfileLockedError);
      await expect(store.deleteProfile("client-a")).rejects.toMatchObject({ code: "profile_locked" });
    } finally {
      await lock.release();
    }
  });

  it("reports missing metadata as profile_not_found", async () => {
    const root = await tempRoot();
    const store = createProfileStore({ root });

    await expect(store.readMetadata("missing")).rejects.toBeInstanceOf(ProfileNotFoundError);
    await expect(store.readMetadata("missing")).rejects.toMatchObject({ code: "profile_not_found" });
  });

  it("rejects profile names that could escape the profile root", async () => {
    const root = await tempRoot();
    const store = createProfileStore({ root });

    await expect(store.saveMetadata({
      name: "../client-a",
      lastVerifiedUrl: "http://127.0.0.1:43114/",
      lastVerifiedAt: "2026-07-06T10:22:31.000Z"
    })).rejects.toThrow(/invalid profile name/i);
  });
});
