import { http, HttpResponse } from "msw";
import { setupWorker } from "msw/browser";

const worker = setupWorker(
  http.get("/api/profile", () => HttpResponse.json({ name: "Development profile" })),
);

export async function startDevelopmentMocks(): Promise<void> {
  await worker.start({ quiet: true });
}

if (import.meta.hot) import.meta.hot.dispose(() => worker.stop());
