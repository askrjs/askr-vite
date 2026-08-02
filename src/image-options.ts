import type {
  ImageFit,
  ImageOptions,
  ImageOutputFormat,
  ImagePipelineOptions,
  NormalizedImageOptions,
} from "./image-types";

export const DEFAULT_IMAGE_WIDTHS = [320, 640, 960, 1280, 1920] as const;
export const DEFAULT_IMAGE_FORMATS = ["avif", "webp", "source"] as const;
export const DEFAULT_IMAGE_QUALITY = {
  avif: 50,
  webp: 75,
  jpeg: 82,
  png: 100,
} as const;

function widths(value: readonly number[] | undefined): number[] {
  const normalized = [...new Set(value ?? DEFAULT_IMAGE_WIDTHS)].sort(
    (left, right) => left - right,
  );
  if (
    normalized.length === 0 ||
    normalized.some((width) => !Number.isSafeInteger(width) || width < 1)
  ) {
    throw new Error("@askrjs/vite image widths must be positive integers.");
  }
  return normalized;
}

function formats(value: readonly ImageOutputFormat[] | undefined): ImageOutputFormat[] {
  const normalized = [...new Set(value ?? DEFAULT_IMAGE_FORMATS)];
  if (
    normalized.length === 0 ||
    normalized.some((format) => !DEFAULT_IMAGE_FORMATS.includes(format))
  ) {
    throw new Error("@askrjs/vite image formats must use avif, webp, or source.");
  }
  return normalized;
}

function ratio(value: ImageOptions["aspectRatio"]): number | undefined {
  if (value === undefined) return undefined;
  const resolved = typeof value === "number" ? value : value.width / value.height;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new Error("@askrjs/vite image aspectRatio must be a positive finite ratio.");
  }
  return resolved;
}

function imageFit(value: unknown): ImageFit {
  const resolved = value ?? "inside";
  if (resolved !== "inside" && resolved !== "cover") {
    throw new Error('@askrjs/vite image fit must be "inside" or "cover".');
  }
  return resolved;
}

function cropPosition(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("@askrjs/vite image position must be a non-empty string.");
  }
  return value.trim();
}

function quality(
  global: ImagePipelineOptions["quality"],
  local: ImageOptions["quality"],
): NormalizedImageOptions["quality"] {
  const normalized = { ...DEFAULT_IMAGE_QUALITY, ...global, ...local };
  for (const [format, value] of Object.entries(normalized)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
      throw new Error(
        `@askrjs/vite ${format} image quality must be an integer from 1 through 100.`,
      );
    }
  }
  return normalized;
}

export function normalizeImageOptions(
  global: ImagePipelineOptions = {},
  local: ImageOptions = {},
): NormalizedImageOptions {
  const fit = imageFit(local.fit);
  const aspectRatio = ratio(local.aspectRatio);
  if (fit === "cover" && aspectRatio === undefined) {
    throw new Error('@askrjs/vite image fit "cover" requires an aspectRatio.');
  }
  return {
    widths: widths(local.widths ?? global.widths),
    formats: formats(local.formats ?? global.formats),
    quality: quality(global.quality, local.quality),
    fit,
    ...(aspectRatio === undefined ? {} : { aspectRatio }),
    position: cropPosition(local.position) ?? "centre",
  };
}

export function normalizeDeclarationOptions(options: ImageOptions = {}): ImageOptions {
  return {
    ...(options.widths ? { widths: widths(options.widths) } : {}),
    ...(options.formats ? { formats: formats(options.formats) } : {}),
    ...(options.quality
      ? {
          quality: Object.fromEntries(
            Object.entries(options.quality).sort(([a], [b]) => a.localeCompare(b)),
          ),
        }
      : {}),
    ...(options.fit === undefined ? {} : { fit: imageFit(options.fit) }),
    ...(options.aspectRatio === undefined ? {} : { aspectRatio: ratio(options.aspectRatio) }),
    ...(options.position === undefined ? {} : { position: cropPosition(options.position) }),
  };
}
