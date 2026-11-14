import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "web/src/**/*.test.{ts,tsx}",
      "florets/**/*.test.{ts,tsx}",
      "scripts/preview/**/*.test.ts",
    ],
    environment: "node",
    restoreMocks: true,
    testTimeout: 15_000,
  },
});
