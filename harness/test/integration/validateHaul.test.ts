import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startFixture, type RunningFixture } from "../helpers/fixtures";
import { FIXTURE_NAMES, type FixtureName } from "../../../fixtures/src/registry";
import { captureSite } from "../../../engine/src/capture/capture";
import { validateHaul } from "../../src/cli";

describe("harness haul validation", () => {
  const tmpRoots: string[] = [];
  const fixtures: RunningFixture[] = [];

  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
    await Promise.all(tmpRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it.each(FIXTURE_NAMES)("validates manifest and waterfall contract files in a %s haul", async (fixtureName: FixtureName) => {
    const fixture = await startFixture(fixtureName);
    fixtures.push(fixture);
    const outDir = await mkdtemp(join(tmpdir(), "gnaw-harness-"));
    tmpRoots.push(outDir);

    const result = await captureSite({
      entrypoint: `${fixture.origin}/`,
      outDir,
      modes: ["study"],
      depth: 0,
      eventSink: () => undefined,
      logSink: () => undefined
    });

    const validation = await validateHaul(result.haulPath);
    expect(validation.manifests).toBe(1);
    expect(validation.waterfallRows).toBeGreaterThan(0);
  }, 15000);
});
