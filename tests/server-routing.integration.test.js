import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createServer } from "vite-plus";
import { askrServer } from "../src/server/index.ts";

const roots = [];
const servers = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Askr Vite development routing", () => {
  it("should preserve a nested page URL through the Vite middleware and Askr fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "askr-vite-routing-"));
    roots.push(root);
    await writeFile(
      join(root, "index.html"),
      "<html><head><!--askr-head--></head><body><!--askr-app--></body></html>",
    );
    await writeFile(
      join(root, "server.js"),
      `export const app = { fetch: async (request) => new Response(
        "<main>" + new URL(request.url).pathname + "</main>",
        { headers: { "content-type": "text/html; charset=utf-8; askr-fragment=1" } },
      ) };`,
    );
    const server = await createServer({
      configFile: false,
      root,
      plugins: [askrServer({ entry: "./server.js" })],
      logLevel: "silent",
      server: { host: "127.0.0.1", port: 0 },
    });
    servers.push(server);
    await server.listen();
    const address = server.httpServer.address();
    if (!address || typeof address === "string") throw new Error("Vite did not bind a TCP port");

    const origin = `http://127.0.0.1:${address.port}`;
    const rootResponse = await fetch(`${origin}/`);
    const nestedResponse = await fetch(`${origin}/nested/page`);
    const rootHtml = await rootResponse.text();
    const nestedHtml = await nestedResponse.text();
    expect(rootResponse.status).toBe(200);
    expect(nestedResponse.status).toBe(200);
    expect(rootHtml).toContain("<main>/</main>");
    expect(nestedHtml).toContain("<main>/nested/page</main>");
    expect(nestedHtml).not.toBe(rootHtml);
  });
});
