import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// __dirname isn't available in ES modules (this file runs as one,
// package.json sets "type": "module"), rebuilt manually from
// import.meta.url instead, the standard ESM equivalent.
const __dirname = dirname(fileURLToPath(import.meta.url));

// Vite is just a fast local dev server + a build step that bundles
// everything into a few small files for hosting later. It adds no
// runtime cost to the finished app, it only helps while building it.
export default {
  // Serve on the local network too (not just localhost), so we can
  // open the dev server from a real phone on the same WiFi during
  // testing, before any real hosting account exists.
  server: {
    host: true,
  },
  build: {
    rollupOptions: {
      // Two separate pages: the rider-facing map (index.html) and the
      // admin screen (admin.html). Vite only bundles index.html by
      // default, this makes it build both for the production `dist/`
      // output, otherwise admin.html would 404 once deployed.
      input: {
        main: resolve(__dirname, "index.html"),
        admin: resolve(__dirname, "admin.html"),
      },
    },
  },
};
