import { createNodeHandler } from "@askrjs/node";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import { createDevelopmentApp } from "./development";
import type { AskrServerOptions } from "./types";

export const ASKR_SERVER_MODULE_ID = "virtual:askr-server";
const RESOLVED_SERVER_MODULE_ID = "\0askr:server";

/** Portable public identity for the server integration plugin. */
export interface AskrServerPlugin {
  readonly name: "askr:server";
}

function createNodeHandlerOptions(server: ViteDevServer): {
  baseUrl?: string;
  allowedHosts?: readonly string[];
} {
  const serverConfig = server.config?.server;
  const baseUrl = serverConfig?.origin;

  if (
    serverConfig?.allowedHosts &&
    serverConfig.allowedHosts !== true &&
    serverConfig.allowedHosts.length > 0
  ) {
    return { baseUrl, allowedHosts: serverConfig.allowedHosts };
  }

  if (baseUrl) {
    return { baseUrl };
  }

  const host = typeof serverConfig?.host === "string" ? serverConfig.host : "localhost";
  const allowedHosts = new Set([host, "localhost", "127.0.0.1", "[::1]"]);
  return { allowedHosts: Array.from(allowedHosts) };
}

export function askrServer(options: AskrServerOptions): AskrServerPlugin {
  let config: ResolvedConfig | undefined;
  const plugin = {
    name: "askr:server" as const,
    config() {
      // Askr owns document routing. Vite should serve modules and assets, but
      // must not rewrite page URLs to /index.html before the Askr fallback.
      // Keep the Askr package family inside Vite's module graph so file-linked
      // peers cannot load a second runtime with a different component context.
      // Vitest derives its dependency inlining from resolve.noExternal, which
      // is also Vite 8's replacement for the deprecated ssr.noExternal option.
      return {
        appType: "custom",
        resolve: { noExternal: ["@askrjs/*"] },
      };
    },
    configResolved(resolved) {
      config = resolved;
    },
    resolveId(id) {
      return id === ASKR_SERVER_MODULE_ID ? RESOLVED_SERVER_MODULE_ID : null;
    },
    async load(id) {
      if (id !== RESOLVED_SERVER_MODULE_ID) return null;
      if (!config) throw new Error("@askrjs/vite: server plugin was not configured.");
      const sourceDocument = resolve(config.root, options.indexHtml ?? "index.html");
      const serverOutDocument = resolve(config.root, config.build.outDir, "index.html");
      const clientOutDocument = resolve(config.root, config.build.outDir, "..", "index.html");
      const builtDocument = [serverOutDocument, clientOutDocument].find(existsSync);
      const document = await readFile(builtDocument ?? sourceDocument, "utf8");
      const entry = resolve(config.root, options.entry);
      const exportName = options.exportName ?? "app";
      return [
        `import * as source from ${JSON.stringify(entry)};`,
        `import { createDocumentApp } from '@askrjs/vite/server';`,
        `const sourceApp = source[${JSON.stringify(exportName)}] ?? source.default;`,
        `const sourceTelemetry = Reflect.get(source, 'telemetry');`,
        `if (!sourceApp?.fetch) throw new Error(${JSON.stringify(`@askrjs/vite: ${options.entry} must export a ServerApp`)});`,
        `export const app = createDocumentApp(sourceApp, ${JSON.stringify(document)}, sourceTelemetry ? { telemetry: sourceTelemetry } : undefined);`,
        `export default app;`,
      ].join("\n");
    },
    configureServer(server) {
      const handler = createNodeHandler(
        createDevelopmentApp(server, options),
        createNodeHandlerOptions(server),
      );
      // Page rendering is the development fallback. Register it after Vite's
      // module, asset, and HTML middleware so client entries and imported CSS
      // are served by Vite instead of being mistaken for application routes.
      return () => server.middlewares.use(handler);
    },
  } satisfies Plugin;
  return plugin;
}
