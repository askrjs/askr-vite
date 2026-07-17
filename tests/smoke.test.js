import { expect, test } from "vitest";
import askrVitePlugin, { askr } from "../src/index.ts";

test("exports the SPA plugin without server integration", async () => {
  const root = await import("../src/index.ts");
  expect(typeof askrVitePlugin).toBe("function");
  expect(askr).toBe(askrVitePlugin);
  expect(root.askrServer).toBeUndefined();
});
