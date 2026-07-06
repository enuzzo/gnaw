import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeRenderedSnapshot } from "../../src/render/renderedSnapshot";

describe("rendered snapshot writer", () => {
  it("rejects traversal outside study/rendered", async () => {
    const haulPath = await mkdtemp(join(tmpdir(), "gnaw-rendered-"));

    await expect(
      writeRenderedSnapshot({
        haulPath,
        renderedPath: "study/rendered/../raw/escape.html",
        html: "<html></html>"
      })
    ).rejects.toThrow(/outside haul|outside rendered/i);
  });

  it("refuses to write through symlinked directories", async () => {
    const haulPath = await mkdtemp(join(tmpdir(), "gnaw-rendered-"));
    await mkdir(join(haulPath, "study", "rendered"), { recursive: true });
    await symlink(tmpdir(), join(haulPath, "study", "rendered", "linked"));

    await expect(
      writeRenderedSnapshot({
        haulPath,
        renderedPath: "study/rendered/linked/page.html",
        html: "<html></html>"
      })
    ).rejects.toThrow(/symlink/i);
  });
});
