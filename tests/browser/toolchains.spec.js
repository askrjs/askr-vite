import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify, stripVTControlCharacters } from "node:util";
import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { readPackRecord } from "../pack-result.js";

const execFileAsync = promisify(execFile);
const NPM_LOG_FILE_LIMIT = 16 * 1024 * 1024;
const NPM_LOG_TOTAL_LIMIT = 32 * 1024 * 1024;
const NPM_INSTALL_TIMEOUT = process.platform === "win32" ? 180_000 : 120_000;
// Windows CI spends about 172 seconds on the packed consumer's install and ci
// before it can run the remaining toolchain, HMR, image, and build assertions.
const PACKED_CONSUMER_TEST_TIMEOUT = process.platform === "win32" ? 420_000 : 180_000;

// Read a finite snapshot even while npm is still appending its own log.
function readNpmLog(path, remaining = NPM_LOG_TOTAL_LIMIT) {
  if (!Number.isSafeInteger(remaining) || remaining < 0 || remaining > NPM_LOG_TOTAL_LIMIT)
    throw new Error("Invalid remaining npm diagnostic log budget.");
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > NPM_LOG_FILE_LIMIT)
    throw new Error("npm diagnostic log must be a bounded regular file.");
  if (before.size > remaining) throw new Error("npm diagnostic logs exceeded their total limit.");
  const descriptor = openSync(path, "r");
  try {
    const current = fstatSync(descriptor);
    if (!current.isFile() || current.dev !== before.dev || current.ino !== before.ino)
      throw new Error("npm diagnostic log identity changed.");
    if (current.size > NPM_LOG_FILE_LIMIT)
      throw new Error("npm diagnostic log exceeded its byte limit.");
    if (current.size > remaining)
      throw new Error("npm diagnostic logs exceeded their total limit.");
    // A fixed-size snapshot never reads or allocates beyond the remaining total.
    const buffer = Buffer.alloc(current.size);
    let bytes = 0;
    while (bytes < buffer.length) {
      const count = readSync(descriptor, buffer, bytes, buffer.length - bytes, null);
      if (!count) break;
      bytes += count;
    }
    const after = fstatSync(descriptor);
    if (!after.isFile() || after.dev !== current.dev || after.ino !== current.ino)
      throw new Error("npm diagnostic log identity changed.");
    if (after.size > NPM_LOG_FILE_LIMIT)
      throw new Error("npm diagnostic log exceeded its byte limit.");
    if (after.size > remaining) throw new Error("npm diagnostic logs exceeded their total limit.");
    return buffer.subarray(0, bytes);
  } finally {
    closeSync(descriptor);
  }
}

function npmLogSnapshot(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  if (entries.length > 64) throw new Error("Too many npm diagnostic logs.");
  let total = 0;
  return entries
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      if (
        !entry.isFile() ||
        !/^[\dT_Z.-]+-(?:debug-\d+\.log|timing\.json|eresolve-report\.txt)$/u.test(entry.name)
      )
        throw new Error("Unexpected npm diagnostic log entry.");
      const bytes = readNpmLog(join(directory, entry.name), NPM_LOG_TOTAL_LIMIT - total);
      total += bytes.length;
      if (total > NPM_LOG_TOTAL_LIMIT)
        throw new Error("npm diagnostic logs exceeded their total limit.");
      return {
        name: entry.name,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        // This is a last-observed log tail, not proof of the active internal phase.
        tail: bytes.subarray(Math.max(0, bytes.length - 4096)).toString("utf8"),
      };
    });
}

