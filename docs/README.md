# @askrjs/vite

Vite plugin for Askr JSX and template transforms.

## Usage

```ts
// vite.config.ts
import { defineConfig } from "vite-plus";
import { askr } from "@askrjs/vite";

export default defineConfig({
  plugins: [askr()],
});
```

## What it does

- Configures JSX to use the Askr runtime (`@askrjs/askr/jsx-runtime`)
- Reports attributed JSX/TSX transform failures through the build tool
- Enables dev-mode invariant stripping in production builds
- Sets up Vite+ test integration for Askr component tests
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

Use Vite+ 0.3.3 and its matching core alias for Askr projects:

```bash
npm install --save-dev vite-plus@0.3.3 vite@npm:@voidzero-dev/vite-plus-core@0.3.3 @askrjs/vite
npm install @askrjs/askr
```

Import `defineConfig` from `vite-plus`, use `vp dev` and `vp build`, and import
component test APIs from `vite-plus/test` with `vp test`. Vite+ owns the `vite`
alias; keep the two versions aligned and do not add a separate Vitest runner.
The plugin retains optional public `vite` and `vite-plus` peers for compatibility.

The installed tests retain plain Vite 8.2.2 as an internal plugin compatibility
control and Vite+ 1.1.0 as a separate runtime characterization. Neither changes
the standard Vite+ 0.3.3 toolchain. The
[checkout starter](../examples/vite-plus/README.md) consumes the packed checkout.

For API mocks, use MSW 2.15.0. The Vite+ 0.3.3 cohort has one known upstream
optional Vite-alias peer diagnostic; its runtime coverage is not a peer-clean
claim. MSW 3 remains outside the supported test/mock cohorts. See the
[root README](../README.md#test-runners-and-api-mocks) for the exact importer
paths, peer ranges and native/browser qualification boundaries.

## See also

- [Askr installation guide](https://github.com/askrjs/askr/tree/main/docs/getting-started/installation.md)
- [Vite+ documentation](https://viteplus.dev)
