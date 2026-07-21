import { existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const asset = new URL("../../../dist/engine/src/stack/stacks.json", import.meta.url);

describe("copy-engine-assets", () => {
  it("copies stacks.json into dist after running the script", () => {
    rmSync(fileURLToPath(asset), { force: true });
    execFileSync("node", ["script/copy-engine-assets.mjs"], { cwd: root });
    expect(existsSync(fileURLToPath(asset))).toBe(true);
  });
});
