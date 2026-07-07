import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("auth login default launcher", () => {
  const tmpRoots: string[] = [];

  afterEach(async () => {
    vi.doUnmock("playwright-core");
    vi.resetModules();
    await Promise.all(tmpRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function tempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "gnaw-auth-login-default-"));
    tmpRoots.push(root);
    return root;
  }

  it("keeps Playwright's chromium binding when using the default launcher", async () => {
    let launcherThis: unknown;
    const fakeChromium = {
      executablePath: () => "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      launchPersistentContext: async function (this: unknown) {
        launcherThis = this;
        return {
          newPage: async () => ({
            mainFrame: () => "main-frame",
            on: () => undefined,
            goto: async () => undefined
          }),
          once: (_event: string, callback: () => void) => {
            callback();
          },
          close: async () => undefined
        };
      }
    };

    vi.doMock("playwright-core", () => ({ chromium: fakeChromium }));

    const { createProfileStore } = await import("../../src/auth/profiles");
    const { loginProfile } = await import("../../src/auth/login");
    const store = createProfileStore({ root: await tempRoot() });

    await loginProfile({
      url: "http://127.0.0.1:43114/",
      profileName: "client-a",
      store
    });

    expect(launcherThis).toBe(fakeChromium);
  });
});
