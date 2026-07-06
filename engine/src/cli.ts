import { Command } from "commander";
import type { Readable, Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { createCaptureController } from "./capture/controller.js";
import { createEventWriter } from "./capture/events.js";
import { captureSite, type CaptureOptions, type CaptureResult } from "./capture/capture.js";
import { buildBlockPatterns } from "./safety/blocklist.js";
export { engineIdentity } from "./identity.js";

export type CliDependencies = {
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
  capture?: (options: CaptureOptions) => Promise<CaptureResult>;
};

export async function runCli(argv = process.argv, dependencies: CliDependencies = {}): Promise<void> {
  await createCliProgram(dependencies).parseAsync(argv);
}

export function createCliProgram({
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  capture = captureSite
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
    .action(() => {
      throw new Error("auth login is not implemented yet");
    });
  auth.command("list").action(() => {
    throw new Error("auth list is not implemented yet");
  });
  auth.command("delete").argument("<name>").action(() => {
    throw new Error("auth delete is not implemented yet");
  });

  return program;
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
