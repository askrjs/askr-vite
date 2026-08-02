import type { ImageOptions, ResponsiveImage } from "./image-types";

export const IMAGE_METADATA_VERSION = 2;
export const IMAGE_METADATA_PATH = "node_modules/.cache/@askrjs/vite/images/metadata.json";

export interface ImageMetadataEntry {
  sourcePath: string;
  sourceHash: string;
  declarationOptions: ImageOptions;
  transformKey: string;
  encoder: string;
  image: ResponsiveImage;
}

export interface ImageMetadataRecord {
  version: typeof IMAGE_METADATA_VERSION;
  entries: Record<string, ImageMetadataEntry>;
}
