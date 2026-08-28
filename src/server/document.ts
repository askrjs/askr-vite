import type { ServerApp } from "@askrjs/server";
import { normalizeAskrHead } from "./head";

interface ViteTelemetryFields {
  status?: number;
}

interface ViteTelemetry {
  viteDocument?<T>(fields: ViteTelemetryFields, work: () => T): T;
}

/** Options for composing a rendered Askr fragment into the HTML document. */
export interface AskrDocumentOptions {
  telemetry?: ViteTelemetry;
}

/** Placeholder marker in `index.html` replaced with the rendered app fragment. */
export const ASKR_APP_MARKER = "<!--askr-app-->";
/** Placeholder marker in `index.html` replaced with rendered `<head>` content. */
export const ASKR_HEAD_MARKER = "<!--askr-head-->";

function markerCount(document: string): number {
  return document.split(ASKR_APP_MARKER).length - 1;
}

function headMarkerCount(document: string): number {
  return document.split(ASKR_HEAD_MARKER).length - 1;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function patchHtmlAttribute(document: string, name: "lang" | "dir", value: string): string {
  return document.replace(/<html\b([^>]*)>/i, (_match, attributes: string) => {
    const matcher = new RegExp(
      `\\s+${name}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'=<>\u0060]+))?`,
      "gi",
    );
    const withoutExisting = attributes.replace(matcher, "");
    return `<html${withoutExisting} ${name}="${escapeAttribute(value)}">`;
  });
}

/**
 * Replace the single {@link ASKR_APP_MARKER} in `document` with `fragment`.
 *
 * @throws If `document` does not contain exactly one app marker.
 */
export function insertAskrFragment(document: string, fragment: string): string {
  const count = markerCount(document);
  if (count !== 1) {
    throw new Error(
      `index.html must contain exactly one ${ASKR_APP_MARKER} marker; found ${count}.`,
    );
  }
  return document.replace(ASKR_APP_MARKER, fragment);
}

/**
 * Replace the {@link ASKR_HEAD_MARKER} in `document` with normalized `head`
 * markup, and patch the `<html>` tag's `lang`/`dir` attributes when given.
 */
export function composeAskrHead(
  document: string,
  head: string,
  lang?: string,
  dir?: string,
): string {
  let output = document.replace(ASKR_HEAD_MARKER, normalizeAskrHead(head));
  if (lang) output = patchHtmlAttribute(output, "lang", lang);
  if (dir) output = patchHtmlAttribute(output, "dir", dir);
  return output;
}

/** Whether `response` carries the `askr-fragment=1` content-type marker. */
export function isAskrFragment(response: Response): boolean {
  return (
    response.headers
      .get("content-type")
      ?.split(";")
      .some((part) => part.trim().toLowerCase() === "askr-fragment=1") ?? false
  );
}

function documentHeaders(response: Response): Headers {
  const headers = new Headers(response.headers);
  const type = response.headers
    .get("content-type")
    ?.split(";")
    .map((part) => part.trim())
    .filter((part) => part.toLowerCase() !== "askr-fragment=1")
    .join("; ");
  if (type) headers.set("content-type", type);
  for (const name of [
    "accept-ranges",
    "content-digest",
    "content-encoding",
    "content-length",
    "content-md5",
    "content-range",
    "digest",
    "etag",
    "last-modified",
    "repr-digest",
    "trailer",
  ]) {
    headers.delete(name);
  }
  const internalHeaders: string[] = [];
  headers.forEach((_value, key) => {
    if (key.toLowerCase().startsWith("x-askr-")) internalHeaders.push(key);
  });
  for (const key of internalHeaders) headers.delete(key);
  return headers;
}

function composeDocumentBody(
  fragment: ReadableStream<Uint8Array> | null,
  prefix: string,
  suffix: string,
): BodyInit {
  if (!fragment) return `${prefix}${suffix}`;
  const encoder = new TextEncoder();
  const reader = fragment.getReader();
  let prefixPending = true;
  let suffixPending = true;
  let reading = false;
  let cancelled = false;
  let finished = false;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (prefixPending) {
        prefixPending = false;
        if (prefix) controller.enqueue(encoder.encode(prefix));
        return;
      }
      if (reading || finished) return;
      reading = true;
      void reader.read().then(
        (part) => {
          reading = false;
          if (cancelled) return;
          if (!part.done) {
            controller.enqueue(part.value);
            return;
          }
          const finalSuffix = suffixPending ? suffix : "";
          finished = true;
          suffixPending = false;
          if (finalSuffix) controller.enqueue(encoder.encode(finalSuffix));
          controller.close();
        },
        (error) => {
          reading = false;
          if (cancelled) return;
          controller.error(error);
          void reader.cancel(error).catch(() => undefined);
        },
      );
    },
    async cancel(reason) {
      cancelled = true;
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}

/**
 * Compose an Askr fragment response into the full `transformedDocument` HTML,
 * streaming the fragment's body between the document prefix and suffix.
 * Non-fragment responses are returned unchanged.
 *
 * @param response The upstream response, expected to be an Askr fragment.
 * @param transformedDocument The `index.html` document with app/head markers.
 * @param options Optional telemetry hook wrapping the compose work.
 * @returns The composed full-document `Response`, or `response` unchanged.
 */
export async function composeAskrDocumentResponse(
  response: Response,
  transformedDocument: string,
  options: AskrDocumentOptions = {},
): Promise<Response> {
  if (!isAskrFragment(response)) return response;
  const compose = () => {
    if (headMarkerCount(transformedDocument) !== 1) {
      throw new Error(
        `index.html must contain exactly one ${ASKR_HEAD_MARKER} marker; found ${headMarkerCount(transformedDocument)}.`,
      );
    }
    const withHead = composeAskrHead(
      transformedDocument,
      response.headers.get("x-askr-head") ?? "",
      response.headers.get("x-askr-html-lang") ?? undefined,
      response.headers.get("x-askr-html-dir") ?? undefined,
    );
    const appCount = markerCount(withHead);
    if (appCount !== 1) {
      throw new Error(
        `index.html must contain exactly one ${ASKR_APP_MARKER} marker; found ${appCount}.`,
      );
    }
    const markerIndex = withHead.indexOf(ASKR_APP_MARKER);
    const prefix = withHead.slice(0, markerIndex);
    const suffix = withHead.slice(markerIndex + ASKR_APP_MARKER.length);
    return new Response(composeDocumentBody(response.body, prefix, suffix), {
      status: response.status,
      statusText: response.statusText,
      headers: documentHeaders(response),
    });
  };
  return options.telemetry?.viteDocument
    ? options.telemetry.viteDocument({ status: response.status }, compose)
    : compose();
}

/**
 * Wrap `app` so every response is composed into `transformedDocument` via
 * {@link composeAskrDocumentResponse}.
 */
export function createDocumentApp(
  app: ServerApp,
  transformedDocument: string,
  options: AskrDocumentOptions = {},
): ServerApp {
  return {
    async fetch(request) {
      return composeAskrDocumentResponse(await app.fetch(request), transformedDocument, options);
    },
  };
}