async function exec(file, args, options) {
  const isInstall =
    file === process.execPath && args[0] === npmCli && ["install", "ci"].includes(args[1]);
  let evidence;
  if (isInstall) {
    const output = test.info().outputPath();
    await mkdir(output, { recursive: true });
    const directory = await mkdtemp(join(output, "npm-phase-"));
    const logs = join(directory, "native-logs");
    await mkdir(logs);
    const parent = options?.env ?? process.env;
    const diagnosticEnv = Object.fromEntries(
      Object.entries(parent).filter(
        ([key]) =>
          !["npm_config_logs_dir", "npm_config_timing", "npm_config_logs_max"].includes(
            key.toLowerCase(),
          ),
      ),
    );
    Object.assign(diagnosticEnv, {
      NPM_CONFIG_LOGS_DIR: logs,
      NPM_CONFIG_TIMING: "true",
      NPM_CONFIG_LOGS_MAX: "1000",
    });
    evidence = { directory, logs, snapshots: [], diagnosticEnv };
  }
  const started = performance.now();
  const command = {
    file: basename(file),
    args: args.slice(0, 3).map((arg) => basename(arg).slice(0, 120)),
  };
  let reported = false;
  let completed = false;
  let pending;
  let failure;
  let stdout;
  let stderr;
  const snapshot = () => {
    const observed = { elapsedMs: performance.now() - started };
    try {
      observed.logs = npmLogSnapshot(evidence.logs);
    } catch (error) {
      observed.captureFailure = error.message;
    }
    evidence.snapshots.push(observed);
    return observed;
  };
  // Keep original argv, cwd, cache, resolver, scripts, concurrency and deadline.
  const diagnostic = setInterval(() => {
    reported = true;
    console.info(
      "Askr consumer command stalled",
      JSON.stringify({
        ...command,
        elapsedMs: performance.now() - started,
        ...(evidence ? { npmLastObserved: snapshot() } : {}),
      }),
    );
  }, 30_000);
  diagnostic.unref();
  try {
    pending = execFileAsync(
      file,
      args,
      evidence
        ? {
            ...options,
            // Buffer capture is decoded back to the original public return shape below.
            encoding: "buffer",
            env: evidence.diagnosticEnv,
          }
        : options,
    );
    const result = await pending;
    completed = true;
    if (evidence) {
      stdout = result.stdout;
      stderr = result.stderr;
      result.stdout = stdout.toString("utf8");
      result.stderr = stderr.toString("utf8");
    }
    return result;
  } catch (error) {
    failure = error;
    if (evidence) {
      stdout = error.stdout;
      stderr = error.stderr;
      if (Buffer.isBuffer(stdout)) error.stdout = stdout.toString("utf8");
      if (Buffer.isBuffer(stderr)) error.stderr = stderr.toString("utf8");
    }
    throw error;
  } finally {
    clearInterval(diagnostic);
    if (evidence) {
      const final = snapshot();
      const captureFailures = evidence.snapshots.flatMap((item) =>
        item.captureFailure ? [item.captureFailure] : [],
      );
      if (!final.logs?.some((item) => item.name.endsWith(".log")))
        captureFailures.push("No native npm debug log was retained.");
      try {
        const streams = {};
        for (const [name, bytes] of [
          ["stdout", stdout],
          ["stderr", stderr],
        ]) {
          if (!Buffer.isBuffer(bytes) || bytes.length > (options?.maxBuffer ?? 1024 * 1024)) {
            captureFailures.push(`Missing or oversized raw npm ${name} stream.`);
            streams[name] = { captured: false };
            continue;
          }
          writeFileSync(join(evidence.directory, `${name}.bin`), bytes);
          streams[name] = {
            captured: true,
            bytes: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          };
        }
        writeFileSync(
          join(evidence.directory, "command.json"),
          JSON.stringify(
            {
              file,
              args,
              cwd: options?.cwd ?? process.cwd(),
              nodeVersion: process.version,
              npmCli,
              pid: pending?.child?.pid ?? null,
              timeoutMs: options?.timeout ?? null,
              maxBuffer: options?.maxBuffer ?? 1024 * 1024,
              completed,
              elapsedMs: performance.now() - started,
              error: failure
                ? {
                    name: failure.name,
                    code: failure.code ?? null,
                    signal: failure.signal ?? null,
                    killed: failure.killed ?? null,
                  }
                : null,
              diagnosticEnv: {
                NPM_CONFIG_LOGS_DIR: evidence.logs,
                NPM_CONFIG_TIMING: "true",
                NPM_CONFIG_LOGS_MAX: "1000",
              },
              streams,
              timingJsonPresent:
                final.logs?.some((item) => item.name.endsWith("-timing.json")) ?? false,
              nativeLogSnapshots: evidence.snapshots,
              captureFailures,
              streamCapture:
                "Exact Buffer bytes retained by the unchanged execFile maxBuffer boundary.",
              descendantTerminationProven: false,
              historicalFailureCauseProven: false,
            },
            null,
            2,
          ) + "\n",
        );
        if (captureFailures.length) throw new Error(captureFailures.join("; "));
      } catch (error) {
        // Preserve the original command error; a diagnostic failure never turns it green.
        console.error("Askr npm phase evidence failed", error.message);
        if (!failure) throw error;
      }
    }
    if (reported)
      console.info(
        "Askr consumer command finished",
        JSON.stringify({ ...command, completed, elapsedMs: performance.now() - started }),
      );
  }
}
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
  {
    name: "Vite 8.2.2",
    dependencies: { vite: "8.2.2", vitest: "5.0.3", msw: "2.15.0" },
    package: "vite",
    cli: "bin/vite.js",
  },
  {
    name: "Vite+ 0.3.3",
    dependencies: {
      vite: "npm:@voidzero-dev/vite-plus-core@0.3.3",
      "vite-plus": "0.3.3",
      msw: "2.15.0",
    },
    package: "vite-plus",
    cli: "bin/vp",
  },
  {
    name: "Vite+ 1.1.0",
    dependencies: {
      vite: "npm:@voidzero-dev/vite-plus-core@1.1.0",
      "vite-plus": "1.1.0",
      msw: "2.15.0",
    },
    package: "vite-plus",
    cli: "bin/vp",
  },
];

