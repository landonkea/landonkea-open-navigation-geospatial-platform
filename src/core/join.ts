// ── The join flow: rider vs. spectator ──────────────────────────────
// WHAT: the branch described in the build prompt's "Accounts / auth"
// and "Spectator mode" sections. Anyone opening a ride's join link
// gets asked for location permission; granting it makes them a
// tracked rider, denying it (or the browser having no location
// support at all) drops them into spectator mode instead, same map,
// same roster, they just never appear as a dot and their phone never
// broadcasts a position. Both paths reuse the exact same join link,
// this file is the one place that decides which path a given visit
// takes.

import { joinRide, becomeRider, type RideParticipant } from "./adapters/supabase";
import { getOrCreateParticipantId } from "./participantId";

// WHY THIS EXISTS (added after real testing): the original version of
// this file collapsed every non-success outcome into a plain "denied"
// with no way to tell a genuine permission refusal apart from the
// device's location service simply failing (no GPS hardware, a slow
// fix, a browser timeout), and gave someone no way to try again after
// fixing the underlying issue, they were just silently stuck as a
// spectator forever. This type lets the UI (see src/main.ts) show
// what actually happened and offer a real "try again" action.
export type SpectatorReason = "permission_denied" | "position_unavailable" | "timeout" | "unsupported";

export type LocationOutcome = { granted: true } | { granted: false; reason: SpectatorReason };

/**
 * Requests browser location permission, wrapped as a Promise instead
 * of the Geolocation API's native callback style, so callers can
 * simply `await` it like everything else here.
 */
export function requestLocationPermission(): Promise<LocationOutcome> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve({ granted: false, reason: "unsupported" }); // this browser has no location API at all
      return;
    }

    navigator.geolocation.getCurrentPosition(
      () => resolve({ granted: true }),
      (err) => {
        // GeolocationPositionError codes, per the browser spec: 1 =
        // permission denied, 2 = position unavailable (no GPS fix,
        // common on a desktop with no GPS hardware and a failed
        // network-location fallback), 3 = timeout.
        const reason =
          err.code === 1 ? "permission_denied" : err.code === 3 ? "timeout" : "position_unavailable";
        console.warn(`Location request failed (${reason}):`, err.message); // visible in the browser console for debugging, previously silent
        resolve({ granted: false, reason });
      },
      { timeout: 10_000 }, // don't hang forever if the device is slow to respond
    );
  });
}

export type JoinResult = {
  participant: RideParticipant; // the row created in Supabase
  isSpectator: boolean; // convenience copy of participant.is_spectator, avoids re-checking it everywhere
  spectatorReason?: SpectatorReason; // why, only set when isSpectator is true
};

/**
 * Runs the full join flow for one ride: request location permission,
 * branch into rider or spectator based on the result, then create the
 * participant row in Supabase.
 *
 * @param rideId - the ride to join, taken from the join link's URL.
 * @returns the join result, including which path was taken, why (if
 *   spectator), and the created participant row.
 */
export async function joinRideFlow(rideId: string): Promise<JoinResult> {
  const outcome = await requestLocationPermission(); // ask, and wait for the real answer
  const isSpectator = !outcome.granted;

  const participantId = getOrCreateParticipantId(rideId); // stable id for this device+ride
  const participant = await joinRide(rideId, participantId, isSpectator); // create the row in Supabase

  return {
    participant,
    isSpectator,
    spectatorReason: outcome.granted ? undefined : outcome.reason,
  };
}

/**
 * Lets a current spectator try again, e.g. after actually granting
 * location access in their browser's site settings following an
 * earlier denial. On success, flips their existing participant row
 * from spectator to rider (via becomeRider(), see adapters/supabase.ts)
 * rather than creating a second row, this stays the same participant,
 * same id, throughout the ride.
 *
 * @returns the same LocationOutcome shape as the initial join, so the
 *   caller can show why it failed again if it does.
 */
export async function retryLocationShare(participantId: string): Promise<LocationOutcome> {
  const outcome = await requestLocationPermission();
  if (outcome.granted) {
    await becomeRider(participantId); // flip is_spectator to false on the existing row
  }
  return outcome;
}
