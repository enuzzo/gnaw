import { describe, expect, it } from "vitest";
import { loadContractSchemas } from "../../src/contract/validate";

describe("contract schema loader", () => {
  it("loads manifest, events, and waterfall schemas", async () => {
    const schemas = await loadContractSchemas();

    expect(Object.keys(schemas).sort()).toEqual([
      "events",
      "manifest",
      "waterfall"
    ]);
  });
});
