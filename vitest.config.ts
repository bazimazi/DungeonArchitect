import { defineConfig } from "vitest/config";

// Globals avoid a duplicate-module issue when test files import "vitest".
export default defineConfig({
  test: { include: ["tests/*.test.ts"], globals: true },
});
