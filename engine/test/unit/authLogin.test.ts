import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { createProfileStore, ProfileLockedError } from "../../src/auth/profiles";
import { loginProfile } from "../../src/auth/login";

describe("auth login", () => {
  const tmpRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tmpRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function tempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "gnaw-auth-login-"));
    tmpRoots.push(root);
    return root;
  }

  it("refuses login when the profile is locked", async () => {
    const store = createProfileStore({ root: await tempRoot() });
    const lock = await store.acquireLock("client-a");

    try {
      await expect(loginProfile({
        url: "http://127.0.0.1:43114/",
        profileName: "client-a",
        store,
        launchPersistentContext: async () => {
          throw new Error("browser should not launch");
        }
      })).rejects.toBeInstanceOf(ProfileLockedError);
    } finally {
      await lock.release();
    }
  });

  it("redacts sensitive fragments before storing last verified URL", async () => {
    const store = createProfileStore({ root: await tempRoot() });

    const metadata = await loginProfile({
      url: "http://127.0.0.1:43114/callback#access_token=gnaw_hash_secret_DO_NOT_LEAK&section=main",
      profileName: "client-a",
      store,
      launchPersistentContext: async () => ({
        newPage: async () => ({
          mainFrame: () => "main-frame",
          on: () => undefined,
          goto: async () => undefined
        }),
        once: (_event: string, callback: () => void) => {
          callback();
        },
        close: async () => undefined
      }) as unknown as BrowserContext
    });

    expect(metadata.lastVerifiedUrl).not.toContain("gnaw_hash_secret_DO_NOT_LEAK");
    expect(metadata.lastVerifiedUrl).toContain("access_token=%5BREDACTED%5D");
    expect(metadata.lastVerifiedUrl).toContain("section=main");
  });
});
