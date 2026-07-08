import { describe, expect, it } from "vitest";
import { buildOutputSessionLayout, sanitizeOutputName } from "../../src/output/naming";

describe("output naming", () => {
  it("builds date-first session folders with project name before time", () => {
    const layout = buildOutputSessionLayout({
      rootDir: "output",
      domain: "TrailMark3D.COM",
      projectName: "Granforcora 2026",
      at: new Date(2026, 6, 8, 8, 42, 15)
    });

    expect(layout.sessionName).toBe("2026-07-08__Granforcora_2026__08-42-15");
    expect(layout.sessionDir).toBe("output/trailmark3d.com/2026-07-08/2026-07-08__Granforcora_2026__08-42-15");
    expect(layout.kindDirs).toMatchObject({
      site: "output/trailmark3d.com/2026-07-08/2026-07-08__Granforcora_2026__08-42-15/site",
      screenshots: "output/trailmark3d.com/2026-07-08/2026-07-08__Granforcora_2026__08-42-15/screenshots",
      exports: "output/trailmark3d.com/2026-07-08/2026-07-08__Granforcora_2026__08-42-15/exports",
      reports: "output/trailmark3d.com/2026-07-08/2026-07-08__Granforcora_2026__08-42-15/reports",
      network: "output/trailmark3d.com/2026-07-08/2026-07-08__Granforcora_2026__08-42-15/network",
      bodies: "output/trailmark3d.com/2026-07-08/2026-07-08__Granforcora_2026__08-42-15/bodies",
      logs: "output/trailmark3d.com/2026-07-08/2026-07-08__Granforcora_2026__08-42-15/logs"
    });
    expect(layout.fileName("3mf")).toBe("2026-07-08__Granforcora_2026__08-42-15.3mf");
    expect(layout.fileName("scenario-report.md")).toBe("2026-07-08__Granforcora_2026__08-42-15__scenario-report.md");
  });

  it("sanitizes names for portable output paths", () => {
    expect(sanitizeOutputName(" Lago Maggiore / GPX: demo! ")).toBe("Lago_Maggiore_GPX_demo");
    expect(sanitizeOutputName("")).toBe("untitled");
  });
});
