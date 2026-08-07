import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeAll, expect, it } from "vitest";

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const repositoryRoot = resolve(import.meta.dirname, "..");
const typescriptCli = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

beforeAll(async () => {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("npm_execpath is required to run the installed-package build");
  await exec(process.execPath, [npmCli, "run", "build"], { cwd: repositoryRoot });
});

async function linkPackage(consumerRoot, name) {
  const target = dirname(require.resolve(`${name}/package.json`));
  const destination = join(consumerRoot, "node_modules", ...name.split("/"));
  await mkdir(dirname(destination), { recursive: true });
  await symlink(target, destination, process.platform === "win32" ? "junction" : "dir");
}

it("should typecheck installed plugins given Vite and vite-plus consumers", async () => {
  const rootDeclaration = await readFile(join(repositoryRoot, "dist", "index.d.ts"), "utf8");
  const serverDeclaration = await readFile(join(repositoryRoot, "dist", "server.d.ts"), "utf8");
  const imageDeclaration = await readFile(join(repositoryRoot, "dist", "image.d.ts"), "utf8");
  expect(rootDeclaration).not.toMatch(/from ["']vite["']/);
  expect(serverDeclaration).not.toMatch(/from ["']vite["']/);
  expect(imageDeclaration).not.toMatch(/from ["'](?:vite|sharp)["']/);

  const consumerRoot = await mkdtemp(join(tmpdir(), "askr-vite-installed-types-"));
  temporaryDirectories.push(consumerRoot);
  const installedRoot = join(consumerRoot, "node_modules", "@askrjs", "vite");
  await mkdir(installedRoot, { recursive: true });
  await cp(join(repositoryRoot, "dist"), join(installedRoot, "dist"), { recursive: true });
  await writeFile(
    join(installedRoot, "package.json"),
    await readFile(join(repositoryRoot, "package.json"), "utf8"),
  );
  await Promise.all(
    ["@askrjs/askr", "@askrjs/server", "vite", "vite-plus"].map((name) =>
      linkPackage(consumerRoot, name),
    ),
  );
  await writeFile(
    join(consumerRoot, "package.json"),
    JSON.stringify({ name: "askr-vite-installed-types", private: true, type: "module" }),
  );
  await writeFile(
    join(consumerRoot, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        skipLibCheck: true,
        noEmit: true,
      },
      include: ["image.ts", "server.ts", "vite.config.ts"],
    }),
  );
  await writeFile(
    join(consumerRoot, "server.ts"),
    [
      'import app, { app as namedApp } from "virtual:askr-server";',
      'import type { ServerApp } from "@askrjs/server";',
      "const defaultApp: ServerApp = app;",
      "const exportedApp: ServerApp = namedApp;",
      "void [defaultApp, exportedApp];",
    ].join("\n"),
  );
  await writeFile(
    join(consumerRoot, "image.ts"),
    [
      'import { Image, image } from "@askrjs/vite/image";',
      'const hero = image(new URL("./hero.jpg", import.meta.url), {',
      '  widths: [320, 640], fit: "cover", aspectRatio: { width: 16, height: 9 },',
      "});",
      'Image({ image: hero, alt: "Mountain ridge", sizes: "100vw", class: "hero" });',
      "// @ts-expect-error alt is required for accessible output",
      "Image({ image: hero });",
    ].join("\n"),
  );
  await writeFile(
    join(consumerRoot, "vite.config.ts"),
    [
      'import { askr } from "@askrjs/vite";',
      'import { askrServer } from "@askrjs/vite/server";',
      'import { defineConfig as defineViteConfig, type Plugin } from "vite";',
      'import { defineConfig } from "vite-plus";',
      "const vitePlugin: Plugin = askr({ images: true });",
      'const serverPlugin: Plugin = askrServer({ entry: "./server.ts" });',
      "void defineViteConfig({ plugins: [vitePlugin, serverPlugin] });",
      'export default defineConfig({ plugins: [askr(), askrServer({ entry: "./server.ts" })] });',
    ].join("\n"),
  );

  const result = await exec(
    process.execPath,
    [typescriptCli, "-p", join(consumerRoot, "tsconfig.json")],
    { cwd: consumerRoot },
  );

  expect(result.stderr).toBe("");
});

it("should keep linked Askr packages on one runtime given a Vitest module runner", async () => {
  const consumerRoot = await mkdtemp(join(tmpdir(), "askr-vite-installed-runtime-"));
  temporaryDirectories.push(consumerRoot);
  const rootRuntime = join(consumerRoot, "node_modules", "@askrjs", "askr");
  const linkedUi = join(consumerRoot, "linked", "ui");
  const linkedRuntime = join(linkedUi, "node_modules", "@askrjs", "askr");

  await Promise.all([
    mkdir(rootRuntime, { recursive: true }),
    mkdir(linkedRuntime, { recursive: true }),
    mkdir(join(consumerRoot, "node_modules", "@askrjs"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(consumerRoot, "package.json"),
      JSON.stringify({ name: "askr-vite-installed-runtime", private: true, type: "module" }),
    ),
    writeFile(
      join(rootRuntime, "package.json"),
      JSON.stringify({
        name: "@askrjs/askr",
        version: "0.0.0",
        type: "module",
        exports: "./index.js",
      }),
    ),
    writeFile(join(rootRuntime, "index.js"), "export const runtime = {};\n"),
    writeFile(
      join(linkedUi, "package.json"),
      JSON.stringify({
        name: "@askrjs/ui",
        version: "0.0.0",
        type: "module",
        exports: "./index.js",
      }),
    ),
    writeFile(
      join(linkedUi, "index.js"),
      'import { runtime } from "@askrjs/askr";\nexport const siblingRuntime = runtime;\n',
    ),
    writeFile(
      join(linkedRuntime, "package.json"),
      JSON.stringify({
        name: "@askrjs/askr",
        version: "0.0.0",
        type: "module",
        exports: "./index.js",
      }),
    ),
    writeFile(join(linkedRuntime, "index.js"), "export const runtime = {};\n"),
  ]);
  await Promise.all([
    symlink(linkedUi, join(consumerRoot, "node_modules", "@askrjs", "ui"), "dir"),
    linkPackage(consumerRoot, "vite"),
    linkPackage(consumerRoot, "vitest"),
  ]);

  await writeFile(
    join(consumerRoot, "runtime.test.js"),
    [
      'import { expect, it } from "vitest";',
      'import { runtime } from "@askrjs/askr";',
      'import { siblingRuntime } from "@askrjs/ui";',
      'it("uses one runtime", () => expect(siblingRuntime).toBe(runtime));',
    ].join("\n"),
  );
  await writeFile(
    join(consumerRoot, "vite.config.js"),
    [
      'import { defineConfig } from "vitest/config";',
      `import { askrServer } from ${JSON.stringify(pathToFileURL(join(repositoryRoot, "dist", "server.js")).href)};`,
      "export default defineConfig({",
      '  resolve: { preserveSymlinks: true, dedupe: ["@askrjs/askr"] },',
      '  plugins: [askrServer({ entry: "./server.js" })],',
      '  test: { environment: "node", include: ["runtime.test.js"] },',
      "});",
    ].join("\n"),
  );

  const vitePlusRoot = dirname(require.resolve("vite-plus/package.json"));
  const result = await exec(
    process.execPath,
    [join(vitePlusRoot, "bin", "vp"), "test", "run", "--config", "vite.config.js"],
    { cwd: consumerRoot },
  );

  expect(result.stdout).toContain("1 passed");
  expect(result.stderr).toBe("");
});
