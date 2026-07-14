import { defineConfig } from "vite-plus";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
  },
  resolve: {
    alias: {
      "@askrjs/node": resolve(import.meta.dirname, "../askr-node/src/index.ts"),
    },
  },
});
