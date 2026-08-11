// ── "Possibly stuck" detection ──────────────────────────────────────
// WHAT: flags a participant as possibly stuck/broken down on the
// trail, distinct from the existing green/yellow/red signal-status
// logic in geo.ts, which is purely about connection quality. A rider
// can have a perfect GPS signal while genuinely stopped (a mechanical
// issue, an injury, waiting on a straggler), this is what catches
// that case instead.
//
// Kept as its own small file (not folded into geo.ts) since it's a
// distinct concern with its own tunable thresholds (see
// src/core/policy.ts), following the same "small, focused, one clear
// job" style as the rest of core/.

import { STUCK_DETECTION_MAX_DISTANCE_METERS, STUCK_DETECTION_WINDOW_MINUTES } from "./policy";

/**
 * Decides whether a participant should be flagged as possibly stuck,
 * based purely on how long they've gone without meaningfully moving.
 *
 * @param lastMovedAtMs - the timestamp of this participant's
 *   last_moved_at column (see the migration adding that column),
 *   updated only when their position actually changed by more than
 *   STUCK_DETECTION_MAX_DISTANCE_METERS.
 * @param nowMs - the current time, passed in rather than read
 *   internally, so this stays a pure, easily-testable function (same
 *   pattern as geo.ts's signalStatus()).
 * @returns true if this participant has been stationary long enough
 *   to warrant flagging to admins.
 */
export function isPossiblyStuck(lastMovedAtMs: number, nowMs: number): boolean {
  const stationaryForMs = nowMs - lastMovedAtMs; // how long since they last actually moved
  const thresholdMs = STUCK_DETECTION_WINDOW_MINUTES * 60 * 1000; // convert the tunable minutes setting to ms
  return stationaryForMs > thresholdMs;
}

/**
 * Decides whether a fresh position update counts as "real movement"
 * (used to decide whether to bump last_moved_at forward, see
 * src/core/sync.ts's poll loop) or just GPS jitter from standing
 * still. Exported separately from isPossiblyStuck() above since it's
 * used at a different point in the flow (every poll, not just when
 * checking admin alerts) but shares the same distance-based
 * threshold, so the two stay in sync by construction, not by two
 * separately-maintained numbers.
 *
 * @param distanceMovedMeters - distance between this poll's position
 *   and the previous one (see geo.ts's distanceMeters()).
 */
export function countsAsMovement(distanceMovedMeters: number): boolean {
  return distanceMovedMeters > STUCK_DETECTION_MAX_DISTANCE_METERS;
}
