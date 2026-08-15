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
  deleteRide,
  startRide,
  fetchAllRides,
  fetchHistorySamples,
  importHistorySamples,
  fetchParticipants,
  updateParticipantTag,
  leaveRide,
  fetchFeedback,
  fetchRouteForRide,
  fetchStatusSummary,
  type Ride,
} from "./core/adapters/supabase";
import { parseGpx, parseGpxTrackPoints } from "./core/gpx";
import { copyToClipboardWithFeedback } from "./core/clipboard";
import { escapeHtml } from "./core/escapeHtml";
import { parseHistoryCsv, parseRouteCsv } from "./core/csvImport";
import { createMap, setRouteLayer } from "./core/map";
import { samplesToCsv, samplesToGpx } from "./core/rideExport";
import { computeRideRecapStats, type RideRecapStats } from "./core/rideRecap";
import { formatDistance } from "./core/units";
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

  // Same sunburst-orange/light-yellow brand palette as the rider-
  // facing app (see main.ts's applyBaseStyles()), Start Ride/End Ride
  // deliberately kept green/red, real go/stop action colors, not part
  // of the brand restyle.
  const style = document.createElement("style");
  style.textContent = `
    body { margin: 0; font-family: system-ui, sans-serif; background: linear-gradient(135deg, #ffcc80, #ff9800); min-height: 100vh; }
    /* Semi-transparent with a blur behind it (a "frosted glass" look),
       so the orange gradient shows through instead of a flat opaque
       card, user's explicit request. The blur keeps text readable
       over the gradient rather than raw see-through text-on-text. */
    #admin-root { max-width: 420px; margin: 40px auto; padding: 24px; background: rgba(255, 255, 255, 0.75); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.15); }
    input, select { display: block; width: 100%; box-sizing: border-box; padding: 8px; margin: 6px 0 14px; font-size: 16px; background: rgba(255, 255, 255, 0.6); border: 1px solid rgba(0, 0, 0, 0.2); border-radius: 4px; }
    /* 0.9 alpha, not fully opaque, matches the same "everything but
       the actual page background gets some transparency" pass main.ts
       got, buttons stay a bit more solid than cards (0.75) since they
       need to stay clearly tappable. */
    button { padding: 10px 16px; font-size: 16px; background: linear-gradient(135deg, rgba(255,179,71,0.9), rgba(255,126,31,0.9)); color: white; border: none; border-radius: 4px; cursor: pointer; }
    .error { color: #c62828; font-size: 14px; }
    .ride-link { word-break: break-all; background: rgba(255,243,224,0.9); padding: 8px; border-radius: 4px; font-family: monospace; }
    #brand-logo { position: absolute; top: 12px; left: 12px; max-height: 32px; max-width: 140px; opacity: 0.8; pointer-events: none; }
  `;
  document.head.appendChild(style);
}

/**
 * Renders the client's logo, small and semi-transparent, in the
 * corner of the admin screen too, same idea and same theme source as
 * main.ts's setUpBrandLogo(), so a real client's logo shows up
 * consistently on both the rider-facing app and the admin panel from
 * one config change.
 */
