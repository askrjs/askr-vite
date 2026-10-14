import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
const expected = new Map([
  ["@askrjs/vite", ["askr"]],
  ["@askrjs/vite/server", ["askrServer", "createDocumentApp"]],
  ["@askrjs/vite/image", ["Image", "image"]],
]);
for (const [path, names] of expected) {
  const namespace = await import(path);
  assert.deepEqual(Object.keys(namespace).sort(), [...names].sort(), path);
  for (const name of names) assert.equal(typeof namespace[name], "function", `${path}.${name}`);
}
const require = createRequire(import.meta.url);
const manifest = require("@askrjs/vite/package.json");
const browser = await import(
  pathToFileURL(join(dirname(require.resolve("@askrjs/vite/package.json")), "dist/image.js"))
);
assert.deepEqual(Object.keys(browser).sort(), ["Image", "image"]);
assert.equal(browser.Image, (await import("@askrjs/vite/image")).Image);
assert.equal(typeof browser.image, "function");
const transformed = {
  __askrImage: true,
  src: "/hero.svg",
  width: 100.5,
  height: 80.25,
  sources: [],
};
assert.deepEqual(browser.image(transformed), transformed);
assert.throws(
  () => browser.image(new URL("file:///untransformed.svg")),
  /@askrjs\/vite.*Enable.*Vite/,
);
assert.deepEqual(Object.keys(manifest.exports).sort(), [
  ".",
  "./image",
  "./package.json",
  "./server",
]);
for (const path of [
  "src/index.ts",
  "dist/index.js",
  "dist/image-node.js",
  "dist/server.js",
  "src/image-pipeline.ts",
  "src/server/document.ts",
  "server/document",
]) {
  await assert.rejects(import(`@askrjs/vite/${path}`), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
}
console.log("PASS Node/browser runtime namespaces, all5 values, exact4 keys,7 private paths");
