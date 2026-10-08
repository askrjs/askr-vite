import { defineConfig } from "vite-plus";
import { askr } from "@askrjs/vite";

export default defineConfig({
  plugins: [askr()],
});
