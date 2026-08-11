// ── Admin app entry point ────────────────────────────────────────────
// A separate small page from the rider-facing app (index.html/main.ts),
// admins are a genuinely different audience doing a different job
// (build prompt's "Admin accounts vs. marshals" section), a login
// screen and a ride-creation form, not a live map. Kept as plain DOM
// manipulation, no framework, same as main.ts, this is a handful of
// screens, not enough complexity to justify one.

import {
  signInAdmin,
  isGrantedAdmin,
  createRide,
  createRoute,
  endRide,
  startRide,
  fetchAllRides,
  fetchHistorySamples,
  fetchParticipants,
  updateParticipantTag,
  fetchFeedback,
  type Ride,
} from "./core/adapters/supabase";
import { parseGpx } from "./core/gpx";
import { createMap, setRouteLayer } from "./core/map";
import { samplesToCsv, samplesToGpx } from "./core/rideExport";
import { bikeTheme } from "./theme/bike/config";
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
 * Escapes a plain string for safe insertion into innerHTML. Needed
 * anywhere a user-entered value (a ride name, admin-chosen) gets
 * shown, without this an admin could name a ride
 * "<img src=x onerror=alert(1)>" and have it actually execute in
 * every admin's browser who later views it (stored XSS), textContent
 * itself auto-escapes, this just borrows that behavior via a scratch
 * element rather than reimplementing HTML-escaping by hand.
 */
