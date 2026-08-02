# @askrjs/vite

[![CI](https://github.com/askrjs/askr-vite/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/askrjs/askr-vite/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40askrjs%2Fvite.svg)](https://www.npmjs.com/package/@askrjs/vite)

Vite plugin for Askr JSX and template transforms.

`@askrjs/vite` is the build-time glue that lets Askr projects use the
framework's JSX and template conventions inside a normal Vite app.

## Install

```bash
npm install -D @askrjs/vite vite
# or
npm install -D @askrjs/vite vite-plus
npm install @askrjs/askr
```

## Use

```ts
import { defineConfig } from "vite";
import { askr } from "@askrjs/vite";
import { askrServer } from "@askrjs/vite/server";

export default defineConfig({
  plugins: [askr(), askrServer({ entry: "./src/server/entry-server.ts" })],
});
```

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
