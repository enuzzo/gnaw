import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeScenario } from "../../src/scenario/analyze";

describe("scenario analyzer", () => {
  const tmpRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tmpRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function tempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "gnaw-scenario-"));
    tmpRoots.push(root);
    return root;
  }

  it("classifies dynamic render and export pipeline endpoints", async () => {
    const root = await tempRoot();
    const networkPath = join(root, "network.ndjson");
    await writeFile(
      networkPath,
      [
        { type: "response", method: "GET", url: "https://example.test/workspace", status: 200, contentType: "text/html; charset=utf-8" },
        { type: "response", method: "POST", url: "https://example.test/parse", status: 200, contentType: "application/json" },
        { type: "response", method: "POST", url: "https://example.test/upload?grid_res=70&shape=square", status: 200, contentType: "application/json" },
        { type: "response", method: "GET", url: "https://example.test/status/job-123", status: 200, contentType: "application/json" },
        { type: "response", method: "GET", url: "https://example.test/preview_mesh/job-123/terrain", status: 200, contentType: "model/gltf-binary" },
        { type: "response", method: "GET", url: "https://example.test/preview_points/job-123", status: 200, contentType: "application/json" },
        { type: "response", method: "POST", url: "https://example.test/download-intent/job-123", status: 200, contentType: "application/json" },
        { type: "response", method: "POST", url: "https://example.test/register_download/job-123", status: 200, contentType: "application/json" },
        { type: "response", method: "GET", url: "https://example.test/download/job-123/3mf", status: 401, contentType: "application/json" }
      ].map((row) => JSON.stringify(row)).join("\n"),
      "utf8"
    );
    const authBodyPath = join(root, "download-error.json");
    await writeFile(authBodyPath, '{"error":"Sign in to download models","kind":"auth_required"}', "utf8");

    const analysis = await analyzeScenario({
      networkLogPath: networkPath,
      responseBodyPaths: [authBodyPath]
    });

    expect(analysis.countsByKind).toMatchObject({
      page: 1,
      parse: 1,
      generate: 1,
      status: 1,
      preview: 2,
      downloadIntent: 2,
      download: 1
    });
    expect(analysis.jobIds).toEqual(["job-123"]);
    expect(analysis.authGate).toMatchObject({
      required: true,
      evidence: expect.arrayContaining([
        expect.stringContaining("auth_required"),
        expect.stringContaining("401")
      ])
    });
    expect(analysis.endpoints.find((endpoint) => endpoint.kind === "generate")).toMatchObject({
      method: "POST",
      path: "/upload",
      queryKeys: ["grid_res", "shape"]
    });
  });

  it("skips malformed JSONL rows while preserving useful findings", async () => {
    const root = await tempRoot();
    const networkPath = join(root, "network.ndjson");
    await writeFile(
      networkPath,
      [
        "{not-json",
        JSON.stringify({ type: "response", method: "GET", url: "https://example.test/api/status/job-9", status: 200, contentType: "application/json" })
      ].join("\n"),
      "utf8"
    );

    const analysis = await analyzeScenario({ networkLogPath: networkPath });

    expect(analysis.malformedRows).toBe(1);
    expect(analysis.countsByKind.status).toBe(1);
    expect(analysis.jobIds).toEqual(["job-9"]);
  });
});
