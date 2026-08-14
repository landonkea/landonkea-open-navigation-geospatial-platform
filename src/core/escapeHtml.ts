// ── Shared HTML-escaping helper ──────────────────────────────────────
// WHAT: pulled out of admin.ts (originally written for ride names,
// see bug #15 in OPERATIONS.md, a stored-XSS gap from an unescaped
// ride name) so status.ts's public, no-login page can reuse the exact
// same escaping instead of interpolating unescaped text into innerHTML
// a second time in a second place.

/**
 * Escapes a plain string for safe insertion into innerHTML. Needed
 * anywhere a value not fully under this app's own control gets shown
 * (an admin-entered ride name, an upstream error message) without
 * this, a string like "<img src=x onerror=alert(1)>" would actually
 * execute wherever it's shown (stored/reflected XSS). textContent
 * itself auto-escapes, this just borrows that behavior via a scratch
 * element rather than reimplementing HTML-escaping by hand.
 */
export function escapeHtml(value: string): string {
  const scratch = document.createElement("div");
  scratch.textContent = value;
  return scratch.innerHTML;
}
