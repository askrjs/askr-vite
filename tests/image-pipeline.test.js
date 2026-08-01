import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { build as viteBuild } from "vite";
import { build as vitePlusBuild } from "vite-plus";
import { image as nodeImage } from "../src/image-node.ts";
import { ImagePipeline } from "../src/image-pipeline.ts";
import { askr } from "../src/index.ts";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function files(directory, prefix = "") {
  const output = [];
  for (const entry of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) output.push(...(await files(directory, relative)));
    else output.push(relative);
  }
  return output.sort();
}

async function createFixture({
  width = 500,
  height = 300,
  declarations = 'const hero = image(new URL("./hero.jpg", import.meta.url), { widths: [100, 200, 800] });\nglobalThis.__hero = hero;',
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-vite-images-"));
  temporaryDirectories.push(root);
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "public"), { recursive: true });
  await fs.writeFile(
    path.join(root, "index.html"),
    '<!doctype html><div id="app"></div><script type="module" src="/src/main.ts"></script>',
  );
  await fs.writeFile(
    path.join(root, "src/main.ts"),
    `import { image } from "@askrjs/vite/image";\n${declarations}\n`,
  );
  await sharp({
    create: { width, height, channels: 3, background: { r: 35, g: 80, b: 140 } },
  })
    .jpeg({ quality: 90 })
    .toFile(path.join(root, "src/hero.jpg"));
  await fs.writeFile(path.join(root, "public/untouched.txt"), "public asset");
  // Vite's HTML emitter compares canonical paths. macOS exposes its temporary
  // directory through /var while realpath resolves it through /private/var.
  return fs.realpath(root);
}

async function buildFixture(root, build = viteBuild, options = true) {
  await build({
    root,
    configFile: false,
    base: "/docs/",
    logLevel: "silent",
    resolve: {
      alias: {
        "@askrjs/askr/jsx-runtime": path.join(
          repositoryRoot,
          "node_modules/@askrjs/askr/dist/jsx-runtime.js",
        ),
        "@askrjs/vite/image": path.join(repositoryRoot, "src/image.ts"),
      },
    },
    plugins: [askr({ images: options })],
    build: { outDir: path.join(root, "dist"), emptyOutDir: true },
  });
  return {
    output: await files(path.join(root, "dist")),
    metadata: JSON.parse(
      await fs.readFile(
        path.join(root, "node_modules/.cache/@askrjs/vite/images/metadata.json"),
        "utf8",
      ),
    ),
  };
}

describe.each([
  ["Vite", viteBuild],
  ["Vite+", vitePlusBuild],
])("responsive image builds with %s", (_name, build) => {
  it("should emit hashed AVIF, WebP, and source variants without upscaling", async () => {
    const root = await createFixture();
    const { output, metadata } = await buildFixture(root, build);
    const assets = output.filter((file) => file.startsWith("assets/"));

    expect(assets.some((file) => /hero-100-.*\.avif$/.test(file))).toBe(true);
    expect(assets.some((file) => /hero-200-.*\.webp$/.test(file))).toBe(true);
    expect(assets.some((file) => /hero-500-.*\.jpg$/.test(file))).toBe(true);
    expect(assets.some((file) => file.includes("800"))).toBe(false);
    expect(
      new Set(assets.map((file) => file.match(/-([\w-]+)\.[^.]+$/)?.[1])).size,
    ).toBeGreaterThan(1);

    const entry = Object.values(metadata.entries)[0];
    expect(entry.encoder).toBe(`sharp@${sharp.versions.sharp}`);
    expect(entry.image).toMatchObject({ width: 500, height: 300 });
    expect(entry.image.src).toMatch(/^\/docs\/assets\/hero-500-.*\.jpg$/);
    expect(entry.image.srcset).not.toContain("800w");
    expect(entry.image.sources.map((source) => source.type)).toEqual(["image/avif", "image/webp"]);
  });
});

