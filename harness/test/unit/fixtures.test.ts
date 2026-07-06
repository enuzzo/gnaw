import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { FIXTURE_NAMES, fixtureRegistry } from "../../../fixtures/src/registry";
import { createStaticServer } from "../../../fixtures/src/server";

const expectedNames = [
  "static",
  "spa",
  "wordpress",
  "lazy",
  "auth",
  "hostile-paths"
] as const;

describe("fixture registry", () => {
  it("defines the authoritative local fixture corpus", () => {
    expect(FIXTURE_NAMES).toEqual(expectedNames);
    expect(Object.keys(fixtureRegistry)).toEqual(expectedNames);
  });

  it("uses only loopback HTTP origins and reserves a second hostile origin", () => {
    for (const name of expectedNames) {
      const fixture = fixtureRegistry[name];

      expect(fixture.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(fixture.publicDir).toBe(`fixtures/sites/${name}/public`);
    }

    expect(fixtureRegistry["hostile-paths"].extraOrigins).toEqual([
      "http://127.0.0.1:43116"
    ]);
  });

  it("ships deterministic HTML entrypoints with matching titles and no live URLs", async () => {
    for (const name of expectedNames) {
      const fixture = fixtureRegistry[name];
      const html = await readFile(`${fixture.publicDir}/index.html`, "utf8");

      expect(html).toContain("<!doctype html>");
      expect(html).toContain(`<title>${fixture.title}</title>`);
      expect(html).not.toMatch(/https?:\/\/(?!127\.0\.0\.1(?::|\/))/);
    }
  });

  it("serves fixture files from a loopback static server", async () => {
    const server = createStaticServer({
      publicDir: fixtureRegistry.static.publicDir
    });

    const port = await new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve((server.address() as AddressInfo).port);
      });
    });

    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(html).toContain("<title>Static Fixture</title>");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});
