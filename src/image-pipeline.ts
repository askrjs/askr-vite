import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ResolvedConfig } from "vite";
import { imageDeclarations } from "./image-declarations";
import {
  IMAGE_METADATA_PATH,
  IMAGE_METADATA_VERSION,
  type ImageMetadataEntry,
  type ImageMetadataRecord,
} from "./image-metadata";
import type { ImagePipelineOptions, ResponsiveImage } from "./image-types";
import type { TextEdit } from "./source-map-rewrites";
import {
  declarationKey,
  defaultSharpLoader,
  processImage,
  type AssetPluginContext,
  type EmittedVariant,
  type ProcessedImage,
  type SharpLoader,
} from "./image-transform";

export interface ImagePipelineTransform {
  code: string;
  edits: TextEdit[];
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
    return (await this.transformWithEdits(context, code, id))?.code;
  }

  async transformWithEdits(
    context: AssetPluginContext,
    code: string,
    id: string,
  ): Promise<ImagePipelineTransform | undefined> {
    const found = imageDeclarations(code, id);
    if (found.length === 0) return undefined;
    if (!this.#config) throw new Error("@askrjs/vite image pipeline was not configured.");
    if (this.#config.command !== "build") {
      throw new Error("@askrjs/vite responsive image declarations currently require a Vite build.");
    }
    const cacheDir = path.join(this.#config.root, "node_modules/.cache/@askrjs/vite/images");
    let transformed = code;
    const edits: TextEdit[] = [];
    for (const declaration of [...found].reverse()) {
      const sourcePath = path.resolve(path.dirname(id.split("?", 1)[0]!), declaration.source);
      const key = declarationKey(sourcePath, declaration.options);
      let processed = this.#processed.get(key);
      if (processed) {
        const sourceHash = createHash("sha256")
          .update(await fs.readFile(sourcePath))
          .digest("hex");
        if (sourceHash !== processed.sourceHash) processed = undefined;
      }
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
      const replacement = imageExpression(processed);
      edits.push({ start: declaration.start, end: declaration.end, replacement });
      transformed = `${transformed.slice(0, declaration.start)}${replacement}${transformed.slice(declaration.end)}`;
    }
    return { code: transformed, edits: edits.sort((left, right) => left.start - right.start) };
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
