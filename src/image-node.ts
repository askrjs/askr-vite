import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Image } from "./image";
import {
  IMAGE_METADATA_PATH,
  IMAGE_METADATA_VERSION,
  type ImageMetadataEntry,
  type ImageMetadataRecord,
} from "./image-metadata";
import { normalizeDeclarationOptions } from "./image-options";
import type { ImageOptions, ResponsiveImage } from "./image-types";

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function declarationKey(sourcePath: string, options: ImageOptions): string {
  return hash(`${sourcePath}\0${JSON.stringify(normalizeDeclarationOptions(options))}`);
}

function metadataCandidates(sourcePath: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const start of [path.dirname(sourcePath), process.cwd()]) {
    let directory = path.resolve(start);
    while (!seen.has(directory)) {
      seen.add(directory);
      candidates.push(path.join(directory, IMAGE_METADATA_PATH));
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  return candidates;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isCheckedImage(value: unknown): value is ResponsiveImage {
  return (
    isRecord(value) &&
    value.__askrImage === true &&
    isNonemptyString(value.src) &&
    typeof value.width === "number" &&
    Number.isFinite(value.width) &&
    value.width > 0 &&
    typeof value.height === "number" &&
    Number.isFinite(value.height) &&
    value.height > 0 &&
    (value.srcset === undefined || isNonemptyString(value.srcset)) &&
    Array.isArray(value.sources) &&
    value.sources.every(
      (source) =>
        isRecord(source) && isNonemptyString(source.type) && isNonemptyString(source.srcset),
    )
  );
}

function isCheckedEntry(value: unknown): value is ImageMetadataEntry {
  return (
    isRecord(value) &&
    isNonemptyString(value.sourcePath) &&
    typeof value.sourceHash === "string" &&
    /^[a-f0-9]{64}$/.test(value.sourceHash) &&
    typeof value.transformKey === "string" &&
    /^[a-f0-9]{64}$/.test(value.transformKey) &&
    isNonemptyString(value.encoder) &&
    isRecord(value.declarationOptions) &&
    isCheckedImage(value.image)
  );
}

function readMetadata(sourcePath: string): ImageMetadataRecord {
  const metadataPath = metadataCandidates(sourcePath).find(existsSync);
  if (!metadataPath) {
    throw new Error(
      "@askrjs/vite image metadata is missing. Run the Vite client build with askr({ images: true }) before direct Node SSR/SSG imports.",
    );
  }
  let record: unknown;
  try {
    record = JSON.parse(readFileSync(metadataPath, "utf8"));
  } catch (error) {
    throw new Error(
      `@askrjs/vite could not read checked image metadata at ${metadataPath}. Re-run the Vite client build.`,
      {
        cause: error,
      },
    );
  }
  if (
    !isRecord(record) ||
    record.version !== IMAGE_METADATA_VERSION ||
    !isRecord(record.entries) ||
    !Object.entries(record.entries).every(
      ([key, entry]) => /^[a-f0-9]{64}$/.test(key) && isCheckedEntry(entry),
    )
  ) {
    throw new Error(
      `@askrjs/vite image metadata at ${metadataPath} is incompatible. Re-run the Vite client build.`,
    );
  }
  return record as unknown as ImageMetadataRecord;
}

function isResponsiveImage(value: unknown): value is ResponsiveImage {
  return Boolean(
    value && typeof value === "object" && (value as Partial<ResponsiveImage>).__askrImage === true,
  );
}

/** Resolve the exact responsive metadata produced by the preceding client build. */
export function image(source: URL, options?: ImageOptions): ResponsiveImage;
/** Accept Vite's transformed declaration during direct Node module evaluation. */
export function image(source: ResponsiveImage): ResponsiveImage;
export function image(source: URL | ResponsiveImage, options: ImageOptions = {}): ResponsiveImage {
  if (isResponsiveImage(source)) return Object.freeze(source);
  if (!(source instanceof URL) || source.protocol !== "file:") {
    throw new TypeError("@askrjs/vite image() requires a file URL created with import.meta.url.");
  }
  const sourcePath = path.resolve(fileURLToPath(source));
  const record = readMetadata(sourcePath);
  const entry = record.entries[declarationKey(sourcePath, options)];
  if (!entry) {
    throw new Error(
      `@askrjs/vite has no built image declaration for ${sourcePath}. Re-run the Vite client build after changing image() options.`,
    );
  }
  const sourceHash = hash(readFileSync(sourcePath));
  if (entry.sourcePath !== sourcePath || entry.sourceHash !== sourceHash) {
    throw new Error(
      `@askrjs/vite image metadata for ${sourcePath} is stale. Re-run the Vite client build before SSR/SSG.`,
    );
  }
  return Object.freeze(entry.image);
}

export { Image };
export type {
  ImageFit,
  ImageOptions,
  ImageOutputFormat,
  ImageProps,
  ImageQualityOptions,
  ResponsiveImage,
  ResponsiveImageSource,
} from "./image-types";
