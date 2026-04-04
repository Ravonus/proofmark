import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    exclude: [
      "src/server/__tests__/rust-engine.test.ts",
      "src/server/__tests__/pdf-analyze-parity.test.ts",
      "src/server/__tests__/pdf-analyze-stress.test.ts",
    ],
    env: {
      SKIP_ENV_VALIDATION: "1",
    },
  },
});
