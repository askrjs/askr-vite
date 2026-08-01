export type AssetFormat = "avif" | "webp" | "jpeg" | "png" | "gif" | "svg";

export interface SourceInspection {
  width: number;
  height: number;
  format: AssetFormat;
  transformable: boolean;
  animated: boolean;
}

function positiveDimensions(
  width: number,
  height: number,
  format: AssetFormat,
  transformable: boolean,
  animated = false,
): SourceInspection | undefined {
  return width > 0 && height > 0 ? { width, height, format, transformable, animated } : undefined;
}

function inspectPng(source: Buffer): SourceInspection | undefined {
  if (
    source.length < 24 ||
    !source.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return undefined;
  }
  return positiveDimensions(
    source.readUInt32BE(16),
    source.readUInt32BE(20),
    "png",
    true,
    source.includes(Buffer.from("acTL")),
  );
}

function inspectGif(source: Buffer): SourceInspection | undefined {
  if (source.length < 10 || !/^GIF8[79]a$/.test(source.subarray(0, 6).toString("ascii"))) {
    return undefined;
  }
  return positiveDimensions(source.readUInt16LE(6), source.readUInt16LE(8), "gif", false, true);
}

function inspectJpeg(source: Buffer): SourceInspection | undefined {
  if (source.length < 4 || source[0] !== 0xff || source[1] !== 0xd8) return undefined;
  const startOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 8 < source.length) {
    if (source[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (source[offset] === 0xff) offset += 1;
    const marker = source[offset++]!;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) continue;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > source.length) break;
    const length = source.readUInt16BE(offset);
    if (length < 2 || offset + length > source.length) break;
    if (startOfFrame.has(marker) && length >= 7) {
      return positiveDimensions(
        source.readUInt16BE(offset + 5),
        source.readUInt16BE(offset + 3),
        "jpeg",
        true,
      );
    }
    offset += length;
  }
  return undefined;
}

function inspectSvg(source: Buffer): SourceInspection | undefined {
  const openingTag = source
    .subarray(0, 16_384)
    .toString("utf8")
    .match(/<svg\b[^>]*>/i)?.[0];
  if (!openingTag) return undefined;
  const numberAttribute = (name: string): number | undefined => {
    const value = openingTag.match(new RegExp(`\\b${name}\\s*=\\s*["']\\s*([0-9.]+)`, "i"))?.[1];
    const parsed = value ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };
  let width = numberAttribute("width");
  let height = numberAttribute("height");
  const viewBox = openingTag
    .match(/\bviewBox\s*=\s*["']\s*[-+0-9.e]+[ ,]+[-+0-9.e]+[ ,]+([-+0-9.e]+)[ ,]+([-+0-9.e]+)/i)
    ?.slice(1)
    .map(Number);
  if (!width && viewBox?.[0] && viewBox[0] > 0) width = viewBox[0];
  if (!height && viewBox?.[1] && viewBox[1] > 0) height = viewBox[1];
  if (!width && height && viewBox?.[0] && viewBox?.[1]) width = height * (viewBox[0] / viewBox[1]);
  if (!height && width && viewBox?.[0] && viewBox?.[1]) height = width / (viewBox[0] / viewBox[1]);
  return width && height ? positiveDimensions(width, height, "svg", false) : undefined;
}

function inspectWebp(source: Buffer): SourceInspection | undefined {
  if (
    source.length < 30 ||
    source.subarray(0, 4).toString("ascii") !== "RIFF" ||
    source.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {
    return undefined;
  }
  const chunk = source.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X") {
    const width = 1 + source.readUIntLE(24, 3);
    const height = 1 + source.readUIntLE(27, 3);
    return positiveDimensions(width, height, "webp", false, Boolean(source[20]! & 0x02));
  }
  if (chunk === "VP8 ") {
    return positiveDimensions(
      source.readUInt16LE(26) & 0x3fff,
      source.readUInt16LE(28) & 0x3fff,
      "webp",
      false,
    );
  }
  if (chunk === "VP8L" && source[20] === 0x2f) {
    const bits = source.readUInt32LE(21);
    return positiveDimensions(1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff), "webp", false);
  }
  return undefined;
}

function inspectAvif(source: Buffer): SourceInspection | undefined {
  if (source.length < 24 || source.subarray(4, 8).toString("ascii") !== "ftyp") return undefined;
  const typeOffset = source.indexOf(Buffer.from("ispe"));
  if (typeOffset < 0 || typeOffset + 16 > source.length) return undefined;
  return positiveDimensions(
    source.readUInt32BE(typeOffset + 8),
    source.readUInt32BE(typeOffset + 12),
    "avif",
    false,
  );
}

export function inspectSource(sourcePath: string, source: Buffer): SourceInspection {
  const inspection =
    inspectPng(source) ??
    inspectGif(source) ??
    inspectJpeg(source) ??
    inspectSvg(source) ??
    inspectWebp(source) ??
    inspectAvif(source);
  if (!inspection) {
    throw new Error(
      `@askrjs/vite could not determine intrinsic dimensions for pass-through image ${sourcePath}.`,
    );
  }
  return inspection;
}
