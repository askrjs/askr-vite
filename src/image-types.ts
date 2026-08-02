export type ImageOutputFormat = "avif" | "webp" | "source";
export type ImageFit = "inside" | "cover";

export interface ImageQualityOptions {
  avif?: number;
  webp?: number;
  jpeg?: number;
  png?: number;
}

export interface ImagePipelineOptions {
  widths?: readonly number[];
  formats?: readonly ImageOutputFormat[];
  quality?: ImageQualityOptions;
}

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

export interface ResponsiveImageSource {
  type: string;
  srcset: string;
}

export interface ResponsiveImage {
  readonly __askrImage: true;
  readonly src: string;
  readonly srcset?: string;
  readonly width: number;
  readonly height: number;
  readonly sources: readonly ResponsiveImageSource[];
}

export interface ImageProps {
  image: ResponsiveImage;
  alt: string;
  sizes?: string;
  [attribute: string]: unknown;
}

export interface NormalizedImageOptions {
  widths: number[];
  formats: ImageOutputFormat[];
  quality: Required<ImageQualityOptions>;
  fit: ImageFit;
  aspectRatio?: number;
  position: string;
}
