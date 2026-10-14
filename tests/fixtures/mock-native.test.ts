import { expect, it } from "vite-plus/test";
import { createDataRuntime, createQuery } from "@askrjs/askr/data";
import { createClient, defineApi, get, json } from "@askrjs/fetch";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { createServer } from "node:http";

it("uses native Askr queries and Fetch with the installed mock/test toolchain", async () => {
  const real = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ name: "Real profile" }));
  });
  await new Promise<void>((resolve, reject) => {
    real.once("error", reject);
    real.listen(0, "127.0.0.1", resolve);
  });
  const address = real.address();
  if (!address || typeof address === "string") throw new Error("Missing native server address.");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const endpoint = `${baseUrl}/profile`;
  const server = setupServer(http.get(endpoint, () => HttpResponse.json({ name: "Mock profile" })));
  server.listen();
  try {
    const api = defineApi({
      profile: get("/profile").returns(200, json<{ name: string }>()).errors({ 503: json() }),
    });
    const client = createClient(api, { baseUrl });
    server.use(
      http.get(endpoint, () => HttpResponse.json({ message: "Unavailable" }, { status: 503 })),
    );
    const failed = await client.profile();
    expect(failed).toMatchObject({ ok: false, kind: "http", status: 503 });
    server.resetHandlers();
    const runtime = createDataRuntime();
    const query = createQuery({
      runtime,
      key: "native-mocked-profile",
      fetch: async ({ signal }) => {
        const result = await client.profile({ signal });
        if (!result.ok) throw new Error("Profile unavailable");
        return result.data;
      },
    });
    await query.refresh();
    expect(query.error).toBeNull();
    expect(query.data).toEqual({ name: "Mock profile" });
    server.use(http.get(endpoint, () => HttpResponse.json({ name: "Retried profile" })));
    await query.refresh();
    expect(query.data).toEqual({ name: "Retried profile" });
    await server.close();
    expect(await (await fetch(endpoint)).json()).toEqual({ name: "Real profile" });
  } finally {
    server.resetHandlers();
    await server.close();
    real.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      real.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
