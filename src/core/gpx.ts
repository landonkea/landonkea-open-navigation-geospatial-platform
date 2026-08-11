// ── GPX file parsing ─────────────────────────────────────────────────
// WHAT: GPX (GPS Exchange Format) is a standard XML file format for
// routes, most bike-route-planning tools (Strava, RideWithGPS, Komoot,
// etc.) can export one. This turns a raw GPX file's text content into
// a GeoJSON FeatureCollection (a LineString for the route path, plus
// a Point feature per named waypoint), the shape MapLibre expects,
// see the build prompt's "Waypoints from the GPX file" section.

/**
 * Parses a GPX file's text content into a GeoJSON FeatureCollection.
 *
 * @param gpxText - the raw contents of a .gpx file (it's plain XML).
 * @returns a FeatureCollection with one LineString feature (the route,
 *   only present if the file actually has track points) and zero or
 *   more Point features (named waypoints, <wpt> elements).
 * @throws a plain-language Error if the file isn't valid XML at all,
 *   a malformed file shouldn't crash the app, see the build prompt's
 *   "handling a malformed/invalid GPX file without crashing" note,
 *   the caller is expected to show this message rather than let it
 *   propagate as an unhandled exception.
 */
export function parseGpx(gpxText: string): GeoJSON.FeatureCollection {
  const parser = new DOMParser(); // built into every browser, no library needed for XML parsing
  const doc = parser.parseFromString(gpxText, "application/xml");

  // DOMParser doesn't throw on invalid XML, it returns a document
  // containing a <parsererror> element instead, this is the standard
  // way to detect that.
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error("This doesn't look like a valid GPX file (couldn't parse it as XML).");
  }

  const features: GeoJSON.Feature[] = [];

  // ── The route line, from <trkpt> (track point) elements ──────────
  // A GPX file organizes track points under <trk><trkseg><trkpt>, we
  // flatten every segment into one continuous line, real GPX files
  // occasionally have more than one segment (e.g. a pause in
  // recording), treating them as one line is simpler and good enough
  // here, this isn't trying to preserve recording-session boundaries.
  const trackPoints = doc.querySelectorAll("trkpt");
  if (trackPoints.length > 0) {
    const coordinates: [number, number][] = [];
    trackPoints.forEach((point) => {
      const lat = parseFloat(point.getAttribute("lat") ?? "");
      const lon = parseFloat(point.getAttribute("lon") ?? "");
      if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
        coordinates.push([lon, lat]); // GeoJSON wants [lng, lat] order, GPX attributes are lat/lon
      }
    });
    if (coordinates.length > 1) {
      // A line needs at least 2 points, a single stray point isn't a real route.
      features.push({
        type: "Feature",
        properties: { kind: "route" }, // lets the map layer style this differently from waypoints
        geometry: { type: "LineString", coordinates },
      });
    }
  }

  // ── Waypoints, from <wpt> elements ────────────────────────────────
  // Named points of interest a route file can include separately from
  // the track itself, e.g. a rest stop or a regroup point (build
  // prompt's exact examples). Not every GPX file has these, that's
  // fine, handled gracefully (build prompt: "handling a GPX file with
  // no waypoints").
  const waypoints = doc.querySelectorAll("wpt");
  waypoints.forEach((point) => {
    const lat = parseFloat(point.getAttribute("lat") ?? "");
    const lon = parseFloat(point.getAttribute("lon") ?? "");
    if (Number.isNaN(lat) || Number.isNaN(lon)) return; // skip a malformed point rather than crash the whole parse

    const nameEl = point.querySelector("name");
    const name = nameEl ? nameEl.textContent : null; // e.g. "Rest Stop", "Mile 12 Regroup"

    features.push({
      type: "Feature",
      properties: { kind: "waypoint", name },
      geometry: { type: "Point", coordinates: [lon, lat] },
    });
  });

  return { type: "FeatureCollection", features };
}

/**
 * Parses a GPX file's track points into plain {lat, lng, recordedAt}
 * samples, for importing as ride history (see importHistorySamples()
 * in src/core/adapters/supabase.ts), a different need from parseGpx()
 * above: that one builds a GeoJSON route line for the map (no
 * timestamps needed), this one needs each point's actual recorded
 * time, since that's what a history sample is. A point with no <time>
 * child is skipped rather than guessed at, a history sample with a
 * fabricated timestamp would be actively misleading.
 *
 * @param gpxText - the raw contents of a .gpx file.
 * @returns every track point that has a real timestamp, in file
 *   order (not necessarily chronological, that's the caller's/
 *   database's concern, not this function's).
 * @throws a plain-language Error for genuinely invalid XML, same as parseGpx().
 */
export function parseGpxTrackPoints(gpxText: string): { lat: number; lng: number; recordedAt: string }[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(gpxText, "application/xml");

  if (doc.querySelector("parsererror")) {
    throw new Error("This doesn't look like a valid GPX file (couldn't parse it as XML).");
  }

  const points: { lat: number; lng: number; recordedAt: string }[] = [];
  doc.querySelectorAll("trkpt").forEach((point) => {
    const lat = parseFloat(point.getAttribute("lat") ?? "");
    const lng = parseFloat(point.getAttribute("lon") ?? "");
    const timeEl = point.querySelector("time");
    const recordedAt = timeEl?.textContent;
    if (Number.isNaN(lat) || Number.isNaN(lng) || !recordedAt) return; // skip points missing lat/lon/time rather than guessing
    points.push({ lat, lng, recordedAt });
  });

  return points;
}
