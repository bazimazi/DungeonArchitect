import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:5318", trace: "retain-on-failure" },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1100 },
      },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: [
    {
      command: "npm run server",
      url: "http://127.0.0.1:5317/api/health",
      env: {
        PORT: "5317",
        ALLOWED_ORIGINS: "http://127.0.0.1:5318",
        DATABASE_PATH: ":memory:",
        SERVE_FILES: "false",
        NODE_ENV: "test",
      },
      reuseExistingServer: false,
    },
    {
      command: "npm run dev -- --port 5318",
      url: "http://127.0.0.1:5318",
      env: { DUNGEON_API_URL: "http://127.0.0.1:5317" },
      reuseExistingServer: false,
    },
    {
      command: "npm run preview -- --port 5319 --strictPort",
      url: "http://127.0.0.1:5319",
      reuseExistingServer: false,
    },
  ],
});
