import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeDeclarationOptions, normalizeImageOptions } from "./image-options";
import type { ImageOptions, ImageOutputFormat, ImagePipelineOptions } from "./image-types";

type SharpFactory = (typeof import("sharp"))["default"];
export type SharpLoader = () => Promise<SharpFactory>;

export interface EmittedVariant {
  referenceId: string;
  width: number;
  height: number;
  format: "avif" | "webp" | "jpeg" | "png";
  mime: string;
}

export interface AssetPluginContext {
  emitFile(file: { type: "asset"; name: string; source: string | Uint8Array }): string;
  getFileName(referenceId: string): string;
}

export interface ProcessedImage {
  declarationKey: string;
  sourcePath: string;
  sourceHash: string;
  declarationOptions: ImageOptions;
  transformKey: string;
  encoder: string;
  fallback: EmittedVariant;
  variants: EmittedVariant[];
  passThrough: boolean;
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function declarationKey(sourcePath: string, options: ImageOptions): string {
  return hash(`${sourcePath}\0${JSON.stringify(normalizeDeclarationOptions(options))}`);
}

export const defaultSharpLoader: SharpLoader = async () => (await import("sharp")).default;

async function loadSharp(loader: SharpLoader): Promise<SharpFactory> {
  try {
    return await loader();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") {
      throw new Error(
        '@askrjs/vite responsive images require the optional peer "sharp". Install sharp@^0.35.3 and rebuild.',
        { cause: error },
      );
    }
    throw error;
  }
}

function sourceFormat(format: string | undefined): "jpeg" | "png" | undefined {
  if (format === "jpeg" || format === "jpg") return "jpeg";
  return format === "png" ? "png" : undefined;
}

function extension(format: EmittedVariant["format"]): string {
  return format === "jpeg" ? "jpg" : format;
}

function mime(format: EmittedVariant["format"]): string {
  return format === "jpeg" ? "image/jpeg" : `image/${format}`;
}

function outputName(sourcePath: string, width: number, format: EmittedVariant["format"]): string {
  const basename = path.basename(sourcePath, path.extname(sourcePath));
  return `${basename}-${width}.${extension(format)}`;
}

function outputHeight(
  width: number,
  sourceWidth: number,
  sourceHeight: number,
  aspectRatio: number | undefined,
): number {
  return Math.max(1, Math.round(width / (aspectRatio ?? sourceWidth / sourceHeight)));
}

async function encodedVariant(
  sharp: SharpFactory,
  source: Buffer,
  cacheDir: string,
  transformKey: string,
  width: number,
  height: number,
  format: EmittedVariant["format"],
  options: ReturnType<typeof normalizeImageOptions>,
): Promise<Buffer> {
  const cachePath = path.join(cacheDir, `${transformKey}-${width}.${extension(format)}`);
  const cached = await fs.readFile(cachePath).catch(() => undefined);
  if (cached) return cached;

  let pipeline = sharp(source, { animated: false });
  pipeline =
    options.fit === "cover"
      ? pipeline.resize({ width, height, fit: "cover", position: options.position })
      : pipeline.resize({ width, fit: "inside", withoutEnlargement: true });
  if (format === "avif") pipeline = pipeline.avif({ quality: options.quality.avif });
  else if (format === "webp") pipeline = pipeline.webp({ quality: options.quality.webp });
  else if (format === "jpeg") pipeline = pipeline.jpeg({ quality: options.quality.jpeg });
  else {
    pipeline = pipeline.png(
      options.quality.png === 100
        ? { compressionLevel: 9 }
        : { compressionLevel: 9, quality: options.quality.png },
    );
  }
  const encoded = await pipeline.toBuffer();
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(cachePath, encoded);
  return encoded;
}

