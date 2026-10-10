import assert from "node:assert/strict";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { askr } from "@askrjs/vite";
import { image } from "@askrjs/vite/image";
import { nextWatchBuild, startImageWatcher } from "./image-watch.js";

const { build } = await import(process.argv[2]);
const root = join(process.cwd(), "watch-source");
await mkdir(join(root, "src"), { recursive: true });
const sourcePath = join(root, "src/hero.svg");
const entryPath = join(root, "src/main.ts");
const declaration =
  'import { image } from "@askrjs/vite/image";\nexport const hero = image(new URL("./hero.svg", import.meta.url));\n';
const original =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100.5" height="80.25"><rect width="100.5" height="80.25" fill="red"/></svg>';
const replacement =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="160"><rect width="200" height="160" fill="blue"/></svg>';
await writeFile(sourcePath, original);
await writeFile(entryPath, declaration);
const metadata = async () =>
  JSON.parse(
    await readFile(join(root, "node_modules/.cache/@askrjs/vite/images/metadata.json"), "utf8"),
  );
const entry = async () => Object.values((await metadata()).entries)[0];
const verifyAsset = async (record, bytes) => {
  assert.equal(
    await readFile(join(root, "dist", record.image.src.replace(/^\/docs\//, "")), "utf8"),
    bytes,
  );
  assert.deepEqual(image(pathToFileURL(record.sourcePath)), record.image);
};
const watcher = await startImageWatcher(root, build, askr({ images: true, transformJsx: false }));
try {
  await nextWatchBuild(watcher);
  const initial = await entry();
  assert.equal(initial.image.width, 100.5);
  assert.equal(initial.image.height, 80.25);
  await verifyAsset(initial, original);
  for (const revision of [1, 2]) {
    const rebuilt = nextWatchBuild(watcher);
    await writeFile(entryPath, `${declaration}\nexport const revision = ${revision};\n`);
    await rebuilt;
    assert.deepEqual(await entry(), initial);
    await verifyAsset(await entry(), original);
  }
  const beforeDeclaration = await readFile(entryPath, "utf8");
  const changed = nextWatchBuild(watcher);
  await writeFile(join(root, "src/replacement.svg"), replacement);
  await rename(join(root, "src/replacement.svg"), sourcePath);
  await changed;
  const updated = await entry();
  assert.notEqual(updated.sourceHash, initial.sourceHash);
  assert.notEqual(updated.image.src, initial.image.src);
  assert.equal(updated.image.width, 200);
  assert.equal(updated.image.height, 160);
  assert.equal(await readFile(entryPath, "utf8"), beforeDeclaration);
  await verifyAsset(updated, replacement);
  const missing = assert.rejects(
    nextWatchBuild(watcher),
    /@askrjs\/vite.*hero\.svg.*Restore.*rebuild/s,
  );
  await unlink(sourcePath);
  await missing;
  const restored = nextWatchBuild(watcher);
  await writeFile(sourcePath, original);
  await restored;
  assert.deepEqual(await entry(), initial);
  await verifyAsset(await entry(), original);
  await writeFile(join(root, "src/badge.svg"), replacement);
  await writeFile(join(root, "src/hero.ts"), declaration);
  await writeFile(join(root, "src/badge.ts"), declaration.replaceAll("hero", "badge"));
  const twoModules = nextWatchBuild(watcher);
  await writeFile(entryPath, 'export { hero } from "./hero";\nexport { badge } from "./badge";\n');
  await twoModules;
  const both = await metadata();
  assert.equal(Object.keys(both.entries).length, 2);
  const oneModule = nextWatchBuild(watcher);
  await writeFile(join(root, "src/hero.ts"), `${declaration}\nexport const revision = 3;\n`);
  await oneModule;
  assert.deepEqual(await metadata(), both);
  for (const record of Object.values(both.entries))
    await verifyAsset(record, record.image.width === 200 ? replacement : original);
  const removed = nextWatchBuild(watcher);
  await writeFile(entryPath, "export const noImage = true;\n");
  await removed;
  assert.deepEqual((await metadata()).entries, {});
  console.log(
    `PASS ${process.argv[2]} installed image watch: source-only, repeated emission, recovery, unchanged modules, empty cleanup, fractional SVG, Node parity`,
  );
} finally {
  await watcher.close();
}
