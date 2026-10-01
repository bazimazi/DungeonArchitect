import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:5188", trace: "retain-on-failure" },
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
      command: "npm run dev -- --port 5188",
      url: "http://127.0.0.1:5188",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run preview -- --port 5189",
      url: "http://127.0.0.1:5189",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
