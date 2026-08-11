// ── Fallback #1: a rider loses network mid-ride ──────────────────────
// WHAT: the build prompt calls for buffering a rider's location
// updates on-device when connectivity drops, then resending once it
// returns, rather than silently losing them. HONEST NOTE on how this
// actually applies here: the database only ever stores ONE current
// position per participant (see ride_participants' lat/lng columns),
// not a history of every point, so there's nothing meaningful to
// "replay" from a queue of missed points, only the single latest
// reading matters once reconnected. What this module actually does:
// detects real network loss (not just a generic failed request),
// surfaces it plainly (see main.ts's offline banner), and triggers an
// immediate retry the moment the browser reports connectivity is back,
// rather than silently waiting for the next scheduled poll interval.

export type OnlineStatusCallback = (isOnline: boolean) => void;

/**
 * Watches the browser's own online/offline signal and calls back on
 * every change. `navigator.onLine` reflects actual network interface
 * state (WiFi/cellular connected or not), it can't detect every
 * possible failure (e.g. WiFi connected but the specific Supabase
 * endpoint is unreachable), that class of failure is instead what
 * pollOnce()'s own try/catch in sync.ts already handles, this is
 * specifically for "the device itself has no network at all."
 *
 * @param onChange - called immediately with the current state, then
 *   again every time it changes.
 * @returns a function to stop watching (remove the event listeners).
 */
export function watchOnlineStatus(onChange: OnlineStatusCallback): () => void {
  onChange(navigator.onLine); // report the current state right away, don't wait for a change event

  const handleOnline = () => onChange(true);
  const handleOffline = () => onChange(false);

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  return () => {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
  };
}
