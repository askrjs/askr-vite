import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  askrServer,
  ASKR_SERVER_MODULE_ID,
  composeAskrDocumentResponse,
  composeAskrHead,
  createDocumentApp,
  insertAskrFragment,
} from "../src/server/index.ts";
import { createDevelopmentApp } from "../src/server/development.ts";

const directories = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(
  document = "<html><head><title>App</title><!--askr-head--></head><body><!--askr-app--></body></html>",
) {
  const root = await mkdtemp(join(tmpdir(), "askr-vite-"));
  directories.push(root);
  await writeFile(join(root, "index.html"), document);
  return root;
}

const fragment = (value = "<main>page</main>") =>
  new Response(value, {
    headers: { "content-type": "text/html; charset=utf-8; askr-fragment=1" },
  });

describe("Vite server integration", () => {
  it("should export server integration only from the Vite server subpath", () => {
    expect(typeof askrServer).toBe("function");
    expect(askrServer({ entry: "./server.ts" }).name).toBe("askr:server");
  });

  it("should reload the configured server entry for every development request", async () => {
    const root = await fixture();
    let loads = 0;
    const server = {
      config: { root },
      ssrLoadModule: async () => {
        loads += 1;
        return { app: { fetch: async () => fragment(String(loads)) } };
      },
      transformIndexHtml: async (_url, html) => html,
    };
    const app = createDevelopmentApp(server, { entry: "./server.ts" });
    expect(await (await app.fetch(new Request("http://example.test/"))).text()).toContain("1");
    expect(await (await app.fetch(new Request("http://example.test/"))).text()).toContain("2");
    expect(loads).toBe(2);
  });

  it("should transform index.html before inserting SSR content", async () => {
    const root = await fixture();
    const server = {
      config: { root },
      ssrLoadModule: async () => ({ app: { fetch: async () => fragment() } }),
      transformIndexHtml: async (_url, html) =>
        html.replace("<title>App</title>", "<title>Transformed</title>"),
    };
    const response = await createDevelopmentApp(server, { entry: "./server.ts" }).fetch(
      new Request("http://example.test/page"),
    );
    const html = await response.text();
    expect(html).toContain("<title>Transformed</title>");
    expect(html).toContain("<body><main>page</main></body>");
  });

  it("should insert content at the sole askr app marker", () => {
    expect(
      insertAskrFragment("<head><!--askr-head--></head><body><!--askr-app--></body>", "<main />"),
    ).toBe("<head><!--askr-head--></head><body><main /></body>");
  });

  it.each(["<body></body>", "<!--askr-app--><!--askr-app-->"])(
    "should fail given a missing or duplicate marker",
    (document) => expect(() => insertAskrFragment(document, "content")).toThrow(/exactly one/),
  );

  it("should leave API and non-fragment responses unchanged", async () => {
    const response = new Response('{"ok":true}', {
      headers: { "content-type": "application/json" },
    });
    await expect(
      composeAskrDocumentResponse(response, "<!--askr-head--><!--askr-app-->"),
    ).resolves.toBe(response);
  });

  it("should remove the fragment content-type marker after composition", async () => {
    const response = await composeAskrDocumentResponse(
      fragment(),
      "<!--askr-head--><!--askr-app-->",
    );
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("should stream the document prefix before the fragment completes", async () => {
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const body = new ReadableStream({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode("<main>first"));
        await pending;
        controller.enqueue(new TextEncoder().encode(" second</main>"));
        controller.close();
      },
    });
    const response = await composeAskrDocumentResponse(
      new Response(body, { headers: { "content-type": "text/html; askr-fragment=1" } }),
      "<html><head><!--askr-head--></head><body><!--askr-app--></body></html>",
    );
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    expect(decoder.decode((await reader.read()).value)).toBe("<html><head></head><body>");
    expect(decoder.decode((await reader.read()).value)).toBe("<main>first");
    release();
    expect(decoder.decode((await reader.read()).value)).toBe(" second</main>");
    expect(decoder.decode((await reader.read()).value)).toBe("</body></html>");
    expect((await reader.read()).done).toBe(true);
  });

  it("should cancel the fragment stream when the composed body is cancelled", async () => {
    let cancelled;
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("fragment"));
      },
      cancel(reason) {
        cancelled = reason;
      },
    });
    const response = await composeAskrDocumentResponse(
      new Response(source, { headers: { "content-type": "text/html; askr-fragment=1" } }),
      "<!--askr-head--><!--askr-app-->",
    );
    const reader = response.body.getReader();
    await reader.read();
    await reader.cancel("disconnected");

    expect(cancelled).toBe("disconnected");
  });

  it("should patch existing html locale attributes without duplicates", () => {
    const document = '<html class="app" lang="fr" dir=rtl><head><!--askr-head--></head></html>';
    const result = composeAskrHead(document, "", "en-US", "ltr");

    expect(result).toContain('<html class="app" lang="en-US" dir="ltr">');
    expect(result.match(/\blang=/g)).toHaveLength(1);
    expect(result.match(/\bdir=/g)).toHaveLength(1);
  });

  it("should strip every internal Askr response header", async () => {
    const response = await composeAskrDocumentResponse(
      new Response("fragment", {
        headers: {
          "content-type": "text/html; askr-fragment=1",
          "x-askr-head": '<title data-askr-head="">Page</title>',
          "x-askr-html-lang": "en",
          "x-askr-private": "must-not-leak",
        },
      }),
      '<html><head><meta charset="utf-8"><!--askr-head--></head><body><!--askr-app--></body></html>',
    );

    expect(response.headers.get("x-askr-head")).toBeNull();
    expect(response.headers.get("x-askr-html-lang")).toBeNull();
    expect(response.headers.get("x-askr-private")).toBeNull();
    expect(await response.text()).toContain(
      '<meta charset="utf-8"><title data-askr-head="">Page</title>',
    );
  });

  it("should report document composition status through optional telemetry", async () => {
    const calls = [];
    const telemetry = {
      viteDocument(fields, work) {
        calls.push({ phase: "start", fields });
        try {
          const result = work();
          calls.push({ phase: "end", fields });
          return result;
        } catch (error) {
          calls.push({ phase: "error", fields });
          throw error;
        }
      },
    };

    const response = await composeAskrDocumentResponse(
      new Response("missing", {
        status: 404,
        headers: { "content-type": "text/html; askr-fragment=1" },
      }),
      "<!--askr-head--><!--askr-app-->",
      { telemetry },
    );

    expect(response.status).toBe(404);
    expect(calls).toEqual([
      { phase: "start", fields: { status: 404 } },
      { phase: "end", fields: { status: 404 } },
    ]);
  });

  it("should register a Connect fallback after Vite middleware", () => {
    let middleware;
    const installFallback = askrServer({ entry: "./server.ts" }).configureServer({
      middlewares: {
        use: (handler) => {
          middleware = handler;
        },
      },
    });
    expect(middleware).toBeUndefined();
    installFallback();
    expect(typeof middleware).toBe("function");
    expect(middleware.length).toBe(3);
  });

  it("should preserve page URLs given the Vite development server when configuring app type", () => {
    const config = askrServer({ entry: "./server.ts" }).config();
    expect(config.appType).toBe("custom");
  });

  it("should inline the Askr package family given linked peers in Vite module runners", () => {
    const config = askrServer({ entry: "./server.ts" }).config();
    expect(config.resolve.noExternal).toHaveLength(1);
    expect(config.resolve.noExternal[0]).toBe("@askrjs/*");
    expect(config.ssr).toBeUndefined();
  });

  it("should emit a production wrapper using the transformed index document", async () => {
    const app = createDocumentApp(
      { fetch: async () => fragment() },
      "<html><!--askr-head--><!--askr-app--></html>",
    );
    const response = await app.fetch(new Request("http://example.test/"));
    expect(await response.text()).toBe("<html><main>page</main></html>");
  });

  it("should generate the production virtual entry from the built index document", async () => {
    const root = await fixture();
    const outDir = join(root, "dist");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(outDir);
    await writeFile(
      join(outDir, "index.html"),
      "<html><head><!--askr-head--></head><body>built:<!--askr-app--></body></html>",
    );
    const plugin = askrServer({ entry: "./src/server.ts" });
    plugin.configResolved({ root, build: { outDir: "dist" } });
    const resolved = plugin.resolveId(ASKR_SERVER_MODULE_ID);
    const source = await plugin.load(resolved);
    expect(source).toContain("built:<!--askr-app-->");
    expect(source).toContain("createDocumentApp");
    expect(source).toContain("Reflect.get(source, 'telemetry')");
    expect(source).not.toContain("source.telemetry");
  });

  it("should use the sibling client document given a nested SSR output directory", async () => {
    const root = await fixture();
    const clientOutDir = join(root, "dist");
    const serverOutDir = join(clientOutDir, "server");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(serverOutDir, { recursive: true });
    await writeFile(
      join(clientOutDir, "index.html"),
      "<html><head><!--askr-head--></head><body>client-build:<!--askr-app--></body></html>",
    );
    const plugin = askrServer({ entry: "./src/server.ts" });
    plugin.configResolved({ root, build: { outDir: "dist/server" } });

    const source = await plugin.load(plugin.resolveId(ASKR_SERVER_MODULE_ID));

    expect(source).toContain("client-build:<!--askr-app-->");
    expect(source).not.toContain("<title>App</title>");
  });

  it("should produce equivalent development and production HTML", async () => {
    const root = await fixture();
    const document =
      "<html><head><title>Final</title><!--askr-head--></head><body><!--askr-app--></body></html>";
    await writeFile(join(root, "index.html"), document);
    const server = {
      config: { root },
      ssrLoadModule: async () => ({ app: { fetch: async () => fragment() } }),
      transformIndexHtml: async (_url, html) => html,
    };
    const development = await createDevelopmentApp(server, { entry: "./server.ts" }).fetch(
      new Request("http://example.test/"),
    );
    const production = await createDocumentApp({ fetch: async () => fragment() }, document).fetch(
      new Request("http://example.test/"),
    );
    expect(await development.text()).toBe(await production.text());
  });
});
