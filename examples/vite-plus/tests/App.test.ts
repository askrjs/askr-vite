import { expect, it } from "vitest";
import { App } from "../src/App";

it("transforms the application JSX through the installed Askr plugin", () => {
  expect(App()).toMatchObject({ type: "main" });
});
