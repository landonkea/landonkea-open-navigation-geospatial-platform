// ── Shared word-capitalization helper ────────────────────────────────
// WHAT: pulled out of status.ts (found duplicated a second time,
// hand-rolled, in admin.ts's recap card, see code review) so both
// files capitalize a bikeTheme word (e.g. "rider" -> "Rider") the same
// way instead of two independent implementations that could drift.

/** Capitalizes a word's first letter, leaves the rest untouched. */
export function capitalize(word: string): string {
  return word[0].toUpperCase() + word.slice(1);
}
