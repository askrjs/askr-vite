import { test, expect } from "vitest";

import askrVitePlugin, { askr } from "../src/index.ts";

test("exports the askr vite plugin factory", () => {
  expect(typeof askrVitePlugin).toBe("function");
  expect(askr).toBe(askrVitePlugin);
});
