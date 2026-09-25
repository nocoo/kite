import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    allowOnly: false,
    passWithNoTests: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "web/**/*.ts"],
      reporter: ["text", "json-summary"],
      thresholds: { statements: 95, branches: 95, functions: 95, lines: 95 },
    },
  },
});
