import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AssetKind } from "../assets/classifyKind.js";

export type WaterfallRow = {
  t: number;
  url: string;
  method: "GET";
  status: number;
  kind: AssetKind;
  contentType: string;
  bytes: number;
  durationMs: number;
  fromCache: boolean;
  viaJs: boolean;
  referrer: string | null;
  page: string;
};

export async function appendWaterfallRow(haulPath: string, row: WaterfallRow): Promise<void> {
  const filePath = join(haulPath, "waterfall.ndjson");
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(row)}\n`, "utf8");
}
