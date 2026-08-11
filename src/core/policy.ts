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
 * Not wired into real disconnect/deletion logic yet, that's a
 * not-yet-built piece (see workingTitle-BUILD-PROMPT.md's Data
 * Retention and Ride Lifecycle sections), this constant exists now so
 * that logic, when built, reads from here instead of a hardcoded
 * number.
 */
export const POST_RIDE_DISCONNECT_MINUTES = 20;
