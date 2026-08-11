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
export type SpectatorReason =
  | "permission_denied"
  | "position_unavailable"
  | "timeout"
  | "unsupported"
  | "insecure_context";

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

    // Browsers refuse the Geolocation API entirely outside a "secure
    // context" (https, or the special-cased "localhost"), a real gap
    // this project's own vite.config.js invites: `server: { host: true
    // }` is there specifically so someone can open the dev server on a
    // real phone over plain http via a LAN IP (e.g. http://192.168.x.x:5173)
    // for testing, which IS an insecure context, geolocation silently
    // fails there. Checked explicitly and given its own reason, rather
    // than letting it fall through to a generic "permission_denied"
    // that gives no hint the real fix is switching to https or testing
    // on localhost itself.
    if (!window.isSecureContext) {
      resolve({ granted: false, reason: "insecure_context" });
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
  spectatorReason?: SpectatorReason; // why, only set when isSpectator is true because a location request failed
};

// WHY TWO SEPARATE FUNCTIONS (added after real feedback): the original
// version auto-requested location the instant the page loaded, with no
// explicit choice first, someone who WANTED to just watch still got a
// permission prompt (or, worse, a silent denial with no context) before
// they'd said anything about their intent. src/main.ts now shows a real
// "I'm riding" / "Just watching" choice screen first, and calls
// whichever of these two matches, so a deliberate spectator never sees
// a location prompt at all, and a rider's failure reason is never
// confused with "chose not to share."

/**
 * Joins as a spectator, deliberately, no location permission is ever
 * requested. For someone who chose "Just watching" up front.
 *
 * @param tag - the self-selected tag (see showTagPicker() in main.ts),
 *   or null for none, e.g. a spectator documenting the ride can still
 *   tag themselves "Photographer/media" without ever sharing location.
 */
export async function joinAsSpectator(rideId: string, tag: string | null = null): Promise<JoinResult> {
  const participantId = getOrCreateParticipantId(rideId);
  const participant = await joinRide(rideId, participantId, true, tag);
  return { participant, isSpectator: true };
}

/**
 * Joins as a rider: requests location permission, and only falls back
 * to spectator if that request actually fails, not by choice. For
 * someone who chose "I'm riding" up front.
 *
 * @param tag - see joinAsSpectator()'s docs above, same meaning here.
 * @returns the join result, including which path was taken, why (if
 *   the location request failed), and the created participant row.
 */
export async function joinAsRider(rideId: string, tag: string | null = null): Promise<JoinResult> {
  const outcome = await requestLocationPermission(); // ask, and wait for the real answer
  const isSpectator = !outcome.granted;

  const participantId = getOrCreateParticipantId(rideId); // stable id for this device+ride
  const participant = await joinRide(rideId, participantId, isSpectator, tag); // create the row in Supabase

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
