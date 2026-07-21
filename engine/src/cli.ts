import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import type { Readable, Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { createCaptureController } from "./capture/controller.js";
import { createEventWriter } from "./capture/events.js";
import { captureSite, type CaptureOptions, type CaptureResult } from "./capture/capture.js";
import { createProfileStore, type ListedProfile, type ProfileMetadata, type ProfileStore } from "./auth/profiles.js";
import { loginProfile } from "./auth/login.js";
import { buildBlockPatterns } from "./safety/blocklist.js";
import { analyzeScenario } from "./scenario/analyze.js";
import { renderScenarioReport } from "./scenario/report.js";
import { checkBrowser, ensureBrowser } from "./browser/browserCommands.js";
import { resolveBrowser as defaultResolveBrowser, type ResolvedBrowser } from "./browser/resolveBrowser.js";
export { engineIdentity } from "./identity.js";

export type AuthLogin = (options: { url: string; profileName: string; store: ProfileStore }) => Promise<ProfileMetadata>;

export type CliDependencies = {
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
  capture?: (options: CaptureOptions) => Promise<CaptureResult>;
  profileStore?: ProfileStore;
  authLogin?: AuthLogin;
  resolveBrowser?: () => ResolvedBrowser;
  installBrowser?: () => Promise<void>;
};

export async function runCli(argv = process.argv, dependencies: CliDependencies = {}): Promise<void> {
  await createCliProgram(dependencies).parseAsync(argv);
}

export function createCliProgram({
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  capture = captureSite,
  profileStore = createProfileStore(),
  authLogin = loginProfile,
  resolveBrowser = defaultResolveBrowser,
  installBrowser
}: CliDependencies = {}): Command {
  const program = new Command();

  program.name("gnaw").version("1.0.0");

  program
    .command("capture")
    .argument("<url>")
    .option("--mode <modes>", "output modes", "study")
    .option("--depth <n>", "crawl depth", "1")
    .option("--profile <name>", "auth profile name")
    .option("--subdomains", "include subdomains")
    .option("--robots", "respect robots.txt")
    .option("--rate-limit <ms>", "rate limit in milliseconds", "250")
    .option("--out <dir>", "output directory")
    .option("--max-pages <n>", "maximum pages", "200")
    .option("--max-bytes <n>", "maximum total bytes", "2147483648")
    .option("--max-asset-bytes <n>", "maximum asset bytes", "104857600")
    .option("--block <pattern>", "navigation blocklist pattern", collect, [])
    .option("--unblock <pattern>", "remove a default navigation blocklist pattern", collect, [])
    .action(async (url: string, options: Record<string, unknown>) => {
      const modes = parseModes(String(options.mode ?? "study"));
      const writer = createEventWriter({ stdout, stderr });
      const abortController = new AbortController();
      const controller = createCaptureController({
        stdin,
        writer,
        logger: { warn: (message) => writer.log(message) },
        onCancel: () => abortController.abort()
      });
      const cancelOnSigterm = () => controller.cancel();
      process.once("SIGTERM", cancelOnSigterm);
      try {
        await capture({
          entrypoint: url,
          outDir: typeof options.out === "string" ? options.out : process.cwd(),
          modes,
          depth: Number.parseInt(String(options.depth ?? "1"), 10),
          maxPages: Number.parseInt(String(options.maxPages ?? "200"), 10),
          maxTotalBytes: Number.parseInt(String(options.maxBytes ?? "2147483648"), 10),
          maxAssetBytes: Number.parseInt(String(options.maxAssetBytes ?? "104857600"), 10),
          profileName: typeof options.profile === "string" ? options.profile : undefined,
          blockPatterns: buildBlockPatterns({
            add: Array.isArray(options.block) ? options.block.map(String) : [],
            remove: Array.isArray(options.unblock) ? options.unblock.map(String) : []
          }),
          signal: abortController.signal,
          control: controller,
          eventSink: (event) => writer.event(event),
          logSink: (line) => writer.log(line)
        });
      } finally {
        process.off("SIGTERM", cancelOnSigterm);
      }
    });

  const auth = program.command("auth");

  auth
    .command("login")
    .argument("<url>")
    .requiredOption("--profile <name>", "profile name")
    .action(async (url: string, options: { profile: string }) => {
      const writer = createEventWriter({ stdout, stderr });
      const profile = await authLogin({ url, profileName: options.profile, store: profileStore });
      writer.event(authProfileEvent({ ...profile, locked: false }));
      writer.log(`Saved auth profile ${profile.name}`);
    });
  auth.command("list").action(async () => {
    const writer = createEventWriter({ stdout, stderr });
    for (const profile of await profileStore.listProfiles()) {
      writer.event(authProfileEvent(profile));
    }
  });
  auth.command("delete").argument("<name>").action(async (name: string) => {
    const writer = createEventWriter({ stdout, stderr });
    await profileStore.deleteProfile(name);
    writer.event({ v: 2, type: "auth_deleted", profileName: name });
    writer.log(`Deleted auth profile ${name}`);
  });

  const scenario = program.command("scenario");

  scenario
    .command("analyze")
    .requiredOption("--network <path>", "scenario network NDJSON path")
    .option("--body <path>", "response body path to scan for gates and errors", collect, [])
    .option("--out <path>", "write markdown report to this path")
    .action(async (options: { network: string; body?: string[]; out?: string }) => {
      const writer = createEventWriter({ stdout, stderr });
      const analysis = await analyzeScenario({
        networkLogPath: options.network,
        responseBodyPaths: options.body ?? []
      });
      const report = renderScenarioReport(analysis);
      if (options.out) {
        await writeFile(options.out, report, "utf8");
        writer.log(`Wrote scenario report ${options.out}`);
      } else {
        writer.log(report.trimEnd());
      }
      writer.event({
        v: 2,
        type: "scenario_analysis",
        networkLogPath: analysis.networkLogPath,
        reportPath: options.out ?? null,
        authRequired: analysis.authGate.required,
        jobIds: analysis.jobIds,
        countsByKind: analysis.countsByKind,
        malformedRows: analysis.malformedRows
      });
    });

  const browser = program.command("browser");

  browser.command("check").action(() => {
    const writer = createEventWriter({ stdout, stderr });
    const result = checkBrowser({ resolveBrowser });
    if (result.found) {
      writer.event({ v: 2, type: "browser", status: "found", detail: result.detail });
    } else {
      writer.log("No supported browser engine found.");
      process.exitCode = 3;
    }
  });

  browser.command("ensure").action(async () => {
    const writer = createEventWriter({ stdout, stderr });
    try {
      await ensureBrowser((event) => writer.event(event), { resolveBrowser, installChromium: installBrowser });
    } catch (error) {
      writer.log(error instanceof Error ? error.message : String(error));
      process.exitCode = 4;
    }
  });

  return program;
}

function authProfileEvent(profile: ListedProfile): { v: 2; type: "auth_profile"; profileName: string; lastVerifiedUrl: string; lastVerifiedAt: string; locked: boolean } {
  return {
    v: 2,
    type: "auth_profile",
    profileName: profile.name,
    lastVerifiedUrl: profile.lastVerifiedUrl,
    lastVerifiedAt: profile.lastVerifiedAt,
    locked: profile.locked
  };
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseModes(value: string): Array<"study" | "navigable"> {
  const rawModes = value.split(",").map((mode) => mode.trim()).filter(Boolean);
  const modes = rawModes.filter((mode): mode is "study" | "navigable" => mode === "study" || mode === "navigable");
  if (modes.length !== rawModes.length || modes.length === 0) {
    throw new Error(`Invalid mode: ${value}`);
  }
  return modes;
}

export function isCliEntrypoint(moduleUrl = import.meta.url, argvPath = process.argv[1]): boolean {
  return argvPath !== undefined && moduleUrl === pathToFileURL(argvPath).href;
}

if (isCliEntrypoint()) {
  runCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
