import { posix } from "node:path";

export type OutputKind = "site" | "screenshots" | "exports" | "reports" | "network" | "bodies" | "logs";

export type OutputSessionLayout = {
  rootDir: string;
  domain: string;
  date: string;
  time: string;
  projectName: string;
  sessionName: string;
  sessionDir: string;
  kindDirs: Record<OutputKind, string>;
  fileName(suffix: string): string;
};

const outputKinds: OutputKind[] = ["site", "screenshots", "exports", "reports", "network", "bodies", "logs"];

export function buildOutputSessionLayout({
  rootDir,
  domain,
  projectName,
  at = new Date()
}: {
  rootDir: string;
  domain: string;
  projectName: string;
  at?: Date;
}): OutputSessionLayout {
  const normalizedDomain = sanitizeDomain(domain);
  const date = formatDate(at);
  const time = formatTime(at);
  const normalizedProject = sanitizeOutputName(projectName);
  const sessionName = `${date}__${normalizedProject}__${time}`;
  const sessionDir = posix.join(rootDir, normalizedDomain, date, sessionName);
  const kindDirs = Object.fromEntries(outputKinds.map((kind) => [kind, posix.join(sessionDir, kind)])) as Record<OutputKind, string>;

  return {
    rootDir,
    domain: normalizedDomain,
    date,
    time,
    projectName: normalizedProject,
    sessionName,
    sessionDir,
    kindDirs,
    fileName(suffix: string): string {
      const cleanSuffix = suffix.replace(/^[_\-.]+/, "");
      if (cleanSuffix.includes(".")) {
        return `${sessionName}__${cleanSuffix}`;
      }
      return `${sessionName}.${cleanSuffix}`;
    }
  };
}

export function sanitizeOutputName(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^\x00-\x7F]/g, "_")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_\-.]+|[_\-.]+$/g, "");
  return sanitized || "untitled";
}

function sanitizeDomain(value: string): string {
  return sanitizeOutputName(value.toLowerCase());
}

function formatDate(value: Date): string {
  return [
    value.getFullYear(),
    pad2(value.getMonth() + 1),
    pad2(value.getDate())
  ].join("-");
}

function formatTime(value: Date): string {
  return [
    pad2(value.getHours()),
    pad2(value.getMinutes()),
    pad2(value.getSeconds())
  ].join("-");
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}
