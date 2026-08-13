// ── Unit formatting: imperial vs metric ──────────────────────────────
// WHAT: pure formatting functions, no DOM, so a theme's unitSystem
// choice (src/theme/bike/config.ts) can drive every distance/speed/
// temperature string shown to a rider without scattering the same
// conversion math across main.ts, admin.ts, and anywhere else a number
// gets shown. bikeMesa is a US audience (imperial), but nothing here
// assumes that, a future theme can set "metric" and every caller of
// these functions follows along with zero other changes.

export type UnitSystem = "imperial" | "metric";

/**
 * Formats a distance in meters as a short, human string. Switches to
 * the smaller unit (feet/meters) below 0.1 of the larger unit, a
 * distance like "0.0 mi" reads as broken/zero to a real person even
 * though it's technically just small.
 */
export function formatDistance(meters: number, system: UnitSystem): string {
  if (system === "imperial") {
    const miles = meters / 1609.344;
    if (miles < 0.1) return `${Math.round(meters * 3.28084)} ft`;
    return `${miles.toFixed(1)} mi`;
  }
  const km = meters / 1000;
  if (km < 0.1) return `${Math.round(meters)} m`;
  return `${km.toFixed(1)} km`;
}

/** Formats a speed in meters/second as a short, human string. */
export function formatSpeed(metersPerSecond: number, system: UnitSystem): string {
  if (system === "imperial") return `${(metersPerSecond * 2.23694).toFixed(1)} mph`;
  return `${(metersPerSecond * 3.6).toFixed(1)} km/h`;
}

/** Formats a Celsius temperature (weather APIs' usual native unit) as a short, human string. */
export function formatTemperatureC(celsius: number, system: UnitSystem): string {
  if (system === "imperial") return `${Math.round((celsius * 9) / 5 + 32)}°F`;
  return `${Math.round(celsius)}°C`;
}