it("should reuse cached transforms and resolve exact metadata in direct Node SSG imports", async () => {
  const options = { widths: [100, 200, 800] };
  const root = await createFixture();
  const first = await buildFixture(root);
  const cacheDir = path.join(root, "node_modules/.cache/@askrjs/vite/images");
  const cacheFiles = (await files(cacheDir)).filter((file) => file !== "metadata.json");
  const mtimes = new Map(
    await Promise.all(
      cacheFiles.map(async (file) => [file, (await fs.stat(path.join(cacheDir, file))).mtimeMs]),
    ),
  );

  await buildFixture(root);
  for (const [file, mtime] of mtimes) {
    expect((await fs.stat(path.join(cacheDir, file))).mtimeMs).toBe(mtime);
  }

  const heroPath = path.join(root, "src/hero.jpg");
  const resolved = nodeImage(pathToFileURL(heroPath), options);
  expect(resolved).toEqual(Object.values(first.metadata.entries)[0].image);
  expect(nodeImage(resolved)).toBe(resolved);

  await sharp({
    create: { width: 500, height: 300, channels: 3, background: { r: 180, g: 20, b: 30 } },
  })
    .jpeg()
    .toFile(heroPath);
  expect(() => nodeImage(pathToFileURL(heroPath), options)).toThrow(/metadata.*stale.*re-run/i);
});

it("should honor cover, aspect-ratio, format, and width overrides", async () => {
  const root = await createFixture({
    declarations:
      'const hero = image(new URL("./hero.jpg", import.meta.url), { widths: [120], formats: ["webp", "source"], quality: { webp: 60, jpeg: 70 }, fit: "cover", aspectRatio: { width: 16, height: 9 }, position: "north" });\nglobalThis.__hero = hero;',
  });
  const { output, metadata } = await buildFixture(root);
  const entry = Object.values(metadata.entries)[0];

  expect(output.some((file) => file.endsWith(".avif"))).toBe(false);
  expect(output.some((file) => /hero-120-.*\.webp$/.test(file))).toBe(true);
  expect(entry.image).toMatchObject({ width: 500, height: 281 });
  expect(entry.image.sources.map((source) => source.type)).toEqual(["image/webp"]);
});

it("should cap cover variants by both source dimensions", async () => {
  const root = await createFixture({
    declarations:
      'const hero = image(new URL("./hero.jpg", import.meta.url), { widths: [200, 400, 800], fit: "cover", aspectRatio: 1 });\nglobalThis.__hero = hero;',
  });
  const { output, metadata } = await buildFixture(root);
  const entry = Object.values(metadata.entries)[0];

  expect(entry.image).toMatchObject({ width: 300, height: 300 });
  expect(entry.image.srcset).toContain("200w");
  expect(entry.image.srcset).toContain("300w");
  expect(entry.image.srcset).not.toContain("400w");
  expect(output.some((file) => /hero-400-/.test(file))).toBe(false);
});

it("should reject environment-dependent image options without evaluating them", async () => {
  const root = await createFixture({
    declarations:
      'const hero = image(new URL("./hero.jpg", import.meta.url), { widths: process.env.IMAGE_WIDTHS });\nglobalThis.__hero = hero;',
  });

  await expect(buildFixture(root)).rejects.toThrow(/must not reference process.*static object/);
});