async function readInstalledGraph(root, stage) {
  const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
  let listed;
  let exit = 0;
  try {
    listed = await exec(process.execPath, [npmCli, "ls", "--all", "--json"], { cwd: root });
  } catch (error) {
    listed = error;
    exit = error.code;
  }
  const tree = JSON.parse(listed.stdout);
  await test.info().attach(`npm-ls-${stage}.json`, {
    body: Buffer.from(JSON.stringify({ exit, tree, stderr: listed.stderr, lock }, null, 2)),
    contentType: "application/json",
  });
  return { lock, tree, exit };
}

async function inspectInstalledToolchain(root, toolchain, stage) {
  const { lock, tree, exit } = await readInstalledGraph(root, stage);
  const invalid = [];
  const visit = (node, path) => {
    expect(node.extraneous, path).toBeFalsy();
    expect(node.missing, path).toBeFalsy();
    if (node.invalid) invalid.push({ path, reason: node.invalid });
    for (const [name, child] of Object.entries(node.dependencies ?? {}))
      visit(child, `${path}/${name}`);
  };
  visit(tree, "root");
  if (toolchain.package === "vite") {
    expect(exit).toBe(0);
    expect(tree.problems ?? []).toEqual([]);
    expect(invalid).toEqual([]);
  } else {
    // Vite+ bundles its runner but @vitest/mocker still advertises ordinary
    // Vite versions. Preserve this exact upstream metadata limitation; no peer bypass.
    expect(exit).toBe(1);
    expect(tree.problems).toHaveLength(1);
    expect(tree.problems[0]).toContain(
      `invalid: vite@npm:@voidzero-dev/vite-plus-core@${toolchain.dependencies["vite-plus"]}`,
    );
    expect(invalid).toEqual([
      {
        path: "root/vite-plus/@vitest/mocker/vite",
        reason: '"^6.0.0 || ^7.0.0 || ^8.0.0" from node_modules/@vitest/mocker',
      },
      ...(toolchain.dependencies["vite-plus"] === "1.1.0"
        ? [
            {
              path: "root/vite-plus/vitest/vite",
              reason:
                '"^6.0.0 || ^7.0.0 || ^8.0.0" from node_modules/@vitest/mocker, "^6.4.0 || ^7.0.0 || ^8.0.0" from node_modules/vitest',
            },
          ]
        : []),
    ]);
  }
  const packages = {};
  for (const name of [
    "@askrjs/vite",
    "@askrjs/askr",
    "@askrjs/fetch",
    "vite",
    "msw",
    toolchain.package === "vite" ? "vitest" : "vite-plus",
    ...(toolchain.package === "vite-plus" ? ["@vitest/mocker", "vitest"] : []),
  ]) {
    const directory = join(root, "node_modules", name);
    const installed = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    packages[name] = {
      name: installed.name,
      version: installed.version,
      realpath: await realpath(directory),
      integrity: lock.packages[`node_modules/${name}`]?.integrity,
    };
    expect(packages[name].integrity).toMatch(/^sha512-/);
  }
  expect(packages.vite.version).toBe(toolchain.dependencies.vite.split("@").at(-1));
  expect(packages.msw.version).toBe(toolchain.dependencies.msw);
  await test.info().attach(`installed-toolchain-${stage}.json`, {
    body: Buffer.from(
      JSON.stringify(
        {
          node: process.versions.node,
          npm: (await exec(process.execPath, [npmCli, "--version"])).stdout.trim(),
          packages,
          npmLsExit: exit,
          tree,
        },
        null,
        2,
      ),
    ),
    contentType: "application/json",
  });
}

