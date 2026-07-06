import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startFixture, type RunningFixture } from "../helpers/fixtures";
import { FIXTURE_NAMES, type FixtureName } from "../../../fixtures/src/registry";
import { captureSite } from "../../../engine/src/capture/capture";
import { summarizeHaulForGolden } from "../../src/cli";

describe("haul golden snapshots", () => {
  const tmpRoots: string[] = [];
  const fixtures: RunningFixture[] = [];

  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
    await Promise.all(tmpRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it.each(FIXTURE_NAMES)("matches the %s fixture haul summary", async (fixtureName: FixtureName) => {
    const fixture = await startFixture(fixtureName);
    fixtures.push(fixture);
    const outDir = await mkdtemp(join(tmpdir(), "gnaw-golden-"));
    tmpRoots.push(outDir);

    const result = await captureSite({
      entrypoint: `${fixture.origin}/`,
      outDir,
      modes: ["study", "navigable"],
      depth: 0,
      eventSink: () => undefined,
      logSink: () => undefined
    });

    const actual = await summarizeHaulForGolden(result.haulPath);
    const expected = JSON.parse(
      await readFile(join(process.cwd(), "harness", "goldens", "hauls", fixtureName, "summary.json"), "utf8")
    );

    expect(actual).toEqual(expected);
  }, 15000);
});
