import { createRequire } from "node:module";
import type { Plugin } from "vite";
import { optimizeTemplateOutput } from "./template-optimizer";
import { ImagePipeline } from "./image-pipeline";
import type { ImagePipelineOptions } from "./image-types";

const require = createRequire(import.meta.url);
type TransformWithOxc = (typeof import("vite"))["transformWithOxc"];
let transformWithOxcPromise: Promise<TransformWithOxc> | undefined;

async function loadTransformWithOxc(): Promise<TransformWithOxc> {
  transformWithOxcPromise ??= (async () => {
    for (const packageName of ["vite-plus", "vite"] as const) {
      try {
        const buildTool = await import(packageName);
        if (typeof buildTool.transformWithOxc === "function") {
          return buildTool.transformWithOxc as TransformWithOxc;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ERR_MODULE_NOT_FOUND") throw error;
      }
    }
    throw new Error("@askrjs/vite requires either vite or vite-plus to transform JSX.");
  })();
  return transformWithOxcPromise;
}

/** Options accepted by {@link askrVitePlugin}. */
export interface AskrVitePluginOptions {
  /** Transform `.jsx`/`.tsx` files with the Askr JSX runtime. Defaults to `true`. */
  transformJsx?: boolean;
  /** Hoist repeated JSX class/style literals using parsed compiled output. Defaults to `false`. */
  optimizeTemplates?: boolean;
  ssrPrecompile?: boolean;
  /** Opt into declared responsive image transforms. */
  images?: boolean | ImagePipelineOptions;
}

/**
 * Portable public plugin identity.
 *
 * Vite-compatible runners only require the plugin name. Keeping versioned Vite
 * hook types out of the installed declaration prevents consumers such as
 * vite-plus from comparing two distinct copies of Vite's recursive Plugin type.
 */
export interface AskrVitePlugin {
  readonly name: "askr:vite";
}

/**
 * Create the Askr Vite plugin, which transforms Askr JSX/TSX with oxc, wires
 * up dependency pre-bundling and aliasing for `@askrjs/askr`, and optionally
 * runs the responsive image pipeline and template optimizer.
 * JSX transform failures are reported through the active Vite/Rollup plugin
 * context with the source file and original transform detail.
 *
 * @param options Plugin configuration; all fields are optional.
 * @returns A Vite-compatible plugin object exposing the `askr:vite` name.
 */
export function askrVitePlugin(options: AskrVitePluginOptions = {}): AskrVitePlugin {
  const shouldTransform = options.transformJsx ?? true;
  const shouldOptimizeTemplates = options.optimizeTemplates ?? false;
  const imagePipeline = options.images
    ? new ImagePipeline(options.images === true ? {} : options.images)
    : undefined;
  const plugin = {
    name: "askr:vite" as const,
    enforce: "pre",
    config() {
      let askrEntry: string | null = null;
      try {
        askrEntry = require.resolve("@askrjs/askr");
      } catch {
        askrEntry = null;
      }
      return {
        define: {
          __ASKR_OPTIMIZE_TEMPLATES__: JSON.stringify(shouldOptimizeTemplates),
        },
        resolve: {
          alias: askrEntry ? [{ find: "@askrjs/askr", replacement: askrEntry }] : [],
          dedupe: ["@askrjs/askr"],
        },
        optimizeDeps: {
          include: [
            "@askrjs/askr",
            "@askrjs/askr/router",
            "@askrjs/askr/boot",
            "@askrjs/askr/control",
            "@askrjs/askr/fx",
            "@askrjs/askr/resources",
            "@askrjs/askr/data",
            "@askrjs/askr/foundations",
            "@askrjs/askr/foundations/icon",
            "@askrjs/askr/foundations/interactions",
            "@askrjs/askr/foundations/state",
            "@askrjs/askr/foundations/structures",
            "@askrjs/askr/foundations/utilities",
            "@askrjs/askr/jsx-runtime",
            "@askrjs/askr/jsx-dev-runtime",
          ],
        },
        oxc: {
          jsx: { runtime: "automatic", importSource: "@askrjs/askr" },
          jsxInject: "import { jsx, jsxs, Fragment } from '@askrjs/askr/jsx-runtime';",
        },
      };
    },
    configResolved(config) {
      imagePipeline?.configure(config);
    },
    async transform(code, id) {
      if (id.includes("node_modules")) return null;
      const imageTransformed = imagePipeline
        ? await imagePipeline.transform(this, code, id)
        : undefined;
      const input = imageTransformed ?? code;
      if (!shouldTransform || !/\.(jsx|tsx)$/.test(id)) {
        return imageTransformed ? { code: imageTransformed, map: null } : null;
      }
      try {
        const transformWithOxc = await loadTransformWithOxc();
        const result = await transformWithOxc(input, id, {
          lang: id.endsWith(".tsx") ? "tsx" : "jsx",
          jsx: { runtime: "automatic", importSource: "@askrjs/askr" },
          sourcemap: true,
        });
        if (!result?.code) return null;
        return {
          code: shouldOptimizeTemplates ? optimizeTemplateOutput(result.code) : result.code,
          map: result.map,
        };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.error(`@askrjs/vite failed to transform ${id}: ${detail}`);
      }
    },
    async writeBundle() {
      await imagePipeline?.writeMetadata(this);
    },
  } satisfies Plugin;
  return plugin;
}
