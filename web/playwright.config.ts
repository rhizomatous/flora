import { defineConfig } from "@playwright/test";

const previewURL = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";

export default defineConfig({
  testDir: "./tests",
  outputDir: "../test-results",
  forbidOnly: Boolean(process.env.CI),
  // Preview scenarios control shared playback state.
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    browserName: "chromium",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
  },
  projects: [
    { name: "preview", testMatch: "preview/**/*.spec.ts" },
    { name: "backend", testMatch: "backend/**/*.spec.ts" },
  ],
  webServer: [
    {
      command: "npm run preview:chat -- --port 5199 --strictPort",
      cwd: "..",
      url: previewURL,
      reuseExistingServer: Boolean(process.env.FLORA_PREVIEW_URL),
    },
    {
      command:
        "npm run build && go -C backend build -tags browserfixture -o ../bin/browser-fixture ./cmd/browser-fixture && exec ./bin/browser-fixture",
      cwd: "..",
      url: "http://127.0.0.1:5198/health",
      timeout: 120_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    },
  ],
});
