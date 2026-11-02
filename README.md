# @askrjs/vite

[![CI](https://github.com/askrjs/askr-vite/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/askrjs/askr-vite/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40askrjs%2Fvite.svg)](https://www.npmjs.com/package/@askrjs/vite)

Vite+ plugin for Askr JSX and template transforms.

`@askrjs/vite` is the build-time glue that lets Askr projects use the
framework's JSX and template conventions inside a Vite+ app.

## Install

```bash
npm install -D @askrjs/vite vite-plus@1.4.0 vite@npm:@voidzero-dev/vite-plus-core@1.4.0
npm install @askrjs/askr
```

`@askrjs/vite` requires Vite+ 1.4 or newer in the 1.x line. Keep the
`vite-plus` package and its matching `vite` core alias on the same version, and
use `vp dev`, `vp build`, and the built-in `vp test` runner. Plain Vite is not
supported.

The installed-package browser suite qualifies the supported toolchain:

| Toolchain | `vite` dependency                        | Configuration import | Test runner |
| --------- | ---------------------------------------- | -------------------- | ----------- |
| Vite+ 1.4 | `npm:@voidzero-dev/vite-plus-core@1.4.0` | `vite-plus`          | `vp test`   |

Each consumer installs normally and exercises JSX, browser
HMR without a document reload, server document composition, production client
and server builds, and responsive-image generation after ordinary install and
clean `npm ci`. `npm ls --all` reports two known invalid Vite core alias peers
inside Vite+'s bundled mocker and Vitest; tests assert those exact upstream
ranges and reject missing, extraneous, or additional invalid packages. Image
declarations require a production build; image processing during development
is not supported.

## Test runners and API mocks

The supported test cohort uses Vite+ 1.4's built-in runner with MSW 2.15.0.
Installed consumers cover normal `npm install`, clean `npm ci`, native
Core/Fetch queries, the generated MSW browser worker, no-reload HMR, retries,
and worker cleanup.

Add MSW 2 and generate its installed browser worker:

```sh
npm install -D vite-plus@1.4.0 vite@npm:@voidzero-dev/vite-plus-core@1.4.0 msw@2.15.0
npm exec -- msw init public --save
npm ci
npm ls --all
```

For Vite+, keep its matching `vite` core alias and use `vite-plus/test` imports
with `vp test`; do not add standalone Vitest. The
[starter's native mock test](examples/vite-plus/tests/Mock.test.ts) uses
`@askrjs/fetch` and Core queries directly. Its
[browser setup](examples/vite-plus/src/mocks.ts) awaits `worker.start()` before
the island mounts. Mocks require an explicit development opt-in; ordinary
production builds omit this setup. The consumer suite also serves a separate,
intentional mock-enabled production fixture to verify the emitted worker.

MSW 3 is outside the supported test/mock cohort. Its optional `vite >=6` peer
does not accept Vite+ core, and Vite+'s mock runner expects MSW 2. A strict
install rejects the combination; use the qualified MSW 2 recipe instead of
bypassing the peer checks. The [MSW 3 migration guide](https://mswjs.io/docs/migrations/2.x-to-3.x/)
also changes the HTTP API import to `msw/http` and makes worker teardown async.

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
later Vite+ build stage.

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
