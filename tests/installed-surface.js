import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readPackRecord } from "./pack-result.js";

const require = createRequire(import.meta.url);
const surface = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures/public-surface.json"), "utf8"),
);
assert.equal(surface.filter((row) => row.decision === "KEEP").length, 18);
assert.equal(surface.filter((row) => row.decision !== "KEEP").length, 10);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run installed surface qualification through npm run pack:check.");
const temporary = mkdtempSync(join(tmpdir(), "askr-vite-packed-surface-"));
const run = (args, cwd = temporary) =>
  execFileSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
try {
  let tarball = process.argv[2];
  if (!tarball) {
    const record = readPackRecord(
      JSON.parse(
        run(
          [npmCli, "pack", "--ignore-scripts", "--json", "--pack-destination", temporary],
          process.cwd(),
        ),
      ),
    );
    tarball = join(temporary, record.filename);
  }
  writeFileSync(
    join(temporary, "package.json"),
    JSON.stringify({
      name: "askr-vite-public-surface-consumer",
      private: true,
      type: "module",
      dependencies: {
        "@askrjs/vite": tarball,
        "@askrjs/askr": ">=0.4.0 <0.5.0",
        "@askrjs/server": ">=0.4.0 <0.5.0",
        "@types/node": "^26.3.0",
        vite: "npm:@voidzero-dev/vite-plus-core@0.3.3",
        "vite-plus": "0.3.3",
      },
    }),
  );
  run([npmCli, "install", "--no-audit", "--no-fund"]);
  for (const name of ["surface-positive.ts", "surface-negative.ts", "surface-runtime.mjs"])
    cpSync(join(import.meta.dirname, "fixtures", name), join(temporary, name));
  const compilerOptions = [
    "--target",
    "ES2022",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--strict",
    "--skipLibCheck",
    "false",
    "--noEmit",
  ];
  for (const name of ["@typescript/typescript6", "typescript"]) {
    const compilerManifestPath = require.resolve(`${name}/package.json`);
    const compilerManifest = JSON.parse(readFileSync(compilerManifestPath, "utf8"));
    const compiler = join(
      dirname(compilerManifestPath),
      compilerManifest.bin.tsc ?? compilerManifest.bin.tsc6,
    );
    const version = run([compiler, "--version"]).trim();
    run([compiler, ...compilerOptions, "surface-positive.ts"]);
    run([compiler, ...compilerOptions, "surface-negative.ts"]);
    console.log(
      `PASS ${name} ${version}: all18 retained pairs,10 retired names and ssrPrecompile; strict normal packed install`,
    );
  }
  process.stdout.write(run(["surface-runtime.mjs"]));
  const lock = JSON.parse(readFileSync(join(temporary, "package-lock.json"), "utf8"));
  console.log(
    JSON.stringify({
      package: tarball,
      installed: Object.fromEntries(
        ["@askrjs/askr", "@askrjs/server", "@askrjs/vite", "vite", "vite-plus"].map((name) => [
          name,
          lock.packages[`node_modules/${name}`].version,
        ]),
      ),
    }),
  );
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  throw error;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