async function prepareMockFixtures(root, toolchain) {
  await mkdir(join(root, "tests"), { recursive: true });
  for (const [source, target] of [
    ["mock-native.test.ts", "tests/mock.test.ts"],
    ["mock-browser.ts", "mock-browser.ts"],
    ["mock-app.tsx", "mock-app.tsx"],
  ]) {
    const contents = (
      await readFile(join(import.meta.dirname, "../fixtures", source), "utf8")
    ).replace(
      'from "vite-plus/test"',
      `from "${toolchain.package === "vite" ? "vitest" : "vite-plus/test"}"`,
    );
    await writeFile(join(root, target), contents);
  }
  await exec(process.execPath, [npmCli, "exec", "--", "msw", "init", "public", "--save"], {
    cwd: root,
    timeout: 30_000,
  });
  const runner =
    toolchain.package === "vite"
      ? [join(root, "node_modules/vitest/vitest.mjs"), "run"]
      : [join(root, "node_modules/vite-plus/bin/vp"), "test", "run"];
  const native = await exec(process.execPath, [...runner, "--config", "vite.config.ts"], {
    cwd: root,
    timeout: 60_000,
  });
  expect(stripVTControlCharacters(native.stdout)).toMatch(/1 passed/);
  await test.info().attach("native-mock-test.log", {
    body: Buffer.from(native.stdout + native.stderr),
    contentType: "text/plain",
  });
}

