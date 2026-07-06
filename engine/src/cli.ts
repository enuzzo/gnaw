import { Command } from "commander";

export const engineIdentity = {
  name: "gnaw-playwright",
  version: "1.0.0",
  contract: "2.0"
} as const;

export function createCliProgram(): Command {
  const program = new Command();

  program.name("gnaw").version("1.0.0");

  program
    .command("capture")
    .argument("<url>")
    .option("--mode <modes>", "output modes", "study,navigable")
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
    .action(() => {
      throw new Error("capture is not implemented yet");
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
