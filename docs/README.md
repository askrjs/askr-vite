# @askrjs/vite

Vite plugin for Askr JSX and template transforms.

## Usage

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { askr } from "@askrjs/vite";

export default defineConfig({
  plugins: [askr()],
});
```

## What it does

- Configures JSX to use the Askr runtime (`@askrjs/askr/jsx-runtime`)
- Reports attributed JSX/TSX transform failures through the build tool
- Enables dev-mode invariant stripping in production builds
- Sets up Vitest integration for Askr component tests
- Owns SSR document composition through `@askrjs/vite/server`
- Optionally transforms declared responsive images with `askr({ images: true })`

## SSR markers

The application `index.html` must contain exactly one `<!--askr-head-->` and
one `<!--askr-app-->` marker. Static head nodes remain in place. Only Askr-owned
metadata is inserted at the head marker, and the streamed app response is
inserted at the app marker.

## Options

```ts
askr({
  images: true,
  optimizeTemplates: true,
});
```

`optimizeTemplates` is off by default. When enabled, it parses compiled output
and hoists repeated static `class`, `className`, and `style` values only from
actual JSX-runtime props objects. Matching text in strings, template literals,
comments, and ordinary objects is outside the rewrite boundary.

Responsive images require `sharp@^0.35.3`. Import `image` and `Image` from
`@askrjs/vite/image`; declarations receive configurable widths, AVIF/WebP/source
formats, quality, and inside/cover fit. Cover requires an aspect ratio. The
client build must precede direct Node SSR/SSG so its checked image metadata is
available. See the root README for the complete example and defaults.

## Peer dependencies

Requires `@askrjs/askr` and either `vite` or `vite-plus`. Both build-tool
peers are optional so package managers do not install Vite into Vite Plus
projects:

```bash
npm install --save-dev vite@8.2.2 @askrjs/vite
# or
npm install --save-dev vite-plus@1.1.0 vite@npm:@voidzero-dev/vite-plus-core@1.1.0 @askrjs/vite
npm install @askrjs/askr
```

Vite+ owns the `vite` alias as well as the `vp` command. Use matching core and
Vite+ versions and import `defineConfig` from `vite-plus`. The checkout is
qualified with Vite 8.2.2, Vite+ 0.3.1, and Vite+ 1.1.0 through normal packed
installs, JSX/HMR, server integration, and production image builds. These peer
ranges are available from `@askrjs/vite@0.4.2`; the
[checkout starter](../examples/vite-plus/README.md) uses the packed checkout.

## See also

- [Askr installation guide](https://github.com/askrjs/askr/tree/main/docs/getting-started/installation.md)
- [Vite documentation](https://vite.dev)
