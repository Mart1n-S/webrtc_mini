// vite.config.js
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  resolve: {
    alias: {
      events: "events/",
      buffer: "buffer/",
      util: "util/",
      process: "process/browser",
    },
  },
  define: {
    global: "window",
    "process.env": {},
  },
  base: "/",
  build: {
    outDir: "public/assets/vite",
    emptyOutDir: false,
    sourcemap: true,
    target: "es2019",
    rollupOptions: {
      input: { "ot-main": "src/ot-main.js" },
      output: {
        entryFileNames: "[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  optimizeDeps: {
    include: ["sharedb/lib/client", "rich-text"],
  },
});
