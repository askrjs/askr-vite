import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  askrServer,
  ASKR_SERVER_MODULE_ID,
  composeAskrDocumentResponse,
  createDocumentApp,
  insertAskrFragment,
} from '../src/server/index.ts';
import { createDevelopmentApp } from '../src/server/development.ts';

const directories = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture(document = '<html><head><title>App</title></head><body><!--askr-app--></body></html>') {
  const root = await mkdtemp(join(tmpdir(), 'askr-vite-'));
  directories.push(root);
  await writeFile(join(root, 'index.html'), document);
  return root;
}

const fragment = (value = '<main>page</main>') => new Response(value, {
  headers: { 'content-type': 'text/html; charset=utf-8; askr-fragment=1' },
});

describe('Vite server integration', () => {
  it('should export server integration only from the Vite server subpath', () => {
    expect(typeof askrServer).toBe('function');
    expect(askrServer({ entry: './server.ts' }).name).toBe('askr:server');
  });

  it('should reload the configured server entry for every development request', async () => {
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
    const app = createDevelopmentApp(server, { entry: './server.ts' });
    expect(await (await app.fetch(new Request('http://example.test/'))).text()).toContain('1');
    expect(await (await app.fetch(new Request('http://example.test/'))).text()).toContain('2');
    expect(loads).toBe(2);
  });

  it('should transform index.html before inserting SSR content', async () => {
    const root = await fixture();
    const server = {
      config: { root },
      ssrLoadModule: async () => ({ app: { fetch: async () => fragment() } }),
      transformIndexHtml: async (_url, html) => html.replace('<title>App</title>', '<title>Transformed</title>'),
    };
    const response = await createDevelopmentApp(server, { entry: './server.ts' })
      .fetch(new Request('http://example.test/page'));
    const html = await response.text();
    expect(html).toContain('<title>Transformed</title>');
    expect(html).toContain('<body><main>page</main></body>');
  });

  it('should insert content at the sole askr app marker', () => {
    expect(insertAskrFragment('<body><!--askr-app--></body>', '<main />')).toBe('<body><main /></body>');
  });

  it.each(['<body></body>', '<!--askr-app--><!--askr-app-->'])(
    'should fail given a missing or duplicate marker',
    (document) => expect(() => insertAskrFragment(document, 'content')).toThrow(/exactly one/),
  );

  it('should leave API and non-fragment responses unchanged', async () => {
    const response = new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
    await expect(composeAskrDocumentResponse(response, '<!--askr-app-->')).resolves.toBe(response);
  });

  it('should remove the fragment content-type marker after composition', async () => {
    const response = await composeAskrDocumentResponse(fragment(), '<!--askr-app-->');
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });

  it('should register a Connect handler backed by askr-node', () => {
    let middleware;
    askrServer({ entry: './server.ts' }).configureServer({
      middlewares: { use: (handler) => { middleware = handler; } },
    });
    expect(typeof middleware).toBe('function');
    expect(middleware.length).toBe(3);
  });

  it('should emit a production wrapper using the transformed index document', async () => {
    const app = createDocumentApp({ fetch: async () => fragment() }, '<html><!--askr-app--></html>');
    const response = await app.fetch(new Request('http://example.test/'));
    expect(await response.text()).toBe('<html><main>page</main></html>');
  });

  it('should generate the production virtual entry from the built index document', async () => {
    const root = await fixture();
    const outDir = join(root, 'dist');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(outDir);
    await writeFile(join(outDir, 'index.html'), '<html><body>built:<!--askr-app--></body></html>');
    const plugin = askrServer({ entry: './src/server.ts' });
    plugin.configResolved({ root, build: { outDir: 'dist' } });
    const resolved = plugin.resolveId(ASKR_SERVER_MODULE_ID);
    const source = await plugin.load(resolved);
    expect(source).toContain('built:<!--askr-app-->');
    expect(source).toContain('createDocumentApp');
  });

  it('should use the sibling client document given a nested SSR output directory', async () => {
    const root = await fixture();
    const clientOutDir = join(root, 'dist');
    const serverOutDir = join(clientOutDir, 'server');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(serverOutDir, { recursive: true });
    await writeFile(join(clientOutDir, 'index.html'), '<html><body>client-build:<!--askr-app--></body></html>');
    const plugin = askrServer({ entry: './src/server.ts' });
    plugin.configResolved({ root, build: { outDir: 'dist/server' } });

    const source = await plugin.load(plugin.resolveId(ASKR_SERVER_MODULE_ID));

    expect(source).toContain('client-build:<!--askr-app-->');
    expect(source).not.toContain('<title>App</title>');
  });

  it('should produce equivalent development and production HTML', async () => {
    const root = await fixture();
    const document = '<html><head><title>Final</title></head><body><!--askr-app--></body></html>';
    await writeFile(join(root, 'index.html'), document);
    const server = {
      config: { root },
      ssrLoadModule: async () => ({ app: { fetch: async () => fragment() } }),
      transformIndexHtml: async (_url, html) => html,
    };
    const development = await createDevelopmentApp(server, { entry: './server.ts' })
      .fetch(new Request('http://example.test/'));
    const production = await createDocumentApp({ fetch: async () => fragment() }, document)
      .fetch(new Request('http://example.test/'));
    expect(await development.text()).toBe(await production.text());
  });
});
