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

import { joinRide, type RideParticipant } from "./adapters/supabase";
import { getOrCreateParticipantId } from "./participantId";

export type JoinResult = {
  participant: RideParticipant; // the row created in Supabase
  isSpectator: boolean; // convenience copy of participant.is_spectator, avoids re-checking it everywhere
};

/**
 * Requests browser location permission, wrapped as a Promise instead
 * of the Geolocation API's native callback style, so callers can
 * simply `await` it like everything else here.
 *
 * @returns the browser's permission result: "granted" or "denied".
 *   Never rejects, a denial is a normal, expected outcome here, not
 *   an error, that's exactly what routes someone into spectator mode.
 */
function requestLocationPermission(): Promise<"granted" | "denied"> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve("denied"); // no location support at all, treat the same as a denial
      return;
    }

    navigator.geolocation.getCurrentPosition(
      () => resolve("granted"), // the browser's permission prompt was accepted
      () => resolve("denied"), // the browser's permission prompt was declined (or errored)
      { timeout: 10_000 }, // don't hang forever if the device is slow to respond
    );
  });
}

/**
 * Runs the full join flow for one ride: request location permission,
 * branch into rider or spectator based on the result, then create the
 * participant row in Supabase.
 *
 * @param rideId - the ride to join, taken from the join link's URL.
 * @returns the join result, including which path was taken and the
 *   created participant row.
 */
export async function joinRideFlow(rideId: string): Promise<JoinResult> {
  const permissionResult = await requestLocationPermission(); // ask, and wait for the real answer
  const isSpectator = permissionResult === "denied"; // the one and only branch point

  const participantId = getOrCreateParticipantId(rideId); // stable id for this device+ride
  const participant = await joinRide(rideId, participantId, isSpectator); // create the row in Supabase

  return { participant, isSpectator };
}
