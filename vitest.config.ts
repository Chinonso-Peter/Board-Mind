import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@boardmind/ai-core": path.resolve(__dirname, "./packages/ai-core/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    testTimeout: 10000,
  },
});
