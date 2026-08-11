// ── Keep the screen awake during an active ride ──────────────────────
// WHAT: uses the browser's Screen Wake Lock API to stop a phone's
// screen from auto-dimming/locking while someone has this app open in
// the foreground. Build prompt's "Additional V1 features" item 1: iOS
// Safari already throttles/stops GPS updates once the screen locks or
// the app backgrounds (a known PWA-vs-native tradeoff, accepted
// elsewhere in this project), so without this, a phone's normal
// auto-lock (usually 1-2 minutes) silently breaks tracking with no
// error shown, someone just quietly vanishes from the map.
//
// HONEST LIMIT: this only prevents the SCREEN from locking while the
// tab is in the foreground. It does NOT fix true backgrounding
// (switching to a different app entirely), that's a separate,
// unsolved tradeoff of choosing a PWA over a native app, not
// something this API (or any web API) can fix.

let currentLock: WakeLockSentinel | null = null; // the active lock, if any, null when not held

/**
 * Requests a screen wake lock. Safe to call even if the browser
 * doesn't support the API at all (older Safari versions, some
 * browsers), fails silently rather than throwing, since this is a
 * nice-to-have, not something that should ever block the app from
 * working.
 *
 * @returns true if a lock was actually acquired, false if the API
 *   isn't supported or the request was refused (e.g. low battery on
 *   some browsers).
 */
export async function requestWakeLock(): Promise<boolean> {
  if (!("wakeLock" in navigator)) return false; // unsupported browser, nothing to do

  try {
    currentLock = await navigator.wakeLock.request("screen");
    return true;
  } catch (err) {
    // A real, but non-fatal, failure, e.g. the page isn't visible
    // right now, or the browser refused for its own reasons. Logged
    // for debugging, never thrown, the app should keep working
    // without this.
    console.warn("Screen wake lock request failed:", err);
    return false;
  }
}

/**
 * Releases the current wake lock, if one is held. Safe to call even
 * if no lock is currently held (a no-op in that case).
 */
export async function releaseWakeLock(): Promise<void> {
  if (!currentLock) return;
  await currentLock.release();
  currentLock = null;
}

/**
 * Sets up automatic re-acquisition: browsers release a wake lock the
 * moment a tab is hidden (switching apps, locking the phone), and
 * this re-requests it the moment the tab becomes visible again (e.g.
 * someone unlocks their phone mid-ride to check something), so the
 * lock stays held for as much of the ride as the tab is actually in
 * the foreground, without the caller having to manage that manually.
 *
 * Call this once, e.g. right after joining a ride as an active rider.
 */
export function keepWakeLockAlive(): void {
  requestWakeLock(); // acquire it immediately for the current session

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      requestWakeLock(); // re-acquire, the browser already released the old one automatically
    }
  });
}
