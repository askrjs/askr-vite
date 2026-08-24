import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "vite";
import { describe, expect, it, vi } from "vitest";
import { askrVitePlugin } from "../src/jsx-plugin.ts";
import { traceSourcePosition } from "../src/source-map-rewrites.ts";
import { optimizeTemplateOutput } from "../src/template-optimizer.ts";

function transformHook(plugin) {
  return typeof plugin.transform === "function" ? plugin.transform : plugin.transform.handler;
}

function positionOf(code, token) {
  const offset = code.indexOf(token);
  if (offset < 0) throw new Error(`Missing token: ${token}`);
  const before = code.slice(0, offset).split("\n");
  return { line: before.length - 1, column: before.at(-1).length };
}

async function withViteFixture(source, options, work) {
  const root = mkdtempSync(join(process.cwd(), ".askr-vite-plugin-"));
  writeFileSync(join(root, "fixture.tsx"), source);
  const server = await createServer({
    root,
    logLevel: "silent",
    server: { middlewareMode: true },
    plugins: [askrVitePlugin(options)],
  });

  try {
    await work(server);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
}

describe("Askr JSX plugin", () => {
  it("should optimize only parsed JSX property literals", () => {
    const compiled = [
      'import { jsx, jsxs as fragment } from "@askrjs/askr/jsx-runtime";',
      'export const label = `class: "active"`;',
      'export const settings = { class: "active" };',
      'export const view = fragment({ children: [jsx("div", { class: "active" }), jsx("span", { class: "active" })] });',
    ].join("\n");

    const optimized = optimizeTemplateOutput(compiled);

    expect(optimized).toContain('export const label = `class: "active"`;');
    expect(optimized).toContain('export const settings = { class: "active" };');
    expect(optimized).toContain('const __askrStaticLiteral0 = "active";');
    expect(optimized.match(/class: __askrStaticLiteral0/g)).toHaveLength(2);
  });

  it("should generate a collision-free hoist identifier", () => {
    const compiled = [
      'import { jsx } from "@askrjs/askr/jsx-runtime";',
      'const __askrStaticLiteral0 = "existing";',
      'export const first = jsx("div", { className: "card" });',
      'export const second = jsx("span", { className: "card" });',
    ].join("\n");

    const optimized = optimizeTemplateOutput(compiled);

    expect(optimized).toContain('const __askrStaticLiteral1 = "card";');
    expect(optimized.match(/className: __askrStaticLiteral1/g)).toHaveLength(2);
  });

  it("should preserve matching template content through a live Vite dev server", async () => {
    const source = [
      'export const label = `class: "active"`;',
      'export const View = () => <><div class="active"/><span class="active"/></>;',
    ].join("\n");

    await withViteFixture(source, { optimizeTemplates: true }, async (server) => {
      const transformed = await server.transformRequest("/fixture.tsx");
      expect(transformed?.code).toContain('class: "active"');
      expect(transformed?.code).toContain("class: __askrStaticLiteral0");
    });
  }, 60_000);

  it("should preserve original positions after template literal hoisting", async () => {
    const source = [
      'export const first = <div class="shared">first</div>;',
      'export const second = <span class="shared">second</span>;',
    ].join("\n");
    const plugin = askrVitePlugin({ optimizeTemplates: true });
    const transformed = await transformHook(plugin).call(
      {
        error: (message) => {
          throw new Error(String(message));
        },
      },
      source,
      "/src/template.tsx",
    );

    const generated = positionOf(transformed.code, "export const second");
    const original = positionOf(source, "export const second");
    expect(traceSourcePosition(transformed.map, generated.line, generated.column)).toEqual(
      original,
    );
    const generatedHoist = positionOf(transformed.code, '"shared"');
    const originalLiteral = positionOf(source, '"shared"');
    expect(
      traceSourcePosition(transformed.map, generatedHoist.line, generatedHoist.column),
    ).toEqual(originalLiteral);
    expect(transformed.map.sourcesContent).toEqual([source]);
  });

  it("should keep repeated and concurrent transforms isolated", async () => {
    const plugin = askrVitePlugin({ optimizeTemplates: true });
    const context = {
      error(message) {
        throw new Error(String(message));
      },
    };
    const first = await transformHook(plugin).call(
      context,
      'export const V=()=> <><i class="one"/><b class="one"/></>',
      "/src/repeated.tsx",
    );
    const second = await transformHook(plugin).call(
      context,
      'export const V=()=> <><i class="two"/><b class="two"/></>',
      "/src/repeated.tsx",
    );
    const [left, right] = await Promise.all([
      transformHook(plugin).call(
        context,
        'export const L=()=> <><i class="left"/><b class="left"/></>',
        "/src/left.tsx",
      ),
      transformHook(plugin).call(
        context,
        'export const R=()=> <><i class="right"/><b class="right"/></>',
        "/src/right.tsx",
      ),
    ]);

    for (const result of [first, second, left, right]) {
      expect(result.code).toContain("const __askrStaticLiteral0");
      expect(result.code).not.toContain("__askrStaticLiteral1");
    }
    expect(first.code).toContain('"one"');
    expect(second.code).toContain('"two"');
    expect(left.code).toContain('"left"');
    expect(right.code).toContain('"right"');
  });

  it("should ignore optimizer-like content in nested and escaped template strings", () => {
    const compiled = [
      'import { jsx } from "@askrjs/askr/jsx-runtime";',
      'const nested = `outer ${`class: \\"shared\\"`} tail`;',
      'const escaped = `literal \\`class: \\"shared\\"\\``;',
      'export const first = jsx("div", { class: "shared" });',
      'export const second = jsx("span", { class: "shared" });',
    ].join("\n");

    const optimized = optimizeTemplateOutput(compiled);

    expect(optimized).toContain("outer ${`class:");
    expect(optimized).toContain("literal \\`class:");
    expect(optimized.match(/class: __askrStaticLiteral0/g)).toHaveLength(2);
  });

  it("should optimize a large duplicate-literal module in linear practical time", () => {
    const calls = Array.from(
      { length: 4000 },
      (_, index) => `jsx("div", { class: "shared", children: ${index} })`,
    );
    const compiled = `import { jsx } from "@askrjs/askr/jsx-runtime";\nexport const views = [${calls.join(",")}];`;
    const started = performance.now();

    const optimized = optimizeTemplateOutput(compiled);

    expect(performance.now() - started).toBeLessThan(2000);
    expect(optimized.match(/class: __askrStaticLiteral0/g)).toHaveLength(4000);
  });

  it("should report its own attributed error for malformed JSX", async () => {
    const plugin = askrVitePlugin();
    const error = vi.fn((message) => {
      throw new Error(String(message));
    });

    await expect(
      transformHook(plugin).call({ error }, "export const View = () => <main>", "/src/broken.tsx"),
    ).rejects.toThrow(/broken\.tsx.*Transform failed/s);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it.each([
    "export const View = () => <main>",
    "export const View = () => <div {... } />",
    "export const View = () => <><span></></>",
    "export const value: = 1",
  ])("should attribute every malformed JSX/TSX class to its source file", async (source) => {
    const plugin = askrVitePlugin();
    await expect(
      transformHook(plugin).call(
        {
          error(message) {
            throw new Error(String(message));
          },
        },
        source,
        "/src/adversarial.tsx",
      ),
    ).rejects.toThrow(/adversarial\.tsx.*(?:Transform failed|Expected|Unexpected)/s);
  });

  it("should surface malformed JSX through a live Vite dev server", async () => {
    await withViteFixture("export const View = () => <main>", {}, async (server) => {
      await expect(server.transformRequest("/fixture.tsx")).rejects.toThrow(
        /fixture\.tsx|PARSE_ERROR|Transform failed/,
      );
    });
  }, 20_000);
});
