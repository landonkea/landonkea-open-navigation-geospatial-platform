// ── Nearest-hospital lookup ──────────────────────────────────────────
// WHAT: powers the rider-facing "Emergency Info" card (see
// setUpEmergencyInfoButton() in main.ts). Uses OpenStreetMap's
// Overpass API (free, no key/signup, same no-cost bar every other
// external service in this app holds to), queried directly from the
// browser, no adapter/backend needed.
//
// HONEST LIMIT: this is informational only, never a substitute for
// calling 911/local emergency services in a real emergency, the UI
// that shows this result says so explicitly. Overpass's public
// instance can be slow or briefly unavailable, this always fails soft
// (returns null) rather than blocking anything else in the app.

import { distanceMeters } from "./geo";

export type NearbyHospital = { name: string; distanceMeters: number };

// How wide to search. 15km covers "no hospital in the immediate area"
// cases (rural routes) without the query becoming slow/huge in a dense
// city.
const SEARCH_RADIUS_METERS = 15_000;

// Don't hang forever if Overpass's public instance is slow/down, this
// is a nice-to-have lookup, not worth blocking on indefinitely.
const FETCH_TIMEOUT_MS = 8_000;

/**
 * Finds the nearest named hospital to a given position via Overpass.
 *
 * @returns the nearest hospital's name and distance, or null if none
 *   was found within the search radius, or the lookup failed for any
 *   reason (network error, timeout, malformed response). Never throws.
 */
export async function fetchNearestHospital(lat: number, lng: number): Promise<NearbyHospital | null> {
  const query = `[out:json][timeout:10];node["amenity"="hospital"](around:${SEARCH_RADIUS_METERS},${lat},${lng});out body 10;`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const data = (await response.json()) as { elements?: { lat: number; lon: number; tags?: { name?: string } }[] };
    const elements = data.elements ?? [];

    let nearest: NearbyHospital | null = null;
    for (const el of elements) {
      if (!el.tags?.name) continue; // an unnamed node isn't useful to show someone
      const meters = distanceMeters(
        { lat, lng, accuracyM: 0, timestampMs: 0 },
        { lat: el.lat, lng: el.lon, accuracyM: 0, timestampMs: 0 },
      );
      if (!nearest || meters < nearest.distanceMeters) nearest = { name: el.tags.name, distanceMeters: meters };
    }
    return nearest;
  } catch {
    return null; // network error, timeout, or malformed response, always fail soft
  } finally {
    clearTimeout(timeoutId);
  }
}
