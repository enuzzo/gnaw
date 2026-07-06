import { describe, expect, it } from "vitest";
import { createCliProgram } from "../../src/cli";

describe("CLI surface", () => {
  it("registers capture and auth commands", () => {
    const program = createCliProgram();

    expect(program.commands.map((command) => command.name()).sort()).toEqual([
      "auth",
      "capture"
    ]);
    expect(program.commands.find((command) => command.name() === "auth")?.commands.map((command) => command.name()).sort()).toEqual([
      "delete",
      "list",
      "login"
    ]);
  });
});