async function exerciseMocks(page, url, first, updated) {
  await page.goto(url);
  await expect(page.getByRole("heading", { name: first })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Loading mock");
  await page.evaluate(() => globalThis.releaseMock());
  await expect(page.getByRole("status")).toHaveText(first);
  if (updated) await updated();
  await page.evaluate(() => globalThis.failNextMock());
  await page.getByRole("button", { name: "Retry mock" }).click();
  await expect(page.getByRole("status")).toHaveText("Mock unavailable");
  await page.getByRole("button", { name: "Retry mock" }).click();
  await expect(page.getByRole("status")).toHaveText(updated ? "Updated mock" : first);
  await page.evaluate(() => globalThis.stopMocks());
  expect(await page.evaluate(async () => (await (await fetch("/mock/profile")).json()).name)).toBe(
    "Real service",
  );
}

async function qualifyMocks(root, toolchain, page) {
  const cli = join(root, "node_modules", toolchain.package, toolchain.cli);
  await writeFile(join(root, "main.tsx"), await readFile(join(root, "mock-app.tsx"), "utf8"));
  let dev;
  try {
    dev = await startDev(root, toolchain);
    await exerciseMocks(page, dev.url, "First mock", async () => {
      await page.evaluate(() => {
        globalThis.mockDocument = "same-document";
      });
      const main = await readFile(join(root, "main.tsx"), "utf8");
      await writeFile(
        join(root, "main.tsx"),
        main.replace('const label = "First mock"', 'const label = "Updated mock"'),
      );
      await expect(page.getByRole("heading", { name: "Updated mock" })).toBeVisible();
      expect(await page.evaluate(() => globalThis.mockDocument)).toBe("same-document");
    });
  } finally {
    if (dev) await stopDev(dev.child);
  }
  await exec(process.execPath, [cli, "build"], { cwd: root, timeout: 60_000 });
  // A dedicated mock qualification build intentionally includes its worker.
  // Serve real localhost HTTP so Service Worker security/selection is native.
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (pathname === "/mock/profile") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ name: "Real service" }));
      return;
    }
    const file = join(root, "dist", pathname === "/" ? "index.html" : pathname);
    response.setHeader(
      "content-type",
      file.endsWith(".html")
        ? "text/html"
        : file.endsWith(".js")
          ? "text/javascript"
          : "application/octet-stream",
    );
    try {
      response.end(await readFile(file));
    } catch {
      response.statusCode = 404;
      response.end("Not found");
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    await exerciseMocks(page, `http://127.0.0.1:${server.address().port}/`, "Updated mock");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

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
    env: { ...process.env, ...toolchain.env },
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
  test(`${toolchain.name}: ordinary packed install/ci, native/browser mocks, JSX, HMR and builds`, async ({
    page,
  }) => {
    test.setTimeout(PACKED_CONSUMER_TEST_TIMEOUT);
    const root = await realpath(await mkdtemp(join(tmpdir(), "askr-vite-consumer-")));
    let dev;
    try {
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({
          private: true,
          type: "module",
          dependencies: { "@askrjs/askr": "0.5.0", "@askrjs/fetch": "0.5.0" },
          devDependencies: { "@askrjs/vite": tarball, sharp: "0.35.5", ...toolchain.dependencies },
          allowScripts: {
            [`msw@${toolchain.dependencies.msw}`]: true,
            "sharp@0.35.5": true,
            "fsevents@2.3.3": true,
            "fsevents@2.3.2": true,
          },
        }),
      );
      const installation = await exec(
        process.execPath,
        [npmCli, "install", "--no-audit", "--no-fund"],
        {
          cwd: root,
          timeout: NPM_INSTALL_TIMEOUT,
        },
      );
      await test.info().attach("ordinary-install.log", {
        body: Buffer.from(installation.stdout + installation.stderr),
        contentType: "text/plain",
      });
      const installed = JSON.parse(
        await readFile(join(root, "node_modules/vite/package.json"), "utf8"),
      );
      expect(installed.version).toBe(toolchain.dependencies.vite.split("@").at(-1));
      await inspectInstalledToolchain(root, toolchain, "install");
      const cleanInstallation = await exec(
        process.execPath,
        [npmCli, "ci", "--no-audit", "--no-fund"],
        {
          cwd: root,
          timeout: NPM_INSTALL_TIMEOUT,
        },
      );
      await test.info().attach("ordinary-ci.log", {
        body: Buffer.from(cleanInstallation.stdout + cleanInstallation.stderr),
        contentType: "text/plain",
      });
      await inspectInstalledToolchain(root, toolchain, "ci");
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
          'const realApi = { name: "fixture-real-api", configureServer(server) { server.middlewares.use((request, response, next) => { if (request.url !== "/mock/profile") return next(); response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ name: "Real service" })); }); } };',
          'export default defineConfig({ plugins: [realApi, askr({ images: true }), askrServer({ entry: "./server.ts" })], test: { environment: "node", include: ["tests/**/*.test.ts"] } });',
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
      await prepareMockFixtures(root, toolchain);
      await sharp({ create: { width: 64, height: 48, channels: 3, background: "navy" } })
        .jpeg()
        .toFile(join(root, "hero.jpg"));
      const errors = [];
      const failedRequests = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("requestfailed", (request) =>
        failedRequests.push({ url: request.url(), error: request.failure()?.errorText }),
      );
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
      const serverEntry = "server-entry.js";
      expect(await readdir(join(root, "dist/server"))).toContain(serverEntry);
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
      await qualifyMocks(root, toolchain, page);
      expect(errors).toEqual([]);
      expect(failedRequests).toEqual([]);
    } finally {
      if (dev) await stopDev(dev.child);
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("Vite+ starter uses one installed toolchain for dev, checks, tests and builds", async ({
  page,
}) => {
  test.setTimeout(PACKED_CONSUMER_TEST_TIMEOUT);
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
      timeout: NPM_INSTALL_TIMEOUT,
    });
    const toolchain = matrix.find((item) => item.name === "Vite+ 1.1.0");
    await inspectInstalledToolchain(root, toolchain, "starter-install");
    await exec(process.execPath, [npmCli, "ci", "--no-audit", "--no-fund"], {
      cwd: root,
      timeout: NPM_INSTALL_TIMEOUT,
    });
    await inspectInstalledToolchain(root, toolchain, "starter-ci");
    await exec(process.execPath, [npmCli, "exec", "--", "msw", "init", "public", "--save"], {
      cwd: root,
      timeout: 30_000,
    });
    for (const script of ["check", "test", "build"]) {
      const result = await exec(process.execPath, [npmCli, "run", script], {
        cwd: root,
        timeout: 60_000,
        env: { ...process.env, ...(script === "build" ? { VITE_ENABLE_MOCKS: "true" } : {}) },
      });
      await test.info().attach(`starter-${script}.log`, {
        body: Buffer.from(result.stdout + result.stderr),
        contentType: "text/plain",
      });
    }
    const builtAssets = await readdir(join(root, "dist/assets"));
    const builtJavaScript = (
      await Promise.all(
        builtAssets
          .filter((file) => file.endsWith(".js"))
          .map((file) => readFile(join(root, "dist/assets", file), "utf8")),
      )
    ).join("\n");
    expect(builtJavaScript).not.toContain("Development profile");
    expect(builtJavaScript).not.toContain("mockServiceWorker.js");
    dev = await startDev(root, { ...toolchain, config: "askr.config.ts" });
    await page.goto(dev.url);
    await expect(page.locator("h1")).toHaveText("Askr Vite+");
    expect(
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
    ).toBe(0);
    await stopDev(dev.child);
    dev = await startDev(root, {
      ...toolchain,
      config: "askr.config.ts",
      env: { VITE_ENABLE_MOCKS: "true" },
    });
    await page.goto(dev.url);
    await expect(page.locator("h1")).toHaveText("Askr Vite+");
    expect(await page.evaluate(async () => (await (await fetch("/api/profile")).json()).name)).toBe(
      "Development profile",
    );
  } finally {
    if (dev) await stopDev(dev.child);
    await rm(root, { recursive: true, force: true });
  }
});