it("should pass through SVG, animated, and already-small images without rewriting other assets", async () => {
  const declarations = [
    'const hero = image(new URL("./hero.jpg", import.meta.url));',
    'const icon = image(new URL("./icon.svg", import.meta.url));',
    'const animation = image(new URL("./animation.gif", import.meta.url));',
    "globalThis.__images = [hero, icon, animation];",
  ].join("\n");
  const root = await createFixture({ width: 100, height: 60, declarations });
  await fs.writeFile(
    path.join(root, "src/icon.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12"><path d="M0 0h24v12H0z"/></svg>',
  );
  await fs.writeFile(
    path.join(root, "src/animation.gif"),
    Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAEALAAAAAABAAEAAAICRAEAIfkEAQAAAQAsAAAAAAEAAQAAAgJEADs=",
      "base64",
    ),
  );
  await fs.writeFile(path.join(root, "src/undeclared.jpg"), "not an image fixture");
  const { output, metadata } = await buildFixture(root);

  expect(output.filter((file) => /hero.*\.(?:jpg|avif|webp)$/.test(file))).toHaveLength(1);
  expect(output.filter((file) => /icon.*\.svg$/.test(file))).toHaveLength(1);
  expect(output.filter((file) => /animation.*\.gif$/.test(file))).toHaveLength(1);
  expect(output.some((file) => file.includes("undeclared"))).toBe(false);
  expect(await fs.readFile(path.join(root, "dist/untouched.txt"), "utf8")).toBe("public asset");
  for (const entry of Object.values(metadata.entries)) {
    expect(entry.image.sources).toEqual([]);
    expect(entry.image).not.toHaveProperty("srcset");
  }
});

it("should require an aspect ratio for cover and explain a missing Sharp peer", async () => {
  const root = await createFixture({
    declarations:
      'const hero = image(new URL("./hero.jpg", import.meta.url), { fit: "cover" });\nglobalThis.__hero = hero;',
  });
  await expect(buildFixture(root)).rejects.toThrow(/cover.*requires an aspectRatio/);

  const pipeline = new ImagePipeline({}, async () => {
    throw Object.assign(new Error("missing"), { code: "ERR_MODULE_NOT_FOUND" });
  });
  pipeline.configure({ root, command: "build" });
  await expect(
    pipeline.transform(
      {
        emitFile() {
          return "asset";
        },
        getFileName() {
          return "asset.jpg";
        },
      },
      'import { image } from "@askrjs/vite/image"; image(new URL("./hero.jpg", import.meta.url));',
      path.join(root, "src/main.ts"),
    ),
  ).rejects.toThrow(/optional peer "sharp".*sharp@\^0\.35\.3/);
});

it("should not resolve Sharp for SVG, animated, or already-small declarations", async () => {
  const declarations = [
    'const hero = image(new URL("./hero.jpg", import.meta.url));',
    'const icon = image(new URL("./icon.svg", import.meta.url));',
    'const animation = image(new URL("./animation.gif", import.meta.url));',
  ].join("\n");
  const root = await createFixture({ width: 100, height: 60, declarations });
  await fs.writeFile(
    path.join(root, "src/icon.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12"></svg>',
  );
  await fs.writeFile(
    path.join(root, "src/animation.gif"),
    Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAEALAAAAAABAAEAAAICRAEAIfkEAQAAAQAsAAAAAAEAAQAAAgJEADs=",
      "base64",
    ),
  );
  let sharpLoads = 0;
  const pipeline = new ImagePipeline({}, async () => {
    sharpLoads += 1;
    throw Object.assign(new Error("missing"), { code: "ERR_MODULE_NOT_FOUND" });
  });
  pipeline.configure({ root, command: "build" });
  const emitted = [];
  await expect(
    pipeline.transform(
      {
        emitFile(file) {
          emitted.push(file.name);
          return `asset-${emitted.length}`;
        },
        getFileName(referenceId) {
          return referenceId;
        },
      },
      `import { image } from "@askrjs/vite/image";\n${declarations}`,
      path.join(root, "src/main.ts"),
    ),
  ).resolves.toContain("__askrImage");

  expect(sharpLoads).toBe(0);
  expect(emitted.sort()).toEqual(["animation.gif", "hero.jpg", "icon.svg"]);
});

it("should fail clearly when direct Node SSG metadata is missing", async () => {
  const root = await createFixture();
  expect(() => nodeImage(pathToFileURL(path.join(root, "src/hero.jpg")), { widths: [1] })).toThrow(
    /metadata is missing|no built image declaration/i,
  );
});
