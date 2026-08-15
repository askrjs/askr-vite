import { parseSync, Visitor, type ObjectProperty } from "oxc-parser";

const OPTIMIZED_PROPS = new Set(["class", "className", "style"]);
const JSX_RUNTIME_SOURCE = "@askrjs/askr/jsx-runtime";
const JSX_FACTORIES = new Set(["jsx", "jsxs", "jsxDEV"]);

type Candidate = {
  literal: string;
  start: number;
  end: number;
};

function importedName(specifier: { imported: { type: string; name?: string; value?: unknown } }) {
  return specifier.imported.type === "Identifier"
    ? specifier.imported.name
    : specifier.imported.value;
}

function collectRuntimeFactories(program: ReturnType<typeof parseSync>["program"]): Set<string> {
  const factories = new Set<string>();

  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration" || statement.source.value !== JSX_RUNTIME_SOURCE) {
      continue;
    }

    for (const specifier of statement.specifiers) {
      if (
        specifier.type === "ImportSpecifier" &&
        JSX_FACTORIES.has(String(importedName(specifier)))
      ) {
        factories.add(specifier.local.name);
      }
    }
  }

  return factories;
}

function collectCandidate(
  property: ObjectProperty,
  code: string,
  candidates: Map<string, Candidate[]>,
) {
  if (
    property.kind !== "init" ||
    property.computed ||
    property.method ||
    property.key.type !== "Identifier" ||
    !OPTIMIZED_PROPS.has(property.key.name) ||
    property.value.type !== "Literal" ||
    typeof property.value.value !== "string"
  ) {
    return;
  }

  const literal = code.slice(property.value.start, property.value.end);
  const cacheKey = `${property.key.name}:${literal}`;
  const group = candidates.get(cacheKey) ?? [];
  group.push({
    literal,
    start: property.value.start,
    end: property.value.end,
  });
  candidates.set(cacheKey, group);
}

export function optimizeTemplateOutput(code: string): string {
  const parsed = parseSync("askr-compiled.js", code, {
    lang: "js",
    sourceType: "module",
  });
  if (parsed.errors.length > 0) return code;

  const runtimeFactories = collectRuntimeFactories(parsed.program);
  if (runtimeFactories.size === 0) return code;

  const candidates = new Map<string, Candidate[]>();
  const identifiers = new Set<string>();
  new Visitor({
    Identifier(identifier) {
      identifiers.add(identifier.name);
    },
    CallExpression(call) {
      if (
        call.callee.type !== "Identifier" ||
        !runtimeFactories.has(call.callee.name) ||
        call.arguments[1]?.type !== "ObjectExpression"
      ) {
        return;
      }

      for (const property of call.arguments[1].properties) {
        if (property.type === "Property") {
          collectCandidate(property, code, candidates);
        }
      }
    },
  }).visit(parsed.program);

  const declarations: string[] = [];
  const replacements: Array<{ start: number; end: number; identifier: string }> = [];
  let hoistIndex = 0;
  for (const group of candidates.values()) {
    if (group.length < 2) continue;

    let identifier: string;
    do {
      identifier = `__askrStaticLiteral${hoistIndex++}`;
    } while (identifiers.has(identifier));
    identifiers.add(identifier);
    declarations.push(`const ${identifier} = ${group[0].literal};`);
    for (const candidate of group) {
      replacements.push({ start: candidate.start, end: candidate.end, identifier });
    }
  }

  if (declarations.length === 0) return code;

  let optimized = code;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    optimized =
      optimized.slice(0, replacement.start) +
      replacement.identifier +
      optimized.slice(replacement.end);
  }
  return `${declarations.join("\n")}\n${optimized}`;
}
