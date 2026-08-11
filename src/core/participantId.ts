// ── Per-device, per-ride participant id ─────────────────────────────
// WHAT: regular riders never log in (see the build prompt's
// "Accounts / auth" section), so there's no server-issued identity to
// tell "this phone's own row" apart from anyone else's on later polls.
// Instead, each device generates its own random id once, the first
// time it joins a given ride, and reuses that same id for every
// update afterward. Kept in localStorage, scoped per ride (a separate
// id per ride, not one id shared across every ride a phone ever
// joins), matching the build prompt's per-ride data isolation
// requirement.

const STORAGE_KEY_PREFIX = "workingtitle-participant-id-"; // followed by the ride id

/**
 * Gets this device's participant id for a given ride, creating and
 * saving a new one on first use, reusing the existing one on every
 * later visit to the same ride (e.g. the page reloading mid-ride).
 *
 * @param rideId - the ride to get/create an id for.
 * @returns a UUID string, stable for this device+ride combination.
 */
export function getOrCreateParticipantId(rideId: string): string {
  const storageKey = STORAGE_KEY_PREFIX + rideId; // one localStorage slot per ride
  const existing = localStorage.getItem(storageKey); // check for a previously saved id
  if (existing) return existing; // reuse it, don't generate a new one every visit

  const generated = crypto.randomUUID(); // built into every modern browser, no library needed
  localStorage.setItem(storageKey, generated); // save it for next time
  return generated;
}
