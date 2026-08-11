// ── The polling sync loop ───────────────────────────────────────────
// WHAT: on a fixed interval, a rider's phone posts its own current
// position and fetches everyone else's, see the build prompt's
// "Critical architecture decision: polling, not persistent realtime
// connections" section for why this is a plain repeated request
// instead of a held-open connection (Supabase's free tier caps
// realtime connections at 200, our expected scale can exceed that).

import { fetchParticipants, updateParticipantPosition, type RideParticipant } from "./adapters/supabase";
import { distanceMeters, headingDegrees, type GpsPoint } from "./geo";

// The last GPS reading this device took, kept between polls so
// headingDegrees()/speedMetersPerSecond() have a previous point to
// compare the newest one against. Null until the first real reading
// arrives.
let previousPoint: GpsPoint | null = null;

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

/**
 * Runs one full poll cycle: read this device's own GPS position, send
 * it to Supabase (skipped entirely for spectators, who never
 * broadcast a position), then fetch every participant's current data
 * so the caller can redraw the map.
 *
 * @param participantId - this device's own participant id.
 * @param rideId - which ride to sync.
 * @param isSpectator - spectators skip the "post my own position"
 *   half of the cycle, per the build prompt's spectator-mode design,
 *   but still fetch everyone else's positions to see the live map.
 * @returns every current participant in the ride, for the caller to
 *   redraw onto the map/roster.
 */
export async function pollOnce(
  participantId: string,
  rideId: string,
  isSpectator: boolean,
): Promise<RideParticipant[]> {
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

      await updateParticipantPosition(participantId, {
        lat: currentPoint.lat,
        lng: currentPoint.lng,
        accuracyM: currentPoint.accuracyM,
        headingDeg,
        speedMps,
      });

      previousPoint = currentPoint; // remember this reading for next poll's heading/speed calculation
    } catch (err) {
      // A single failed GPS read or network request shouldn't crash
      // the whole app, log it and move on, the next poll interval
      // will simply try again (this is also where the build prompt's
      // "buffer briefly, resend on reconnect" fallback would plug in,
      // not yet built, see workingTitle-BUILD-PROMPT.md's Fallback #1).
      console.error("Position update failed, will retry next poll:", err);
    }
  }

  return fetchParticipants(rideId); // always fetch, spectators included, everyone needs to see the map
}

/**
 * Starts the repeating poll loop on a fixed interval and returns a
 * function to stop it (call this when a ride ends or the page
 * unloads, so a stray timer doesn't keep polling forever).
 *
 * @param participantId - this device's own participant id.
 * @param rideId - which ride to sync.
 * @param isSpectator - see pollOnce()'s docs.
 * @param intervalSeconds - how often to poll, user-selectable per the
 *   build prompt's "Update interval: user-selectable" section.
 * @param onUpdate - called with the fresh participant list after
 *   every successful poll, the caller uses this to redraw the map.
 * @returns a function that stops the poll loop when called.
 */
export function startPolling(
  participantId: string,
  rideId: string,
  isSpectator: boolean,
  intervalSeconds: number,
  onUpdate: (participants: RideParticipant[]) => void,
): () => void {
  let stopped = false; // flips true once stopPolling() is called, checked before each poll

  async function loop(): Promise<void> {
    if (stopped) return; // the loop was stopped while a previous poll was still in flight, bail out
    try {
      const participants = await pollOnce(participantId, rideId, isSpectator);
      onUpdate(participants); // hand the fresh data to the caller (e.g. to redraw the map)
    } catch (err) {
      // Fetching participants failed entirely (not just this device's
      // own position update, that's already handled above), log and
      // let the next scheduled poll try again rather than stopping.
      console.error("Poll failed, will retry next interval:", err);
    }
    if (!stopped) {
      setTimeout(loop, intervalSeconds * 1000); // schedule the next poll only after this one finished
    }
  }

  loop(); // kick off the first poll immediately, don't wait a full interval before the first update

  return () => {
    stopped = true; // the returned "stop" function, prevents any further scheduled polls from running
  };
}
