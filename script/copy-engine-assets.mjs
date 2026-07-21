import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

// Non-TS runtime data files that tsc does not emit. Add new entries here.
const assets = ["engine/src/stack/stacks.json"];

for (const rel of assets) {
  const from = join(root, rel);
  const to = join(root, "dist", rel);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
  console.log(`copied ${rel} -> dist/${rel}`);
}
