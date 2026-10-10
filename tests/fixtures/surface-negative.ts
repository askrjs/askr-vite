import * as retiredNamespace1 from "@askrjs/vite";
// @ts-expect-error retired public value
void retiredNamespace1.askrVitePlugin;
import * as retiredNamespace4 from "@askrjs/vite";
// @ts-expect-error retired public value
void retiredNamespace4.default;
import * as retiredNamespace6 from "@askrjs/vite/server";
// @ts-expect-error retired public value
void retiredNamespace6.ASKR_APP_MARKER;
import * as retiredNamespace7 from "@askrjs/vite/server";
// @ts-expect-error retired public value
void retiredNamespace7.ASKR_HEAD_MARKER;
import * as retiredNamespace8 from "@askrjs/vite/server";
// @ts-expect-error retired public value
void retiredNamespace8.ASKR_SERVER_MODULE_ID;
import * as retiredNamespace13 from "@askrjs/vite/server";
// @ts-expect-error retired public value
void retiredNamespace13.composeAskrDocumentResponse;
import * as retiredNamespace14 from "@askrjs/vite/server";
// @ts-expect-error retired public value
void retiredNamespace14.composeAskrHead;
import * as retiredNamespace16 from "@askrjs/vite/server";
// @ts-expect-error retired public value
void retiredNamespace16.insertAskrFragment;
import * as retiredNamespace17 from "@askrjs/vite/server";
// @ts-expect-error retired public value
void retiredNamespace17.isAskrFragment;
// @ts-expect-error retired public type
export type Retired23 = import("@askrjs/vite/image").ImagePipelineOptions;
import { askr } from "@askrjs/vite";
// @ts-expect-error ssrPrecompile never affected output and is retired
askr({ ssrPrecompile: true });

// @ts-expect-error private package implementation is not exported
import * as privateNamespace0 from "@askrjs/vite/src/index.ts";
// @ts-expect-error private package implementation is not exported
import * as privateNamespace1 from "@askrjs/vite/dist/index.js";
// @ts-expect-error private package implementation is not exported
import * as privateNamespace2 from "@askrjs/vite/dist/image-node.js";
// @ts-expect-error private package implementation is not exported
import * as privateNamespace3 from "@askrjs/vite/dist/server.js";
// @ts-expect-error private package implementation is not exported
import * as privateNamespace4 from "@askrjs/vite/src/image-pipeline.ts";
// @ts-expect-error private package implementation is not exported
import * as privateNamespace5 from "@askrjs/vite/src/server/document.ts";
// @ts-expect-error private package implementation is not exported
import * as privateNamespace6 from "@askrjs/vite/server/document";

void [
  privateNamespace0,
  privateNamespace1,
  privateNamespace2,
  privateNamespace3,
  privateNamespace4,
  privateNamespace5,
  privateNamespace6,
];
