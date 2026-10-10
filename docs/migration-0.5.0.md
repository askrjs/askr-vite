# Migrating to 0.5.0

The four package entry points remain. Use the named plugin factory:

```ts
import { askr } from "@askrjs/vite";
```

Replace a root default import or named `askrVitePlugin` import with `askr`.
Existing `transformJsx`, `optimizeTemplates` and `images` options retain their
meaning. Remove `ssrPrecompile`; it was never read and never changed emitted
output. It has no replacement option.

Import plugin-wide image defaults from the root. Per-image overrides and image
results remain at `/image`:

```ts
import { askr, type ImagePipelineOptions } from "@askrjs/vite";
import { Image, image, type ImageOptions } from "@askrjs/vite/image";
```

`ImagePipelineOptions` is no longer reexported from `/image`. Its definition and
meaning remain unchanged at the root.

The `/server` entry retains `askrServer`, `createDocumentApp`, `AskrServerOptions`,
`AskrServerPlugin` and `AskrDocumentOptions`. The generated production virtual
server module still uses the installed `createDocumentApp` wrapper. Import the
application through the existing virtual module:

```ts
import app, { app as namedApp } from "virtual:askr-server";
```

The following low-level exports leave `/server`:

| Removed name                  | Migration                                                                                                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ASKR_APP_MARKER`             | Author `<!--askr-app-->` exactly once in the HTML document.                                                                                                                |
| `ASKR_HEAD_MARKER`            | Author `<!--askr-head-->` exactly once in the HTML document.                                                                                                               |
| `ASKR_SERVER_MODULE_ID`       | Import `"virtual:askr-server"` directly. App-local tooling can own that explicit module string.                                                                            |
| `composeAskrDocumentResponse` | Use `askrServer` for configured Vite document ownership, or `createDocumentApp` to wrap a `ServerApp` explicitly. Custom response composition must own its local contract. |
| `composeAskrHead`             | Use the retained document integration for server metadata; custom head-string composition must own its local contract.                                                     |
| `insertAskrFragment`          | Use the retained document integration; custom fragment insertion must own its local contract.                                                                              |
| `isAskrFragment`              | Use the retained document integration; custom response classification must own its local contract.                                                                         |

The response, head and fragment helpers do not have one-for-one public
substitutes. Their internal implementations still support the retained document
wrapper, including stream cancellation and header normalization.

Responsive images keep explicit build-time declarations. Client builds emit the
browser metadata; direct Node SSR/SSG imports resolve that same checked metadata.
Run the client build before Node rendering and rebuild after changing source
images or declaration options. The Node adapter does not enter browser bundles.

Watch builds now observe declared image files and use emission references owned
by the current build. Atomic source replacement, deletion and restoration require
no edit to the declaring module. Deleting the last declaration in a client watch
build clears its checked entries. An unrelated SSR build preserves the preceding
client metadata. Malformed checked metadata identifies the cache and instructs a
client rebuild. Fractional positive SVG dimensions remain valid.

Duplicate plugin instances with identical options preserve the original JSX,
image and source-map output. Configure one instance per build when choosing
options; no precedence contract for conflicting duplicate options is introduced.

Emitted filenames are URI-encoded before entering checked `src` and `srcset`
URLs. This preserves responsive candidate grammar when filenames contain spaces
or Unicode. Older Vite+ toolchains can represent browser URLs as absolute URLs;
Node metadata uses the configured base. Their URL targets and native responsive
image selection match, while bundler-owned URL representation remains intact.
