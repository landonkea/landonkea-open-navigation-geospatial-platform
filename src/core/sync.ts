// ── The polling sync loop ───────────────────────────────────────────
// WHAT: on a fixed interval, a rider's phone posts its own current
// position and fetches everyone else's, see the build prompt's
// "Critical architecture decision: polling, not persistent realtime
// connections" section for why this is a plain repeated request
// instead of a held-open connection (Supabase's free tier caps
// realtime connections at 200, our expected scale can exceed that).

import {
  fetchParticipants,
  fetchRideStatus,
  updateParticipantPosition,
  type RideParticipant,
  type RideStatus,
} from "./adapters/supabase";
import { distanceMeters, headingDegrees, type GpsPoint } from "./geo";
import { countsAsMovement } from "./stuckDetection";
import { watchOnlineStatus, type OnlineStatusCallback } from "./offlineBuffer";

// The last GPS reading this device took, kept between polls so
// headingDegrees()/speedMetersPerSecond() have a previous point to
// compare the newest one against. Null until the first real reading
// arrives.
let previousPoint: GpsPoint | null = null;

// Never wait longer than this between retries, even after many
// consecutive failures, a real cap on how degraded things get.
const MAX_BACKOFF_SECONDS = 300; // 5 minutes

/**
 * Fallback #3 (build prompt: "a Supabase limit gets hit
 * unexpectedly... degrade gracefully instead of hard-failing... fall
 * back to a longer polling interval"): computes how long to wait
 * before the next poll attempt, doubling the normal interval for each
 * additional consecutive failure, capped at MAX_BACKOFF_SECONDS so it
 * never grows unbounded. Resets back to the plain interval the moment
 * a poll succeeds again (see startPolling()'s loop(), which resets
 * its failure counter to 0 on success).
 *
 * A pure function on purpose (no reference to the actual timer/poll
 * state), so the backoff math itself is easy to verify in isolation.
 *
 * @param baseIntervalSeconds - the normal, non-backed-off interval.
 * @param consecutiveFailures - how many polls in a row have failed,
 *   0 means "no backoff needed, use the normal interval."
 */
export function computeBackoffSeconds(baseIntervalSeconds: number, consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return baseIntervalSeconds; // normal case, no backoff needed
  const backedOff = baseIntervalSeconds * 2 ** consecutiveFailures; // 1st failure: 2x, 2nd: 4x, 3rd: 8x, ...
  return Math.min(backedOff, MAX_BACKOFF_SECONDS);
}

/**
 * Reads the device's current GPS position, wrapped as a Promise
 * (the Geolocation API is callback-based natively).
 */
function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true, // request the best GPS fix the device can give, not a coarse network-based guess
      timeout: 10_000, // give up after 10s rather than hanging the poll indefinitely
    });
  });
}

export type PollResult = {
  participants: RideParticipant[];
  rideStatus: RideStatus | null; // checked every poll so an admin ending the ride is noticed quickly, see startPolling()
};

/**
 * Runs one full poll cycle: read this device's own GPS position, send
 * it to Supabase (skipped entirely for spectators, who never
 * broadcast a position), then fetch every participant's current data
 * plus the ride's current status, so the caller can redraw the map
 * and notice if the ride has ended.
 *
 * @param participantId - this device's own participant id.
 * @param rideId - which ride to sync.
 * @param isSpectator - spectators skip the "post my own position"
 *   half of the cycle, per the build prompt's spectator-mode design,
 *   but still fetch everyone else's positions to see the live map.
 * @returns every current participant plus the ride's current status.
 */
export async function pollOnce(
  participantId: string,
  rideId: string,
  isSpectator: boolean,
): Promise<PollResult> {
  if (!isSpectator) {
    try {
      const rawPosition = await getCurrentPosition(); // ask the device for a fresh GPS fix
      const currentPoint: GpsPoint = {
        lat: rawPosition.coords.latitude,
        lng: rawPosition.coords.longitude,
        accuracyM: rawPosition.coords.accuracy,
        timestampMs: rawPosition.timestamp,
      };

      // Heading only makes sense once we have two points to compare,
      // the very first poll of a ride has nothing to compare against
      // yet, so it's left null rather than a meaningless 0.
      const headingDeg = previousPoint ? headingDegrees(previousPoint, currentPoint) : null;
      // Speed is derived the same way, but computed inline here
      // (distance ÷ time) rather than importing speedMetersPerSecond,
      // since we already need distanceMeters' result for nothing else
      // right now; kept simple rather than adding an unused import.
      const speedMps =
        previousPoint && currentPoint.timestampMs > previousPoint.timestampMs
          ? distanceMeters(previousPoint, currentPoint) /
            ((currentPoint.timestampMs - previousPoint.timestampMs) / 1000)
          : null;

      // Whether this counts as "real movement" or just GPS jitter from
      // standing still, drives whether last_moved_at bumps forward
      // (see stuckDetection.ts and updateParticipantPosition's docs).
      // First-ever poll (no previousPoint yet) counts as movement, so
      // a rider who just joined isn't immediately flagged stuck.
      const moved = !previousPoint || countsAsMovement(distanceMeters(previousPoint, currentPoint));

      await updateParticipantPosition(
        participantId,
        {
          lat: currentPoint.lat,
          lng: currentPoint.lng,
          accuracyM: currentPoint.accuracyM,
          headingDeg,
          speedMps,
        },
        moved,
      );

      previousPoint = currentPoint; // remember this reading for next poll's heading/speed calculation
    } catch (err) {
      // A single failed GPS read or network request shouldn't crash
      // the whole app, log it and move on, the next poll interval
      // will simply try again. Real network loss specifically is
      // handled a level up, in startPolling() below (Fallback #1, see
      // offlineBuffer.ts), which reacts to the browser's own online/
      // offline signal rather than trying to infer it from request
      // failures here.
      console.error("Position update failed, will retry next poll:", err);
    }
  }

  const [participants, rideStatus] = await Promise.all([
    fetchParticipants(rideId), // always fetch, spectators included, everyone needs to see the map
    fetchRideStatus(rideId), // cheap, status-only query, see fetchRideStatus()'s docstring for why
  ]);
  return { participants, rideStatus };
}

