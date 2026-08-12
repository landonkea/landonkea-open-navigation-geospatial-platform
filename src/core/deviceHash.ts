// ── Device hash: a stable, human-showable label per physical device ──
// WHAT: purely a display convenience for the admin panel, so the same
// device shows the same short code across rides instead of a
// meaningless random participant id (see admin.ts's participant
// list). NOT an identity/security mechanism: joining/updating a
// position still goes through the real random participantId from
// src/core/participantId.ts, this hash is never checked by RLS or
// used to look anything up, only displayed.
export async function computeDeviceHash(): Promise<string> {
  const raw = [
    navigator.userAgent,
    screen.width,
    screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.language,
  ].join("|");

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 12); // short enough to show, long enough two different devices won't realistically collide
}
