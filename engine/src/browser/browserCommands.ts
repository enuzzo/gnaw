import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { resolveBrowser as defaultResolveBrowser, type ResolvedBrowser } from "./resolveBrowser.js";

export type BrowserStatusEvent = {
  v: 2;
  type: "browser";
  status: "found" | "downloading";
  detail?: string;
  progress?: number;
};

export type BrowserCommandDeps = {
  resolveBrowser?: () => ResolvedBrowser;
  installChromium?: () => Promise<void>;
};

export function checkBrowser({ resolveBrowser = defaultResolveBrowser }: BrowserCommandDeps = {}): {
  found: boolean;
  detail?: string;
} {
  try {
    return { found: true, detail: resolveBrowser().label };
  } catch {
    return { found: false };
  }
}

export async function ensureBrowser(
  emit: (event: BrowserStatusEvent) => void,
  { resolveBrowser = defaultResolveBrowser, installChromium = defaultInstallChromium }: BrowserCommandDeps = {}
): Promise<void> {
  const existing = checkBrowser({ resolveBrowser });
  if (existing.found) {
    emit({ v: 2, type: "browser", status: "found", detail: existing.detail });
    return;
  }
  emit({ v: 2, type: "browser", status: "downloading", detail: "Downloading browser engine…" });
  await installChromium();
  emit({ v: 2, type: "browser", status: "found", detail: resolveBrowser().label });
}

const INSTALL_CHROMIUM_TIMEOUT_MS = 10 * 60 * 1000;

async function defaultInstallChromium(): Promise<void> {
  const require = createRequire(import.meta.url);
  // playwright-core exposes ./package.json; cli.js sits beside it.
  const cliPath = join(dirname(require.resolve("playwright-core/package.json")), "cli.js");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, "install", "chromium"], {
      stdio: ["ignore", "inherit", "inherit"],
      env: process.env
    });
    const onSigterm = () => child.kill("SIGKILL");
    process.once("SIGTERM", onSigterm);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Chromium download timed out"));
    }, INSTALL_CHROMIUM_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timer);
      process.removeListener("SIGTERM", onSigterm);
    };
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("exit", (code) => {
      cleanup();
      code === 0 ? resolve() : reject(new Error(`chromium install failed (exit ${code})`));
    });
  });
}
