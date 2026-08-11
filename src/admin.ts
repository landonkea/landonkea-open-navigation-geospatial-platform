// ── Admin app entry point ────────────────────────────────────────────
// A separate small page from the rider-facing app (index.html/main.ts),
// admins are a genuinely different audience doing a different job
// (build prompt's "Admin accounts vs. marshals" section), a login
// screen and a ride-creation form, not a live map. Kept as plain DOM
// manipulation, no framework, same as main.ts, this is a handful of
// screens, not enough complexity to justify one.

import { signInAdmin, isGrantedAdmin, createRide, createRoute, type Ride } from "./core/adapters/supabase";
import { parseGpx } from "./core/gpx";
import QRCode from "qrcode";

const root = document.getElementById("admin-root") as HTMLDivElement; // the one mount point from admin.html

/**
 * Sets the page title and minimal layout styling, same "owned by
 * TypeScript, not hardcoded HTML/CSS" pattern as main.ts's
 * applyBaseStyles().
 */
function applyBaseStyles(): void {
  document.title = "admin"; // simple, this page is never shown to regular riders

  const style = document.createElement("style");
  style.textContent = `
    body { margin: 0; font-family: system-ui, sans-serif; background: #f5f5f5; }
    #admin-root { max-width: 420px; margin: 40px auto; padding: 24px; background: white; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.15); }
    input { display: block; width: 100%; box-sizing: border-box; padding: 8px; margin: 6px 0 14px; font-size: 16px; }
    button { padding: 10px 16px; font-size: 16px; background: #1f6feb; color: white; border: none; border-radius: 4px; cursor: pointer; }
    .error { color: #c62828; font-size: 14px; }
    .ride-link { word-break: break-all; background: #f0f0f0; padding: 8px; border-radius: 4px; font-family: monospace; }
  `;
  document.head.appendChild(style);
}

/**
 * Renders the sign-in form and wires up its submit handler. On a
 * successful sign-in that's ALSO a granted admin (two separate
 * checks, see isGrantedAdmin's docs), moves on to renderCreateRide().
 * On success-but-not-a-granted-admin, shows a clear message rather
 * than silently letting a non-admin account in.
 */
function renderSignIn(): void {
  root.innerHTML = `
    <h2>Admin sign in</h2>
    <form id="signin-form">
      <label>Email<input type="email" id="email" required /></label>
      <label>Password<input type="password" id="password" required /></label>
      <button type="submit">Sign in</button>
      <p class="error" id="signin-error"></p>
    </form>
  `;

  const form = document.getElementById("signin-form") as HTMLFormElement;
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); // stop the browser's default full-page-reload form submission
    const email = (document.getElementById("email") as HTMLInputElement).value;
    const password = (document.getElementById("password") as HTMLInputElement).value;
    const errorEl = document.getElementById("signin-error") as HTMLParagraphElement;

    try {
      const userId = await signInAdmin(email, password); // real Supabase Auth sign-in
      const granted = await isGrantedAdmin(userId); // separate check: logged in ≠ actually an admin
      if (!granted) {
        errorEl.textContent = "This account isn't on the admin list, ask an existing admin to grant access.";
        return;
      }
      renderCreateRide(userId); // success on both checks, move to the actual admin screen
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : String(err);
    }
  });
}

/**
 * Renders the "create a ride" form for a confirmed, signed-in admin,
 * and shows the resulting join link + a GPX route upload once a ride
 * is created.
 */
function renderCreateRide(adminUserId: string): void {
  root.innerHTML = `
    <h2>Create a ride</h2>
    <form id="create-ride-form">
      <label>Ride name<input type="text" id="ride-name" required placeholder="Saturday Morning Loop" /></label>
      <button type="submit">Create ride</button>
      <p class="error" id="create-error"></p>
    </form>
    <div id="created-ride"></div>
  `;

  const form = document.getElementById("create-ride-form") as HTMLFormElement;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nameInput = document.getElementById("ride-name") as HTMLInputElement;
    const errorEl = document.getElementById("create-error") as HTMLParagraphElement;
    const resultEl = document.getElementById("created-ride") as HTMLDivElement;

    try {
      const ride: Ride = await createRide(nameInput.value, adminUserId); // real insert into `rides`, this also generates ride.slug (see rideSlug.ts)
      // Short, date-based link (e.g. "site.com/08112026") instead of
      // the long uuid-based one, see rideSlug.ts's module docstring
      // for the guessability tradeoff this accepts on purpose.
      const joinUrl = `${window.location.origin}/${ride.slug}`;
      resultEl.innerHTML = `
        <p>Ride created: <strong>${ride.name}</strong></p>
        <p>Share this link, or have riders scan the QR code:</p>
        <p class="ride-link">${joinUrl}</p>
      `;
      // Renders a scannable QR code for the same link, printable or
      // shown on a screen at the ride's start. Note: this is the
      // current per-ride link format (a fresh short link every ride),
      // NOT the permanent single-QR option discussed separately, that
      // decision is still open, see this repo's conversation history.
      const canvas = document.createElement("canvas");
      resultEl.appendChild(canvas);
      await QRCode.toCanvas(canvas, joinUrl, { width: 220 });
      nameInput.value = ""; // clear the field so creating another ride starts fresh

      renderRouteUpload(resultEl, ride.id); // let the admin optionally add a GPX route right after creating the ride
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : String(err);
    }
  });
}

/**
 * Renders a GPX file upload control under a just-created ride, parses
 * the file entirely in the browser (see core/gpx.ts, no server-side
 * processing needed for plain XML) and saves the result as that
 * ride's route. Optional, a ride with no route uploaded is a valid
 * "no fixed route" ride (build prompt's own supported case).
 *
 * @param container - where to render the upload control.
 * @param rideId - which ride this route belongs to.
 */
function renderRouteUpload(container: HTMLElement, rideId: string): void {
  const section = document.createElement("div");
  section.innerHTML = `
    <p style="margin-top: 20px;">Optional: upload a GPX route file</p>
    <input type="file" id="gpx-file" accept=".gpx" />
    <p class="error" id="gpx-error"></p>
    <p id="gpx-success" style="color: #2e7d32;"></p>
  `;
  container.appendChild(section);

  const fileInput = document.getElementById("gpx-file") as HTMLInputElement;
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return; // the picker was opened and cancelled, nothing to do

    const errorEl = document.getElementById("gpx-error") as HTMLParagraphElement;
    const successEl = document.getElementById("gpx-success") as HTMLParagraphElement;
    errorEl.textContent = "";
    successEl.textContent = "";

    try {
      const text = await file.text(); // read the uploaded file's raw contents
      const geojson = parseGpx(text); // throws a plain-language error on a genuinely malformed file, see gpx.ts
      await createRoute(rideId, geojson); // saves it, the rider-facing map fetches this automatically (see main.ts)
      const waypointCount = geojson.features.filter((f) => f.properties?.kind === "waypoint").length;
      successEl.textContent = `Route saved${waypointCount > 0 ? ` (${waypointCount} waypoint${waypointCount === 1 ? "" : "s"})` : ""}.`;
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : String(err);
    }
  });
}

applyBaseStyles();
renderSignIn(); // every visit starts at sign-in, no "remember me" session persistence built yet