test("MSW 3: Vite+ strict install and plain Vite ordinary ci expose exact upstream peers", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "askr-vite-msw3-peers-")));
  try {
    await test.info().attach("peer-probe-toolchain.json", {
      body: Buffer.from(
        JSON.stringify(
          {
            node: process.versions.node,
            npm: (await exec(process.execPath, [npmCli, "--version"])).stdout.trim(),
          },
          null,
          2,
        ),
      ),
      contentType: "application/json",
    });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        dependencies: { "@askrjs/askr": "0.5.0" },
        devDependencies: {
          "@askrjs/vite": tarball,
          vite: "npm:@voidzero-dev/vite-plus-core@1.1.0",
          "vite-plus": "1.1.0",
          msw: "3.0.2",
        },
      }),
    );
    const rejected = await exec(
      process.execPath,
      [npmCli, "install", "--strict-peer-deps", "--no-audit", "--no-fund"],
      { cwd: root, timeout: NPM_INSTALL_TIMEOUT },
    ).then(
      () => {
        throw new Error("The incompatible MSW 3/Vite+ peer install unexpectedly succeeded.");
      },
      (error) => error,
    );
    expect(rejected.code).toBe(1);
    expect(rejected.stderr).toContain("ERESOLVE");
    expect(rejected.stderr).toContain('peerOptional vite@">=6" from msw@3.0.2');
    expect(rejected.stderr).toContain("vite@1.1.0");
    await test.info().attach("msw3-vite-plus-peer-rejection.log", {
      body: Buffer.from(rejected.stdout + rejected.stderr),
      contentType: "text/plain",
    });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        dependencies: { "@askrjs/askr": "0.5.0" },
        devDependencies: { "@askrjs/vite": tarball, vite: "8.2.2", vitest: "5.0.3", msw: "3.0.3" },
      }),
    );
    for (const command of ["install", "ci"]) {
      const installed = await exec(process.execPath, [npmCli, command, "--no-audit", "--no-fund"], {
        cwd: root,
        timeout: NPM_INSTALL_TIMEOUT,
      });
      await test.info().attach(`msw3-plain-${command}.log`, {
        body: Buffer.from(installed.stdout + installed.stderr),
        contentType: "text/plain",
      });
      const graph = await readInstalledGraph(root, `msw3-plain-${command}`);
      if (command === "install") continue;
      expect(graph.exit).toBe(1);
      expect(graph.tree.problems).toHaveLength(1);
      expect(graph.tree.problems[0]).toContain("invalid: msw@3.0.3");
      const invalid = [];
      const visit = (node, path) => {
        expect(node.extraneous, path).toBeFalsy();
        expect(node.missing, path).toBeFalsy();
        if (node.invalid) invalid.push({ path, reason: node.invalid });
        for (const [name, child] of Object.entries(node.dependencies ?? {}))
          visit(child, `${path}/${name}`);
      };
      visit(graph.tree, "root");
      expect(invalid).toEqual([
        {
          path: "root/vitest/@vitest/mocker/msw",
          reason: '"^2.4.9" from node_modules/vitest/node_modules/@vitest/mocker',
        },
      ]);
      const mocker = JSON.parse(
        await readFile(
          join(root, "node_modules/vitest/node_modules/@vitest/mocker/package.json"),
          "utf8",
        ),
      );
      expect(mocker.version).toBe("5.0.3");
      expect(mocker.peerDependencies.msw).toBe("^2.4.9");
      expect(
        JSON.parse(await readFile(join(root, "node_modules/msw/package.json"), "utf8")).version,
      ).toBe("3.0.3");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
