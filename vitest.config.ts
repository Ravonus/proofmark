import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

const premiumDir = path.resolve(__dirname, "premium");
const hasPremium = existsSync(path.join(premiumDir, "index.ts"));

export default defineConfig({
  resolve: {
    alias: [
      ...(hasPremium ? [{ find: "~/premium", replacement: premiumDir }] : []),
      { find: "~", replacement: path.resolve(__dirname, "src") },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts", ...(hasPremium ? ["premium/**/__tests__/**/*.test.ts"] : [])],
    exclude: [
      "src/server/__tests__/rust-engine.test.ts",
      "src/server/__tests__/pdf-analyze-parity.test.ts",
      "src/server/__tests__/pdf-analyze-stress.test.ts",
    ],
    setupFiles: ["./src/test-setup.ts"],
    env: {
      SKIP_ENV_VALIDATION: "1",
    },
  },
});
