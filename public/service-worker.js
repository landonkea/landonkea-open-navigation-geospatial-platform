// ── Service worker: what makes this app "installable" and usable ──
// offline for its own shell (not the live map data, that always
// needs a real network connection, but the app's HTML/CSS/JS itself).
//
// WHAT A SERVICE WORKER IS, for anyone new to this: it's a small
// script the browser runs in the background, separate from the page
// itself, that can intercept network requests. We use it here for
// exactly one job: caching the app's own files (this file, the HTML,
// the JS) so the app still opens even with a flaky connection, the
// same way a native app's icon still opens even with no signal.

const CACHE_NAME = "opennav-shell-v1";

// Only the app "shell" itself, never live ride data, that must always
// come from the network fresh, caching it would show stale rider
// positions.
const SHELL_FILES = ["/", "/index.html", "/manifest.json"];

// "install" fires once, the first time a browser loads this service
// worker. We use it to pre-download the shell files into a cache.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
});

// "activate" fires when a new version of this service worker takes
// over. We use it to delete any old cache from a previous version, so
// updates don't leave stale files behind forever.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
});

// "fetch" fires on every network request the page makes. For shell
// files, serve the cached copy if we have one (fast, works offline);
// for everything else (API calls, map tiles, live position data),
// just let the network handle it normally, we never want to serve
// stale ride data from a cache.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isShellFile = SHELL_FILES.includes(url.pathname);
  if (!isShellFile) return; // let the browser handle it normally

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
