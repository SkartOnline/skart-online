import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative base so a static build works from any subdirectory.
  base: "./",
  build: {
    // Fonts and any other asset get base64'd into the CSS, which is what lets
    // the whole site ship as one self-contained HTML file.
    assetsInlineLimit: 4_000_000,
    cssCodeSplit: false,
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
