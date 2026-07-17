import { createRequire } from "node:module";
import { transformWithOxc, type Plugin } from "vite";
import { optimizeTemplateOutput } from "./template-optimizer";

const require = createRequire(import.meta.url);

export interface AskrVitePluginOptions {
  transformJsx?: boolean;
  optimizeTemplates?: boolean;
  ssrPrecompile?: boolean;
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

export function askrVitePlugin(options: AskrVitePluginOptions = {}): AskrVitePlugin {
  const shouldTransform = options.transformJsx ?? true;
  const shouldOptimizeTemplates = options.optimizeTemplates ?? false;
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
    async transform(code, id) {
      if (!shouldTransform || !/\.(jsx|tsx)$/.test(id) || id.includes("node_modules")) return null;
      try {
        const result = await transformWithOxc(code, id, {
          lang: id.endsWith(".tsx") ? "tsx" : "jsx",
          jsx: { runtime: "automatic", importSource: "@askrjs/askr" },
          sourcemap: true,
        });
        if (!result?.code) return null;
        return {
          code: shouldOptimizeTemplates ? optimizeTemplateOutput(result.code) : result.code,
          map: result.map,
        };
      } catch {
        return null;
      }
    },
  } satisfies Plugin;
  return plugin;
}
