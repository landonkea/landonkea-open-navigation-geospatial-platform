// ── GPS math: distance, speed, heading, signal status ──────────────
// WHAT: pure functions, no DOM, no network, no map library, just
// numbers in and numbers out. The build prompt specifically calls
// this kind of logic out for TDD ("easy to get subtly wrong and hard
// to verify just by looking at it"), so this file exists on its own,
// separate from map.ts, specifically so it's simple to unit test.

// One GPS reading, matches what the browser's Geolocation API gives
// us (lat/lng in degrees, accuracy as a radius in meters, a
// timestamp in milliseconds since epoch).
export type GpsPoint = {
  lat: number; // latitude in degrees
  lng: number; // longitude in degrees
  accuracyM: number; // GPS accuracy radius in meters, smaller is better
  timestampMs: number; // when this reading was taken
};

// Earth's radius in meters, used by the distance calculation below.
const EARTH_RADIUS_M = 6371000;

/**
 * Converts degrees to radians, every trig function below needs
 * radians, but GPS coordinates always arrive in degrees.
 */
function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180; // the standard degrees-to-radians formula
}

/**
 * Distance in meters between two GPS points, using the Haversine
 * formula (the standard way to measure distance between two points
 * on a sphere, accounts for the Earth's curvature, unlike simple
 * Pythagorean distance which would be wrong at any real scale).
 */
export function distanceMeters(a: GpsPoint, b: GpsPoint): number {
  const lat1 = toRadians(a.lat); // point A's latitude, in radians
  const lat2 = toRadians(b.lat); // point B's latitude, in radians
  const deltaLat = toRadians(b.lat - a.lat); // difference in latitude
  const deltaLng = toRadians(b.lng - a.lng); // difference in longitude

  // The Haversine formula itself, computes the "half versed sine" of
  // the central angle between the two points.
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  const centralAngle = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine)); // angle between the points, in radians

  return EARTH_RADIUS_M * centralAngle; // arc length = radius × angle, gives meters
}

/**
 * Decides whether a fresh GPS reading represents real movement or
 * just noise, given how far it is from the last position actually
 * shown/broadcast. Real-world report this fixes: standing still, the
 * dot visibly jumped back and forth by tens of meters, every poll
 * broadcast the device's raw new reading regardless of how it
 * compared to the last one. GPS accuracy is never perfect, a reading
 * with accuracyM: 40 genuinely could be anywhere within 40 meters of
 * the device's real position, that's not a bug in the reading, it's
 * what the number means. Comparing the moved distance against THAT
 * reading's own accuracy (not a fixed constant) is the standard fix:
 * movement smaller than the reading's own uncertainty radius isn't
 * distinguishable from noise, so don't treat it as real.
 *
 * @param distanceMovedMeters - distance between the new reading and
 *   the last position actually shown/broadcast.
 * @param newReadingAccuracyM - the new reading's own accuracy radius.
 */
export function isRealMovement(distanceMovedMeters: number, newReadingAccuracyM: number): boolean {
  return distanceMovedMeters > newReadingAccuracyM;
}

/**
 * Speed in meters per second between two GPS points, given their
 * timestamps. Returns 0 if the points are simultaneous or out of
 * order (a zero or negative time gap), rather than dividing by zero
 * or returning a negative/infinite speed.
 */
export function speedMetersPerSecond(a: GpsPoint, b: GpsPoint): number {
  const elapsedSeconds = (b.timestampMs - a.timestampMs) / 1000; // convert ms to seconds
  if (elapsedSeconds <= 0) return 0; // guard against divide-by-zero or reversed order
  return distanceMeters(a, b) / elapsedSeconds; // speed = distance ÷ time
}

/**
 * Heading (compass bearing) in degrees from point A to point B, 0 is
 * north, 90 is east, 180 is south, 270 is west, matches how MapLibre
 * expects a marker's rotation angle. Used to orient a rider's dot/
 * arrow on the map in the direction they're actually moving.
 */
export function headingDegrees(a: GpsPoint, b: GpsPoint): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLng = toRadians(b.lng - a.lng);

  // Standard bearing formula, atan2 gives us the correct angle in
  // every direction (atan alone can't distinguish, say, northeast
  // from southwest).
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  const bearingRadians = Math.atan2(y, x); // -π to π range

  const bearingDegrees = (bearingRadians * 180) / Math.PI; // convert to degrees, still -180 to 180
  return (bearingDegrees + 360) % 360; // normalize to the usual 0-360 compass range
}

// The three signal states a participant's dot can show, see the build
// prompt's "Rider dot: live status color" section. Named as a union
// type (not a plain string) so every place that handles status is
// forced by the compiler to cover all three cases, none silently
// forgotten.
export type SignalStatus = "green" | "yellow" | "red";

// Thresholds behind the signal-color decision below, pulled out as
// named constants (not magic numbers inline) so the reasoning is
// visible and these are easy to retune later without hunting through
// logic to find where they're used.
const STALE_AFTER_MS = 90_000; // no update in 90 seconds counts as "lost signal"
const DEGRADED_ACCURACY_M = 25; // an accuracy radius worse than this counts as "degraded"

/**
 * Decides a participant's signal status from how old their last
 * update is and how accurate their GPS reading was, see the build
 * prompt's exact rule: green (recent, accurate), yellow (recent-ish,
 * degraded accuracy), red (stale, frozen at last known position).
 *
 * @param lastUpdateTimestampMs - when the participant's last position was received
 * @param lastAccuracyM - that update's GPS accuracy radius in meters
 * @param nowMs - the current time, passed in (not read from Date.now()
 *   internally) specifically so this function stays pure and easy to
 *   test with a fixed, known "now" instead of the real clock.
 */
export function signalStatus(
  lastUpdateTimestampMs: number,
  lastAccuracyM: number,
  nowMs: number,
): SignalStatus {
  const ageMs = nowMs - lastUpdateTimestampMs; // how long ago the last update arrived

  if (ageMs > STALE_AFTER_MS) return "red"; // too old, signal is effectively lost
  if (lastAccuracyM > DEGRADED_ACCURACY_M) return "yellow"; // recent, but GPS accuracy is poor
  return "green"; // recent and accurate, the good case
}

/**
 * Map-dot opacity (0.3-1) for how stale a position is, a softer visual
 * cue layered on top of the discrete green/yellow/red status: two red
 * dots (one 91 seconds stale, one stale for 20 minutes) look identical
 * under signalStatus() alone, this makes the difference visible at a
 * glance instead of both looking equally "current". Floors at 0.3
 * rather than fading to invisible, a long-stale rider should stay
 * visibly present on the map, just clearly old.
 */
export function staleOpacity(lastUpdateTimestampMs: number, nowMs: number): number {
  const ageMs = nowMs - lastUpdateTimestampMs;
  const fullyFadedAfterMs = STALE_AFTER_MS * 4; // reaches the floor at ~6 minutes stale
  const fraction = Math.min(Math.max(ageMs / fullyFadedAfterMs, 0), 1);
  return 1 - fraction * 0.7; // 1.0 (fresh) down to 0.3 (very stale)
}
