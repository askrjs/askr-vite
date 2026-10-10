import { expect, it } from "vite-plus/test";
import { App } from "../src/App";

it("transforms the application JSX through the installed Askr plugin", () => {
  expect(App()).toMatchObject({ type: "main" });
});
