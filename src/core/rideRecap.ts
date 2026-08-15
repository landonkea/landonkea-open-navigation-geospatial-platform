// ── Post-ride recap stats ────────────────────────────────────────────
// WHAT: pure computation for the admin panel's downloadable "recap
// card" (see renderRecapCardButton() in admin.ts): total distance
// covered (summed across every rider's real recorded movement, not
// just one person's), how many distinct riders showed up, and the
// ride's duration. Built from ride_history_samples, the same data
// source the GPX/CSV export already uses, no new table/migration
// needed, kept separate from rideExport.ts since this produces
// aggregate numbers, not a file format.

import { distanceMetersPlain } from "./geo";
import { groupByParticipant, type HistorySample } from "./rideExport";

export type RideRecapStats = {
  totalDistanceMeters: number;
  riderCount: number;
  durationMs: number | null; // null if the ride was never actually started/ended
};

/**
 * Computes recap stats from a ride's raw history samples.
 *
 * @param samples - every history sample for the ride, any order/mix
 *   of participants, same input shape fetchHistorySamples() returns.
 * @param startedAt - the ride's started_at, or null if never started.
 * @param endedAt - the ride's ended_at, or null if never ended (still
 *   active, or ended without ever having started, an edge case that
 *   just means "no duration to show," not an error).
 */
export function computeRideRecapStats(
  samples: HistorySample[],
  startedAt: string | null,
  endedAt: string | null,
): RideRecapStats {
  const groups = groupByParticipant(samples);

  let totalDistanceMeters = 0;
  for (const points of groups.values()) {
    for (let i = 1; i < points.length; i++) {
      totalDistanceMeters += distanceMetersPlain(points[i - 1], points[i]);
    }
  }

  const durationMs = startedAt && endedAt ? new Date(endedAt).getTime() - new Date(startedAt).getTime() : null;

  return { totalDistanceMeters, riderCount: groups.size, durationMs };
}

/**
 * Formats a duration as "<hours>h <minutes>m" (or "—" for null).
 * Rounds to a whole minute ONCE and derives hours/minutes from that
 * single integer (found in review: rounding hours and minutes
 * independently could each round up separately with nothing to carry
 * the overflow, producing a label like "2h 60m" for a ride lasting
 * 1h59m40s instead of the correct "2h 0m").
 */
export function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return "—";
  const totalMinutes = Math.round(durationMs / 60000);
  return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}
