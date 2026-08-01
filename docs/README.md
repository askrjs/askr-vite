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
});
```

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
npm install --save-dev vite @askrjs/vite
# or
npm install --save-dev vite-plus @askrjs/vite
npm install @askrjs/askr
```

## See also

- [Askr installation guide](https://github.com/askrjs/askr/tree/main/docs/getting-started/installation.md)
- [Vite documentation](https://vite.dev)
