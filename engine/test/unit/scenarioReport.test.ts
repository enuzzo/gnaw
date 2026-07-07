import { describe, expect, it } from "vitest";
import type { ScenarioAnalysis } from "../../src/scenario/analyze";
import { renderScenarioReport } from "../../src/scenario/report";

describe("scenario report", () => {
  it("renders endpoint inventory, auth gate, and next actions", () => {
    const analysis: ScenarioAnalysis = {
      networkLogPath: "/tmp/network.ndjson",
      responseBodyPaths: ["/tmp/auth.json"],
      malformedRows: 0,
      jobIds: ["job-123"],
      countsByKind: {
        page: 1,
        asset: 0,
        api: 0,
        parse: 1,
        generate: 1,
        status: 1,
        preview: 2,
        downloadIntent: 1,
        download: 1,
        auth: 0,
        unknown: 0
      },
      authGate: {
        required: true,
        evidence: ["/tmp/auth.json: auth_required", "401 GET /download/job-123/3mf"]
      },
      endpoints: [
        { kind: "parse", method: "POST", url: "https://example.test/parse", path: "/parse", status: 200, contentType: "application/json", queryKeys: [] },
        { kind: "generate", method: "POST", url: "https://example.test/upload?grid_res=70&shape=square", path: "/upload", status: 200, contentType: "application/json", queryKeys: ["grid_res", "shape"] },
        { kind: "status", method: "GET", url: "https://example.test/status/job-123", path: "/status/job-123", status: 200, contentType: "application/json", queryKeys: [] },
        { kind: "preview", method: "GET", url: "https://example.test/preview_mesh/job-123/terrain", path: "/preview_mesh/job-123/terrain", status: 200, contentType: "model/gltf-binary", queryKeys: [] },
        { kind: "downloadIntent", method: "POST", url: "https://example.test/download-intent/job-123", path: "/download-intent/job-123", status: 200, contentType: "application/json", queryKeys: [] },
        { kind: "download", method: "GET", url: "https://example.test/download/job-123/3mf", path: "/download/job-123/3mf", status: 401, contentType: "application/json", queryKeys: [] }
      ]
    };

    const report = renderScenarioReport(analysis);

    expect(report).toContain("# Dynamic Site Study");
    expect(report).toContain("Auth gate: required");
    expect(report).toContain("| generate | POST | 200 | /upload | grid_res, shape |");
    expect(report).toContain("job-123");
    expect(report).toContain("Create or refresh a named auth profile");
    expect(report).toContain("Repeat the scenario with the authenticated profile");
    expect(report).toContain("Do not store plaintext credentials");
  });
});
