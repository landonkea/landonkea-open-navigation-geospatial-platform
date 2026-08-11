// ── The core map module ──────────────────────────────────────────
// WHAT: renders the live map using MapLibre GL JS + OpenStreetMap
// tiles. Generic on purpose: it knows about "participants" and
// "events", never "riders" or "rides", the bike-specific wording
// lives in src/theme/bike/config.ts and gets passed in, not
// hardcoded here (see the build prompt's "Generalize the core, keep
// bike-specific things swappable" section).
//
// WHY MapLibre + OSM tiles (not Google Maps): free with no per-load
// billing, which matters a lot at 150-300 people all loading the map
// at once during a ride.

import maplibregl from "maplibre-gl"; // the map library itself
import type { LngLat } from "../theme/bike/config"; // shared coordinate type

// A GeoJSON Point Feature representing one participant's current
// position, this is the exact shape MapLibre's clustering expects,
// so we don't need to convert anything before handing it over.
export type ParticipantFeature = GeoJSON.Feature<GeoJSON.Point>;

/**
 * Create and mount the live map into a DOM element.
 *
 * @param containerId - the DOM element id to render the map into.
 * @param center - where the map opens, {lng, lat}.
 * @param zoom - initial zoom level, higher = more zoomed in.
 * @returns the created map instance, so callers (like main.ts) can
 *   add participant markers/clustering onto it later.
 */
export function createMap(
  containerId: string, // which <div id="..."> to render into
  center: LngLat, // starting map center
  zoom: number, // starting zoom level
): maplibregl.Map {
  const map = new maplibregl.Map({
    container: containerId, // tells MapLibre which DOM element is "the map"
    // A free, no-signup-required OSM tile style. Good enough to build
    // and test against; a production deployment may want a dedicated
    // free tile provider (e.g. MapTiler's free tier) for better
    // reliability at scale, that's a one-line style URL swap here
    // later, not a rewrite.
    style: "https://demotiles.maplibre.org/style.json",
    center: [center.lng, center.lat], // MapLibre wants [lng, lat] order, not [lat, lng]
    zoom, // shorthand for zoom: zoom
  });

  // Standard zoom/rotate controls, top-right, small but genuinely
  // useful on a phone screen where pinch-zoom alone can be fiddly.
  map.addControl(new maplibregl.NavigationControl(), "top-right");

  return map; // hand the live map instance back to the caller
}

/**
 * Set up (or refresh) the clustered source/layers that render
 * participant dots on the map. Called once at startup with an empty
 * feature list, then called again every time fresh position data
 * comes in (see src/core/adapters/supabase.ts, not yet built).
 *
 * WHAT clustering does here: MapLibre's built-in clustering (backed
 * by the `supercluster` library, already part of MapLibre, no extra
 * dependency) groups nearby dots into a single numbered bubble at
 * zoomed-out levels, so 300 overlapping dots at the start line don't
 * turn into visual noise. See the build prompt's "Map UX at scale"
 * section for the clusterRadius/clusterMaxZoom reasoning.
 *
 * @param map - the live map instance from createMap().
 * @param participantsGeoJSON - every current participant, as one
 *   GeoJSON FeatureCollection of Point features.
 */
export function setParticipantLayer(
  map: maplibregl.Map, // the map to draw onto
  participantsGeoJSON: GeoJSON.FeatureCollection<GeoJSON.Point>, // current positions
): void {
  const sourceId = "participants"; // internal MapLibre source name, reused below

  const existingSource = map.getSource(sourceId); // check if we've already set this up
  if (existingSource) {
    // Already set up, this is the common case (called again on every
    // poll once live sync exists), just refresh the data in place.
    (existingSource as maplibregl.GeoJSONSource).setData(participantsGeoJSON);
    return; // nothing else to do, the existing layers already render it
  }

  map.addSource(sourceId, {
    type: "geojson", // plain GeoJSON data source, no server-side clustering needed
    data: participantsGeoJSON, // the initial (usually empty) feature set
    cluster: true, // turn on MapLibre's built-in clustering
    // Screen pixels, not real-world distance, see this function's
    // docstring above and the build prompt for why. Starting values
    // from the build prompt, tune after the real small-scale test ride.
    clusterRadius: 55, // px radius that gets grouped into one bubble
    clusterMaxZoom: 15, // past this zoom, always show individual dots
  });

  // Cluster bubbles: a circle sized/colored the same regardless of
  // count for now (a real design pass can vary size by count later),
  // plus a text label showing the count.
  map.addLayer({
    id: "clusters", // this layer's internal name
    type: "circle", // draw a filled circle shape
    source: sourceId, // pull data from the source we just added
    filter: ["has", "point_count"], // only features that ARE a cluster
    paint: {
      "circle-color": "#1f6feb", // brand blue
      "circle-radius": 18, // pixel radius of the bubble
      "circle-stroke-width": 2, // white outline width
      "circle-stroke-color": "#ffffff", // white outline color
    },
  });
  map.addLayer({
    id: "cluster-count", // separate layer just for the number label
    type: "symbol", // text/icon layer type
    source: sourceId,
    filter: ["has", "point_count"], // same filter as the bubble above
    layout: {
      "text-field": "{point_count_abbreviated}", // e.g. "42" or "1.2k"
      "text-size": 14, // font size in px
    },
    paint: { "text-color": "#ffffff" }, // white text on the blue bubble
  });

  // Individual participant dots (unclustered), colored by signal
  // status (build prompt's "Rider dot: live status color" section).
  // Each feature carries a "status" property, set in src/main.ts from
  // geo.ts's signalStatus(), and this "match" expression picks the
  // color, computed by MapLibre itself, stays fast even at 300 dots.
  map.addLayer({
    id: "unclustered-point",
    type: "circle",
    source: sourceId,
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": [
        "match",
        ["get", "status"],
        "green", "#2e7d32",
        "yellow", "#f9a825",
        "red", "#c62828",
        "#1f6feb", // fallback if "status" is ever missing
      ],
      "circle-radius": 8,
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
    },
  });

  // Color alone isn't enough for colorblind riders (build prompt's
  // "Readability" section), so a small glyph rides on top of each dot
  // as a second, non-color status cue.
  map.addLayer({
    id: "unclustered-point-icon",
    type: "symbol",
    source: sourceId,
    filter: ["!", ["has", "point_count"]],
    layout: {
      "text-field": ["match", ["get", "status"], "green", "●", "yellow", "▲", "red", "✕", "?"],
      "text-size": 10,
      "text-allow-overlap": true,
    },
    paint: { "text-color": "#ffffff" },
  });
}
