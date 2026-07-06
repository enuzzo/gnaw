import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

export type ResolvedBrowser = {
  executablePath: string;
  label: string;
};

export type BrowserResolverDependencies = {
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
  playwrightExecutablePath?: () => string;
};

const macCandidates = [
  {
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    label: "Google Chrome"
  },
  {
    executablePath: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    label: "Microsoft Edge"
  },
  {
    executablePath: "/Applications/Chromium.app/Contents/MacOS/Chromium",
    label: "Chromium"
  }
];

export function resolveBrowser({
  env = process.env,
  exists = existsSync,
  playwrightExecutablePath = () => chromium.executablePath()
}: BrowserResolverDependencies = {}): ResolvedBrowser {
  const playwrightPath = playwrightExecutablePath();
  if (exists(playwrightPath)) {
    return { executablePath: playwrightPath, label: "Playwright Chromium" };
  }

  const envPath = env.GNAW_CHROME_PATH;
  if (envPath && exists(envPath)) {
    return { executablePath: envPath, label: "Custom Chromium" };
  }

  const browser = macCandidates.find((candidate) => exists(candidate.executablePath));
  if (!browser) {
    throw new Error("No supported Chromium browser found");
  }

  return browser;
}
