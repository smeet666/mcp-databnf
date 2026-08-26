import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globals: false,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary"],
      // Every source file counts, including one no test imports: a module left
      // out of the suite is what this measures.
      include: ["src/**/*.ts"],
      // The executable takes stdio and ends the process as it is imported, so a
      // test that loads it takes the runner with it. What it wires is measured
      // where it is built.
      exclude: ["src/index.ts"],
      // The floor is what the suite reaches, and it does not go down.
      thresholds: {
        statements: 95,
        branches: 85,
        functions: 95,
        lines: 95,
      },
    },
  },
});
