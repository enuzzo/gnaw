import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "engine/test/**/*.test.ts",
      "harness/test/**/*.test.ts"
    ]
  }
});
