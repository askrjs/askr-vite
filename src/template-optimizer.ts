export function optimizeTemplateOutput(code: string): string {
  const hoists = new Map<string, string>();
  let hoistIndex = 0;
  const optimized = code.replace(
    /\b(class|className|style):\s*("([^"\\]|\\.)*")/g,
    (fullMatch: string, key: string, literal: string) => {
      const cacheKey = `${key}:${literal}`;
      let identifier = hoists.get(cacheKey);
      if (!identifier) {
        if (code.split(fullMatch).length - 1 < 2) return fullMatch;
        identifier = `__askrStaticLiteral${hoistIndex++}`;
        hoists.set(cacheKey, identifier);
      }
      return `${key}: ${identifier}`;
    },
  );
  if (hoists.size === 0) return code;
  const declarations = Array.from(hoists.entries()).map(([cacheKey, name]) => {
    const literal = cacheKey.slice(cacheKey.indexOf(":") + 1);
    return `const ${name} = ${literal};`;
  });
  return `${declarations.join("\n")}\n${optimized}`;
}
