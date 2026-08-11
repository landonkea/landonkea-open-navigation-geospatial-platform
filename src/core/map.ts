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

// ── Map view styles ──────────────────────────────────────────────────
// WHAT: lets someone switch between a normal street map and satellite
// imagery. HONEST LIMIT worth stating here too (see the "street view"
// request this responds to): true ground-level photo panoramas (like
// Google Street View) aren't available anywhere for free, every
// provider that offers that requires paid billing, which breaks this
// project's $0-forever rule. These two views (street + satellite) are
// the real, buildable options within that constraint.
export type MapViewId = "street" | "satellite";

// The normal OSM street map, same style used everywhere else in this
// file, given a name here so the view-switcher can refer back to it.
const STREET_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

// Esri's World Imagery: free, no API key, no signup, satellite/aerial
// photography tiles, widely used in open-source mapping projects for
// exactly this reason. Built as a plain MapLibre style object (not a
// style URL like the street map) since it's a single raster source,
// no need to fetch an external style.json for something this simple.
const SATELLITE_STYLE: maplibregl.StyleSpecification = {
  version: 8, // MapLibre/Mapbox style spec version, 8 is the current one
  sources: {
    satellite: {
      type: "raster", // photographic tiles, not vector map data
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256, // Esri's standard tile pixel size
      attribution: "Esri, Maxar, Earthstar Geographics", // required by Esri's terms of use for this free service
    },
  },
  layers: [
    {
      id: "satellite-layer", // this layer's internal name
      type: "raster", // matches the source's type above
      source: "satellite",
    },
  ],
};

/**
 * Switches the map between the street and satellite views. Changing a
 * MapLibre map's style wipes every custom source/layer that isn't
 * part of the new style (that includes the participant clustering
 * layer this app adds, see setParticipantLayer() below), so the
 * caller MUST re-run setParticipantLayer() with the latest data once
 * this resolves, this function only swaps the base map itself.
 *
 * @param map - the live map instance.
 * @param view - which view to switch to.
 * @returns a promise that resolves once the new style has fully
 *   loaded (safe to add sources/layers again after this resolves).
 */
export function setMapView(map: maplibregl.Map, view: MapViewId): Promise<void> {
  return new Promise((resolve) => {
    map.once("styledata", () => resolve()); // fires once the new style has loaded
    map.setStyle(view === "satellite" ? SATELLITE_STYLE : STREET_STYLE_URL);
  });
}

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
    // OpenFreeMap: real, full-detail OSM vector tiles worldwide, free,
    // no signup, no API key, no rate limit (donation-funded). Replaced
    // an earlier version of this file that used MapLibre's own
    // "demotiles" style, which only has real detail in a handful of
    // demo cities, everywhere else (including Mesa, AZ) rendered as a
    // flat, featureless green fill, a real bug caught by actually
    // loading the app and looking at it, not just by requests
    // succeeding (the demo tiles DID load fine, HTTP 200, they just
    // had no useful data for this location).
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: [center.lng, center.lat], // MapLibre wants [lng, lat] order, not [lat, lng]
    zoom, // shorthand for zoom: zoom
  });

  // Standard zoom/rotate controls, bottom-right (not top-right), small
  // but genuinely useful on a phone screen where pinch-zoom alone can
  // be fiddly. Bottom-right specifically to stay clear of the status
  // banner main.ts renders across the top of the screen, a real bug
  // found by actually looking at the running app: top-right placement
  // put the zoom buttons directly under/behind that banner.
  map.addControl(new maplibregl.NavigationControl(), "bottom-right");

  // Defensive, not a confirmed-fix for a specific reproduced bug:
  // main.ts's applyBaseStyles() injects the CSS that gives #map its
  // real size (position: absolute; inset: 0) via a <style> tag added
  // moments before this function runs. If a browser ever reads the
  // container's size before that CSS is applied and laid out,
  // MapLibre could initialize believing the container is 0×0. Forcing
  // a resize() here makes it re-read the container's actual current
  // size, closing that theoretical race for free. (While debugging a
  // separate map-never-loads symptom during testing, this call was
  // tried as a fix and did NOT resolve it, the real cause turned out
  // to be the testing browser tab itself being unfocused, which
  // throttles MapLibre's render loop, not an app bug at all, see this
  // repo's OPERATIONS.md for the full diagnosis. Left in regardless
  // since it's a real, if rare, class of bug worth guarding against.)
  map.resize();

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
