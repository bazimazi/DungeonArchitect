import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    watch: { ignored: ["**/.cache/**", "**/android/**", "**/ios/**"] },
  },
});
