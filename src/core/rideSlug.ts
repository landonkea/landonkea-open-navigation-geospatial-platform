// ── Short, date-based ride link slugs ───────────────────────────────
// WHAT: turns a ride's creation date into a short, human-typeable
// link segment like "08112026" (month, day, 4-digit year, no
// separators), instead of a long UUID. See the migration that added
// the `slug` column (supabase/migrations/20260811020000_add_ride_slug.sql)
// for the honest privacy tradeoff this involves, a date is guessable,
// a UUID isn't.

/**
 * Builds the base slug (just the date part, no collision suffix yet)
 * for a given date, in MMDDYYYY format.
 *
 * @param date - defaults to right now, pass a specific date for tests
 *   or if a ride is being scheduled for a future/past date.
 * @returns an 8-character digit string, e.g. "08112026" for August
 *   11, 2026.
 */
export function baseSlugForDate(date: Date = new Date()): string {
  // getMonth() is 0-indexed (0 = January), so +1 to get the real
  // month number a human expects.
  const month = date.getMonth() + 1; // e.g. 8 for August
  const day = date.getDate(); // e.g. 11
  const year = date.getFullYear(); // e.g. 2026, already 4 digits

  // padStart(2, "0") turns "8" into "08" (always exactly 2 digits for
  // month/day, matching the requested "2 digit 2 digit 4 digit"
  // format).
  const monthStr = String(month).padStart(2, "0"); // "08"
  const dayStr = String(day).padStart(2, "0"); // "11"
  const yearStr = String(year); // "2026", already 4 digits, no padding needed

  return `${monthStr}${dayStr}${yearStr}`; // "08112026", no separators, matching the requested format
}

/**
 * Picks a real, unique slug for a brand-new ride, given the base date
 * slug and the set of slugs already in use (for handling the "two
 * rides created on the same day" case, see the build prompt's own
 * "occasionally same-day" note under Rides and routes).
 *
 * @param baseSlug - the plain date slug, e.g. "08112026".
 * @param existingSlugs - every slug already in the database (or at
 *   least every one that could collide), checked by the caller before
 *   calling this function.
 * @returns baseSlug itself if it's free, otherwise baseSlug with a
 *   "-2", "-3", etc. suffix, whichever is the first free one.
 */
export function pickUniqueSlug(baseSlug: string, existingSlugs: Set<string>): string {
  if (!existingSlugs.has(baseSlug)) return baseSlug; // the plain date works, most common case

  // Same-day collision: try "-2", "-3", and so on until a free one is
  // found. Starting at 2 (not 1) so the FIRST ride of the day keeps
  // the clean, no-suffix slug, only the second-and-later rides that
  // day get a suffix.
  let suffix = 2;
  while (existingSlugs.has(`${baseSlug}-${suffix}`)) {
    suffix += 1; // keep counting up until we find a slug nobody's using yet
  }
  return `${baseSlug}-${suffix}`;
}
