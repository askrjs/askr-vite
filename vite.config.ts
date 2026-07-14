import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
      server: "src/server/index.ts",
    },
    format: ["esm"],
    outDir: "dist",
    platform: "node",
    outExtensions: () => ({
      js: ".js",
      dts: ".d.ts",
    }),
    dts: true,
    sourcemap: true,
    deps: {
      neverBundle: ["vite", /^@askrjs\/(?:askr|node|server)(?:\/.*)?$/],
    },
  },
});
