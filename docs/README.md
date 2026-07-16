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

## SSR markers

The application `index.html` must contain exactly one `<!--askr-head-->` and
one `<!--askr-app-->` marker. Static head nodes remain in place. Only Askr-owned
metadata is inserted at the head marker, and the streamed app response is
inserted at the app marker.

## Options

```ts
askr({
  // No required options. All config is inferred from the project.
});
```

## Peer dependencies

Requires `vite` and `@askrjs/askr` as peers:

```bash
npm install --save-dev vite @askrjs/vite
npm install @askrjs/askr
```

## See also

- [Askr installation guide](https://github.com/askrjs/askr/tree/main/docs/getting-started/installation.md)
- [Vite documentation](https://vite.dev)
