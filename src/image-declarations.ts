import { imageDeclarationMask } from "./image-lexical";
import type { ImageOptions } from "./image-types";

export interface ImageDeclaration {
  start: number;
  end: number;
  source: string;
  options: ImageOptions;
}

const IMAGE_CALL = /\bimage\s*\(\s*new\s+URL\s*\(\s*(["'])([^"']+)\1\s*,\s*import\.meta\.url\s*\)/g;

function staticJson(source: string, id: string): string {
  let output = "";
  for (let index = 0; index < source.length;) {
    const character = source[index]!;
    if (/\s/.test(character) || "{}[]:".includes(character)) {
      output += character;
      index += 1;
      continue;
    }
    if (character === ",") {
      let next = index + 1;
      while (/\s/.test(source[next] ?? "")) next += 1;
      if (source[next] !== "}" && source[next] !== "]") output += character;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      let end = index + 1;
      while (end < source.length && source[end] !== character) {
        if (source[end] === "\\") {
          throw new Error(
            `@askrjs/vite image() option strings in ${id} cannot contain escape sequences.`,
          );
        }
        end += 1;
      }
      if (end >= source.length) {
        throw new Error(`@askrjs/vite found an unterminated image option in ${id}.`);
      }
      output += JSON.stringify(source.slice(index + 1, end));
      index = end + 1;
      continue;
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?/i.exec(source.slice(index));
    if (number) {
      output += number[0];
      index += number[0].length;
      continue;
    }
    const identifier = /^[A-Za-z_]\w*/.exec(source.slice(index));
    if (identifier) {
      let next = index + identifier[0].length;
      while (/\s/.test(source[next] ?? "")) next += 1;
      if (source[next] === ":") output += JSON.stringify(identifier[0]);
      else if (["true", "false", "null"].includes(identifier[0])) output += identifier[0];
      else {
        throw new Error(
          `@askrjs/vite image() options in ${id} must not reference ${identifier[0]}; use a static object literal.`,
        );
      }
      index += identifier[0].length;
      continue;
    }
    throw new Error(
      `@askrjs/vite image() options in ${id} must be a static object literal so builds and direct SSG imports agree.`,
    );
  }
  return output;
}

function staticOptions(source: string, id: string): ImageOptions {
  const trimmed = source.trim();
  if (!trimmed) return {};
  let value: unknown;
  try {
    value = JSON.parse(staticJson(trimmed, id));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("@askrjs/vite")) throw error;
    throw new Error(`@askrjs/vite could not parse image() options in ${id}.`, { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`@askrjs/vite image() options in ${id} must be an object literal.`);
  }
  return value as ImageOptions;
}

function findCallEnd(code: string, start: number): number {
  let depth = 1;
  let quote = "";
  let escaped = false;
  for (let index = start; index < code.length; index += 1) {
    const character = code[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

export function imageDeclarations(code: string, id: string): ImageDeclaration[] {
  const mask = imageDeclarationMask(code);
  if (!mask) return [];
  const output: ImageDeclaration[] = [];
  IMAGE_CALL.lastIndex = 0;
  for (let match = IMAGE_CALL.exec(code); match; match = IMAGE_CALL.exec(code)) {
    if (!mask[match.index]) continue;
    const afterUrl = IMAGE_CALL.lastIndex;
    const end = findCallEnd(code, afterUrl);
    if (end < 0) throw new Error(`@askrjs/vite found an unterminated image() call in ${id}.`);
    const remainder = code.slice(afterUrl, end).trim();
    if (remainder && !remainder.startsWith(",")) {
      throw new Error(`@askrjs/vite could not parse image() declaration in ${id}.`);
    }
    output.push({
      start: match.index,
      end: end + 1,
      source: match[2]!,
      options: staticOptions(remainder.replace(/^,/, ""), id),
    });
    IMAGE_CALL.lastIndex = end + 1;
  }
  return output;
}
