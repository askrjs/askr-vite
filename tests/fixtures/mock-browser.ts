import { http, HttpResponse } from "msw";
import { setupWorker } from "msw/browser";

let reply = "First mock";
let hold = true;
let release: (() => void) | undefined;
let started = false;
const worker = setupWorker(
  http.get("/mock/profile", async () => {
    if (hold)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return HttpResponse.json({ name: reply });
  }),
);

export async function startMocks(): Promise<void> {
  if (started) return;
  await worker.start({ quiet: true });
  started = true;
}
export function setReply(value: string): void {
  reply = value;
}
export function releaseMock(): void {
  hold = false;
  release?.();
}
export function failNextMock(): void {
  worker.use(
    http.get(
      "/mock/profile",
      () => HttpResponse.json({ message: "Unavailable" }, { status: 503 }),
      { once: true },
    ),
  );
}
export async function stopMocks(): Promise<void> {
  releaseMock();
  worker.resetHandlers();
  await worker.stop();
  started = false;
}
