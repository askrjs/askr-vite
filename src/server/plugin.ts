import { createNodeHandler } from '@askrjs/node';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { createDevelopmentApp } from './development';
import type { AskrServerOptions } from './types';

export const ASKR_SERVER_MODULE_ID = 'virtual:askr-server';
const RESOLVED_SERVER_MODULE_ID = '\0askr:server';

export function askrServer(options: AskrServerOptions): Plugin {
  let config: ResolvedConfig | undefined;
  return {
    name: 'askr:server',
    configResolved(resolved) {
      config = resolved;
    },
    resolveId(id) {
      return id === ASKR_SERVER_MODULE_ID ? RESOLVED_SERVER_MODULE_ID : null;
    },
    async load(id) {
      if (id !== RESOLVED_SERVER_MODULE_ID) return null;
      if (!config) throw new Error('@askrjs/vite: server plugin was not configured.');
      const sourceDocument = resolve(config.root, options.indexHtml ?? 'index.html');
      const serverOutDocument = resolve(config.root, config.build.outDir, 'index.html');
      const clientOutDocument = resolve(config.root, config.build.outDir, '..', 'index.html');
      const builtDocument = [serverOutDocument, clientOutDocument].find(existsSync);
      const document = await readFile(builtDocument ?? sourceDocument, 'utf8');
      const entry = resolve(config.root, options.entry);
      const exportName = options.exportName ?? 'app';
      return [
        `import * as source from ${JSON.stringify(entry)};`,
        `import { createDocumentApp } from '@askrjs/vite/server';`,
        `const sourceApp = source[${JSON.stringify(exportName)}] ?? source.default;`,
        `if (!sourceApp?.fetch) throw new Error(${JSON.stringify(`@askrjs/vite: ${options.entry} must export a ServerApp`)});`,
        `export const app = createDocumentApp(sourceApp, ${JSON.stringify(document)});`,
        `export default app;`,
      ].join('\n');
    },
    configureServer(server) {
      const handler = createNodeHandler(createDevelopmentApp(server, options));
      server.middlewares.use(handler);
    },
  };
}
