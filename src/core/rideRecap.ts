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
