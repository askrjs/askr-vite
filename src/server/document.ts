import type { ServerApp } from "@askrjs/server";
import { normalizeAskrHead } from "./head";

interface ViteTelemetryFields {
  status?: number;
}

interface ViteTelemetry {
  viteDocument?<T>(fields: ViteTelemetryFields, work: () => T): T;
}

export interface AskrDocumentOptions {
  telemetry?: ViteTelemetry;
}

export const ASKR_APP_MARKER = "<!--askr-app-->";
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

export function insertAskrFragment(document: string, fragment: string): string {
  const count = markerCount(document);
  if (count !== 1) {
    throw new Error(
      `index.html must contain exactly one ${ASKR_APP_MARKER} marker; found ${count}.`,
    );
  }
  return document.replace(ASKR_APP_MARKER, fragment);
}

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

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (prefixPending) {
        prefixPending = false;
        if (prefix) controller.enqueue(encoder.encode(prefix));
        return;
      }
      if (reading) return;
      reading = true;
      void reader.read().then(
        (part) => {
          reading = false;
          if (cancelled) return;
          if (!part.done) {
            controller.enqueue(part.value);
            return;
          }
          if (suffixPending && suffix) controller.enqueue(encoder.encode(suffix));
          suffixPending = false;
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
