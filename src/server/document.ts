import type { ServerApp } from '@askrjs/server';

export const ASKR_APP_MARKER = '<!--askr-app-->';

function markerCount(document: string): number {
  return document.split(ASKR_APP_MARKER).length - 1;
}

export function insertAskrFragment(document: string, fragment: string): string {
  const count = markerCount(document);
  if (count !== 1) {
    throw new Error(`index.html must contain exactly one ${ASKR_APP_MARKER} marker; found ${count}.`);
  }
  return document.replace(ASKR_APP_MARKER, fragment);
}

export function isAskrFragment(response: Response): boolean {
  return response.headers.get('content-type')
    ?.split(';')
    .some((part) => part.trim().toLowerCase() === 'askr-fragment=1') ?? false;
}

function documentHeaders(response: Response): Headers {
  const headers = new Headers(response.headers);
  const type = response.headers.get('content-type')
    ?.split(';')
    .map((part) => part.trim())
    .filter((part) => part.toLowerCase() !== 'askr-fragment=1')
    .join('; ');
  if (type) headers.set('content-type', type);
  return headers;
}

export async function composeAskrDocumentResponse(
  response: Response,
  transformedDocument: string,
): Promise<Response> {
  if (!isAskrFragment(response)) return response;
  const html = insertAskrFragment(transformedDocument, await response.text());
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers: documentHeaders(response),
  });
}

export function createDocumentApp(app: ServerApp, transformedDocument: string): ServerApp {
  return {
    async fetch(request) {
      return composeAskrDocumentResponse(await app.fetch(request), transformedDocument);
    },
  };
}