function escapeHtml(value: string): string {
  const scratch = document.createElement("div");
  scratch.textContent = value;
  return scratch.innerHTML;
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
    <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;" />
    <div id="ride-list"></div>
  `;

  // Admin-only ride browsing (fetchAllRides()'s docs explain why this
  // is gated here, in the UI layer, rather than at the database
  // level). Loaded once now, and refreshed after creating a new ride
  // below, so a fresh admin session isn't stuck only ever managing the
  // one ride created in it.
  const rideListContainer = document.getElementById("ride-list") as HTMLDivElement;
  loadAndRenderRideList(rideListContainer);

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
        <p>Ride created: <strong>${escapeHtml(ride.name)}</strong></p>
        <p>Riders can't join until you click "Start Ride" below, even with the link.</p>
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
      renderRouteDrawer(resultEl, ride.id); // alternative to GPX upload: click-to-draw a route directly on the map
      renderStartRideButton(resultEl, ride.id); // explicit lifecycle control: a ride starts "created", riders can't join until this is clicked
      renderEndRideButton(resultEl, ride.id); // explicit lifecycle control, build prompt's "Ride lifecycle" section
      renderExportButtons(resultEl, ride); // build prompt's "Ride data export" section
      loadAndRenderRideList(rideListContainer); // refresh so the just-created ride shows up in the list below immediately
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : String(err);
    }
  });
}

/**
 * Loads every ride and renders each as a row in the given container,
 * with inline "End Ride" / "Export GPX" / "Export CSV" actions. Kept
 * separate from renderCreateRide() itself so it can be called again
 * standalone (e.g. right after creating a new ride, to refresh).
 *
 * @param container - where to render the list, replaces its contents.
 */
async function loadAndRenderRideList(container: HTMLDivElement): Promise<void> {
  container.innerHTML = "<p>Loading rides…</p>";
  try {
    const rides = await fetchAllRides();
    container.innerHTML = "<h3>Existing rides</h3>";
    if (rides.length === 0) {
      container.innerHTML += "<p>No rides yet.</p>";
      return;
    }
    for (const ride of rides) {
      container.appendChild(buildRideListItem(ride));
    }
  } catch (err) {
    container.innerHTML = `<p class="error">${escapeHtml(err instanceof Error ? err.message : String(err))}</p>`;
  }
}

/**
 * Builds one ride's row for the ride list: name, status, join link,
 * and inline management actions. Built with document.createElement +
 * direct event listener references throughout, deliberately NOT
 * document.getElementById by id string (unlike renderEndRideButton/
 * renderExportButtons above, which only ever render once per page):
 * this function runs once per ride in a list of many, ids would
 * collide and every button would end up wired to whichever ride's
 * element the id happened to match first.
 *
 * @param ride - the ride this row represents.
 */
function buildRideListItem(ride: Ride): HTMLElement {
  const joinUrl = ride.slug
    ? `${window.location.origin}/${ride.slug}`
    : `${window.location.origin}/?ride=${ride.id}`; // pre-slug rides (see Ride type's docs), old-style link still works
  const statusLabel = ride.status === "active" ? "Active" : ride.status === "ended" ? "Ended" : "Created";

  const item = document.createElement("div");
  item.style.cssText = "border-top: 1px solid #eee; padding: 10px 0;";
  item.innerHTML = `
    <p><strong>${escapeHtml(ride.name)}</strong> — ${statusLabel}</p>
    <p class="ride-link" style="font-size: 12px;">${joinUrl}</p>
  `;

  const actions = document.createElement("div");
  actions.style.cssText = "display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px;";
  item.appendChild(actions);

  const errorEl = document.createElement("p");
  errorEl.className = "error";
  const showItemError = (err: unknown): void => {
    errorEl.textContent = err instanceof Error ? err.message : String(err);
  };

  if (ride.status === "created") {
    const startButton = document.createElement("button");
    startButton.textContent = "Start Ride";
    startButton.style.background = "#2e7d32";
    startButton.addEventListener("click", async () => {
      startButton.disabled = true;
      try {
        await startRide(ride.id);
        startButton.textContent = "Started";
      } catch (err) {
        showItemError(err);
        startButton.disabled = false; // let them retry if it failed
      }
    });
    actions.appendChild(startButton);
  }

  if (ride.status !== "ended") {
    const endButton = document.createElement("button");
    endButton.textContent = "End Ride";
    endButton.style.background = "#c62828";
    endButton.addEventListener("click", async () => {
      endButton.disabled = true;
      try {
        await endRide(ride.id);
        endButton.textContent = "Ended";
      } catch (err) {
        showItemError(err);
        endButton.disabled = false; // let them retry if it failed
      }
    });
    actions.appendChild(endButton);
  }

  const safeFileNamePart = ride.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  const gpxButton = document.createElement("button");
  gpxButton.textContent = "Export GPX";
  gpxButton.style.background = "#555";
  gpxButton.addEventListener("click", async () => {
    try {
      const samples = await fetchHistorySamples(ride.id);
      downloadTextFile(`${safeFileNamePart}.gpx`, samplesToGpx(ride.name, samples), "application/gpx+xml");
    } catch (err) {
      showItemError(err);
    }
  });
  actions.appendChild(gpxButton);

  const csvButton = document.createElement("button");
  csvButton.textContent = "Export CSV";
  csvButton.style.background = "#555";
  csvButton.addEventListener("click", async () => {
    try {
      const samples = await fetchHistorySamples(ride.id);
      downloadTextFile(`${safeFileNamePart}.csv`, samplesToCsv(samples), "text/csv");
    } catch (err) {
      showItemError(err);
    }
  });
  actions.appendChild(csvButton);

  const participantsButton = document.createElement("button");
  participantsButton.textContent = "Manage participants";
  participantsButton.style.background = "#555";
  actions.appendChild(participantsButton);

  // Lazily loaded: no point fetching every ride's participants up
  // front just to render a list of ride rows, only fetch once this
  // specific ride's button is actually clicked, and toggle
  // open/closed on repeat clicks rather than re-fetching every time.
  const participantsSection = document.createElement("div");
  participantsSection.style.cssText = "margin-top: 8px;";
  item.appendChild(participantsSection);
  let participantsLoaded = false;

  participantsButton.addEventListener("click", async () => {
    if (participantsSection.innerHTML !== "") {
      participantsSection.innerHTML = ""; // already open, second click just closes it
      participantsLoaded = false;
      return;
    }
    if (participantsLoaded) return; // a fetch is already in flight, ignore a double-click
    participantsLoaded = true;
    participantsSection.innerHTML = "<p>Loading participants…</p>";
    try {
      const participants = await fetchParticipants(ride.id);
      participantsSection.innerHTML = "";
      if (participants.length === 0) {
        participantsSection.innerHTML = "<p>No one has joined yet.</p>";
        return;
      }
      for (const participant of participants) {
        participantsSection.appendChild(buildParticipantTagRow(participant.id, participant.tag, participant.is_spectator));
      }
    } catch (err) {
      participantsSection.innerHTML = "";
      showItemError(err);
    }
  });

  const feedbackButton = document.createElement("button");
  feedbackButton.textContent = "View Feedback";
  feedbackButton.style.background = "#555";
  actions.appendChild(feedbackButton);

  // Same lazy load-once-then-toggle pattern as participants above.
  const feedbackSection = document.createElement("div");
  feedbackSection.style.cssText = "margin-top: 8px;";
  item.appendChild(feedbackSection);
  let feedbackLoaded = false;

  feedbackButton.addEventListener("click", async () => {
    if (feedbackSection.innerHTML !== "") {
      feedbackSection.innerHTML = "";
      feedbackLoaded = false;
      return;
    }
    if (feedbackLoaded) return;
    feedbackLoaded = true;
    feedbackSection.innerHTML = "<p>Loading feedback…</p>";
    try {
      const submissions = await fetchFeedback(ride.id);
      if (submissions.length === 0) {
        feedbackSection.innerHTML = "<p>No feedback submitted yet.</p>";
        return;
      }
      feedbackSection.innerHTML = submissions
        .map(
          (f) =>
            `<p style="border-top: 1px solid #eee; padding-top: 4px; margin-top: 4px; font-size: 14px;">${escapeHtml(f.message)}</p>`,
        )
        .join("");
    } catch (err) {
      feedbackSection.innerHTML = "";
      showItemError(err);
    }
  });

  item.appendChild(errorEl);
  return item;
}

/**
 * Builds one row of the participant tag-reassignment list: which
 * device this is (a truncated id, there's no name field on a
 * participant, see the schema), whether they're a spectator, and a
 * dropdown to change/clear their tag. This is the admin-side
 * counterpart to showTagPicker()'s rider-side self-select in main.ts,
 * for correcting or assigning a tag after the fact (e.g. a marshal
 * who forgot to self-select when they joined).
 *
 * @param participantId - which participant this row is for.
 * @param currentTag - their current tag id, or null.
 * @param isSpectator - shown as a small label, purely informational.
 */
function buildParticipantTagRow(participantId: string, currentTag: string | null, isSpectator: boolean): HTMLElement {
  const row = document.createElement("div");
  row.style.cssText = "display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 14px;";

  const label = document.createElement("span");
  label.textContent = `${participantId.slice(0, 8)}… ${isSpectator ? "(spectator)" : "(rider)"}`;
  row.appendChild(label);

  const select = document.createElement("select");
  const noneOption = document.createElement("option");
  noneOption.value = "";
  noneOption.textContent = "No tag";
  select.appendChild(noneOption);
  for (const tag of bikeTheme.tags) {
    const option = document.createElement("option");
    option.value = tag.id;
    option.textContent = `${tag.icon} ${tag.label}`;
    select.appendChild(option);
  }
  select.value = currentTag ?? "";
  row.appendChild(select);

  const statusEl = document.createElement("span");
  statusEl.style.cssText = "color: #2e7d32; font-size: 12px;";
  row.appendChild(statusEl);

  select.addEventListener("change", async () => {
    statusEl.textContent = "";
    try {
      await updateParticipantTag(participantId, select.value || null);
      statusEl.textContent = "Saved";
    } catch (err) {
      statusEl.textContent = err instanceof Error ? err.message : String(err);
      statusEl.style.color = "#c62828";
    }
  });

  return row;
}

/**
 * Renders an explicit "Start Ride" button under a just-created ride.
 * createRide() now leaves a new ride in the "created" state (the
 * schema's own default, previously always overridden to jump straight
 * to "active"), riders can't actually join until this flips it to
 * "active" (the "anyone can join an active ride" RLS policy on
 * ride_participants requires it, see startRide()'s docs), giving an
 * admin a real moment to double check the route/name before anyone
 * can show up on the map. Symmetric with renderEndRideButton() below.
 *
 * @param container - where to render the button.
 * @param rideId - which ride this starts.
 */
function renderStartRideButton(container: HTMLElement, rideId: string): void {
  const section = document.createElement("div");
  section.innerHTML = `
    <button id="start-ride-button" style="background: #2e7d32; margin-top: 20px;">Start Ride</button>
    <p class="error" id="start-ride-error"></p>
    <p id="start-ride-success" style="color: #2e7d32;"></p>
  `;
  container.appendChild(section);

  const button = document.getElementById("start-ride-button") as HTMLButtonElement;
  button.addEventListener("click", async () => {
    const errorEl = document.getElementById("start-ride-error") as HTMLParagraphElement;
    const successEl = document.getElementById("start-ride-success") as HTMLParagraphElement;
    button.disabled = true;
    try {
      await startRide(rideId);
      successEl.textContent = "Ride started. Riders can now join using the link/QR code above.";
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : String(err);
      button.disabled = false; // let them retry if it failed
    }
  });
}

/**
 * Renders an explicit "End Ride" button under a just-created ride.
 * Build prompt's "Ride lifecycle" section: ending a ride "stops new
 * broadcasts" (see sync.ts's pollOnce(), which checks ride status on
 * every poll and stops itself once it sees 'ended') "and triggers the
 * 20-minute countdown to delete live data" (that deletion job itself
 * isn't built yet, see OPERATIONS.md's Phase 5 notes).
 *
 * @param container - where to render the button.
 * @param rideId - which ride this ends.
 */
function renderEndRideButton(container: HTMLElement, rideId: string): void {
  const section = document.createElement("div");
  section.innerHTML = `
    <button id="end-ride-button" style="background: #c62828; margin-top: 20px;">End Ride</button>
    <p class="error" id="end-ride-error"></p>
    <p id="end-ride-success" style="color: #2e7d32;"></p>
  `;
  container.appendChild(section);

  const button = document.getElementById("end-ride-button") as HTMLButtonElement;
  button.addEventListener("click", async () => {
    const errorEl = document.getElementById("end-ride-error") as HTMLParagraphElement;
    const successEl = document.getElementById("end-ride-success") as HTMLParagraphElement;
    button.disabled = true;
    try {
      await endRide(rideId);
      successEl.textContent = "Ride ended. Riders' apps will stop sharing location on their next check-in.";
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : String(err);
      button.disabled = false; // let them retry if it failed
    }
  });
}

/**
 * Triggers a browser download of plain text content as a file,
 * without ever needing a server round trip, the file exists only in
 * the browser's memory (a Blob) and is handed straight to the user.
 * Small and generic on purpose, both GPX and CSV exports below reuse
 * this exact same mechanic, only the content/filename/mime type
 * differ.
 *
 * @param filename - the name the downloaded file gets.
 * @param content - the file's full text content.
 * @param mimeType - e.g. "application/gpx+xml" or "text/csv".
 */
function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url); // release the in-memory file now that the download has started
}

/**
 * Renders "Export as GPX" / "Export as CSV" buttons under a
 * just-created ride. Build prompt's "Ride data export" section, pulls
 * every recorded src/core/sync.ts history sample for this ride (see
 * fetchHistorySamples()) and reshapes it client-side
 * (src/core/rideExport.ts), no server/export endpoint needed. Works
 * for a ride that's still active too (exports whatever's been
 * recorded so far), not just an ended one.
 *
 * @param container - where to render the buttons.
 * @param ride - the ride to export (needs both its id, for the query,
 *   and its name, used as the exported file's display name/filename).
 */
function renderExportButtons(container: HTMLElement, ride: Ride): void {
  const section = document.createElement("div");
  section.innerHTML = `
    <p style="margin-top: 20px;">Export recorded route data</p>
    <button id="export-gpx-button" style="background: #555; margin-right: 8px;">Export GPX</button>
    <button id="export-csv-button" style="background: #555;">Export CSV</button>
    <p class="error" id="export-error"></p>
  `;
  container.appendChild(section);

  const errorEl = document.getElementById("export-error") as HTMLParagraphElement;
  const safeFileNamePart = ride.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase(); // strip anything that isn't filename-safe

  const gpxButton = document.getElementById("export-gpx-button") as HTMLButtonElement;
  gpxButton.addEventListener("click", async () => {
    try {
      const samples = await fetchHistorySamples(ride.id);
      downloadTextFile(`${safeFileNamePart}.gpx`, samplesToGpx(ride.name, samples), "application/gpx+xml");
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : String(err);
    }
  });

  const csvButton = document.getElementById("export-csv-button") as HTMLButtonElement;
  csvButton.addEventListener("click", async () => {
    try {
      const samples = await fetchHistorySamples(ride.id);
      downloadTextFile(`${safeFileNamePart}.csv`, samplesToCsv(samples), "text/csv");
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
      await createRoute(rideId, geojson, "gpx"); // saves it, the rider-facing map fetches this automatically (see main.ts)
      const waypointCount = geojson.features.filter((f) => f.properties?.kind === "waypoint").length;
      successEl.textContent = `Route saved${waypointCount > 0 ? ` (${waypointCount} waypoint${waypointCount === 1 ? "" : "s"})` : ""}.`;
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : String(err);
    }
  });
}

/**
 * Renders a "draw your own route" control under a just-created ride,
 * an alternative to GPX upload (renderRouteUpload() above) for a ride
 * with no existing GPX file to upload, e.g. sketching a route
 * directly from local knowledge of the roads/trails. Reuses the exact
 * same rider-facing map building blocks (core/map.ts) so what the
 * admin sees while drawing looks the same as what riders will
 * eventually see.
 *
 * Each click on the map adds one point; the line and small preview
 * dots redraw live after every click (setRouteLayer() already
 * supports being called repeatedly, see its docs), a separate
 * "Save drawn route" step then persists it, so an admin can freely
 * undo/clear/re-click before committing to anything.
 *
 * @param container - where to render the control.
 * @param rideId - which ride this route belongs to.
 */
function renderRouteDrawer(container: HTMLElement, rideId: string): void {
  const section = document.createElement("div");
  section.innerHTML = `
    <p style="margin-top: 20px;">Or draw a route: click the map to add points</p>
    <div id="route-draw-map" style="position: relative; width: 100%; height: 300px; overflow: hidden; border-radius: 4px;"></div>
    <div style="display: flex; gap: 8px; margin-top: 8px;">
      <button type="button" id="route-draw-undo" style="background: #555;">Undo last point</button>
      <button type="button" id="route-draw-clear" style="background: #555;">Clear</button>
      <button type="button" id="route-draw-save">Save drawn route</button>
    </div>
    <p class="error" id="route-draw-error"></p>
    <p id="route-draw-success" style="color: #2e7d32;"></p>
  `;
  container.appendChild(section);

  const errorEl = document.getElementById("route-draw-error") as HTMLParagraphElement;
  const successEl = document.getElementById("route-draw-success") as HTMLParagraphElement;

  // Every clicked point, in click order, the only state this control
  // needs to track, everything drawn on the map is rebuilt from this
  // array on every change rather than mutated in place.
  let points: { lat: number; lng: number }[] = [];

  const map = createMap("route-draw-map", bikeTheme.defaultMapCenter, bikeTheme.defaultMapZoom);

  /**
   * Rebuilds and redraws the live preview from the current `points`
   * array: the connecting line (needs at least 2 points to exist at
   * all) plus a small dot at every clicked point so a single click
   * still gives visible feedback before a second point makes a line
   * possible. Reuses the "waypoint" style purely for this visual
   * feedback, these dots are NOT saved as real named waypoints, see
   * buildFinalRouteGeoJson() below for what actually gets saved.
   */
  function redrawPreview(): void {
    const features: GeoJSON.Feature[] = points.map((p) => ({
      type: "Feature",
      properties: { kind: "waypoint", name: null },
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
    }));
    if (points.length >= 2) {
      features.push({
        type: "Feature",
        properties: { kind: "route" },
        geometry: { type: "LineString", coordinates: points.map((p) => [p.lng, p.lat]) },
      });
    }
    setRouteLayer(map, { type: "FeatureCollection", features });
  }

  /** Builds the GeoJSON that actually gets saved: the line only, no per-click dots. */
  function buildFinalRouteGeoJson(): GeoJSON.FeatureCollection {
    return {
      type: "FeatureCollection",
      features:
        points.length >= 2
          ? [
              {
                type: "Feature",
                properties: { kind: "route" },
                geometry: { type: "LineString", coordinates: points.map((p) => [p.lng, p.lat]) },
              },
            ]
          : [],
    };
  }

  // Same real race condition already found and fixed in main.ts:
  // addSource()/addLayer() (inside setRouteLayer(), called from the
  // click handler below) only work once the map's style has actually
  // finished loading, so clicks are ignored until then rather than
  // risking that same silent failure here too.
  let mapReady = false;
  map.once("load", () => {
    mapReady = true;
  });

  map.on("click", (event) => {
    if (!mapReady) return;
    points.push({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    redrawPreview();
  });

  const undoButton = document.getElementById("route-draw-undo") as HTMLButtonElement;
  undoButton.addEventListener("click", () => {
    points.pop();
    redrawPreview();
  });

  const clearButton = document.getElementById("route-draw-clear") as HTMLButtonElement;
  clearButton.addEventListener("click", () => {
    points = [];
    redrawPreview();
  });

  const saveButton = document.getElementById("route-draw-save") as HTMLButtonElement;
  saveButton.addEventListener("click", async () => {
    errorEl.textContent = "";
    successEl.textContent = "";
    if (points.length < 2) {
      errorEl.textContent = "Click at least 2 points on the map to form a route line.";
      return;
    }
    try {
      await createRoute(rideId, buildFinalRouteGeoJson(), "drawn");
      successEl.textContent = "Drawn route saved.";
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : String(err);
    }
  });
}

applyBaseStyles();
renderSignIn(); // every visit starts at sign-in, no "remember me" session persistence built yet
