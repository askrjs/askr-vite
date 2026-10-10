import { execFile, spawn } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify, stripVTControlCharacters } from "node:util";
import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { readPackRecord } from "../pack-result.js";

const exec = promisify(execFile);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run the consumer matrix through npm run test:browser.");
let artifacts;
let tarball;

test.beforeAll(async () => {
  artifacts = await mkdtemp(join(tmpdir(), "askr-vite-consumer-pack-"));
  const packed = await exec(process.execPath, [
    npmCli,
    "pack",
    "--ignore-scripts",
    "--json",
    "--pack-destination",
    artifacts,
  ]);
  tarball = join(artifacts, readPackRecord(JSON.parse(packed.stdout)).filename);
});

test.afterAll(async () => {
  if (artifacts) await rm(artifacts, { recursive: true, force: true });
});

const matrix = [
  { name: "Vite 8.2.2", dependencies: { vite: "8.2.2" }, package: "vite", cli: "bin/vite.js" },
  {
    name: "Vite+ 0.3.3",
    dependencies: { vite: "npm:@voidzero-dev/vite-plus-core@0.3.3", "vite-plus": "0.3.3" },
    package: "vite-plus",
    cli: "bin/vp",
  },
  {
    name: "Vite+ 1.1.0",
    dependencies: { vite: "npm:@voidzero-dev/vite-plus-core@1.1.0", "vite-plus": "1.1.0" },
    package: "vite-plus",
    cli: "bin/vp",
  },
];

function application(label, images = false) {
  return [
    'import { createIsland } from "@askrjs/askr/boot";',
    ...(images
      ? [
          'import { Image, image } from "@askrjs/vite/image";',
          'const hero = image(new URL("./hero.jpg", import.meta.url), { widths: [32, 64], formats: ["webp", "source"] });',
          'const unusual = image(new URL("./hero%20%E9%9B%AA.jpg", import.meta.url), { widths: [32, 64], formats: ["webp", "source"] });',
          "globalThis.__unusualImage = unusual;",
          'globalThis.__renderNodeImage = (metadata) => createIsland({ root: "#node-image", component: () => <Image image={metadata} alt="Node metadata image" sizes="32px" /> });',
        ]
      : []),
    `createIsland({ root: "#app", component: () => <main><h1>${label}</h1>${images ? '<><Image image={hero} alt="Consumer image" /><Image image={unusual} alt="Unusual image" sizes="32px" /></>' : ""}</main> });`,
    "if (import.meta.hot) import.meta.hot.accept();",
  ].join("\n");
}

async function startDev(root, toolchain) {
  const command = [join(root, "node_modules", toolchain.package, toolchain.cli)];
  if (toolchain.package === "vite-plus") command.push("dev");
  command.push("--host", "127.0.0.1", "--port", "0");
  if (toolchain.config) command.push("--config", toolchain.config);
  const child = spawn(process.execPath, command, {
    cwd: root,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Dev server did not start: ${logs}`)),
      30_000,
    );
    const output = (chunk) => {
      logs += String(chunk);
      const match = stripVTControlCharacters(logs).match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    };
    child.stdout.on("data", output);
    child.stderr.on("data", output);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Dev server exited ${code}: ${logs}`));
    });
  }).catch(async (error) => {
    await stopDev(child);
    throw error;
  });
  return { child, url };
}

async function stopDev(child) {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === "win32") {
    await exec("taskkill", ["/PID", String(child.pid), "/T", "/F"]).catch(() => {});
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}

