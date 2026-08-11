// ── App entry point ────────────────────────────────────────────────
// This file wires the generic core (src/core/) together with the
// bike-specific theme (src/theme/bike/config.ts) to produce the
// actual running app. Kept intentionally thin, it should mostly just
// call into core/ modules, not contain real logic itself.
//
// Note on structure: index.html is deliberately close to empty (just
// the required-before-JS-runs tags). Page title, theme color, and all
// layout CSS are set here instead, in TypeScript, so there's one
// place (not split across .html/.css/.ts files) that owns the page's
// appearance.

import "maplibre-gl/dist/maplibre-gl.css"; // MapLibre's own required stylesheet, bundled by Vite (not a CDN link in index.html) so it's version-locked to the installed package and still works offline
import { createMap, setParticipantLayer } from "./core/map"; // generic map setup
import { bikeTheme } from "./theme/bike/config"; // bike-specific config/wording

/**
 * Sets everything about the page's appearance that would otherwise be
 * hardcoded in index.html or a separate .css file: the browser tab
 * title, the address-bar theme color, and the full-screen map layout.
 * Called once, immediately, before the map itself is created.
 */
function applyBaseStyles(): void {
  // The browser tab's title, previously a static <title> tag in
  // index.html, now generated from the active theme instead.
  document.title = `${bikeTheme.eventWordSingular} — live map`; // e.g. "ride — live map"

  // theme-color tints the browser's address bar / OS status bar on
  // supporting browsers (mostly Android Chrome). This has to be a
  // real <meta> tag in the DOM to work, so we create it here in code
  // rather than hand-writing it into index.html.
  const themeColorMeta = document.createElement("meta"); // build the tag
  themeColorMeta.name = "theme-color"; // this attribute name is what browsers look for
  themeColorMeta.content = "#1f6feb"; // brand blue, matches manifest.json's theme_color
  document.head.appendChild(themeColorMeta); // insert it into the page

  // Full-screen app layout: the map should fill the entire screen,
  // not sit inside a scrollable page the way a normal website does.
  // Generated as one <style> tag here instead of a separate .css
  // file, so this file is the single source of truth for layout.
  const layoutStyle = document.createElement("style"); // build the <style> tag
  layoutStyle.textContent = `
    html, body { margin: 0; height: 100%; }
    #map { position: absolute; inset: 0; }
  `; // the actual CSS rules, kept minimal on purpose
  document.head.appendChild(layoutStyle); // insert it into the page
}

/**
 * Registers the service worker (see public/service-worker.js), which
 * is what makes the app shell installable and usable offline. Guarded
 * with a feature check since some older browsers don't support
 * service workers at all, the app should still just work without
 * this, not crash.
 */
function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return; // unsupported browser, silently skip
  window.addEventListener("load", () => {
    // wait for full page load, the recommended time to register
    navigator.serviceWorker.register("/service-worker.js"); // start caching the app shell
  });
}

applyBaseStyles(); // set title/theme-color/layout before anything else renders
registerServiceWorker(); // make the app installable/offline-capable

// Create the live map, centered/zoomed per the active theme's
// defaults (Mesa, AZ for bikeMesa), mounted into the <div id="map">
// from index.html.
const map = createMap("map", bikeTheme.defaultMapCenter, bikeTheme.defaultMapZoom);

// Placeholder empty participant layer, wired up now so the clustering
// setup is in place and testable, real live positions come from the
// Supabase adapter (src/core/adapters/supabase.ts, not yet built),
// that's the very next piece (Phase 2's polling sync).
map.on("load", () => {
  // "load" fires once the map's initial style/tiles are ready, adding
  // layers any earlier would silently fail.
  setParticipantLayer(map, { type: "FeatureCollection", features: [] }); // start with zero participants
});
