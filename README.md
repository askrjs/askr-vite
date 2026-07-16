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
import { askrServer } from "@askrjs/vite/server";

export default defineConfig({
  plugins: [askr(), askrServer({ entry: "./src/server/entry-server.ts" })],
});
```

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