for (const toolchain of matrix) {
  test(`${toolchain.name}: clean packed install, JSX, HMR, server and image builds`, async ({
    page,
  }) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "askr-vite-consumer-")));
    let dev;
    try {
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({
          private: true,
          type: "module",
          dependencies: { "@askrjs/askr": "0.4.3" },
          devDependencies: { "@askrjs/vite": tarball, sharp: "0.35.5", ...toolchain.dependencies },
        }),
      );
      await exec(process.execPath, [npmCli, "install", "--no-audit", "--no-fund"], {
        cwd: root,
        timeout: 120_000,
      });
      const installed = JSON.parse(
        await readFile(join(root, "node_modules/vite/package.json"), "utf8"),
      );
      expect(installed.version).toBe(toolchain.dependencies.vite.split("@").at(-1));
      await cp(
        join(import.meta.dirname, "../../examples/vite-plus/tsconfig.json"),
        join(root, "tsconfig.json"),
      );
      await writeFile(
        join(root, "vite.config.ts"),
        [
          `import { defineConfig } from "${toolchain.package}";`,
          'import { askr } from "@askrjs/vite";',
          'import { askrServer } from "@askrjs/vite/server";',
          'export default defineConfig({ plugins: [askr({ images: true }), askrServer({ entry: "./server.ts" })] });',
        ].join("\n"),
      );
      await writeFile(
        join(root, "index.html"),
        '<!doctype html><html><head><!--askr-head--></head><body><div id="server"><!--askr-app--></div><div id="app"></div><script type="module" src="/main.tsx"></script></body></html>',
      );
      await writeFile(
        join(root, "server.ts"),
        'export const app = { fetch: () => new Response("<p>Server consumer</p>", { headers: { "content-type": "text/html; askr-fragment=1" } }) };',
      );
      await writeFile(join(root, "server-entry.ts"), 'export { app } from "virtual:askr-server";');
      await writeFile(join(root, "main.tsx"), application("First consumer"));
      await sharp({ create: { width: 64, height: 48, channels: 3, background: "navy" } })
        .jpeg()
        .toFile(join(root, "hero.jpg"));
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      dev = await startDev(root, toolchain);
      await page.goto(dev.url);
      await expect(page.locator("h1")).toHaveText("First consumer");
      await expect(page.locator("#server")).toHaveText("Server consumer");
      await page.evaluate(() => {
        globalThis.consumerDocument = "same-document";
      });
      await writeFile(join(root, "main.tsx"), application("Updated consumer"));
      await expect(page.locator("h1")).toHaveText("Updated consumer");
      expect(await page.evaluate(() => globalThis.consumerDocument)).toBe("same-document");
      await stopDev(dev.child);
      dev = undefined;
      await writeFile(join(root, "main.tsx"), application("Built consumer", true));
      await sharp({ create: { width: 64, height: 48, channels: 3, background: "orange" } })
        .jpeg()
        .toFile(join(root, "hero 雪.jpg"));
      const cli = join(root, "node_modules", toolchain.package, toolchain.cli);
      await exec(process.execPath, [cli, "build"], { cwd: root, timeout: 60_000 });
      const assets = await readdir(join(root, "dist/assets"));
      expect(assets.some((file) => /hero-32-.*\.webp$/.test(file))).toBe(true);
      expect(assets.some((file) => /hero-64-.*\.jpg$/.test(file))).toBe(true);
      await page.route("http://packed-consumer.test/**", async (route) => {
        const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
        const file = join(root, "dist", pathname === "/" ? "index.html" : pathname);
        const contentType = file.endsWith(".html")
          ? "text/html"
          : file.endsWith(".js")
            ? "text/javascript"
            : file.endsWith(".webp")
              ? "image/webp"
              : "image/jpeg";
        try {
          await route.fulfill({ body: await readFile(file), contentType });
        } catch {
          await route.fulfill({ status: 404, body: "Not found" });
        }
      });
      await page.goto("http://packed-consumer.test/");
      await expect(page.locator("h1")).toHaveText("Built consumer");
      const clientImage = page.locator('img[alt="Unusual image"]');
      await expect(clientImage).toHaveJSProperty("complete", true);
      const clientSelected = await clientImage.evaluate((image) => image.currentSrc);
      expect(clientSelected).toMatch(/hero%20%E9%9B%AA-32-.*\.webp$/);
      expect(await clientImage.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
      const nodeMetadata = JSON.parse(
        (
          await exec(
            process.execPath,
            [
              "--input-type=module",
              "-e",
              `import { image } from "@askrjs/vite/image"; import { pathToFileURL } from "node:url"; console.log(JSON.stringify(image(pathToFileURL(${JSON.stringify(join(root, "hero 雪.jpg"))}), { widths: [32, 64], formats: ["webp", "source"] })));`,
            ],
            { cwd: root, timeout: 30_000 },
          )
        ).stdout,
      );
      await page.evaluate((metadata) => {
        const host = document.createElement("div");
        host.id = "node-image";
        document.body.append(host);
        globalThis.__renderNodeImage(metadata);
      }, nodeMetadata);
      const nodeImage = page.locator('img[alt="Node metadata image"]');
      await expect(nodeImage).toHaveJSProperty("complete", true);
      const nodeSelected = await nodeImage.evaluate((image) => image.currentSrc);
      expect(nodeSelected).toBe(clientSelected);
      expect(await nodeImage.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
      const browserMetadata = await page.evaluate(() => globalThis.__unusualImage);
      const normalizeUrl = (url) => new URL(url, "http://packed-consumer.test/").href;
      expect(normalizeUrl(nodeMetadata.src)).toBe(normalizeUrl(browserMetadata.src));
      const normalizeSrcset = (srcset) =>
        srcset.split(",").map((candidate) => {
          const separator = candidate.trim().lastIndexOf(" ");
          return `${normalizeUrl(candidate.trim().slice(0, separator))} ${candidate.trim().slice(separator + 1)}`;
        });
      expect(normalizeSrcset(nodeMetadata.srcset)).toEqual(normalizeSrcset(browserMetadata.srcset));
      expect(
        nodeMetadata.sources.map((source) => ({
          type: source.type,
          srcset: normalizeSrcset(source.srcset),
        })),
      ).toEqual(
        browserMetadata.sources.map((source) => ({
          type: source.type,
          srcset: normalizeSrcset(source.srcset),
        })),
      );

      await exec(
        process.execPath,
        [cli, "build", "--ssr", "server-entry.ts", "--outDir", "dist/server"],
        { cwd: root, timeout: 60_000 },
      );
      const serverEntry = (await readdir(join(root, "dist/server"))).find((file) =>
        file.endsWith(".js"),
      );
      expect(serverEntry).toBeTruthy();
      const verify = await exec(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `const { app } = await import(${JSON.stringify(`./dist/server/${serverEntry}`)}); console.log(await (await app.fetch(new Request("http://localhost/"))).text());`,
        ],
        { cwd: root, timeout: 30_000 },
      );
      expect(verify.stdout).toContain("<p>Server consumer</p>");
      expect(verify.stdout).toContain("/assets/");
      for (const fixture of ["image-watch.js", "image-watch-consumer.mjs"]) {
        await cp(join(import.meta.dirname, "../fixtures", fixture), join(root, fixture));
      }
      const watched = await exec(
        process.execPath,
        ["image-watch-consumer.mjs", toolchain.package],
        {
          cwd: root,
          timeout: 60_000,
        },
      );
      expect(watched.stdout).toContain(`PASS ${toolchain.package} installed image watch:`);
      expect(errors).toEqual([]);
    } finally {
      if (dev) await stopDev(dev.child);
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("Vite+ starter uses one installed toolchain for dev, checks, tests and builds", async ({
  page,
}) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "askr-vite-starter-")));
  let dev;
  try {
    await cp(join(import.meta.dirname, "../../examples/vite-plus"), root, { recursive: true });
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    expect(manifest.devDependencies["@askrjs/vite"]).toBe(`file:../../${basename(tarball)}`);
    manifest.devDependencies["@askrjs/vite"] = tarball;
    await writeFile(join(root, "package.json"), JSON.stringify(manifest));
    await exec(process.execPath, [npmCli, "install", "--no-audit", "--no-fund"], {
      cwd: root,
      timeout: 120_000,
    });
    for (const script of ["check", "test", "build"]) {
      await exec(process.execPath, [npmCli, "run", script], { cwd: root, timeout: 60_000 });
    }
    dev = await startDev(root, { ...matrix[2], config: "askr.config.ts" });
    await page.goto(dev.url);
    await expect(page.locator("h1")).toHaveText("Askr Vite+");
  } finally {
    if (dev) await stopDev(dev.child);
    await rm(root, { recursive: true, force: true });
  }
});
