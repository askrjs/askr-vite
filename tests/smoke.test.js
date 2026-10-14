import { expect, test } from "vite-plus/test";
import { askr } from "../src/index.ts";

test("should export the SPA plugin without server integration", async () => {
  const root = await import("../src/index.ts");
  expect(typeof askr).toBe("function");
  expect(Object.keys(root)).toEqual(["askr"]);
  expect(root.askrServer).toBeUndefined();
});
