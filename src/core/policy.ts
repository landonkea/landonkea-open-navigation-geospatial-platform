// ── Generic, easily-tunable policy values ───────────────────────────
// WHAT: timing/behavior constants that apply to every event type, not
// specific to bikeMesa/cycling (that's what src/theme/bike/config.ts
// is for), so they live in core/, not the theme layer, per the build
// prompt's "Generalize the core, keep bike-specific things swappable"
// section.
//
// WHY THIS FILE EXISTS: these are exactly the kind of number someone
// running the club will want to change later without touching real
// logic, pulling them out into one small, obviously-named file (not
// buried as a magic number inside whatever function uses it) makes
// that a one-line edit instead of a hunt through the codebase.

/**
 * How many minutes after a ride is marked "ended" before every
 * device gets force-disconnected from it, live location data is
 * deleted, and the graceful "thanks for riding" screen is shown.
 * Placeholder value, change this single number to retune it, nothing
 * else needs to change.
 *
 * Used by the scheduled retention-cleanup job
 * (.github/workflows/data-retention.yml) as its cutoff for deleting
 * `ride_participants` rows. That workflow can't import a TypeScript
 * file, so its own `RETENTION_MINUTES` is a hand-kept copy of this
 * number, if you change this, update that workflow's copy too.
 */
export const POST_RIDE_DISCONNECT_MINUTES = 20;

/**
 * Same idea as POST_RIDE_DISCONNECT_MINUTES above, but for an admin's
 * own device, if an admin is also riding (and so also being tracked
 * as a participant like anyone else, separate from their logged-in
 * admin session used for ride management). A separate, longer default
 * since an admin may still be wrapping up ride-closing tasks
 * (confirming everyone's accounted for, handling a straggler) after
 * the ride officially ends, when a regular rider's tracking has
 * already stopped.
 */
export const POST_RIDE_ADMIN_DISCONNECT_MINUTES = 45;

/**
 * How many minutes a participant's position must stay essentially
 * unchanged (see STUCK_DETECTION_MAX_DISTANCE_METERS below for what
 * "unchanged" means) before they're flagged to admins as possibly
 * stuck/broken down, rather than just stopped for a normal break.
 * Placeholder value, deliberately generous to avoid false alarms over
 * a genuine rest stop, tune based on real-world testing.
 */
export const STUCK_DETECTION_WINDOW_MINUTES = 15;

/**
 * How far (in meters) a participant must move to count as "still
 * moving" for the stuck-detection check above. Set above typical GPS
 * jitter (a stationary phone's GPS reading can drift a few meters on
 * its own) so standing still doesn't falsely register as movement.
 */
export const STUCK_DETECTION_MAX_DISTANCE_METERS = 30;

/**
 * How often (in seconds) a rider's position gets persisted into
 * `ride_history_samples` for later export (GPX/CSV), deliberately
 * decoupled from the live poll interval, which can be much shorter
 * (e.g. every 5-15s). Sampling on every single live poll would grow
 * storage fast at real scale (hundreds of riders over a multi-hour
 * ride), sampling on a slower fixed cadence instead keeps a ride's
 * full route shape while bounding row count. Tune this number if
 * exported routes look too coarse or storage grows faster than
 * expected.
 */
export const HISTORY_SAMPLE_INTERVAL_SECONDS = 60;