function setUpBrandLogo(): void {
  if (!bikeTheme.logoUrl) return;
  const img = document.createElement("img");
  img.id = "brand-logo";
  img.src = `${import.meta.env.BASE_URL}${bikeTheme.logoUrl.replace(/^\//, "")}`;
  img.alt = "";
  document.body.appendChild(img);
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
    <div id="dashboard-cards" style="display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap;"></div>
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

  loadAndRenderDashboardCards(document.getElementById("dashboard-cards") as HTMLDivElement);

  // Admin-only ride browsing (fetchAllRides()'s docs explain why this
  // is gated here, in the UI layer, rather than at the database
  // level). Loaded once now, and refreshed after creating a new ride
  // below, so a fresh admin session isn't stuck only ever managing the
  // one ride created in it.
  const rideListContainer = document.getElementById("ride-list") as HTMLDivElement;
  loadAndRenderRideList(rideListContainer, adminUserId);

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

      // One-tap copy, small but removes real friction: without this an
      // admin has to select the plain-text link above by hand, easy to
      // mis-select on a phone screen while setting up a ride.
      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.textContent = "Copy Link";
      copyButton.addEventListener("click", async () => {
        await copyToClipboardWithFeedback(copyButton, joinUrl, "Copy Link");
      });
      resultEl.appendChild(copyButton);

      nameInput.value = ""; // clear the field so creating another ride starts fresh

      renderRouteUpload(resultEl, ride.id); // let the admin optionally add a GPX route right after creating the ride
      renderRouteDrawer(resultEl, ride.id); // alternative to GPX upload: click-to-draw a route directly on the map
      renderStartRideButton(resultEl, ride.id); // explicit lifecycle control: a ride starts "created", riders can't join until this is clicked
      renderEndRideButton(resultEl, ride.id); // explicit lifecycle control, build prompt's "Ride lifecycle" section
      renderExportButtons(resultEl, ride); // build prompt's "Ride data export" section
      loadAndRenderRideList(rideListContainer, adminUserId); // refresh so the just-created ride shows up in the list below immediately
      // NOT a dashboard-card refresh here: createRide() leaves a ride
      // in "created", not "active" (see startRide()'s docs), so this
      // moment can never actually change the active-ride/riders-online
      // counts, only Start Ride/End Ride can (see those handlers below).
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : String(err);
    }
  });
}

/**
 * Renders the "at a glance" summary cards at the top of the admin
 * screen (active ride count, riders currently online), the same
 * aggregate counts the public status page shows (see
 * fetchStatusSummary()'s docs), just with an admin-facing label.
 * Best-effort: a failure here shows a small inline error rather than
 * blocking the rest of the admin screen, this is a nice-to-have
 * summary, not something the ride-creation flow depends on.
 */
/**
 * Refreshes the dashboard cards by id, a convenience for the several
 * places that change the active-ride/riders-online counts (Start
 * Ride, End Ride) but don't otherwise have a reference to the cards
 * container. Silently does nothing if the element isn't on the page
 * (defensive only, it always is on the one screen these actions live on).
 */
function refreshDashboardCards(): void {
  const container = document.getElementById("dashboard-cards") as HTMLDivElement | null;
  if (container) loadAndRenderDashboardCards(container);
}

async function loadAndRenderDashboardCards(container: HTMLDivElement): Promise<void> {
  const cardStyle =
    "background: rgba(255,255,255,0.6); border-radius: 8px; padding: 12px 18px; min-width: 140px;";
  container.innerHTML = `<div style="${cardStyle}">Loading…</div>`;
  try {
    const summary = await fetchStatusSummary();
    container.innerHTML = `
      <div style="${cardStyle}"><div style="font-size: 24px; font-weight: bold;">${summary.activeRideCount}</div><div style="font-size: 12px; color: #555;">Active ${bikeTheme.eventWordPlural}</div></div>
      <div style="${cardStyle}"><div style="font-size: 24px; font-weight: bold;">${summary.ridersOnlineCount}</div><div style="font-size: 12px; color: #555;">${bikeTheme.participantWord}s online</div></div>
    `;
  } catch (err) {
    container.innerHTML = `<p class="error">${escapeHtml(err instanceof Error ? err.message : String(err))}</p>`;
  }
}

/**
 * Loads every ride and renders each as a row in the given container,
 * with inline "End Ride" / "Export GPX" / "Export CSV" actions. Kept
 * separate from renderCreateRide() itself so it can be called again
 * standalone (e.g. right after creating a new ride, to refresh).
 *
 * @param container - where to render the list, replaces its contents.
 * @param adminUserId - needed for the "Duplicate" action, which
 *   creates a new ride and so needs a creator id the same way the main
 *   create-ride form does.
 */
async function loadAndRenderRideList(container: HTMLDivElement, adminUserId: string): Promise<void> {
  container.innerHTML = "<p>Loading rides…</p>";
  try {
    const rides = await fetchAllRides();
    container.innerHTML = "<h3>Existing rides</h3>";
    if (rides.length === 0) {
      container.innerHTML += "<p>No rides yet.</p>";
      return;
    }
    for (const ride of rides) {
      container.appendChild(buildRideListItem(ride, adminUserId, (newRide) => onRideListChanged(container, adminUserId, newRide)));
    }
  } catch (err) {
    container.innerHTML = `<p class="error">${escapeHtml(err instanceof Error ? err.message : String(err))}</p>`;
  }
}

