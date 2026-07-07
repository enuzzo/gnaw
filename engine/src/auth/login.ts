import { chromium } from "playwright-core";
import { resolveBrowser } from "../browser/resolveBrowser.js";
import { redactText } from "../redaction/redact.js";
import type { ProfileMetadata, ProfileStore } from "./profiles.js";

export type AuthLoginOptions = {
  url: string;
  profileName: string;
  store: ProfileStore;
  launchPersistentContext?: typeof chromium.launchPersistentContext;
  now?: () => Date;
};

export async function loginProfile({
  url,
  profileName,
  store,
  launchPersistentContext = chromium.launchPersistentContext,
  now = () => new Date()
}: AuthLoginOptions): Promise<ProfileMetadata> {
  const lock = await store.acquireLock(profileName);
  const browserInfo = resolveBrowser();
  let lastVerifiedUrl = url;

  try {
    const profileDir = await store.ensureProfileDir(profileName);
    const context = await launchPersistentContext(profileDir, {
      executablePath: browserInfo.executablePath,
      headless: false,
      args: ["--no-sandbox"]
    });
    const page = await context.newPage();
    try {
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) {
          lastVerifiedUrl = frame.url();
        }
      });
      await page.goto(url, { waitUntil: "load" });
      await new Promise<void>((resolve) => {
        context.once("close", () => resolve());
      });
    } finally {
      await context.close().catch(() => undefined);
    }

    return store.saveMetadata({
      name: profileName,
      lastVerifiedUrl: redactText(lastVerifiedUrl),
      lastVerifiedAt: now().toISOString()
    });
  } finally {
    await lock.release();
  }
}
