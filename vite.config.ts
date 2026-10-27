import { defineConfig } from "vite";

export default defineConfig({
  server: {
    watch: {
      ignored: ["**/.cache/**", "**/android/**", "**/ios/**", "**/data/**"],
    },
    proxy: { "/api": process.env.DUNGEON_API_URL ?? "http://127.0.0.1:5187" },
  },
});
