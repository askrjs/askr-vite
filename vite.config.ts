import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: "src/index.ts",
    format: ["esm"],
    outDir: "dist",
    platform: "node",
    dts: true,
    sourcemap: true,
    deps: {
      neverBundle: ["vite", /^@askrjs\/askr(?:\/.*)?$/],
    },
  },
});
