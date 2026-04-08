# @askrjs/askr-vite

Vite plugin for Askr JSX and template transforms.

## Usage

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { askr } from '@askrjs/askr-vite';

export default defineConfig({
  plugins: [askr()],
});
```

## What it does

- Configures JSX to use the Askr runtime (`@askrjs/askr/jsx-runtime`)
- Enables dev-mode invariant stripping in production builds
- Sets up Vitest integration for Askr component tests

## Options

```ts
askr({
  // No required options. All config is inferred from the project.
})
```

## Peer dependencies

Requires `vite` and `@askrjs/askr` as peers:

```bash
npm install --save-dev vite @askrjs/askr-vite
npm install @askrjs/askr
```

## See also

- [Getting started](../askr/docs/getting-started/installation.md)
- [Vite documentation](https://vite.dev)
