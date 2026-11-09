import { defineConfig } from "@playwright/test";

const previewURL = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";

export default defineConfig({
  globalSetup: "./tests/global-setup.ts",
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
  ],
});
