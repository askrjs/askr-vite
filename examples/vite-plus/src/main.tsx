import { createIsland } from "@askrjs/askr/boot";
import { App } from "./App";

if (import.meta.env.DEV && import.meta.env.VITE_ENABLE_MOCKS === "true") {
  const { startDevelopmentMocks } = await import("./mocks");
  await startDevelopmentMocks();
}

createIsland({ root: "#app", component: App });
