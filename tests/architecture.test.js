import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

describe("Vite package architecture", () => {
  it("should keep public barrels re-export only", () => {
    for (const file of ["src/index.ts", "src/server/index.ts"]) {
      const lines = readFileSync(resolve(root, file), "utf8").split("\n").filter(Boolean);
      expect(
        lines.every((line) => line.startsWith("export ")),
        file,
      ).toBe(true);
    }
  });

  it("should keep the root SPA entry free of server and node imports", () => {
    for (const file of ["src/index.ts", "src/jsx-plugin.ts", "src/template-optimizer.ts"]) {
      expect(readFileSync(resolve(root, file), "utf8"), file).not.toMatch(
        /@askrjs\/(?:server|node)/,
      );
    }
  });

  it("should delegate Node transport handling to askr-node", () => {
    expect(readFileSync(resolve(root, "src/server/plugin.ts"), "utf8")).toMatch(
      /from ["']@askrjs\/node["']/,
    );

    const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    expect(manifest.dependencies?.["@askrjs/node"]).toMatch(/[<>^~*]/);
    expect(readFileSync(resolve(root, "vitest.config.ts"), "utf8")).not.toMatch(/\.\.\/askr-node/);
  });

  it("should accept Vite or Vite Plus without installing either build tool", () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    expect(manifest.dependencies?.vite).toBeUndefined();
    expect(manifest.dependencies?.["vite-plus"]).toBeUndefined();
    expect(manifest.peerDependencies?.vite).toMatch(/[<>^~*]/);
    expect(manifest.peerDependencies?.["vite-plus"]).toMatch(/[<>^~*]/);
    expect(manifest.peerDependenciesMeta).toMatchObject({
      vite: { optional: true },
      "vite-plus": { optional: true },
    });
  });

  it("should keep template optimization on the parsed JSX-runtime boundary", () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const optimizer = readFileSync(resolve(root, "src/template-optimizer.ts"), "utf8");

    expect(manifest.dependencies?.["oxc-parser"]).toMatch(/[<>^~*]/);
    expect(optimizer).toMatch(/from ["']oxc-parser["']/);
    expect(optimizer).not.toMatch(/code\.(?:replace|replaceAll|split)\(/);
  });

  it("should keep production modules within 300 lines", () => {
    const sourceFiles = [
      ...readdirSync(resolve(root, "src"))
        .filter((file) => file.endsWith(".ts"))
        .map((file) => resolve(root, "src", file)),
      ...readdirSync(resolve(root, "src/server"))
        .filter((file) => file.endsWith(".ts"))
        .map((file) => resolve(root, "src/server", file)),
    ];
    for (const file of sourceFiles) {
      expect(readFileSync(file, "utf8").split("\n").length, file).toBeLessThanOrEqual(300);
    }
  });
});
