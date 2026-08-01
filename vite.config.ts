import { defineConfig } from "vite-plus";

export default defineConfig({
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
      neverBundle: ["sharp", "vite", /^@askrjs\/(?:askr|node|server)(?:\/.*)?$/],
    },
  },
});
