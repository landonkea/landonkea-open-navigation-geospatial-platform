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
};
