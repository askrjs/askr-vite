import { createIsland } from "@askrjs/askr/boot";
import { createQuery } from "@askrjs/askr/data";
import { createClient, defineApi, get, json } from "@askrjs/fetch";
import { startMocks, setReply, releaseMock, failNextMock, stopMocks } from "./mock-browser";

const label = "First mock";
await startMocks();
setReply(label);
const api = defineApi({
  profile: get("/mock/profile").returns(200, json<{ name: string }>()).errors({ 503: json() }),
});
const client = createClient(api, { baseUrl: location.origin });
createIsland({
  root: "#app",
  component: () => {
    const query = createQuery({
      key: "browser-mocked-profile",
      fetch: async ({ signal }) => {
        const result = await client.profile({ signal });
        if (!result.ok) throw new Error("Mock unavailable");
        return result.data;
      },
    });
    return (
      <main>
        <h1>{label}</h1>
        <output role="status">
          {query.loading ? "Loading mock" : query.error ? "Mock unavailable" : query.data?.name}
        </output>
        <button
          onClick={() => {
            void query.refresh();
          }}
        >
          Retry mock
        </button>
      </main>
    );
  },
});
Object.assign(globalThis, { releaseMock, failNextMock, stopMocks });
if (import.meta.hot) import.meta.hot.accept();
