import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "vite";
import { describe, expect, it, vi } from "vitest";
import { askrVitePlugin } from "../src/jsx-plugin.ts";
import { optimizeTemplateOutput } from "../src/template-optimizer.ts";

function transformHook(plugin) {
  return typeof plugin.transform === "function" ? plugin.transform : plugin.transform.handler;
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
  }, 20_000);

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

  it("should surface malformed JSX through a live Vite dev server", async () => {
    await withViteFixture("export const View = () => <main>", {}, async (server) => {
      await expect(server.transformRequest("/fixture.tsx")).rejects.toThrow(
        /fixture\.tsx|PARSE_ERROR|Transform failed/,
      );
    });
  }, 20_000);
});
