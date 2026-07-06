import { describe, expect, it } from "vitest";
import { engineIdentity } from "../../src/cli";

describe("engine skeleton", () => {
  it("exposes the Gnaw Playwright engine identity", () => {
    expect(engineIdentity).toEqual({
      name: "gnaw-playwright",
      version: "1.0.0",
      contract: "2.0"
    });
  });
});
