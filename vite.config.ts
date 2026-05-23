import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [cloudflare()],
  // yahoo-finance2 pulls in @deno/shim-deno, whose mainModule shim references the
  // Node-only `__dirname` global at import time. Workers (ESM) has no such global,
  // so replace it with a harmless literal to keep the module from throwing on load.
  define: {
    __dirname: '"/"',
    __filename: '"/index.js"',
  },
});
