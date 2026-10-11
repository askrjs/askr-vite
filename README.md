# @askrjs/vite

[![CI](https://github.com/askrjs/askr-vite/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/askrjs/askr-vite/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40askrjs%2Fvite.svg)](https://www.npmjs.com/package/@askrjs/vite)

Vite plugin for Askr JSX and template transforms.

`@askrjs/vite` is the build-time glue that lets Askr projects use the
framework's JSX and template conventions inside a Vite+ app.

## Install

```bash
npm install -D @askrjs/vite vite-plus@0.3.3 vite@npm:@voidzero-dev/vite-plus-core@0.3.3
npm install @askrjs/askr
```

Vite+ 0.3.3 is the primary Askr recipe. Keep its matching `vite` core alias and
use `vp dev`, `vp build` and the built-in `vp test`; do not add standalone
Vitest. Use `@askrjs/vite@0.4.2` or newer for these peer ranges.

Ordinary Vite 8.2.2 remains an internal compatibility control for the public
plugin contract. Use Vite+ for Askr projects. The additional
[Vite+ 1.1.0 starter](examples/vite-plus/README.md) is a runtime-characterized
fixture consuming a packed artifact from this checkout, not an upgrade
requirement for the primary recipe.

The installed-package browser suite exercises this build-tool matrix:

| Toolchain   | `vite` dependency                        | Configuration import |
| ----------- | ---------------------------------------- | -------------------- |
| Vite+ 0.3.3 | `npm:@voidzero-dev/vite-plus-core@0.3.3` | `vite-plus`          |
| Vite 8.2.2  | `vite@8.2.2`                             | `vite`               |
| Vite+ 1.1.0 | `npm:@voidzero-dev/vite-plus-core@1.1.0` | `vite-plus`          |

Each consumer installs normally and exercises JSX, browser
HMR without a document reload, server document composition, production client
and server builds, and responsive-image generation. Image declarations require
a production build; image processing during development is not supported.
The low versions in the `vite` peer range describe Vite+ core aliases.

## Test runners and API mocks

Plugin peer compatibility does not establish compatibility between the test
runner and mock library. The installed consumer tests use these exact cohorts,
including ordinary `npm install`, a clean `npm ci`, native Core/Fetch queries,
MSW's generated browser worker, no-reload HMR, retries and worker cleanup:

| Build tool  | Test runner                 | Mock library | Dependency-tree qualification                                                       |
| ----------- | --------------------------- | ------------ | ----------------------------------------------------------------------------------- |
| Vite+ 0.3.3 | Matching built-in `vp test` | MSW 2.15.0   | Primary recipe; one upstream Vite-alias peer diagnostic, described below            |
| Vite 8.2.2  | Vitest 5.0.3                | MSW 2.15.0   | Secondary compatibility control; clean `npm ls --all` after install and ci          |
| Vite+ 1.1.0 | Matching built-in `vp test` | MSW 2.15.0   | Runtime characterization with one invalid alias observed by two bundled peer owners |

For the primary Vite+ recipe, add MSW 2 and generate its installed browser
worker:

```sh
npm install -D vite-plus@0.3.3 vite@npm:@voidzero-dev/vite-plus-core@0.3.3 msw@2.15.0
npm exec -- msw init public --save
npm ci
npm ls --all
```

`npm ls --all` reports the one known alias-peer diagnostic described below;
this recipe has qualified runtime behavior, not a peer-clean dependency tree.

The plain Vite/Vitest row is an internal compatibility test, not an Askr
setup recipe.

For Vite+, keep its matching `vite` core alias and use `vite-plus/test` imports
with `vp test`; do not add standalone Vitest. The
[starter's native mock test](examples/vite-plus/tests/Mock.test.ts) uses
`@askrjs/fetch` and Core queries directly. Its
[browser setup](examples/vite-plus/src/mocks.ts) awaits `worker.start()` before
the island mounts. Mocks require an explicit development opt-in; ordinary
production builds omit this setup. The consumer suite also serves a separate,
intentional mock-enabled production fixture to verify the emitted worker.

The Vite+ recipes run successfully but their built-in `@vitest/mocker` advertises
ordinary Vite versions (`^6.0.0 || ^7.0.0 || ^8.0.0`), which excludes the Vite+
core alias's `0.3.3` or `1.1.0` version. In Vite+ 1.1.0, bundled Vitest 5.0.3 also
declares ordinary `vite ^6.4.0 || ^7.0.0 || ^8.0.0`. `npm ls --all` reports one
invalid physical Vite alias: through the mocker in 0.3.3, and through both exact
bundled importer paths in 1.1.0. Tests assert those owners and ranges and reject
additional invalid, missing or extraneous packages. The 1.1.0 cohort is runtime
characterization with this known peer diagnostic. This is an upstream
[Vite+ distribution](https://github.com/voidzero-dev/vite-plus) /
[Vitest mocker](https://github.com/vitest-dev/vitest/tree/main/packages/mocker)
metadata boundary, not a peer-clean claim.

MSW 3 is outside those supported mock/test cohorts. MSW 3.0.2 and 3.0.3 declare
an optional `vite >=6` peer, excluding Vite+ aliases; a fresh strict install of
Vite+ 1.1.0 with MSW 3.0.2 rejects that exact peer. Switching to ordinary Vite
8.2.2 satisfies MSW's Vite peer, but Vitest 5.0.3's `@vitest/mocker` still declares
`msw ^2.4.9`. After ordinary install and clean ci, `npm ls --all` reports MSW
3.0.3 invalid at that owner. Use the verified MSW 2 recipe rather than bypassing
these peers. The [MSW 3 migration guide](https://mswjs.io/docs/migrations/2.x-to-3.x/)
also changes the HTTP API import to `msw/http` and makes worker teardown async;
changing Askr's JSX transform or peer ranges cannot resolve these upstream
constraints.

## Use

```ts
import { defineConfig } from "vite-plus";
import { askr } from "@askrjs/vite";
import { askrServer } from "@askrjs/vite/server";

export default defineConfig({
  plugins: [askr(), askrServer({ entry: "./src/server/entry-server.ts" })],
});
```

`askr({ optimizeTemplates: true })` optionally hoists repeated static
`class`, `className`, and `style` literals from parsed JSX-runtime property
nodes. The optimizer never scans or rewrites unrelated strings, template
literals, or ordinary objects. JSX/TSX transform failures are reported through
Vite with the source filename and parser detail instead of falling through to a
later build stage.

## Responsive images

Responsive image processing is opt in and requires the optional `sharp` peer:

```bash
npm install -D sharp@^0.35.3
```

```ts
// vite.config.ts
export default defineConfig({
  plugins: [askr({ images: true })],
});
```

```tsx
import { Image, image } from "@askrjs/vite/image";

const hero = image(new URL("./hero.jpg", import.meta.url));

<Image image={hero} alt="Mountain ridge" sizes="(min-width: 60rem) 50vw, 100vw" />;
```

The build emits content-hashed AVIF, WebP, and source-format variants at
320, 640, 960, 1280, and 1920 pixels without upscaling. Defaults are AVIF 50,
WebP 75, JPEG 82, and lossless PNG; plugin defaults and each declaration can
override widths, formats, and quality. Per-image `fit: "cover"` declarations
must also provide an `aspectRatio` and may provide a crop `position`.

`Image` requires `alt`, includes intrinsic dimensions, forwards ordinary image
attributes, and does not choose eager or lazy loading for the application. SVG,
animated, unsupported, and already-small declarations pass through unchanged.
Only files explicitly declared with `image(new URL(..., import.meta.url))` are
processed; `public/` and undeclared files are never rewritten.

The client build writes checked metadata below
`node_modules/.cache/@askrjs/vite/images`. Run it before direct Node SSR/SSG
imports so the server uses exactly the URLs and dimensions emitted by Vite.
Missing or stale metadata fails with an instruction to rebuild.

## Document ownership

Vite is the sole owner of the HTML document. A server-rendered template must
contain exactly one head marker and one app marker:

```html
<head>
  <meta charset="UTF-8" />
  <!--askr-head-->
</head>
<body>
  <div id="app"><!--askr-app--></div>
</body>
```

The server plugin validates both markers. It preserves application-authored
head content, injects only normalized Askr-owned title, meta, link, and JSON-LD
nodes at the head marker, patches the existing `html` language and direction,
and composes the app response between the template prefix and suffix without
buffering the full Web stream. Internal coordination headers are not sent to
the browser.

## When To Use It

- In `vite.config.ts` for any app that uses `@askrjs/askr`
- When you want the Askr JSX and template transforms
- When you are scaffolded from an Askr starter and need to understand the plugin boundary

## Preparing for 0.5.0

See the [migration guide](docs/migration-0.5.0.md) and [complete public API review](docs/0.5.0-public-api.md) for the canonical plugin, server and image entry points.
