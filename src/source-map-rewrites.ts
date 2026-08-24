export interface TextEdit {
  start: number;
  end: number;
  replacement: string;
  mapTo?: number;
}

export interface RawSourceMap {
  version: number;
  mappings: string;
  names?: string[];
  sources?: string[];
  sourcesContent?: Array<string | null>;
  file?: string;
  sourceRoot?: string;
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUES = new Map([...BASE64].map((character, index) => [character, index]));

function decodeVlq(value: string, cursor: { value: number }): number {
  let result = 0;
  let shift = 0;
  for (;;) {
    const digit = BASE64_VALUES.get(value[cursor.value++]);
    if (digit === undefined) throw new Error("Invalid sourcemap VLQ segment.");
    result += (digit & 31) << shift;
    if ((digit & 32) === 0) break;
    shift += 5;
  }
  const negative = (result & 1) === 1;
  result >>= 1;
  return negative ? -result : result;
}

function encodeVlq(value: number): string {
  let remaining = (Math.abs(value) << 1) | (value < 0 ? 1 : 0);
  let output = "";
  do {
    let digit = remaining & 31;
    remaining >>>= 5;
    if (remaining > 0) digit |= 32;
    output += BASE64[digit];
  } while (remaining > 0);
  return output;
}

function decodeMappings(value: string): number[][][] {
  const lines: number[][][] = [];
  let source = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let name = 0;
  for (const encodedLine of value.split(";")) {
    const segments: number[][] = [];
    let generatedColumn = 0;
    for (const encoded of encodedLine.split(",")) {
      if (!encoded) continue;
      const cursor = { value: 0 };
      generatedColumn += decodeVlq(encoded, cursor);
      const segment = [generatedColumn];
      if (cursor.value < encoded.length) {
        source += decodeVlq(encoded, cursor);
        originalLine += decodeVlq(encoded, cursor);
        originalColumn += decodeVlq(encoded, cursor);
        segment.push(source, originalLine, originalColumn);
        if (cursor.value < encoded.length) {
          name += decodeVlq(encoded, cursor);
          segment.push(name);
        }
      }
      segments.push(segment);
    }
    lines.push(segments);
  }
  return lines;
}

function encodeMappings(lines: number[][][]): string {
  let previousSource = 0;
  let previousOriginalLine = 0;
  let previousOriginalColumn = 0;
  let previousName = 0;
  return lines
    .map((segments) => {
      let previousGeneratedColumn = 0;
      return segments
        .map((segment) => {
          let encoded = encodeVlq(segment[0]! - previousGeneratedColumn);
          previousGeneratedColumn = segment[0]!;
          if (segment.length >= 4) {
            encoded += encodeVlq(segment[1]! - previousSource);
            encoded += encodeVlq(segment[2]! - previousOriginalLine);
            encoded += encodeVlq(segment[3]! - previousOriginalColumn);
            previousSource = segment[1]!;
            previousOriginalLine = segment[2]!;
            previousOriginalColumn = segment[3]!;
            if (segment.length === 5) {
              encoded += encodeVlq(segment[4]! - previousName);
              previousName = segment[4]!;
            }
          }
          return encoded;
        })
        .join(",");
    })
    .join(";");
}

function lineStarts(code: string): number[] {
  const starts = [0];
  for (let index = 0; index < code.length; index += 1) {
    if (code[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function offsetAt(starts: number[], line: number, column: number): number {
  return (starts[line] ?? starts[starts.length - 1]!) + column;
}

function positionAt(starts: number[], offset: number): [number, number] {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (starts[middle]! <= offset) low = middle;
    else high = middle;
  }
  return [low, offset - starts[low]!];
}

function forwardOffset(offset: number, edits: readonly TextEdit[]): number {
  let delta = 0;
  for (const edit of edits) {
    if (offset < edit.start) break;
    if (offset < edit.end) return edit.start + delta;
    delta += edit.replacement.length - (edit.end - edit.start);
  }
  return offset + delta;
}

function reverseOffset(offset: number, edits: readonly TextEdit[]): number {
  let delta = 0;
  for (const edit of edits) {
    const generatedStart = edit.start + delta;
    const generatedEnd = generatedStart + edit.replacement.length;
    if (offset < generatedStart) break;
    if (offset < generatedEnd) return edit.start;
    delta += edit.replacement.length - (edit.end - edit.start);
  }
  return offset - delta;
}

function normalize(lines: number[][][]): number[][][] {
  return lines.map((segments) => {
    const sorted = segments.sort((left, right) => left[0]! - right[0]!);
    return sorted.filter((segment, index) => index === 0 || segment[0] !== sorted[index - 1]![0]);
  });
}

function mappingAt(lines: number[][][], starts: number[], offset: number): number[] | undefined {
  const [line, column] = positionAt(starts, offset);
  let match: number[] | undefined;
  for (const segment of lines[line] ?? []) {
    if (segment[0]! > column) break;
    if (segment.length >= 4) match = segment;
  }
  return match;
}

/** Move generated coordinates after deterministic text edits. */
export function remapGenerated(
  map: RawSourceMap,
  before: string,
  after: string,
  edits: readonly TextEdit[],
): RawSourceMap {
  const beforeStarts = lineStarts(before);
  const afterStarts = lineStarts(after);
  const decoded = decodeMappings(map.mappings);
  const output: number[][][] = Array.from({ length: afterStarts.length }, () => []);
  for (const [line, segments] of decoded.entries()) {
    for (const segment of segments) {
      const offset = forwardOffset(offsetAt(beforeStarts, line, segment[0]!), edits);
      const [nextLine, nextColumn] = positionAt(afterStarts, offset);
      output[nextLine]!.push([nextColumn, ...segment.slice(1)]);
    }
  }
  let delta = 0;
  for (const edit of edits) {
    if (edit.mapTo !== undefined) {
      const mapped = mappingAt(decoded, beforeStarts, edit.mapTo);
      if (mapped) {
        const [line, column] = positionAt(afterStarts, edit.start + delta);
        output[line]!.push([column, ...mapped.slice(1)]);
      }
    }
    delta += edit.replacement.length - (edit.end - edit.start);
  }
  return { ...map, mappings: encodeMappings(normalize(output)) };
}

/** Move original coordinates back through deterministic text edits. */
export function remapOriginal(
  map: RawSourceMap,
  original: string,
  rewritten: string,
  edits: readonly TextEdit[],
): RawSourceMap {
  const originalStarts = lineStarts(original);
  const rewrittenStarts = lineStarts(rewritten);
  const lines = decodeMappings(map.mappings);
  for (const segments of lines) {
    for (const segment of segments) {
      if (segment.length < 4 || segment[1] !== 0) continue;
      const offset = reverseOffset(offsetAt(rewrittenStarts, segment[2]!, segment[3]!), edits);
      const [line, column] = positionAt(originalStarts, offset);
      segment[2] = line;
      segment[3] = column;
    }
  }
  return {
    ...map,
    mappings: encodeMappings(lines),
    sourcesContent: map.sources?.map((_source, index) =>
      index === 0 ? original : (map.sourcesContent?.[index] ?? null),
    ),
  };
}

/** Build a complete map for a rewritten source when no downstream map exists. */
export function sourceMapForRewrite(
  original: string,
  rewritten: string,
  edits: readonly TextEdit[],
  id: string,
): RawSourceMap {
  const originalStarts = lineStarts(original);
  const rewrittenStarts = lineStarts(rewritten);
  const lines: number[][][] = Array.from({ length: rewrittenStarts.length }, () => []);
  for (let offset = 0; offset < rewritten.length; offset += 1) {
    const [generatedLine, generatedColumn] = positionAt(rewrittenStarts, offset);
    const [originalLine, originalColumn] = positionAt(originalStarts, reverseOffset(offset, edits));
    lines[generatedLine]!.push([generatedColumn, 0, originalLine, originalColumn]);
  }
  return {
    version: 3,
    names: [],
    sources: [id],
    sourcesContent: [original],
    mappings: encodeMappings(lines),
  };
}

export function traceSourcePosition(
  map: RawSourceMap,
  line: number,
  column: number,
): { line: number; column: number } | undefined {
  const segments = decodeMappings(map.mappings)[line] ?? [];
  let match: number[] | undefined;
  for (const segment of segments) {
    if (segment[0]! > column) break;
    if (segment.length >= 4) match = segment;
  }
  return match ? { line: match[2]!, column: match[3]! } : undefined;
}
