import fs from "node:fs/promises";
import path from "node:path";
import type { ResolvedConfig } from "vite";
import { imageDeclarationMask } from "./image-lexical";
import {
  IMAGE_METADATA_PATH,
  IMAGE_METADATA_VERSION,
  type ImageMetadataEntry,
  type ImageMetadataRecord,
} from "./image-metadata";
import type { ImageOptions, ImagePipelineOptions, ResponsiveImage } from "./image-types";
import {
  declarationKey,
  defaultSharpLoader,
  processImage,
  type AssetPluginContext,
  type EmittedVariant,
  type ProcessedImage,
  type SharpLoader,
} from "./image-transform";

interface Declaration {
  start: number;
  end: number;
  source: string;
  options: ImageOptions;
}

const IMAGE_CALL = /\bimage\s*\(\s*new\s+URL\s*\(\s*(["'])([^"']+)\1\s*,\s*import\.meta\.url\s*\)/g;

function staticJson(source: string, id: string): string {
  let output = "";
  for (let index = 0; index < source.length;) {
    const character = source[index]!;
    if (/\s/.test(character) || "{}[]:".includes(character)) {
      output += character;
      index += 1;
      continue;
    }
    if (character === ",") {
      let next = index + 1;
      while (/\s/.test(source[next] ?? "")) next += 1;
      if (source[next] !== "}" && source[next] !== "]") output += character;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      let end = index + 1;
      while (end < source.length && source[end] !== character) {
        if (source[end] === "\\") {
          throw new Error(
            `@askrjs/vite image() option strings in ${id} cannot contain escape sequences.`,
          );
        }
        end += 1;
      }
      if (end >= source.length) {
        throw new Error(`@askrjs/vite found an unterminated image option in ${id}.`);
      }
      output += JSON.stringify(source.slice(index + 1, end));
      index = end + 1;
      continue;
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?/i.exec(source.slice(index));
    if (number) {
      output += number[0];
      index += number[0].length;
      continue;
    }
    const identifier = /^[A-Za-z_]\w*/.exec(source.slice(index));
    if (identifier) {
      let next = index + identifier[0].length;
      while (/\s/.test(source[next] ?? "")) next += 1;
      if (source[next] === ":") output += JSON.stringify(identifier[0]);
      else if (["true", "false", "null"].includes(identifier[0])) output += identifier[0];
      else {
        throw new Error(
          `@askrjs/vite image() options in ${id} must not reference ${identifier[0]}; use a static object literal.`,
        );
      }
      index += identifier[0].length;
      continue;
    }
    throw new Error(
      `@askrjs/vite image() options in ${id} must be a static object literal so builds and direct SSG imports agree.`,
    );
  }
  return output;
}

function staticOptions(source: string, id: string): ImageOptions {
  const trimmed = source.trim();
  if (!trimmed) return {};
  let value: unknown;
  try {
    value = JSON.parse(staticJson(trimmed, id));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("@askrjs/vite")) throw error;
    throw new Error(`@askrjs/vite could not parse image() options in ${id}.`, { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`@askrjs/vite image() options in ${id} must be an object literal.`);
  }
  return value as ImageOptions;
}

function findCallEnd(code: string, start: number): number {
  let depth = 1;
  let quote = "";
  let escaped = false;
  for (let index = start; index < code.length; index += 1) {
    const character = code[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function declarations(code: string, id: string): Declaration[] {
  const mask = imageDeclarationMask(code);
  if (!mask) return [];
  const output: Declaration[] = [];
  IMAGE_CALL.lastIndex = 0;
  for (let match = IMAGE_CALL.exec(code); match; match = IMAGE_CALL.exec(code)) {
    if (!mask[match.index]) continue;
    const afterUrl = IMAGE_CALL.lastIndex;
    const end = findCallEnd(code, afterUrl);
    if (end < 0) throw new Error(`@askrjs/vite found an unterminated image() call in ${id}.`);
    const remainder = code.slice(afterUrl, end).trim();
    if (remainder && !remainder.startsWith(",")) {
      throw new Error(`@askrjs/vite could not parse image() declaration in ${id}.`);
    }
    output.push({
      start: match.index,
      end: end + 1,
      source: match[2]!,
      options: staticOptions(remainder.replace(/^,/, ""), id),
    });
    IMAGE_CALL.lastIndex = end + 1;
  }
  return output;
}

function urlExpression(referenceId: string): string {
  return `import.meta.ROLLUP_FILE_URL_${referenceId}`;
}

function mime(format: EmittedVariant["format"]): string {
  return format === "jpeg" ? "image/jpeg" : `image/${format}`;
}

function srcsetExpression(variants: readonly EmittedVariant[]): string {
  return `[${variants.map((variant) => `${urlExpression(variant.referenceId)} + ${JSON.stringify(` ${variant.width}w`)}`).join(",")}].join(", ")`;
}

function imageExpression(processed: ProcessedImage): string {
  const fallbackVariants = processed.variants.filter(
    (variant) => variant.format === processed.fallback.format,
  );
  const modernFormats = ["avif", "webp"] as const;
  const sources = processed.passThrough
    ? []
    : modernFormats.flatMap((format) => {
        const variants = processed.variants.filter((variant) => variant.format === format);
        return variants.length === 0
          ? []
          : [`{type:${JSON.stringify(mime(format))},srcset:${srcsetExpression(variants)}}`];
      });
  return `image({__askrImage:true,src:${urlExpression(processed.fallback.referenceId)},${
    processed.passThrough ? "" : `srcset:${srcsetExpression(fallbackVariants)},`
  }width:${processed.fallback.width},height:${processed.fallback.height},sources:[${sources.join(",")}]})`;
}

function builtUrl(base: string, fileName: string): string {
  if (/^https?:\/\//.test(base))
    return new URL(fileName, base.endsWith("/") ? base : `${base}/`).href;
  if (base === "" || base === "./" || base === ".")
    return `${base === "." ? "./" : base}${fileName}`;
  return `${base.endsWith("/") ? base : `${base}/`}${fileName}`;
}

function responsiveMetadata(
  processed: ProcessedImage,
  fileName: (referenceId: string) => string,
  base: string,
): ResponsiveImage {
  const url = (variant: EmittedVariant) => builtUrl(base, fileName(variant.referenceId));
  const srcset = (variants: readonly EmittedVariant[]) =>
    variants.map((variant) => `${url(variant)} ${variant.width}w`).join(", ");
  const fallbackVariants = processed.variants.filter(
    (variant) => variant.format === processed.fallback.format,
  );
  return {
    __askrImage: true,
    src: url(processed.fallback),
    ...(processed.passThrough ? {} : { srcset: srcset(fallbackVariants) }),
    width: processed.fallback.width,
    height: processed.fallback.height,
    sources: processed.passThrough
      ? []
      : (["avif", "webp"] as const).flatMap((format) => {
          const variants = processed.variants.filter((variant) => variant.format === format);
          return variants.length === 0 ? [] : [{ type: mime(format), srcset: srcset(variants) }];
        }),
  };
}

export class ImagePipeline {
  readonly #options: ImagePipelineOptions;
  readonly #processed = new Map<string, ProcessedImage>();
  readonly #sharpLoader: SharpLoader;
  #config: ResolvedConfig | undefined;

  constructor(options: ImagePipelineOptions, sharpLoader: SharpLoader = defaultSharpLoader) {
    this.#options = options;
    this.#sharpLoader = sharpLoader;
  }

  configure(config: ResolvedConfig): void {
    this.#config = config;
  }

  async transform(
    context: AssetPluginContext,
    code: string,
    id: string,
  ): Promise<string | undefined> {
    const found = declarations(code, id);
    if (found.length === 0) return undefined;
    if (!this.#config) throw new Error("@askrjs/vite image pipeline was not configured.");
    if (this.#config.command !== "build") {
      throw new Error("@askrjs/vite responsive image declarations currently require a Vite build.");
    }
    const cacheDir = path.join(this.#config.root, "node_modules/.cache/@askrjs/vite/images");
    let transformed = code;
    for (const declaration of [...found].reverse()) {
      const sourcePath = path.resolve(path.dirname(id.split("?", 1)[0]!), declaration.source);
      const key = declarationKey(sourcePath, declaration.options);
      let processed = this.#processed.get(key);
      if (!processed) {
        processed = await processImage(
          context,
          sourcePath,
          declaration.options,
          this.#options,
          cacheDir,
          this.#sharpLoader,
        );
        this.#processed.set(key, processed);
      }
      transformed = `${transformed.slice(0, declaration.start)}${imageExpression(processed)}${transformed.slice(declaration.end)}`;
    }
    return transformed;
  }

  async writeMetadata(context: AssetPluginContext): Promise<void> {
    if (!this.#config || this.#processed.size === 0) return;
    const entries: Record<string, ImageMetadataEntry> = {};
    for (const processed of [...this.#processed.values()].sort((left, right) =>
      left.declarationKey.localeCompare(right.declarationKey),
    )) {
      entries[processed.declarationKey] = {
        sourcePath: processed.sourcePath,
        sourceHash: processed.sourceHash,
        declarationOptions: processed.declarationOptions,
        transformKey: processed.transformKey,
        encoder: processed.encoder,
        image: responsiveMetadata(
          processed,
          (referenceId) => context.getFileName(referenceId),
          this.#config.base,
        ),
      };
    }
    const record: ImageMetadataRecord = {
      version: IMAGE_METADATA_VERSION,
      entries,
    };
    const metadataPath = path.join(this.#config.root, IMAGE_METADATA_PATH);
    await fs.mkdir(path.dirname(metadataPath), { recursive: true });
    await fs.writeFile(metadataPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }
}