function variantFormats(
  formats: readonly ImageOutputFormat[],
  fallback: "jpeg" | "png",
): Array<"avif" | "webp" | "jpeg" | "png"> {
  const output: Array<"avif" | "webp" | "jpeg" | "png"> = [];
  for (const format of formats) {
    const resolved = format === "source" ? fallback : format;
    if (!output.includes(resolved)) output.push(resolved);
  }
  if (!output.includes(fallback)) output.push(fallback);
  return output;
}

function passThroughImage(
  context: AssetPluginContext,
  sourcePath: string,
  source: Buffer,
  width: number,
  height: number,
  format: "jpeg" | "png",
): { fallback: EmittedVariant; variants: EmittedVariant[] } {
  const referenceId = context.emitFile({ type: "asset", name: path.basename(sourcePath), source });
  const fallback = { referenceId, width, height, format, mime: mime(format) };
  return { fallback, variants: [fallback] };
}

export async function processImage(
  context: AssetPluginContext,
  sourcePath: string,
  declarationOptions: ImageOptions,
  globalOptions: ImagePipelineOptions,
  cacheDir: string,
  sharpLoader: SharpLoader,
): Promise<ProcessedImage> {
  const source = await fs.readFile(sourcePath);
  const sourceHash = hash(source);
  const sharp = await loadSharp(sharpLoader);
  const metadata = await sharp(source, { animated: true }).metadata();
  const sourceWidth = metadata.autoOrient.width ?? metadata.width;
  const sourceHeight =
    (metadata.pages ?? 1) > 1
      ? (metadata.pageHeight ?? metadata.height)
      : (metadata.autoOrient.height ?? metadata.height);
  if (!sourceWidth || !sourceHeight) {
    throw new Error(`@askrjs/vite could not determine intrinsic dimensions for ${sourcePath}.`);
  }
  const normalized = normalizeImageOptions(globalOptions, declarationOptions);
  const encoder = `sharp@${sharp.versions.sharp}`;
  const transformKey = hash(`${sourceHash}\0${JSON.stringify(normalized)}\0${encoder}`);
  const fallbackFormat = sourceFormat(metadata.format);
  const key = declarationKey(sourcePath, declarationOptions);

  const shouldPassThrough =
    path.extname(sourcePath).toLowerCase() === ".svg" ||
    (metadata.pages ?? 1) > 1 ||
    !fallbackFormat ||
    (normalized.fit === "inside" && sourceWidth <= normalized.widths[0]!);
  if (shouldPassThrough) {
    const format = fallbackFormat ?? "png";
    return {
      declarationKey: key,
      sourcePath,
      sourceHash,
      declarationOptions: normalizeDeclarationOptions(declarationOptions),
      transformKey,
      encoder,
      ...passThroughImage(context, sourcePath, source, sourceWidth, sourceHeight, format),
      passThrough: true,
    };
  }

  const widths = normalized.widths.filter((width) => width <= sourceWidth);
  if (!widths.includes(sourceWidth)) widths.push(sourceWidth);
  widths.sort((left, right) => left - right);
  const variants: EmittedVariant[] = [];
  for (const format of variantFormats(normalized.formats, fallbackFormat)) {
    for (const width of widths) {
      const height = outputHeight(
        width,
        sourceWidth,
        sourceHeight,
        normalized.fit === "cover" ? normalized.aspectRatio : undefined,
      );
      const buffer = await encodedVariant(
        sharp,
        source,
        cacheDir,
        transformKey,
        width,
        height,
        format,
        normalized,
      );
      variants.push({
        referenceId: context.emitFile({
          type: "asset",
          name: outputName(sourcePath, width, format),
          source: buffer,
        }),
        width,
        height,
        format,
        mime: mime(format),
      });
    }
  }
  return {
    declarationKey: key,
    sourcePath,
    sourceHash,
    declarationOptions: normalizeDeclarationOptions(declarationOptions),
    transformKey,
    encoder,
    fallback: variants.filter((variant) => variant.format === fallbackFormat).at(-1)!,
    variants,
    passThrough: false,
  };
}