/**
 * Starts the repeating poll loop on a fixed interval and returns a
 * function to stop it (call this when a ride ends or the page
 * unloads, so a stray timer doesn't keep polling forever).
 *
 * Also watches the browser's online/offline signal (Fallback #1, see
 * offlineBuffer.ts's module docstring for the full reasoning) and
 * triggers an immediate poll the moment connectivity returns, rather
 * than leaving someone waiting up to a full interval after
 * reconnecting.
 *
 * @param participantId - this device's own participant id.
 * @param rideId - which ride to sync.
 * @param isSpectator - see pollOnce()'s docs.
 * @param intervalSeconds - how often to poll, user-selectable per the
 *   build prompt's "Update interval: user-selectable" section.
 * @param onUpdate - called with the fresh participant list after
 *   every successful poll, the caller uses this to redraw the map.
 * @param onOnlineStatusChange - optional, called whenever the
 *   device's online/offline state changes, so the caller can show a
 *   plain "you're offline" indicator (see main.ts).
 * @param onRideEnded - optional, called once if an admin ends the
 *   ride while this device is still polling (build prompt's "Ride
 *   lifecycle" section: ending a ride should "stop new broadcasts").
 *   The loop stops itself right after calling this, no need for the
 *   caller to call the returned stop function too.
 * @returns a function that stops the poll loop when called.
 */
export function startPolling(
  participantId: string,
  rideId: string,
  isSpectator: boolean,
  intervalSeconds: number,
  onUpdate: (participants: RideParticipant[]) => void,
  onOnlineStatusChange?: OnlineStatusCallback,
  onRideEnded?: () => void,
): () => void {
  let stopped = false; // flips true once stopPolling() is called, checked before each poll
  let scheduledTimer: ReturnType<typeof setTimeout> | null = null; // tracked so a reconnect can cancel and replace it
  let consecutiveFailures = 0; // Fallback #3, see computeBackoffSeconds()'s docstring

  async function loop(): Promise<void> {
    if (stopped) return; // the loop was stopped while a previous poll was still in flight, bail out
    scheduledTimer = null; // this poll is the one that was scheduled, it's no longer "pending"
    try {
      const { participants, rideStatus } = await pollOnce(participantId, rideId, isSpectator);
      onUpdate(participants); // hand the fresh data to the caller (e.g. to redraw the map)
      consecutiveFailures = 0; // a real success, reset the backoff back to the normal interval

      if (rideStatus === "ended" || rideStatus === null) {
        // An admin ended the ride (or, less likely, it was deleted
        // entirely), stop polling for real, per the build prompt's
        // "stop new broadcasts" requirement, this device's own
        // position update above already happened for this cycle
        // (harmless, the row just won't be read from again once
        // retention deletes it), but there will be no next one.
        stopped = true;
        onRideEnded?.();
        return; // skip scheduling another poll below
      }
    } catch (err) {
      // Fetching participants failed entirely (not just this device's
      // own position update, that's already handled above), log and
      // let the next scheduled poll try again rather than stopping.
      consecutiveFailures += 1;
      const delay = computeBackoffSeconds(intervalSeconds, consecutiveFailures);
      console.error(`Poll failed (${consecutiveFailures} in a row), backing off to every ${delay}s:`, err);
    }
    if (!stopped) {
      const delay = computeBackoffSeconds(intervalSeconds, consecutiveFailures);
      scheduledTimer = setTimeout(loop, delay * 1000); // schedule the next poll, backed off if needed
    }
  }

  loop(); // kick off the first poll immediately, don't wait a full interval before the first update

  const stopWatchingOnlineStatus = watchOnlineStatus((isOnline) => {
    onOnlineStatusChange?.(isOnline); // let the caller update its UI regardless
    if (isOnline && !stopped && scheduledTimer) {
      // Reconnected while a future poll was still waiting on its
      // timer, jump the queue: cancel that wait and poll right now
      // instead, so a rider's location resumes sharing immediately
      // rather than up to a full interval late.
      clearTimeout(scheduledTimer);
      loop();
    }
  });

  return () => {
    stopped = true; // the returned "stop" function, prevents any further scheduled polls from running
    if (scheduledTimer) clearTimeout(scheduledTimer);
    stopWatchingOnlineStatus();
  };
}
