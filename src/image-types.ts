/** Output image formats the pipeline can emit; `"source"` keeps the original format. */
export type ImageOutputFormat = "avif" | "webp" | "source";
/** Resize strategy: `"inside"` fits within bounds, `"cover"` crops to fill. */
export type ImageFit = "inside" | "cover";

/** Per-format quality settings (0-100) used when encoding output images. */
export interface ImageQualityOptions {
  avif?: number;
  webp?: number;
  jpeg?: number;
  png?: number;
}

/** Plugin-level defaults applied to every `image()` declaration. */
export interface ImagePipelineOptions {
  widths?: readonly number[];
  formats?: readonly ImageOutputFormat[];
  quality?: ImageQualityOptions;
}

/** Per-declaration overrides for a single `image()` call. */
export interface ImageOptions {
  widths?: readonly number[];
  formats?: readonly ImageOutputFormat[];
  quality?: ImageQualityOptions;
  fit?: ImageFit;
  /** Required output width/height ratio when fit is cover. */
  aspectRatio?: number | { width: number; height: number };
  /** Sharp-compatible crop position. Defaults to centre. */
  position?: string;
}

/** A single `<source>` candidate within a {@link ResponsiveImage}. */
export interface ResponsiveImageSource {
  type: string;
  srcset: string;
}

/** Build-time-resolved metadata for a declared image, ready to render. */
export interface ResponsiveImage {
  readonly __askrImage: true;
  readonly src: string;
  readonly srcset?: string;
  readonly width: number;
  readonly height: number;
  readonly sources: readonly ResponsiveImageSource[];
}

/** Props accepted by the {@link Image} component. */
export interface ImageProps {
  image: ResponsiveImage;
  alt: string;
  sizes?: string;
  [attribute: string]: unknown;
}

/** Fully-resolved image options with all defaults applied. */
export interface NormalizedImageOptions {
  widths: number[];
  formats: ImageOutputFormat[];
  quality: Required<ImageQualityOptions>;
  fit: ImageFit;
  aspectRatio?: number;
  position: string;
}
