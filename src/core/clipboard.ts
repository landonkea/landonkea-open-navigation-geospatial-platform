// ── Shared "copy to clipboard, show brief feedback" behavior ────────
// WHAT: the copy-link-with-"Copied!"-feedback pattern used by both
// main.ts's share button (clipboard fallback when the Web Share API
// isn't available) and admin.ts's "Copy Link" button. Pulled out here
// after code review flagged the two as near-identical duplicates that
// would be easy to fix in only one place by accident.

/**
 * Copies text to the clipboard and briefly changes a button's label to
 * confirm it worked, reverting after 2 seconds. Failures (e.g. a
 * browser blocking clipboard access) are logged, not thrown, a failed
 * copy shouldn't crash anything else on the page.
 *
 * @param button - the button that triggered the copy, its label is
 *   what changes.
 * @param text - the text to copy.
 * @param idleLabel - the label to restore after the "Copied!" flash.
 */
export async function copyToClipboardWithFeedback(
  button: HTMLButtonElement,
  text: string,
  idleLabel: string,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied!";
    setTimeout(() => {
      button.textContent = idleLabel;
    }, 2000);
  } catch (err) {
    console.error("Clipboard copy failed:", err);
  }
}
