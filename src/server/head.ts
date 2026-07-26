import { parseFragment, serialize, type DefaultTreeAdapterMap } from "parse5";

const htmlNamespace = "http://www.w3.org/1999/xhtml";
const linkAttributes = new Set([
  "as",
  "crossorigin",
  "data-askr-head",
  "fetchpriority",
  "href",
  "hreflang",
  "imagesizes",
  "imagesrcset",
  "media",
  "referrerpolicy",
  "rel",
  "sizes",
  "type",
]);

function headMarkupError(message: string): never {
  throw new TypeError(`Invalid x-askr-head metadata: ${message}`);
}

function attributesOf(node: DefaultTreeAdapterMap["element"]): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const attribute of node.attrs) {
    if (attribute.namespace || attribute.prefix)
      headMarkupError("namespaced attributes are not allowed.");
    attributes.set(attribute.name.toLowerCase(), attribute.value);
  }
  return attributes;
}

function requireAllowedAttributes(
  attributes: Map<string, string>,
  allowed: ReadonlySet<string>,
): void {
  for (const name of attributes.keys()) {
    if (!allowed.has(name)) headMarkupError(`attribute ${name} is not allowed.`);
  }
  if (attributes.get("data-askr-head") !== "")
    headMarkupError("every metadata node must be Askr-owned.");
}

function isTextNode(
  node: DefaultTreeAdapterMap["childNode"],
): node is DefaultTreeAdapterMap["textNode"] {
  return "value" in node;
}

function textContent(node: DefaultTreeAdapterMap["element"]): string {
  let value = "";
  for (const child of node.childNodes) {
    if (!isTextNode(child)) headMarkupError(`${node.tagName} must contain only text.`);
    value += child.value;
  }
  return value;
}

function validateHeadElement(node: DefaultTreeAdapterMap["element"]): void {
  if (node.namespaceURI !== htmlNamespace) headMarkupError("foreign elements are not allowed.");
  const attributes = attributesOf(node);
  if (node.tagName === "title") {
    requireAllowedAttributes(attributes, new Set(["data-askr-head"]));
    textContent(node);
    return;
  }
  if (node.tagName === "meta") {
    requireAllowedAttributes(
      attributes,
      new Set(["content", "data-askr-head", "name", "property"]),
    );
    const hasName = attributes.has("name");
    const hasProperty = attributes.has("property");
    if (hasName === hasProperty || !attributes.has("content"))
      headMarkupError("meta requires content and exactly one of name or property.");
    if (node.childNodes.length) headMarkupError("meta cannot contain child nodes.");
    return;
  }
  if (node.tagName === "link") {
    requireAllowedAttributes(attributes, linkAttributes);
    if (!attributes.has("rel") || !attributes.has("href"))
      headMarkupError("link requires rel and href.");
    if (node.childNodes.length) headMarkupError("link cannot contain child nodes.");
    return;
  }
  if (node.tagName === "script") {
    requireAllowedAttributes(attributes, new Set(["data-askr-head", "type"]));
    if (attributes.get("type") !== "application/ld+json")
      headMarkupError("only application/ld+json script nodes are allowed.");
    const json = textContent(node);
    try {
      JSON.parse(json);
    } catch {
      headMarkupError("JSON-LD content must be valid JSON.");
    }
    return;
  }
  headMarkupError(`element ${node.tagName} is not allowed.`);
}

export function normalizeAskrHead(head: string): string {
  const fragment = parseFragment(head);
  for (const node of fragment.childNodes) {
    if (isTextNode(node)) {
      if (node.value.trim()) headMarkupError("top-level text is not allowed.");
      continue;
    }
    if (!("tagName" in node)) headMarkupError("non-element nodes are not allowed.");
    validateHeadElement(node);
  }
  return serialize(fragment);
}
