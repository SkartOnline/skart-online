import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative base so a static build works from any subdirectory.
  base: "./",
  // Honour an assigned port (tooling sets PORT); fall back to vite's default.
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
  },
  build: {
    // Assets ship as files, not base64.
    //
    // This used to inline everything, so the whole site was one self-contained
    // HTML file. That was a fine trade when the only asset was the font. It
    // stops being one the moment there is card art: base64 costs a third again
    // in size, an inlined image cannot be lazily fetched, and every byte of it
    // lands in the render-blocking stylesheet — so a set of card paintings
    // would have to finish downloading before the menu could draw.
    //
    // Left at vite's default (4 KB), which still inlines the few tiny things
    // where a request would cost more than the bytes.
    assetsInlineLimit: 4096,
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