/**
 * Handles a ride-list row reporting a change. Two cases, on purpose
 * (found in review, the original version always did a full reload):
 * - `newRide` provided (currently only "Duplicate", see
 *   buildRideListItem()): the new row is inserted directly at the top
 *   instead of reloading the whole list, so every OTHER row's
 *   already-open "Manage participants"/"View Feedback" panel or an
 *   armed-but-not-yet-confirmed "Delete Ride" doesn't silently reset
 *   just because a sibling row changed.
 * - no `newRide`: falls back to a full reload (not currently used by
 *   any caller, kept as the safe default for a future action that
 *   genuinely needs one, e.g. a ride disappearing entirely).
 */
function onRideListChanged(container: HTMLDivElement, adminUserId: string, newRide?: Ride): void {
  if (!newRide) {
    loadAndRenderRideList(container, adminUserId);
    return;
  }
  const heading = container.querySelector("h3");
  const item = buildRideListItem(newRide, adminUserId, (r) => onRideListChanged(container, adminUserId, r));
  if (heading) heading.after(item);
  else container.prepend(item);
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
 * @param adminUserId - needed for the "Duplicate" action below.
 * @param onChanged - called after an action that changes the list
 *   itself (currently just "Duplicate"). Pass the newly-created ride
 *   when there is one, see onRideListChanged()'s docs for why: it lets
 *   the caller insert just the one new row instead of reloading (and
 *   thereby collapsing every other row's open panels/armed deletes).
 */
function buildRideListItem(ride: Ride, adminUserId: string, onChanged: (newRide?: Ride) => void): HTMLElement {
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
    startButton.style.background = "rgba(46,125,50,0.9)";
    startButton.addEventListener("click", async () => {
      startButton.disabled = true;
      try {
        await startRide(ride.id);
        startButton.textContent = "Started";
        refreshDashboardCards(); // starting a ride changes the "active rides" count
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
    endButton.style.background = "rgba(198,40,40,0.9)";
    endButton.addEventListener("click", async () => {
      endButton.disabled = true;
      try {
        await endRide(ride.id);
        endButton.textContent = "Ended";
        refreshDashboardCards(); // ending a ride changes both dashboard counts
      } catch (err) {
        showItemError(err);
        endButton.disabled = false; // let them retry if it failed
      }
    });
    actions.appendChild(endButton);
  }

  // Reuses a past ride's route (if it had one) under a new name/link,
  // real value for a recurring weekly meetup (this project's actual
  // first client, bikeMesa): no need to re-upload the same GPX file
  // or re-draw the same route every week. Creates a fresh ride in the
  // normal "created" state (an admin still has to click "Start Ride"),
  // never copies participants/history/feedback, those are specific to
  // the ride that happened, not the route/plan itself.
  const duplicateButton = document.createElement("button");
  duplicateButton.textContent = "Duplicate";
  duplicateButton.addEventListener("click", async () => {
    duplicateButton.disabled = true;
    duplicateButton.textContent = "Duplicating…";
    try {
      // Create the new ride FIRST and show it immediately (found in
      // review: running this concurrently with fetchRouteForRide via
      // Promise.all meant a route-fetch failure after the ride insert
      // had already succeeded left a real, invisible orphaned ride in
      // the database, only discoverable by inspecting it directly, no
      // onChanged() call ever ran since the whole Promise.all rejected).
      const newRide = await createRide(`${ride.name} (copy)`, adminUserId);
      onChanged(newRide);
      duplicateButton.disabled = false;
      duplicateButton.textContent = "Duplicate";

      // Copying the route is a separate, best-effort step now: if it
      // fails, the ride still exists and is already visible, this just
      // reports the partial failure instead of hiding the ride too.
      try {
        const route = await fetchRouteForRide(ride.id);
        if (route?.geojson && route.source !== "none") await createRoute(newRide.id, route.geojson, route.source);
      } catch (routeErr) {
        showItemError(
          `Ride duplicated, but couldn't copy its route: ${routeErr instanceof Error ? routeErr.message : String(routeErr)}`,
        );
      }
    } catch (err) {
      showItemError(err);
      duplicateButton.disabled = false;
      duplicateButton.textContent = "Duplicate";
    }
  });
  actions.appendChild(duplicateButton);

  const safeFileNamePart = ride.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  const gpxButton = document.createElement("button");
  gpxButton.textContent = "Export GPX";
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
  csvButton.addEventListener("click", async () => {
    try {
      const samples = await fetchHistorySamples(ride.id);
      downloadTextFile(`${safeFileNamePart}.csv`, samplesToCsv(samples), "text/csv");
    } catch (err) {
      showItemError(err);
    }
  });
  actions.appendChild(csvButton);

  const recapButton = document.createElement("button");
  recapButton.textContent = "Recap Card";
  recapButton.addEventListener("click", async () => {
    try {
      const samples = await fetchHistorySamples(ride.id);
      const stats = computeRideRecapStats(samples, ride.started_at, ride.ended_at);
      const canvas = drawRecapCard(ride.name, stats);
      downloadCanvasAsPng(canvas, `${safeFileNamePart}-recap.png`);
    } catch (err) {
      showItemError(err);
    }
  });
  actions.appendChild(recapButton);

  // Import: the inverse of the export buttons above, populates
  // ride_history_samples from an uploaded file instead of downloading
  // it, real use case is loading realistic pre-recorded test/demo
  // data (e.g. an exported Strava ride) to exercise the roster/map/
  // export features without needing live participants. Admin-only,
  // works regardless of the ride's status (see the "admins can import
  // history samples for any ride" RLS policy's docs).
  const importSection = document.createElement("div");
  importSection.style.cssText = "margin-top: 8px; font-size: 13px;";
  importSection.innerHTML = `
    <p style="margin: 4px 0;">Import history: <input type="file" id="import-gpx-${ride.id}" accept=".gpx" style="font-size: 12px;" /> (GPX)
    <input type="file" id="import-csv-${ride.id}" accept=".csv" style="font-size: 12px;" /> (CSV)</p>
    <p id="import-status-${ride.id}" style="color: #2e7d32; margin: 2px 0;"></p>
  `;
  item.appendChild(importSection);

  const importStatusEl = importSection.querySelector(`#import-status-${ride.id}`) as HTMLParagraphElement;

  const importGpxInput = importSection.querySelector(`#import-gpx-${ride.id}`) as HTMLInputElement;
  importGpxInput.addEventListener("change", async () => {
    const file = importGpxInput.files?.[0];
    if (!file) return;
    importStatusEl.textContent = "";
    try {
      const text = await file.text();
      const points = parseGpxTrackPoints(text);
      // One synthetic participant id for the whole file, a GPX track
      // represents one person's ride, unlike CSV import below, which
      // can represent several (see parseHistoryCsv()'s docs).
      const participantId = crypto.randomUUID();
      await importHistorySamples(
        ride.id,
        points.map((p) => ({ participantId, ...p })),
      );
      importStatusEl.textContent = `Imported ${points.length} points from GPX.`;
    } catch (err) {
      showItemError(err);
    } finally {
      importGpxInput.value = ""; // let the same file be re-selected/re-imported if needed
    }
  });

  const importCsvInput = importSection.querySelector(`#import-csv-${ride.id}`) as HTMLInputElement;
  importCsvInput.addEventListener("change", async () => {
    const file = importCsvInput.files?.[0];
    if (!file) return;
    importStatusEl.textContent = "";
    try {
      const text = await file.text();
      const samples = parseHistoryCsv(text);
      await importHistorySamples(ride.id, samples);
      importStatusEl.textContent = `Imported ${samples.length} points from CSV.`;
    } catch (err) {
      showItemError(err);
    } finally {
      importCsvInput.value = "";
    }
  });

  const participantsButton = document.createElement("button");
  participantsButton.textContent = "Manage participants";
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
        participantsSection.appendChild(
          buildParticipantTagRow(participant.id, participant.tag, participant.is_spectator, participant.device_hash),
        );
      }
    } catch (err) {
      participantsSection.innerHTML = "";
      showItemError(err);
    }
  });

  const feedbackButton = document.createElement("button");
  feedbackButton.textContent = "View Feedback";
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

  // Deliberately a two-click confirm built into the button itself
  // (first click turns it into "Confirm delete?", a second click
  // within a few seconds actually deletes), rather than a native
  // confirm() dialog, matching this app's existing no-native-dialogs
  // pattern elsewhere, while still guarding against an accidental
  // single click on something this irreversible (cascades to every
  // participant/route/history-sample/feedback row for this ride too).
  const deleteButton = document.createElement("button");
  deleteButton.textContent = "Delete Ride";
  deleteButton.style.background = "rgba(198,40,40,0.9)";
  actions.appendChild(deleteButton);

  let deleteArmed = false;
  let deleteArmedTimeout: ReturnType<typeof setTimeout> | null = null;
  deleteButton.addEventListener("click", async () => {
    if (!deleteArmed) {
      deleteArmed = true;
      deleteButton.textContent = "Confirm delete?";
      deleteArmedTimeout = setTimeout(() => {
        deleteArmed = false;
        deleteButton.textContent = "Delete Ride";
      }, 4000); // reverts on its own if they don't confirm, rather than staying armed forever
      return;
    }
    if (deleteArmedTimeout) clearTimeout(deleteArmedTimeout);
    deleteButton.disabled = true;
    deleteButton.textContent = "Deleting...";
    try {
      await deleteRide(ride.id);
      item.remove(); // gone, no need to keep showing a row for a ride that no longer exists
    } catch (err) {
      showItemError(err);
      deleteArmed = false;
      deleteButton.disabled = false;
      deleteButton.textContent = "Delete Ride";
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
 * @param deviceHash - a stable per-device label (see
 *   src/core/deviceHash.ts), shown instead of the raw internal id when
 *   available, the same physical device shows the same short code
 *   across rides, unlike the random participant id. Display-only,
 *   never used to look anything up. Null for rows written before this
 *   existed, falls back to the raw id in that case.
 */
function buildParticipantTagRow(
  participantId: string,
  currentTag: string | null,
  isSpectator: boolean,
  deviceHash: string | null,
): HTMLElement {
  const row = document.createElement("div");
  row.style.cssText = "display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 14px;";

  const label = document.createElement("span");
  // Riders never enter a name (no login, no account), this is the
  // only thing that tells two rows apart. Prefer the stable device
  // hash when we have one, falls back to the raw participant id for
  // older rows that predate device_hash.
  label.textContent = `Device: ${deviceHash ?? participantId.slice(0, 8) + "…"} ${isSpectator ? "(spectator)" : "(rider)"}`;
  row.appendChild(label);

  const select = document.createElement("select");
  const noneOption = document.createElement("option");
  noneOption.value = "";
  noneOption.textContent = "Standard rider";
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

  // Force-removes this one participant from the ride, distinct from
  // "Delete Ride" (which removes the whole ride for everyone). Reuses
  // leaveRide(), the exact same function a rider's own "Leave Ride"
  // button calls on themselves, the underlying RLS policy already
  // permits deleting any participant row (no ownership check, same
  // trust model as the rest of this schema), an admin calling it on
  // someone else's id needed no new migration. Two-click confirm, same
  // pattern as the ride list's "Delete Ride" button.
  const removeButton = document.createElement("button");
  removeButton.textContent = "Remove";
  removeButton.style.cssText = "background: rgba(198,40,40,0.9); font-size: 12px; padding: 4px 10px;";
  row.appendChild(removeButton);

  let removeArmed = false;
  let removeArmedTimeout: ReturnType<typeof setTimeout> | null = null;
  removeButton.addEventListener("click", async () => {
    if (!removeArmed) {
      removeArmed = true;
      removeButton.textContent = "Confirm?";
      removeArmedTimeout = setTimeout(() => {
        removeArmed = false;
        removeButton.textContent = "Remove";
      }, 4000);
      return;
    }
    if (removeArmedTimeout) clearTimeout(removeArmedTimeout);
    removeButton.disabled = true;
    try {
      await leaveRide(participantId);
      row.remove(); // gone from the ride, no reason to keep showing this row
    } catch (err) {
      statusEl.textContent = err instanceof Error ? err.message : String(err);
      statusEl.style.color = "#c62828";
      removeArmed = false;
      removeButton.disabled = false;
      removeButton.textContent = "Remove";
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
    <button id="start-ride-button" style="background: rgba(46,125,50,0.9); margin-top: 20px;">Start Ride</button>
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
      // A disabled button alone isn't a strong enough visual signal,
      // this one keeps its bright green background regardless (a real
      // report: it "doesn't change to started" even though it had
      // worked, the success message below was the only real proof).
      // Matches buildRideListItem()'s own Start Ride button, which
      // already does this.
      button.textContent = "Started";
      successEl.textContent = "Ride started. Riders can now join using the link/QR code above.";
      refreshDashboardCards(); // starting a ride changes the "active rides" count
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
    <button id="end-ride-button" style="background: rgba(198,40,40,0.9); margin-top: 20px;">End Ride</button>
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
      refreshDashboardCards(); // ending a ride changes both dashboard counts
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
 * Triggers a browser download of a canvas's current contents as a
 * PNG, same "never needs a server round trip" mechanic as
 * downloadTextFile() above, just for image data (canvas.toBlob())
 * instead of a plain string.
 */
function downloadCanvasAsPng(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return; // toBlob can hand back null on a genuine encoder failure, nothing sensible to download then
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

/**
 * Draws a shareable post-ride recap image: the ride's name, total
 * distance covered (summed across every rider's real recorded
 * movement, see computeRideRecapStats()), how many riders showed up,
 * and how long the ride ran. Same sunburst-orange brand gradient as
 * the rest of the app, meant to look like something worth actually
 * sharing, not a plain data dump.
 *
 * @returns an off-screen canvas (never attached to the page, just
 *   handed to downloadCanvasAsPng()) with the finished image drawn.
 */
function drawRecapCard(rideName: string, stats: RideRecapStats): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 500;
  const ctx = canvas.getContext("2d")!;

  const gradient = ctx.createLinearGradient(0, 0, 800, 500);
  gradient.addColorStop(0, "#ffb347");
  gradient.addColorStop(1, "#ff7e1f");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 800, 500);

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";

  ctx.font = "bold 40px system-ui, sans-serif";
  wrapText(ctx, rideName, 400, 90, 700, 46);

  const durationLabel =
    stats.durationMs === null
      ? "—"
      : `${Math.round(stats.durationMs / 60000 / 60)
          .toString()
          .padStart(1, "0")}h ${Math.round((stats.durationMs / 60000) % 60)}m`;

  const rows: [string, string][] = [
    ["Distance covered", formatDistance(stats.totalDistanceMeters, bikeTheme.unitSystem)],
    [`${bikeTheme.participantWord[0].toUpperCase()}${bikeTheme.participantWord.slice(1)}s`, String(stats.riderCount)],
    ["Duration", durationLabel],
  ];

  let y = 220;
  for (const [label, value] of rows) {
    ctx.font = "bold 56px system-ui, sans-serif";
    ctx.fillText(value, 400, y);
    ctx.font = "20px system-ui, sans-serif";
    ctx.fillText(label.toUpperCase(), 400, y + 32);
    y += 100;
  }

  ctx.font = "16px system-ui, sans-serif";
  ctx.fillText(`Open Navigation & Geospatial Platform`, 400, 470);

  return canvas;
}

/** Wraps a long ride name across multiple centered lines instead of overflowing/getting clipped on a single one. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): void {
  const words = text.split(" ");
  let line = "";
  let lineY = y;
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, lineY);
      line = word;
      lineY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, lineY);
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
    <button id="export-gpx-button" >Export GPX</button>
    <button id="export-csv-button" >Export CSV</button>
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
    <p>Or upload a CSV route file (lat,lng,name, name optional per row)</p>
    <input type="file" id="route-csv-file" accept=".csv" />
    <p class="error" id="route-csv-error"></p>
    <p id="route-csv-success" style="color: #2e7d32;"></p>
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

  // Second way to set a route, a simpler format than GPX (no XML/GPS-
  // tool needed to produce one, just a spreadsheet export), same
  // createRoute()/setRouteLayer() code path either way, see
  // parseRouteCsv()'s docs in csvImport.ts for the exact expected
  // format.
  const csvFileInput = document.getElementById("route-csv-file") as HTMLInputElement;
  csvFileInput.addEventListener("change", async () => {
    const file = csvFileInput.files?.[0];
    if (!file) return;

    const errorEl = document.getElementById("route-csv-error") as HTMLParagraphElement;
    const successEl = document.getElementById("route-csv-success") as HTMLParagraphElement;
    errorEl.textContent = "";
    successEl.textContent = "";

    try {
      const text = await file.text();
      const geojson = parseRouteCsv(text);
      await createRoute(rideId, geojson, "drawn"); // no dedicated "csv" source value, "drawn" (hand-authored, not a GPS device recording) fits better than "gpx"
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
      <button type="button" id="route-draw-undo" >Undo last point</button>
      <button type="button" id="route-draw-clear" >Clear</button>
      <button type="button" id="route-draw-save">Save drawn route</button>
    </div>
    <div style="display: flex; gap: 8px; margin-top: 8px; align-items: center;">
      <input type="text" id="route-draw-waypoint-name" placeholder="Waypoint name (e.g. Rest Stop)" style="flex: 1; margin: 0;" />
      <button type="button" id="route-draw-name-point">Name last point</button>
    </div>
    <p class="error" id="route-draw-error"></p>
    <p id="route-draw-success" style="color: #2e7d32;"></p>
  `;
  container.appendChild(section);

  const errorEl = document.getElementById("route-draw-error") as HTMLParagraphElement;
  const successEl = document.getElementById("route-draw-success") as HTMLParagraphElement;

  // Every clicked point, in click order, the only state this control
  // needs to track, everything drawn on the map is rebuilt from this
  // array on every change rather than mutated in place. `name` is
  // null for a plain route point, a real string turns that same
  // point into a genuine saved waypoint too (see "Name last point"
  // below), no limit on how many, an admin can name as many of their
  // clicked points as they want.
  let points: { lat: number; lng: number; name: string | null }[] = [];

  const map = createMap("route-draw-map", bikeTheme.defaultMapCenter, bikeTheme.defaultMapZoom);

  /**
   * Rebuilds and redraws the live preview from the current `points`
   * array: the connecting line (needs at least 2 points to exist at
   * all) plus a small dot at every clicked point so a single click
   * still gives visible feedback before a second point makes a line
   * possible. A point with a `name` shows its real label (see
   * setRouteLayer()'s waypoint-label layer), an unnamed point still
   * shows as a plain dot for click feedback, but isn't a real
   * waypoint, see buildFinalRouteGeoJson() below for exactly what
   * gets saved.
   */
  function redrawPreview(): void {
    const features: GeoJSON.Feature[] = points.map((p) => ({
      type: "Feature",
      properties: { kind: "waypoint", name: p.name },
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

  /**
   * Builds the GeoJSON that actually gets saved: the line, plus one
   * Point feature for every point the admin gave a name to (see
   * "Name last point" below), no limit on how many. An unnamed click
   * (just shaping the line) never gets saved as a waypoint.
   */
  function buildFinalRouteGeoJson(): GeoJSON.FeatureCollection {
    const features: GeoJSON.Feature[] = [];
    if (points.length >= 2) {
      features.push({
        type: "Feature",
        properties: { kind: "route" },
        geometry: { type: "LineString", coordinates: points.map((p) => [p.lng, p.lat]) },
      });
    }
    for (const p of points) {
      if (!p.name) continue;
      features.push({
        type: "Feature",
        properties: { kind: "waypoint", name: p.name },
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      });
    }
    return { type: "FeatureCollection", features };
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
    points.push({ lat: event.lngLat.lat, lng: event.lngLat.lng, name: null });
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

  // Names the MOST RECENTLY clicked point, turning it into a real
  // waypoint (see buildFinalRouteGeoJson() above). Click as many
  // different points, name each one in turn, however many the ride
  // actually needs, no hardcoded limit anywhere in this flow.
  const waypointNameInput = document.getElementById("route-draw-waypoint-name") as HTMLInputElement;
  const namePointButton = document.getElementById("route-draw-name-point") as HTMLButtonElement;
  namePointButton.addEventListener("click", () => {
    errorEl.textContent = "";
    const name = waypointNameInput.value.trim();
    if (points.length === 0) {
      errorEl.textContent = "Click a point on the map first.";
      return;
    }
    if (!name) {
      errorEl.textContent = "Type a name for the waypoint first.";
      return;
    }
    points[points.length - 1].name = name;
    waypointNameInput.value = "";
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
setUpBrandLogo();
renderSignIn(); // every visit starts at sign-in, no "remember me" session persistence built yet
