import { jsx as createElement, jsxs as createElements } from "@askrjs/askr/jsx-runtime";
import type { ImageOptions, ImageProps, ResponsiveImage } from "./image-types";

function isResponsiveImage(value: unknown): value is ResponsiveImage {
  return Boolean(
    value && typeof value === "object" && (value as Partial<ResponsiveImage>).__askrImage === true,
  );
}

/** Declare a source-controlled image for the opt-in Vite image pipeline. */
export function image(source: URL, options?: ImageOptions): ResponsiveImage;
/** @internal Build-time replacement signature. */
export function image(source: ResponsiveImage): ResponsiveImage;
export function image(source: URL | ResponsiveImage, _options: ImageOptions = {}): ResponsiveImage {
  if (isResponsiveImage(source)) return Object.freeze(source);
  throw new Error(
    "@askrjs/vite image metadata is unavailable. Enable askr({ images: true }) and run this module through Vite before browser execution.",
  );
}

/** Render responsive metadata as accessible picture/source/img markup. */
export function Image(props: ImageProps): ReturnType<typeof createElements> {
  const { image: declaration, alt, sizes, ...attributes } = props;
  return createElements("picture", {
    children: [
      ...declaration.sources.map((source) =>
        createElement("source", {
          type: source.type,
          srcset: source.srcset,
          ...(sizes ? { sizes } : {}),
        }),
      ),
      createElement("img", {
        ...attributes,
        src: declaration.src,
        ...(declaration.srcset ? { srcset: declaration.srcset } : {}),
        ...(sizes ? { sizes } : {}),
        width: declaration.width,
        height: declaration.height,
        alt,
      }),
    ],
  });
}

export type {
  ImageFit,
  ImageOptions,
  ImageOutputFormat,
  ImagePipelineOptions,
  ImageProps,
  ImageQualityOptions,
  ResponsiveImage,
  ResponsiveImageSource,
} from "./image-types";
