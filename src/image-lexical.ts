const IMAGE_IMPORT = /from\s+["']@askrjs\/vite\/image["']/g;

function lexicalCodeMask(source: string): Uint8Array {
  const mask = new Uint8Array(source.length);
  let state: "code" | "single" | "double" | "template" | "line-comment" | "block-comment" = "code";
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    const next = source[index + 1];
    if (state === "code") {
      if (character === "/" && next === "/") {
        state = "line-comment";
        index += 1;
      } else if (character === "/" && next === "*") {
        state = "block-comment";
        index += 1;
      } else if (character === "'") state = "single";
      else if (character === '"') state = "double";
      else if (character === "`") state = "template";
      else mask[index] = 1;
      continue;
    }
    if (state === "line-comment") {
      if (character === "\n" || character === "\r") {
        state = "code";
        mask[index] = 1;
      }
      continue;
    }
    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        state = "code";
        index += 1;
      }
      continue;
    }
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
    else if (
      (state === "single" && character === "'") ||
      (state === "double" && character === '"') ||
      (state === "template" && character === "`")
    ) {
      state = "code";
    }
  }
  return mask;
}

export function imageDeclarationMask(code: string): Uint8Array | undefined {
  const mask = lexicalCodeMask(code);
  IMAGE_IMPORT.lastIndex = 0;
  for (let match = IMAGE_IMPORT.exec(code); match; match = IMAGE_IMPORT.exec(code)) {
    if (mask[match.index]) return mask;
  }
  return undefined;
}
