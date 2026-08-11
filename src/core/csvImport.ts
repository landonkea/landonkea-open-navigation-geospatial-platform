// ── CSV import parsing ───────────────────────────────────────────────
// WHAT: the inverse of src/core/rideExport.ts's CSV output, and a
// second way (alongside GPX) to set a ride's planned route. Both
// formats here are plain, comma-split parsing, no escaping/quoting
// support, matching rideExport.ts's own reasoning: every field in
// both formats is a UUID, a number, or an ISO timestamp, none of
// which can ever contain a comma, so a real CSV parser/library would
// be solving a problem this data never actually has.

export type ImportedHistorySample = {
  participantId: string;
  lat: number;
  lng: number;
  recordedAt: string;
};

/**
 * Parses a CSV file back into history samples, expecting exactly the
 * shape samplesToCsv() in rideExport.ts produces:
 * "participant_id,lat,lng,recorded_at" header, then one row per
 * sample. Existing participant ids are preserved as-is (re-importing
 * a real export recreates the same multi-participant structure it
 * came from), see importHistorySamples() in
 * src/core/adapters/supabase.ts for where this actually gets saved.
 *
 * @param csvText - the raw contents of a .csv file.
 * @returns every row that parsed as a complete, valid sample, a
 *   malformed row is skipped rather than failing the whole import.
 * @throws a plain-language Error if the file has no usable rows at
 *   all (e.g. just a header, or genuinely not CSV).
 */
export function parseHistoryCsv(csvText: string): ImportedHistorySample[] {
  const lines = csvText.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  const dataLines = lines.slice(1); // first line is always the header, never data

  const samples: ImportedHistorySample[] = [];
  for (const line of dataLines) {
    const [participantId, latStr, lngStr, recordedAt] = line.split(",");
    const lat = parseFloat(latStr ?? "");
    const lng = parseFloat(lngStr ?? "");
    if (!participantId || Number.isNaN(lat) || Number.isNaN(lng) || !recordedAt) continue; // skip a malformed row rather than failing the whole file
    samples.push({ participantId, lat, lng, recordedAt });
  }

  if (samples.length === 0) {
    throw new Error("No usable rows found in this CSV file (expected: participant_id,lat,lng,recorded_at).");
  }
  return samples;
}

/**
 * Parses a simple "lat,lng,name" CSV into the same GeoJSON shape
 * parseGpx() produces (a LineString route plus optional named
 * waypoint Points), a second, simpler way to set a ride's planned
 * route alongside GPX upload. `name` is optional per row, empty means
 * "just a route point," a real value means "this row is also a named
 * waypoint" (e.g. "Rest Stop"), not a replacement point.
 *
 * @param csvText - the raw contents of a .csv file, header row
 *   expected as the first line (its exact contents don't matter,
 *   it's always skipped) then rows of "lat,lng" or "lat,lng,name".
 * @returns a FeatureCollection matching parseGpx()'s shape, so the
 *   exact same createRoute()/setRouteLayer() code paths handle it.
 * @throws a plain-language Error if fewer than 2 usable points exist
 *   (a route line needs at least 2 points to draw at all).
 */
export function parseRouteCsv(csvText: string): GeoJSON.FeatureCollection {
  const lines = csvText.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  const dataLines = lines.slice(1);

  const coordinates: [number, number][] = [];
  const features: GeoJSON.Feature[] = [];

  for (const line of dataLines) {
    const [latStr, lngStr, name] = line.split(",");
    const lat = parseFloat(latStr ?? "");
    const lng = parseFloat(lngStr ?? "");
    if (Number.isNaN(lat) || Number.isNaN(lng)) continue; // skip a malformed row rather than failing the whole file

    coordinates.push([lng, lat]); // GeoJSON wants [lng, lat], same order convention as gpx.ts
    if (name && name.trim().length > 0) {
      features.push({
        type: "Feature",
        properties: { kind: "waypoint", name: name.trim() },
        geometry: { type: "Point", coordinates: [lng, lat] },
      });
    }
  }

  if (coordinates.length < 2) {
    throw new Error("Need at least 2 valid points to form a route (expected: lat,lng,name with name optional).");
  }

  // The route line goes first, matching parseGpx()'s own feature
  // order (route, then waypoints), not that anything downstream
  // actually depends on the order, just for consistency.
  return {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { kind: "route" }, geometry: { type: "LineString", coordinates } },
      ...features,
    ],
  };
}
