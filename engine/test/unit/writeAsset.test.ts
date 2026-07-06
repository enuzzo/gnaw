import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { writeAsset } from "../../src/assets/writeAsset";

describe("writeAsset", () => {
  const tmpRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tmpRoots.map((root) => rm(root, { recursive: true, force: true })));
    tmpRoots.length = 0;
  });

  async function createHaulRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "gnaw-write-asset-"));
    tmpRoots.push(root);
    return root;
  }

  it("writes original bytes under study/raw/<host>/<path> and returns manifest metadata", async () => {
    const outputRoot = await createHaulRoot();
    const body = Buffer.from("console.log('gnaw');");

    const result = await writeAsset({
      outputRoot,
      url: "https://cdn.example.com/assets/app.js?v=1",
      contentType: "application/javascript",
      body,
      normalizedPath: "cdn.example.com/assets/app~q3bfc2695.js"
    });

    expect(await readFile(join(outputRoot, result.rawPath))).toEqual(body);
    expect(result).toEqual({
      bytes: body.byteLength,
      sha256: createHash("sha256").update(body).digest("hex"),
      rawPath: "study/raw/cdn.example.com/assets/app~q3bfc2695.js"
    });
  });

  it("accepts a Uint8Array body and a normalizer callback", async () => {
    const outputRoot = await createHaulRoot();
    const body = new Uint8Array([0, 1, 2, 3]);

    const result = await writeAsset({
      outputRoot,
      url: "https://static.example.com/img/logo.png",
      contentType: "image/png",
      body,
      normalizePath: (url, contentType) => {
        expect(url).toBe("https://static.example.com/img/logo.png");
        expect(contentType).toBe("image/png");
        return "static.example.com/img/logo.png";
      }
    });

    expect(await readFile(join(outputRoot, result.rawPath))).toEqual(Buffer.from(body));
    expect(result.bytes).toBe(4);
  });

  it("rejects normalized paths that would escape study/raw", async () => {
    const outputRoot = await createHaulRoot();

    await expect(
      writeAsset({
        outputRoot,
        url: "https://example.com/evil",
        contentType: "text/plain",
        body: Buffer.from("evil"),
        normalizedPath: "../MANIFEST.json"
      })
    ).rejects.toThrow(/path traversal/i);
  });

  it("rejects pre-existing symlink ancestors inside study/raw", async () => {
    const outputRoot = await createHaulRoot();
    const outsideRoot = await createHaulRoot();
    await mkdir(join(outputRoot, "study", "raw"), { recursive: true });
    await symlink(outsideRoot, join(outputRoot, "study", "raw", "example.com"));

    await expect(
      writeAsset({
        outputRoot,
        url: "https://example.com/app.js",
        contentType: "application/javascript",
        body: Buffer.from("alert(1);"),
        normalizedPath: "example.com/app.js"
      })
    ).rejects.toThrow(/symlink/i);
  });
});
