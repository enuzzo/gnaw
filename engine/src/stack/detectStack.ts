import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type StackSignal = {
  name: string;
  confidence: number;
  signals: string[];
};

export type DetectedStack = {
  primary: string | null;
  detected: StackSignal[];
};

type StackRule = {
  name: string;
  signals: Array<{
    kind: "html" | "asset" | "header";
    pattern: string;
    label: string;
    weight: number;
  }>;
};

const stackRules = JSON.parse(
  readFileSync(fileURLToPath(new URL("./stacks.json", import.meta.url)), "utf8")
) as StackRule[];

export function detectStack({
  html,
  assetUrls,
  headers = {}
}: {
  html: string;
  assetUrls: string[];
  headers?: Record<string, string>;
}): DetectedStack {
  const normalizedHtml = html.toLowerCase();
  const normalizedAssets = assetUrls.map((url) => url.toLowerCase());
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value.toLowerCase()])
  );

  const detected = stackRules
    .map((rule) => {
      const matched = rule.signals.filter((signal) =>
        signalMatches(signal, normalizedHtml, normalizedAssets, normalizedHeaders)
      );
      return {
        name: rule.name,
        confidence: Math.min(1, matched.reduce((total, signal) => total + signal.weight, 0)),
        signals: matched.map((signal) => signal.label)
      };
    })
    .filter((rule) => rule.confidence >= 0.6)
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));

  return {
    primary: detected[0]?.name ?? null,
    detected
  };
}

function signalMatches(
  signal: StackRule["signals"][number],
  html: string,
  assetUrls: string[],
  headers: Record<string, string>
): boolean {
  const pattern = signal.pattern.toLowerCase();
  if (signal.kind === "html") {
    return html.includes(pattern);
  }
  if (signal.kind === "asset") {
    return assetUrls.some((url) => url.includes(pattern));
  }
  return Object.entries(headers).some(([name, value]) => `${name}: ${value}`.includes(pattern));
}
