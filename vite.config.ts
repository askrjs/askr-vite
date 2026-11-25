import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    // Vitest v4 compatibility: preserve mock call history.
    // Remove after tests no longer rely on calls from setup or earlier tests.
    // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
    // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
    clearMocks: false,
  },
  pack: {
    entry: {
      index: "src/index.ts",
      image: "src/image.ts",
      "image-node": "src/image-node.ts",
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
    sourcemap: "hidden",
    banner: ({ fileName }) =>
      fileName === "server.d.ts"
        ? { dts: '/// <reference path="./virtual-askr-server.d.ts" />' }
        : undefined,
    copy: [{ from: "src/server/virtual-askr-server.d.ts" }],
    deps: {
      // tsdown <0.23 compatibility: resolve external dependency subpaths.
      // Remove to preserve subpath imports as written (the new default).
      // https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
      resolveDepSubpath: true,
      neverBundle: ["sharp", "vite", /^@askrjs\/(?:askr|node|server)(?:\/.*)?$/],
    },
  },
});
