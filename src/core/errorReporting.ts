// ── Client-side error reporting ──────────────────────────────────────
// WHAT: an uncaught exception or unhandled promise rejection on a
// rider's phone was previously invisible, nobody (not even the rider,
// usually) would ever know it happened. This wires window.onerror and
// unhandledrejection to reportClientError() (see adapters/supabase.ts),
// giving admins real visibility into rider-side crashes without
// needing a rider to notice and report one manually.

import { reportClientError } from "./adapters/supabase";

// Matches the check constraints in the client_errors migration, kept
// in sync here by hand (same reasoning as policy.ts's constants that
// mirror a DB-side value): truncate before sending rather than let a
// long message/stack silently fail the insert entirely.
const MAX_MESSAGE_LENGTH = 500;
const MAX_STACK_LENGTH = 2000;
const MAX_URL_LENGTH = 500;
const MAX_USER_AGENT_LENGTH = 300;

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/**
 * Starts listening for uncaught errors/rejections and reports each one
 * (best-effort, never blocks/throws itself, see reportClientError()'s
 * docs). Call once, early, in an app entry point (main.ts).
 */
export function setUpErrorReporting(): void {
  window.addEventListener("error", (event) => {
    void reportClientError(
      truncate(event.message || "Unknown error", MAX_MESSAGE_LENGTH),
      event.error?.stack ? truncate(String(event.error.stack), MAX_STACK_LENGTH) : null,
      truncate(window.location.href, MAX_URL_LENGTH),
      truncate(navigator.userAgent, MAX_USER_AGENT_LENGTH),
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error && reason.stack ? reason.stack : null;
    void reportClientError(
      truncate(`Unhandled rejection: ${message}`, MAX_MESSAGE_LENGTH),
      stack ? truncate(stack, MAX_STACK_LENGTH) : null,
      truncate(window.location.href, MAX_URL_LENGTH),
      truncate(navigator.userAgent, MAX_USER_AGENT_LENGTH),
    );
  });
}
