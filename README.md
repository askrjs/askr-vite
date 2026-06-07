# @askrjs/vite

Vite plugin for Askr JSX and template transforms.

`@askrjs/vite` is the build-time glue that lets Askr projects use the
framework's JSX and template conventions inside a normal Vite app.

## Install

```bash
npm install -D @askrjs/vite vite
npm install @askrjs/askr
```

## Use

```ts
import { defineConfig } from "vite";
import { askr } from "@askrjs/vite";

export default defineConfig({
  plugins: [askr()],
});
```

## When To Use It

- In `vite.config.ts` for any app that uses `@askrjs/askr`
- When you want the Askr JSX and template transforms
- When you are scaffolded from an Askr starter and need to understand the plugin boundary
