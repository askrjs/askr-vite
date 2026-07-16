import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ServerApp } from '@askrjs/server';
import type { ViteDevServer } from 'vite';
import { composeAskrDocumentResponse, isAskrFragment } from './document';
import type { AskrServerOptions } from './types';

function serverApp(module: Record<string, unknown>, options: AskrServerOptions): ServerApp {
  const value = module[options.exportName ?? 'app'] ?? module.default;
  if (!value || typeof (value as ServerApp).fetch !== 'function') {
    throw new Error(
      `@askrjs/vite: ${options.entry} must export a ServerApp as ${options.exportName ?? 'app'} or default`,
    );
  }
  return value as ServerApp;
}

function moduleTelemetry(module: Record<string, unknown>) {
  const telemetry = module['telemetry'];
  return telemetry && typeof telemetry === 'object'
    ? { telemetry: telemetry as NonNullable<Parameters<typeof composeAskrDocumentResponse>[2]>['telemetry'] }
    : undefined;
}

export function createDevelopmentApp(
  server: ViteDevServer,
  options: AskrServerOptions,
): ServerApp {
  return {
    async fetch(request) {
      const module = await server.ssrLoadModule(options.entry);
      const response = await serverApp(module, options).fetch(request);
      if (!isAskrFragment(response)) return response;
      const file = resolve(server.config.root, options.indexHtml ?? 'index.html');
      const document = await readFile(file, 'utf8');
      const transformed = await server.transformIndexHtml(new URL(request.url).pathname, document);
      return composeAskrDocumentResponse(response, transformed, moduleTelemetry(module));
    },
  };
}
