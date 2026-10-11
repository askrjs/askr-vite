import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { build as viteBuild } from "vite-plus";
import { build as vitePlusBuild } from "vite-plus";
import { image as nodeImage } from "../src/image-node.ts";
import { ImagePipeline } from "../src/image-pipeline.ts";
import { askr } from "../src/index.ts";
import { traceSourcePosition } from "../src/source-map-rewrites.ts";
import { nextWatchBuild, startImageWatcher } from "./fixtures/image-watch.js";

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
  directoryName = "",
  declarations = 'const hero = image(new URL("./hero.jpg", import.meta.url), { widths: [100, 200, 800] });\nglobalThis.__hero = hero;',
} = {}) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-vite-images-"));
  temporaryDirectories.push(temporaryRoot);
  const root = path.join(temporaryRoot, directoryName);
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

function hook(plugin, name) {
  const value = plugin[name];
  return typeof value === "function" ? value : value.handler;
}

function positionOf(code, token) {
  const offset = code.indexOf(token);
  if (offset < 0) throw new Error(`Missing token: ${token}`);
  const before = code.slice(0, offset).split("\n");
  return { line: before.length - 1, column: before.at(-1).length };
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

it("should map combined image and template rewrites to the original TSX", async () => {
  const root = await createFixture();
  const id = path.join(root, "src/combined.tsx");
  const source = [
    'import { image } from "@askrjs/vite/image";',
    'const hero = image(new URL("./hero.jpg", import.meta.url), { widths: [100] });',
    'export const marker = "after-image";',
    'export const View = () => <><img class="shared" src={hero.src}/><img class="shared" src={hero.src}/></>;',
  ].join("\n");
  const plugin = askr({ images: true, optimizeTemplates: true });
  hook(plugin, "configResolved")({ command: "build", root, base: "/" });
  let reference = 0;
  const transformed = await hook(plugin, "transform").call(
    {
      emitFile: vi.fn(() => `asset${reference++}`),
      error(message) {
        throw new Error(String(message));
      },
    },
    source,
    id,
  );

  const generated = positionOf(transformed.code, "export const marker");
  const original = positionOf(source, "export const marker");
  expect(traceSourcePosition(transformed.map, generated.line, generated.column)).toEqual(original);
  expect(transformed.map.sourcesContent).toEqual([source]);
});

it("should invalidate an image transform when the source changes on disk", async () => {
  const root = await createFixture();
  const id = path.join(root, "src/repeated.ts");
  const source = [
    'import { image } from "@askrjs/vite/image";',
    'export const hero = image(new URL("./hero.jpg", import.meta.url), { widths: [100] });',
    'export const marker = "after-image";',
  ].join("\n");
  const plugin = askr({ images: true });
  hook(plugin, "configResolved")({ command: "build", root, base: "/" });
  let reference = 0;
  const emitted = [];
  const context = {
    emitFile(file) {
      emitted.push(file.source);
      return `asset${reference++}`;
    },
    error(message) {
      throw new Error(String(message));
    },
  };
  const first = await hook(plugin, "transform").call(context, source, id);
  const generated = positionOf(first.code, "export const marker");
  expect(traceSourcePosition(first.map, generated.line, generated.column)).toEqual(
    positionOf(source, "export const marker"),
  );
  const firstEmissionCount = emitted.length;
  await sharp({
    create: { width: 500, height: 300, channels: 3, background: { r: 220, g: 10, b: 30 } },
  })
    .jpeg()
    .toFile(path.join(root, "src/hero.jpg"));

  const second = await hook(plugin, "transform").call(context, source, id);

  expect(emitted.length).toBeGreaterThan(firstEmissionCount);
  expect(second.code).not.toBe(first.code);
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

it("should auto-orient source dimensions and encoded variants", async () => {
  const root = await createFixture({
    declarations:
      'const hero = image(new URL("./hero.jpg", import.meta.url), { widths: [200] });\nglobalThis.__hero = hero;',
  });
  await sharp({
    create: { width: 500, height: 300, channels: 3, background: { r: 35, g: 80, b: 140 } },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toFile(path.join(root, "src/hero.jpg"));

  const { output, metadata } = await buildFixture(root);
  const entry = Object.values(metadata.entries)[0];
  const fallback = output.find((file) => /assets\/hero-300-.*\.jpg$/.test(file));

  expect(entry.image).toMatchObject({ width: 300, height: 500 });
  expect(entry.image.srcset).toContain("200w");
  expect(entry.image.srcset).toContain("300w");
  await expect(sharp(path.join(root, "dist", fallback)).metadata()).resolves.toMatchObject({
    width: 300,
    height: 500,
  });
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

  const escaped = await createFixture({
    declarations: String.raw`const hero = image(new URL("./hero.jpg", import.meta.url), { fit: "cover", aspectRatio: 1, position: "north\"east" });`,
  });
  await expect(buildFixture(escaped)).rejects.toThrow(/option strings.*escape sequences/);
});

it("should ignore image declaration examples inside strings and comments", async () => {
  const root = await createFixture({
    declarations: [
      'const hero = image(new URL("./hero.jpg", import.meta.url), { widths: [100] });',
      `const example = 'image(new URL("./missing-string.jpg", import.meta.url), { widths: [1] })';`,
      '// image(new URL("./missing-line.jpg", import.meta.url), { widths: [1] });',
      '/* image(new URL("./missing-block.jpg", import.meta.url), { widths: [1] }); */',
      "globalThis.__hero = hero;",
    ].join("\n"),
  });

  const { output, metadata } = await buildFixture(root);
  expect(Object.keys(metadata.entries)).toHaveLength(1);
  expect(output.some((file) => file.includes("missing-"))).toBe(false);
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

  const invalidFit = await createFixture({
    declarations: 'const hero = image(new URL("./hero.jpg", import.meta.url), { fit: "stretch" });',
  });
  await expect(buildFixture(invalidFit)).rejects.toThrow(/fit must be.*inside.*cover/);

  const invalidPosition = await createFixture({
    declarations:
      'const hero = image(new URL("./hero.jpg", import.meta.url), { fit: "cover", aspectRatio: 1, position: 42 });',
  });
  await expect(buildFixture(invalidPosition)).rejects.toThrow(/position.*non-empty string/);

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
  await sharp({
    create: { width: 500, height: 300, channels: 3, background: { r: 35, g: 80, b: 140 } },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toFile(path.join(root, "src/hero.jpg"));
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

async function watchedMetadata(root) {
  return JSON.parse(
    await fs.readFile(
      path.join(root, "node_modules/.cache/@askrjs/vite/images/metadata.json"),
      "utf8",
    ),
  );
}

const initialSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80" fill="red"/></svg>';
const changedSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="160"><rect width="200" height="160" fill="blue"/></svg>';
const svgDeclaration =
  'import { image } from "@askrjs/vite/image";\nexport const hero = image(new URL("./hero.svg", import.meta.url));\n';

describe.each([
  ["Vite", viteBuild],
  ["Vite+", vitePlusBuild],
])("responsive image build watch with %s", (_name, build) => {
  it("should rebuild from an atomic source-image replacement without touching its declaring module", async () => {
    const root = await createFixture();
    const entryPath = path.join(root, "src/main.ts");
    const sourcePath = path.join(root, "src/hero.svg");
    await fs.writeFile(entryPath, svgDeclaration);
    await fs.writeFile(sourcePath, initialSvg);
    const watcher = await startImageWatcher(
      root,
      build,
      askr({ images: true, transformJsx: false }),
    );
    try {
      await nextWatchBuild(watcher);
      const before = Object.values((await watchedMetadata(root)).entries)[0];
      expect(before.image).toMatchObject({ width: 100, height: 80 });
      const rebuilt = nextWatchBuild(watcher);
      await fs.writeFile(path.join(root, "src/replacement.svg"), changedSvg);
      await fs.rename(path.join(root, "src/replacement.svg"), sourcePath);
      await rebuilt;
      const after = Object.values((await watchedMetadata(root)).entries)[0];
      expect(after.sourceHash).not.toBe(before.sourceHash);
      expect(after.image.src).not.toBe(before.image.src);
      expect(after.image).toMatchObject({ width: 200, height: 160 });
      expect(
        await fs.readFile(
          path.join(root, "dist", after.image.src.replace(/^\/docs\//, "")),
          "utf8",
        ),
      ).toBe(changedSvg);
      expect(await fs.readFile(entryPath, "utf8")).toBe(svgDeclaration);
      const missing = expect(nextWatchBuild(watcher)).rejects.toThrow(
        /@askrjs\/vite.*hero\.svg.*Restore.*rebuild/s,
      );
      await fs.unlink(sourcePath);
      await missing;
      const recovered = nextWatchBuild(watcher);
      await fs.writeFile(sourcePath, initialSvg);
      await recovered;
      const restored = Object.values((await watchedMetadata(root)).entries)[0];
      expect(restored).toEqual(before);
      expect(
        await fs.readFile(
          path.join(root, "dist", restored.image.src.replace(/^\/docs\//, "")),
          "utf8",
        ),
      ).toBe(initialSvg);
      const removed = nextWatchBuild(watcher);
      await fs.writeFile(entryPath, "export const noImage = true;\n");
      await removed;
      expect((await watchedMetadata(root)).entries).toEqual({});
    } finally {
      await watcher.close();
    }
  }, 20_000);

  it("should emit current-build image references across repeated entry-only watch rebuilds", async () => {
    const root = await createFixture();
    const entryPath = path.join(root, "src/main.ts");
    await fs.writeFile(entryPath, svgDeclaration);
    await fs.writeFile(path.join(root, "src/hero.svg"), initialSvg);
    const watcher = await startImageWatcher(
      root,
      build,
      askr({ images: true, transformJsx: false }),
    );
    try {
      await nextWatchBuild(watcher);
      const before = await watchedMetadata(root);
      for (const revision of [1, 2]) {
        const rebuilt = nextWatchBuild(watcher);
        await fs.writeFile(entryPath, `${svgDeclaration}\nexport const revision = ${revision};\n`);
        await rebuilt;
        expect(await watchedMetadata(root)).toEqual(before);
        const entry = Object.values(before.entries)[0];
        expect(
          await fs.readFile(
            path.join(root, "dist", entry.image.src.replace(/^\/docs\//, "")),
            "utf8",
          ),
        ).toBe(initialSvg);
      }
    } finally {
      await watcher.close();
    }
  }, 20_000);

  it("should preserve unchanged declaration-module metadata when another module rebuilds", async () => {
    const root = await createFixture();
    const heroModule = path.join(root, "src/hero.ts");
    await fs.writeFile(heroModule, svgDeclaration);
    await fs.writeFile(path.join(root, "src/badge.ts"), svgDeclaration.replaceAll("hero", "badge"));
    await fs.writeFile(
      path.join(root, "src/main.ts"),
      'export { hero } from "./hero";\nexport { badge } from "./badge";\n',
    );
    await fs.writeFile(path.join(root, "src/hero.svg"), initialSvg);
    await fs.writeFile(path.join(root, "src/badge.svg"), changedSvg);
    const watcher = await startImageWatcher(
      root,
      build,
      askr({ images: true, transformJsx: false }),
    );
    try {
      await nextWatchBuild(watcher);
      const before = await watchedMetadata(root);
      expect(Object.keys(before.entries)).toHaveLength(2);
      const rebuilt = nextWatchBuild(watcher);
      await fs.writeFile(heroModule, `${svgDeclaration}\nexport const revision = 1;\n`);
      await rebuilt;
      expect(await watchedMetadata(root)).toEqual(before);
      for (const entry of Object.values(before.entries)) {
        expect(
          await fs.readFile(
            path.join(root, "dist", entry.image.src.replace(/^\/docs\//, "")),
            "utf8",
          ),
        ).toBe(entry.image.width === 100 ? initialSvg : changedSvg);
      }
    } finally {
      await watcher.close();
    }
  }, 20_000);
});

it("should retain a captured in-flight source snapshot and recover after source removal and recreation", async () => {
  const root = await createFixture();
  const sourcePath = path.join(root, "src/hero.jpg");
  const initialBytes = await fs.readFile(sourcePath);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const pipeline = new ImagePipeline({}, async () => {
    entered.resolve();
    await release.promise;
    return sharp;
  });
  pipeline.configure({ root, command: "build", base: "/" });
  const emitted = new Map();
  const context = {
    emitFile(file) {
      const reference = `asset${emitted.size}`;
      emitted.set(reference, file);
      return reference;
    },
    getFileName(reference) {
      return emitted.get(reference).name;
    },
  };
  const code =
    'import { image } from "@askrjs/vite/image"; image(new URL("./hero.jpg", import.meta.url), { widths: [100] });';
  const captured = pipeline.transform(context, code, path.join(root, "src/main.ts"));
  try {
    await entered.promise;
    await fs.unlink(sourcePath);
    await expect(pipeline.transform(context, code, path.join(root, "src/main.ts"))).rejects.toThrow(
      /hero\.jpg/,
    );
    await sharp({ create: { width: 320, height: 240, channels: 3, background: "orange" } })
      .jpeg()
      .toFile(sourcePath);
  } finally {
    release.resolve();
  }
  await expect(captured).resolves.toContain("width:500,height:300");
  await pipeline.writeMetadata(context);
  const capturedEntry = Object.values((await watchedMetadata(root)).entries)[0];
  expect(capturedEntry.sourceHash).toBe(createHash("sha256").update(initialBytes).digest("hex"));
  expect(capturedEntry.image).toMatchObject({ width: 500, height: 300 });
  await expect(
    pipeline.transform(context, code, path.join(root, "src/main.ts")),
  ).resolves.toContain("width:320,height:240");
  await pipeline.writeMetadata(context);
  const currentEntry = Object.values((await watchedMetadata(root)).entries)[0];
  expect(currentEntry.sourceHash).toBe(
    createHash("sha256")
      .update(await fs.readFile(sourcePath))
      .digest("hex"),
  );
  expect(currentEntry.sourceHash).not.toBe(capturedEntry.sourceHash);
  expect(currentEntry.image).toMatchObject({ width: 320, height: 240 });
});

it("should reject malformed checked metadata with a rebuild diagnostic and recover from a valid rebuild", async () => {
  const root = await createFixture();
  await buildFixture(root);
  const metadataPath = path.join(root, "node_modules/.cache/@askrjs/vite/images/metadata.json");
  const valid = JSON.parse(await fs.readFile(metadataPath, "utf8"));
  const key = Object.keys(valid.entries)[0];
  const cases = [
    ["invalid JSON", "{"],
    ["null root", "null"],
    ["array root", "[]"],
    ["wrong version", { ...valid, version: 1 }],
    ["missing entries", { version: valid.version }],
    ["array entries", { ...valid, entries: [] }],
    ["null entry", { ...valid, entries: { [key]: null } }],
    [
      "missing image",
      { ...valid, entries: { [key]: { ...valid.entries[key], image: undefined } } },
    ],
    ["null image", { ...valid, entries: { [key]: { ...valid.entries[key], image: null } } }],
    [
      "invalid width",
      {
        ...valid,
        entries: {
          [key]: { ...valid.entries[key], image: { ...valid.entries[key].image, width: 0 } },
        },
      },
    ],
    [
      "invalid source URL",
      {
        ...valid,
        entries: {
          [key]: { ...valid.entries[key], image: { ...valid.entries[key].image, src: 1 } },
        },
      },
    ],
    [
      "non-array sources",
      {
        ...valid,
        entries: {
          [key]: { ...valid.entries[key], image: { ...valid.entries[key].image, sources: {} } },
        },
      },
    ],
    [
      "malformed source",
      {
        ...valid,
        entries: {
          [key]: {
            ...valid.entries[key],
            image: { ...valid.entries[key].image, sources: [{ type: "image/webp", srcset: null }] },
          },
        },
      },
    ],
  ];
  const failures = [];
  for (const [name, record] of cases) {
    await fs.writeFile(metadataPath, typeof record === "string" ? record : JSON.stringify(record));
    let diagnostic;
    try {
      nodeImage(pathToFileURL(path.join(root, "src/hero.jpg")), { widths: [100, 200, 800] });
    } catch (error) {
      diagnostic = error.message;
    }
    if (!diagnostic || !/@askrjs\/vite.*metadata.*[Rr](?:e-?run|ebuild)/s.test(diagnostic))
      failures.push({ name, diagnostic: diagnostic ?? "No error; malformed metadata accepted" });
  }
  await buildFixture(root);
  expect(
    nodeImage(pathToFileURL(path.join(root, "src/hero.jpg")), { widths: [100, 200, 800] }),
  ).toEqual(valid.entries[key].image);
  expect(failures).toEqual([]);
});

it("should preserve checked client metadata during an unrelated SSR build", async () => {
  const root = await createFixture();
  const client = await buildFixture(root);
  await fs.writeFile(path.join(root, "src/server.ts"), "export const server = true;\n");
  await viteBuild({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [askr({ images: true })],
    build: {
      rollupOptions: { external: [/^@askrjs\//] },
      ssr: path.join(root, "src/server.ts"),
      outDir: path.join(root, "dist/server"),
    },
  });
  expect(await watchedMetadata(root)).toEqual(client.metadata);
  expect(
    nodeImage(pathToFileURL(path.join(root, "src/hero.jpg")), { widths: [100, 200, 800] }),
  ).toEqual(Object.values(client.metadata.entries)[0].image);
});

it("should preserve positive fractional SVG dimensions in checked client-to-Node metadata", async () => {
  const root = await createFixture({
    declarations:
      'const hero = image(new URL("./icon.svg", import.meta.url)); globalThis.__hero = hero;',
  });
  const sourcePath = path.join(root, "src/icon.svg");
  await fs.writeFile(
    sourcePath,
    '<svg xmlns="http://www.w3.org/2000/svg" width="100.5" height="80.25"><rect width="100%" height="100%"/></svg>',
  );
  const { metadata } = await buildFixture(root);
  const entry = Object.values(metadata.entries)[0];
  expect(entry.image).toMatchObject({ width: 100.5, height: 80.25 });
  expect(nodeImage(pathToFileURL(sourcePath))).toEqual(entry.image);
});

it("should build images from nested Unicode and URL-reserved paths with original source maps", async () => {
  const root = await createFixture({ directoryName: "nested space Ω # %" });
  const sourcePath = path.join(root, "src/hero # % 雪.svg");
  await fs.writeFile(sourcePath, initialSvg);
  const id = path.join(root, "src/unusual.tsx");
  const source = [
    'import { image } from "@askrjs/vite/image";',
    'export const hero = image(new URL("./hero%20%23%20%25%20%E9%9B%AA.svg", import.meta.url));',
    'export const marker = "unusual-source";',
    'export const View = () => <><img class="shared" src={hero.src}/><img class="shared" src={hero.src}/></>;',
  ].join("\n");
  await fs.writeFile(id, source);
  const result = await viteBuild({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [askr({ images: true, optimizeTemplates: true })],
    build: {
      lib: { entry: id, formats: ["es"], fileName: "unusual" },
      minify: false,
      sourcemap: true,
      rollupOptions: { external: [/^@askrjs\//] },
    },
  });
  const output = Array.isArray(result) ? result.flatMap((bundle) => bundle.output) : result.output;
  const bundle = output.find((file) => file.type === "chunk");
  const generated = positionOf(bundle.code, '"unusual-source"');
  expect(traceSourcePosition(bundle.map, generated.line, generated.column)).toEqual(
    positionOf(source, '"unusual-source"'),
  );
  const sourceIndex = bundle.map.sources.findIndex((name) => name.endsWith("/unusual.tsx"));
  expect(sourceIndex).toBeGreaterThanOrEqual(0);
  expect(bundle.map.sourcesContent[sourceIndex]).toBe(source);
  const record = Object.values((await watchedMetadata(root)).entries)[0];
  expect(record.sourcePath).toBe(sourcePath);
  expect(nodeImage(pathToFileURL(sourcePath))).toEqual(record.image);
  expect(
    await fs.readFile(
      path.join(root, "dist", decodeURIComponent(record.image.src.replace(/^\//, ""))),
      "utf8",
    ),
  ).toBe(initialSvg);
});

it("should compose identical plugin instances without duplicate JSX, image emission or lost source maps", async () => {
  const root = await createFixture();
  const id = path.join(root, "src/duplicate.tsx");
  const source = [
    'import { image } from "@askrjs/vite/image";',
    'export const hero = image(new URL("./hero.jpg", import.meta.url), { widths: [100], formats: ["source"] });',
    'export const marker = "duplicate-source";',
    'export const View = () => <><img class="shared" src={hero.src}/><img class="shared" src={hero.src}/></>;',
  ].join("\n");
  await fs.writeFile(id, source);
  const result = await viteBuild({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [
      askr({ images: true, optimizeTemplates: true }),
      askr({ images: true, optimizeTemplates: true }),
    ],
    build: {
      lib: { entry: id, formats: ["es"], fileName: "duplicate" },
      minify: false,
      sourcemap: true,
      rollupOptions: { external: [/^@askrjs\//] },
    },
  });
  const output = Array.isArray(result) ? result.flatMap((bundle) => bundle.output) : result.output;
  const bundle = output.find((file) => file.type === "chunk");
  expect(bundle.code).not.toContain("<img");
  expect(bundle.code).not.toContain("ROLLUP_FILE_URL");
  expect(
    output
      .filter((file) => file.type === "asset" && file.fileName.endsWith(".jpg"))
      .map((file) => file.fileName)
      .sort(),
  ).toEqual(["hero-100.jpg", "hero-500.jpg"]);
  const generated = positionOf(bundle.code, '"duplicate-source"');
  expect(traceSourcePosition(bundle.map, generated.line, generated.column)).toEqual(
    positionOf(source, '"duplicate-source"'),
  );
  const record = Object.values((await watchedMetadata(root)).entries)[0];
  expect(
    nodeImage(pathToFileURL(path.join(root, "src/hero.jpg")), {
      widths: [100],
      formats: ["source"],
    }),
  ).toEqual(record.image);
  await fs.writeFile(id, "export const Broken = () => <main>");
  await expect(
    viteBuild({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [askr(), askr()],
      build: { lib: { entry: id, formats: ["es"] }, rollupOptions: { external: [/^@askrjs\//] } },
    }),
  ).rejects.toThrow(/duplicate\.tsx.*(?:Transform failed|Expected|Unexpected)/s);
});
