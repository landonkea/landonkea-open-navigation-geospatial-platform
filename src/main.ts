// ── App entry point ────────────────────────────────────────────────
// Wires the generic core (src/core/) together with the bike theme
// (src/theme/bike/config.ts). Page title/theme-color/layout CSS are
// set here in TypeScript rather than hardcoded in index.html/a .css
// file, see applyBaseStyles() below.

import "maplibre-gl/dist/maplibre-gl.css"; // MapLibre's required stylesheet, bundled by Vite, not a CDN link
import type { Map as MapLibreMap } from "maplibre-gl"; // just the type, for setUpViewSwitcher()'s parameter below
import { createMap, setParticipantLayer, setMapView, setRouteLayer, type MapViewId, type ParticipantFeature } from "./core/map";
import { bikeTheme } from "./theme/bike/config";
import { joinAsRider, joinAsSpectator, retryLocationShare, type JoinResult, type SpectatorReason } from "./core/join";
import { startPolling } from "./core/sync";
import { signalStatus, type SignalStatus } from "./core/geo";
import { detectLocationGuidance } from "./core/locationHelp";
import { keepWakeLockAlive, releaseWakeLock } from "./core/wakeLock";
import { isPossiblyStuck } from "./core/stuckDetection";
import {
  fetchRide,
  fetchRideBySlug,
  fetchRouteForRide,
  leaveRide,
  submitFeedback,
  type RideParticipant,
} from "./core/adapters/supabase";

function applyBaseStyles(): void {
  document.title = `${bikeTheme.eventWordSingular} live map`; // e.g. "ride live map"

  const themeColorMeta = document.createElement("meta");
  themeColorMeta.name = "theme-color";
  themeColorMeta.content = "#ff7e1f";
  document.head.appendChild(themeColorMeta);

  // Brand palette: sunburst orange, as a gradient, with a light-yellow
  // accent (user's explicit request). Deliberately NOT applied to the
  // roster's green/yellow/red signal-status dots, the "possibly
  // stuck" warning, or the offline indicator, those colors carry real
  // functional meaning (online/degraded/lost signal, a real problem
  // state), restyling them for brand consistency would make the app
  // harder to read at a glance, exactly what those colors exist to
  // prevent.
  const layoutStyle = document.createElement("style");
  layoutStyle.textContent = `
    html, body { margin: 0; height: 100%; font-family: system-ui, sans-serif; }
    #map { position: absolute; inset: 0; }
    #join-banner { position: absolute; top: 0; left: 0; right: 0; z-index: 5; background: linear-gradient(135deg, #ffb347, #ff7e1f); color: white; padding: 8px 12px; font-size: 14px; text-align: center; }
    #join-banner button { margin-left: 10px; padding: 4px 10px; font-size: 13px; background: #fff8e1; color: #ff7e1f; border: none; border-radius: 4px; cursor: pointer; }
    #join-choice { position: absolute; inset: 0; z-index: 20; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; }
    /* Semi-transparent "frosted glass" cards, the blur behind them
       keeps text readable while still letting the map/gradient show
       through, applied to every card/form/field in this app. */
    #join-choice .card { background: rgba(255, 255, 255, 0.75); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: 10px; padding: 28px; max-width: 360px; text-align: center; }
    #join-choice h2 { margin-top: 0; }
    #join-choice button { display: block; width: 100%; padding: 14px; margin: 8px 0; font-size: 16px; border-radius: 6px; border: none; cursor: pointer; }
    #join-choice .ride-btn { background: linear-gradient(135deg, #ffb347, #ff7e1f); color: white; }
    #join-choice .watch-btn { background: #fff3e0; color: #7a4a00; }
    #tag-picker { position: absolute; inset: 0; z-index: 20; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; }
    #tag-picker .card { background: rgba(255, 255, 255, 0.75); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: 10px; padding: 28px; max-width: 360px; width: 90%; max-height: 80vh; overflow-y: auto; text-align: center; }
    #tag-picker h2 { margin-top: 0; }
    #tag-picker button { display: block; width: 100%; padding: 14px; margin: 8px 0; font-size: 16px; border-radius: 6px; border: none; cursor: pointer; }
    #tag-picker .ride-btn { background: linear-gradient(135deg, #ffb347, #ff7e1f); color: white; }
    #tag-picker .watch-btn { background: #fff3e0; color: #7a4a00; }
    #location-help { position: absolute; inset: 0; z-index: 20; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; }
    #location-help .card { background: rgba(255, 255, 255, 0.75); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: 10px; padding: 24px; max-width: 380px; }
    #location-help ol { padding-left: 20px; }
    #location-help li { margin-bottom: 8px; }
    #location-help button { padding: 10px 16px; font-size: 15px; background: linear-gradient(135deg, #ffb347, #ff7e1f); color: white; border: none; border-radius: 6px; cursor: pointer; margin-top: 8px; }
    #view-switcher { position: absolute; bottom: 12px; left: 12px; z-index: 10; background: white; border-radius: 6px; box-shadow: 0 1px 4px rgba(0,0,0,0.3); overflow: hidden; }
    #view-switcher button { display: block; width: 90px; padding: 8px; font-size: 13px; border: none; background: white; cursor: pointer; }
    #view-switcher button.active { background: linear-gradient(135deg, #ffb347, #ff7e1f); color: white; }
    #roster-toggle { position: absolute; bottom: 12px; right: 60px; z-index: 10; background: #fff8e1; border: none; border-radius: 6px; padding: 8px 12px; font-size: 13px; box-shadow: 0 1px 4px rgba(0,0,0,0.3); cursor: pointer; }
    #roster-panel { position: absolute; inset: 0; z-index: 15; background: white; overflow-y: auto; padding: 16px; }
    #roster-panel h2 { margin-top: 40px; }
    #roster-panel .summary { color: #555; margin-bottom: 12px; }
    #roster-panel .close-roster { position: absolute; top: 12px; right: 12px; padding: 8px 14px; background: #fff3e0; border: none; border-radius: 6px; cursor: pointer; }
    #roster-panel ul { list-style: none; padding: 0; margin: 0; }
    #roster-panel li { display: flex; align-items: center; gap: 10px; padding: 10px; border-bottom: 1px solid #eee; }
    #roster-panel .dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
    #roster-panel .dot.green { background: #2e7d32; }
    #roster-panel .dot.yellow { background: #f9a825; }
    #roster-panel .dot.red { background: #c62828; }
    #roster-panel .stuck-flag { color: #c62828; font-weight: bold; font-size: 12px; }
    #install-prompt { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); z-index: 10; background: #fff8e1; border-radius: 8px; padding: 10px 16px; box-shadow: 0 1px 6px rgba(0,0,0,0.3); font-size: 13px; display: flex; align-items: center; gap: 10px; max-width: 90%; }
    #install-prompt button { padding: 6px 12px; font-size: 13px; background: linear-gradient(135deg, #ffb347, #ff7e1f); color: white; border: none; border-radius: 4px; cursor: pointer; }
    #install-prompt .dismiss { background: none; color: #888; padding: 4px; }
    #offline-indicator { position: absolute; top: 44px; left: 0; right: 0; z-index: 9; background: #c62828; color: white; text-align: center; padding: 6px; font-size: 13px; }
    /* Semi-transparent so it reads as a watermark, not a solid badge
       fighting for attention with the map, and never intercepts
       clicks/taps meant for whatever's underneath it. */
    #brand-logo { position: absolute; top: 12px; left: 12px; z-index: 10; max-height: 32px; max-width: 140px; opacity: 0.8; pointer-events: none; }
    #share-button { position: absolute; top: 12px; right: 12px; z-index: 10; background: #fff8e1; border: none; border-radius: 6px; padding: 8px 12px; font-size: 13px; box-shadow: 0 1px 4px rgba(0,0,0,0.3); cursor: pointer; }
    #feedback-button { position: absolute; top: 56px; right: 12px; z-index: 10; background: #fff8e1; border: none; border-radius: 6px; padding: 8px 12px; font-size: 13px; box-shadow: 0 1px 4px rgba(0,0,0,0.3); cursor: pointer; }
    #leave-ride-button { position: absolute; top: 100px; right: 12px; z-index: 10; background: #fff8e1; border: none; border-radius: 6px; padding: 8px 12px; font-size: 13px; box-shadow: 0 1px 4px rgba(0,0,0,0.3); cursor: pointer; }
    #feedback-form { position: absolute; inset: 0; z-index: 20; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; }
    #feedback-form .card { background: rgba(255, 255, 255, 0.75); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: 10px; padding: 24px; max-width: 360px; width: 90%; }
    #feedback-form textarea { width: 100%; box-sizing: border-box; padding: 10px; font-size: 15px; border-radius: 6px; border: 1px solid #ffcc80; margin: 10px 0; font-family: inherit; resize: vertical; background: rgba(255, 255, 255, 0.6); }
    #feedback-form button { padding: 10px 16px; font-size: 15px; border: none; border-radius: 6px; cursor: pointer; margin-right: 8px; }
    #feedback-form .submit-btn { background: linear-gradient(135deg, #ffb347, #ff7e1f); color: white; }
    #feedback-form .cancel-btn { background: #fff3e0; color: #7a4a00; }
  `;
  document.head.appendChild(layoutStyle);
}

function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    // BASE_URL is "/" on Cloudflare (domain root) but "/repo-name/" on
    // GitHub Pages (subpath-hosted), Vite sets it from the --base build
    // flag. A hardcoded "/service-worker.js" 404s on GitHub Pages since
    // the file actually lives under the repo-name prefix there.
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`);
  });
}

// Chrome/Android's real event type for the "Add to Home Screen"
// prompt, not part of the standard DOM types yet (it's a newer,
// Chromium-specific API), so it's declared by hand here.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
};

/**
 * Shows a short "install this app" prompt the first time someone
 * visits, build prompt's "Readability, contrast, and quick
 * onboarding" section: "installing a PWA isn't obvious to everyone."
 *
 * Two real platform paths, handled differently since only one of them
 * actually supports a programmatic prompt:
 * - Android/desktop Chrome: listens for the browser's own
 *   `beforeinstallprompt` event and shows a real "Install" button
 *   that triggers the browser's native install flow.
 * - iOS Safari: has NO programmatic install API at all (Apple's
 *   choice, not something a website can work around), so this shows
 *   plain instructions instead ("tap Share, then Add to Home
 *   Screen").
 *
 * Skips entirely if the app is already running installed (standalone
 * mode), no point prompting someone who already installed it.
 */
function setUpInstallPrompt(): void {
  // Already installed and running standalone, or already dismissed
  // this before on this device, don't ask again.
  const alreadyStandalone = window.matchMedia("(display-mode: standalone)").matches;
  const alreadyDismissed = localStorage.getItem("opennav-install-dismissed") === "true";
  if (alreadyStandalone || alreadyDismissed) return;

  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

  function showPrompt(installClickHandler: (() => void) | null): void {
    const prompt = document.createElement("div");
    prompt.id = "install-prompt";
    prompt.innerHTML = installClickHandler
      ? `<span>Install this app for quick access.</span><button id="install-now">Install</button><button class="dismiss" id="install-dismiss">✕</button>`
      : `<span>Tip: tap Share, then "Add to Home Screen" for quick access.</span><button class="dismiss" id="install-dismiss">✕</button>`;
    document.body.appendChild(prompt);

    document.getElementById("install-dismiss")!.addEventListener("click", () => {
      prompt.remove();
      localStorage.setItem("opennav-install-dismissed", "true"); // don't nag every single visit
    });
    if (installClickHandler) {
      document.getElementById("install-now")!.addEventListener("click", () => {
        installClickHandler();
        prompt.remove();
      });
    }
  }

  if (isIOS) {
    showPrompt(null); // no programmatic prompt possible, just show the manual instructions
    return;
  }

  // Chrome/Android fires this event automatically when it decides the
  // page is installable, we just listen and hold onto it until
  // someone actually clicks our own "Install" button.
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // stop Chrome's own default mini-infobar, we show our own styled prompt instead
    const installEvent = event as BeforeInstallPromptEvent;
    showPrompt(() => installEvent.prompt());
  });
}

/**
 * Converts raw participant rows from Supabase into the GeoJSON
 * feature shape MapLibre's clustering expects, computing each one's
 * live signal-status color/icon along the way (see geo.ts's
 * signalStatus()). Participants with no position yet (just joined,
 * no GPS fix landed yet) or spectators (who never broadcast a
 * position at all) are left off the map entirely, not drawn as an
 * empty/wrong dot.
 */
function toParticipantFeatures(participants: RideParticipant[]): ParticipantFeature[] {
  const nowMs = Date.now(); // one shared "now" for this whole batch, not re-read per participant
  const features: ParticipantFeature[] = [];

  for (const participant of participants) {
    if (participant.lat === null || participant.lng === null) continue; // no GPS fix yet, nothing to draw
    if (participant.is_spectator) continue; // spectators never appear as a dot, by design

    const lastSeenMs = new Date(participant.last_seen_at).getTime();
    const status = signalStatus(lastSeenMs, participant.accuracy_m ?? 0, nowMs);

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [participant.lng, participant.lat] },
      properties: { status, id: participant.id, tag: participant.tag },
    });
  }

  return features;
}

/**
 * Reads the ride id to join from the URL. Supports both the short
 * date-based path form (/08112026, see core/rideSlug.ts) and the
 * older ?ride=<uuid> query-param form, so any previously-shared link
 * still works.
 */
function getRideIdFromUrl(): string | null {
  const fromQuery = new URLSearchParams(window.location.search).get("ride");
  if (fromQuery) return fromQuery;

  // Split the path into segments and take the LAST one, not just
  // "everything after the first slash". This makes the same code work
  // whether the app is deployed at a domain root (Cloudflare Pages,
  // path is "/08112026", one segment) or under a subpath (GitHub
  // Pages, path is "/repo-name/08112026", two segments), the ride
  // slug is always whatever comes last either way.
  const segments = window.location.pathname.split("/").filter((segment) => segment.length > 0);
  return segments.length > 0 ? segments[segments.length - 1] : null;
}

/**
 * Turns a spectator reason into plain language a rider can actually
 * act on, rather than a generic "you're a spectator" with no
 * explanation. Added after real testing showed people were silently
 * dropped into spectator mode with no idea why or how to fix it.
 */
function spectatorReasonMessage(reason: SpectatorReason | undefined): string {
  switch (reason) {
    case "permission_denied":
      return "Location access was denied.";
    case "position_unavailable":
      return "Couldn't get a location fix (no GPS signal or location services are off).";
    case "timeout":
      return "Location request timed out.";
    case "unsupported":
      return "This browser doesn't support location sharing.";
    case "insecure_context":
      return "Location sharing needs a secure (https) connection, or open this on the same device as the dev server (localhost). A plain http address on another device (e.g. a phone over WiFi) can't share location.";
    default:
      return "Location wasn't shared.";
  }
}

/**
 * Shows the full-screen "I'm riding" / "Just watching" choice, added
 * after real feedback: the previous version requested location the
 * instant the page loaded, with no explicit choice first, so even a
 * deliberate spectator got a permission prompt (or a confusing silent
 * failure) before saying anything about their intent.
 *
 * @returns a promise resolving to which path was chosen.
 */
function showJoinChoice(): Promise<"ride" | "watch"> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = "join-choice";
    overlay.innerHTML = `
      <div class="card">
        <h2>Join this ${bikeTheme.eventWordSingular}</h2>
        <button class="ride-btn" id="choice-ride">I'm ${bikeTheme.participantVerbGerund}</button>
        <button class="watch-btn" id="choice-watch">Just watching</button>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById("choice-ride")!.addEventListener("click", () => {
      overlay.remove();
      resolve("ride");
    });
    document.getElementById("choice-watch")!.addEventListener("click", () => {
      overlay.remove();
      resolve("watch");
    });
  });
}

/**
 * Shows the optional, self-select tag picker (build prompt's
 * "Optional rider tags" section, e.g. "Marshal", "Sweep") right after
 * showJoinChoice() resolves, for either path (a spectator can tag
 * themselves "Photographer/media" without ever sharing location, see
 * joinAsSpectator()'s docs). The tag list itself comes from
 * bikeTheme.tags (src/theme/bike/config.ts), a different theme would
 * show a different list with zero changes needed here.
 *
 * @returns a promise resolving to the chosen tag id, or null if they
 *   pick "No tag" (the common case, this is optional).
 */
function showTagPicker(): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = "tag-picker";
    overlay.innerHTML = `
      <div class="card">
        <h2>Any role for this ${bikeTheme.eventWordSingular}? (optional)</h2>
        <button class="watch-btn" id="tag-none">No tag</button>
        ${bikeTheme.tags
          .map((tag) => `<button class="ride-btn" data-tag-id="${tag.id}">${tag.icon} ${tag.label}</button>`)
          .join("")}
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById("tag-none")!.addEventListener("click", () => {
      overlay.remove();
      resolve(null);
    });
    overlay.querySelectorAll<HTMLButtonElement>("button[data-tag-id]").forEach((button) => {
      button.addEventListener("click", () => {
        overlay.remove();
        resolve(button.dataset.tagId ?? null);
      });
    });
  });
}

/**
 * Shows device-specific instructions for fixing blocked location
 * access (see core/locationHelp.ts's module docstring for the honest
 * limit here: no website can open a phone's Settings app for someone,
 * every browser blocks that on purpose, this gives exact steps
 * instead of one generic paragraph).
 *
 * @returns a promise resolving once the person clicks "Try again",
 *   the caller decides what to actually do with that click.
 */
function showLocationHelp(reason: SpectatorReason | undefined): Promise<void> {
  return new Promise((resolve) => {
    const guidance = detectLocationGuidance();
    const overlay = document.createElement("div");
    overlay.id = "location-help";
    overlay.innerHTML = `
      <div class="card">
        <p><strong>${spectatorReasonMessage(reason)}</strong></p>
        <p>Steps for ${guidance.label}:</p>
        <ol>${guidance.steps.map((s) => `<li>${s}</li>`).join("")}</ol>
        <button id="location-help-retry">Try again</button>
        <button id="location-help-watch" style="background:#fff3e0;color:#7a4a00;">Just watch instead</button>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById("location-help-retry")!.addEventListener("click", () => {
      overlay.remove();
      resolve();
    });
    // Escape hatch: someone who can't (or doesn't want to) fix
    // permissions right now shouldn't be stuck on this screen forever,
    // "just watch" is always one click away.
    document.getElementById("location-help-watch")!.addEventListener("click", () => {
      overlay.remove();
      resolve();
    });
  });
}

/**
 * Renders the Map/Satellite view-switcher buttons and wires up the
 * click handling. See core/map.ts's module comment for the honest
 * limit here: true Street View (ground-level photos) isn't feasible
 * anywhere for free, so this only offers the two views that are.
 *
 * @param map - the live map instance.
 * @param getCurrentFeatures - called at switch time to get whatever
 *   participant data should be redrawn on the new base map (MapLibre
 *   wipes custom layers on every style change, see setMapView()'s
 *   docstring), a function rather than a plain value so it always
 *   reads the LATEST data at the moment someone actually clicks,
 *   not whatever was current when the switcher was first built.
 */
function setUpViewSwitcher(map: MapLibreMap, getCurrentFeatures: () => ParticipantFeature[]): void {
  const container = document.createElement("div");
  container.id = "view-switcher";
  // "active" starts on Satellite, matching createMap()'s own
  // "satellite" initialView passed from main() below, so this button
  // doesn't lie about which view is actually showing on load.
  container.innerHTML = `
    <button id="view-street">Map</button>
    <button id="view-satellite" class="active">Satellite</button>
  `;
  document.body.appendChild(container);

  const streetButton = document.getElementById("view-street") as HTMLButtonElement;
  const satelliteButton = document.getElementById("view-satellite") as HTMLButtonElement;

  async function switchTo(view: MapViewId): Promise<void> {
    streetButton.classList.toggle("active", view === "street"); // highlight whichever button matches the current view
    satelliteButton.classList.toggle("active", view === "satellite");
    await setMapView(map, view); // swap the base map, wipes custom layers as a side effect
    setParticipantLayer(map, { type: "FeatureCollection", features: getCurrentFeatures() }); // redraw whatever was already known
  }

  streetButton.addEventListener("click", () => switchTo("street"));
  satelliteButton.addEventListener("click", () => switchTo("satellite"));
}

// Sort order for the roster list below: riders needing attention
// (red, then yellow) surface to the top instead of getting buried in
// a long green list, matching the build prompt's "Roster/headcount
// view" section exactly ("Sort it so riders needing attention...
// surface to the top instead of getting buried").
const ROSTER_SORT_ORDER: Record<SignalStatus, number> = { red: 0, yellow: 1, green: 2 };

/**
 * Sets up the roster/headcount toggle button and panel. Reuses the
 * exact same participant data already being polled for the map (see
 * the build prompt: "no new data collection required"), just rendered
 * as a sorted list instead of map dots.
 *
 * @returns an update function, call this with the latest participant
 *   list on every poll (see main()'s onPollUpdate), it stores the
 *   data and, if the panel is currently open, re-renders it live too.
 */
/**
 * Shows/hides a plain "you're offline" banner in response to
 * sync.ts's online-status watching (Fallback #1, see
 * offlineBuffer.ts). Kept separate from the main join-status banner
 * since the two convey genuinely different things (which mode you
 * joined in, vs. a live connectivity signal) and can both be true at
 * once.
 *
 * @returns a callback in the exact shape startPolling() expects for
 *   its onOnlineStatusChange parameter.
 */
function setUpOfflineIndicator(): (isOnline: boolean) => void {
  const indicator = document.createElement("div");
  indicator.id = "offline-indicator";
  indicator.textContent = "You're offline, sharing will resume automatically once reconnected.";
  indicator.style.display = "none"; // hidden by default, only shown while actually offline
  document.body.appendChild(indicator);

  return (isOnline: boolean) => {
    indicator.style.display = isOnline ? "none" : "block";
  };
}

/**
 * Turns a stored tag id (e.g. "marshal") into its human-readable
 * "icon + label" form (e.g. "🚦 Marshal") for display, looked up from
 * bikeTheme.tags rather than shown raw. Falls back to the bare id
 * itself for a tag id that no longer exists in the theme (e.g. an
 * admin edits the tag list later, an old participant row still has
 * the old id), better than showing nothing at all for a real tag
 * someone genuinely selected.
 */
function tagLabel(tagId: string): string {
  const tag = bikeTheme.tags.find((t) => t.id === tagId);
  return tag ? `${tag.icon} ${tag.label}` : tagId;
}

/**
 * Renders the client's logo, small and semi-transparent, in the
 * corner of the screen (see #brand-logo's CSS above). Reads its path
 * from bikeTheme.logoUrl, not hardcoded, so a real client's logo is a
 * one-line theme-config change, not a code change. Does nothing if
 * the theme has no logo set.
 */
function setUpBrandLogo(): void {
  if (!bikeTheme.logoUrl) return;
  const img = document.createElement("img");
  img.id = "brand-logo";
  // BASE_URL is "/" on Cloudflare (domain root) but "/repo-name/" on
  // GitHub Pages (subpath-hosted), same reasoning as
  // registerServiceWorker()'s fix above, a bare root-absolute
  // logoUrl would 404 there otherwise.
  img.src = `${import.meta.env.BASE_URL}${bikeTheme.logoUrl.replace(/^\//, "")}`;
  img.alt = ""; // decorative watermark, not meaningful content, an empty alt is the correct accessible choice
  document.body.appendChild(img);
}

/**
 * Renders a "Share" button using the browser's native share sheet
 * (the Web Share API) when available, e.g. handing off to Messages/
 * WhatsApp/Twitter/whatever the OS offers, no hardcoded per-platform
 * links needed. Desktop browsers mostly don't support it, falls back
 * to copying the link to the clipboard instead, the next best thing.
 *
 * @param rideName - shown as the shared content's title.
 */
function setUpShareButton(rideName: string): void {
  const button = document.createElement("button");
  button.id = "share-button";
  button.textContent = "Share";
  document.body.appendChild(button);

  button.addEventListener("click", async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: rideName, text: `Join ${rideName}`, url });
      } catch (err) {
        // AbortError just means they closed the native share sheet
        // without picking anything, a normal outcome, not a real error.
        if (err instanceof Error && err.name !== "AbortError") console.error("Share failed:", err);
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      button.textContent = "Copied!";
      setTimeout(() => {
        button.textContent = "Share";
      }, 2000);
    } catch (err) {
      console.error("Clipboard copy failed:", err);
    }
  });
}

/**
 * Renders a "Feedback" button opening a small anonymous feedback
 * form (see submitFeedback() in supabase.ts and the "feedback" table's
 * migration comment for why this exists instead of linking out to an
 * external Google Form/Tally form, no external service, no url to go
 * set up first). Works on an ended ride too, not just an active one.
 *
 * @param rideId - which ride the feedback is about.
 */
function setUpFeedbackButton(rideId: string): void {
  const button = document.createElement("button");
  button.id = "feedback-button";
  button.textContent = "Feedback";
  document.body.appendChild(button);

  button.addEventListener("click", () => {
    const overlay = document.createElement("div");
    overlay.id = "feedback-form";
    overlay.innerHTML = `
      <div class="card">
        <h2>Feedback</h2>
        <p>Anonymous, nothing identifying is attached to this.</p>
        <textarea rows="4" placeholder="What's working, what's not?"></textarea>
        <p class="error"></p>
        <div>
          <button class="submit-btn">Send</button>
          <button class="cancel-btn">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector(".cancel-btn")!.addEventListener("click", () => overlay.remove());
    overlay.querySelector(".submit-btn")!.addEventListener("click", async () => {
      const textarea = overlay.querySelector("textarea") as HTMLTextAreaElement;
      const errorEl = overlay.querySelector(".error") as HTMLParagraphElement;
      const message = textarea.value.trim();
      if (!message) {
        errorEl.textContent = "Type something first.";
        return;
      }
      try {
        await submitFeedback(rideId, message);
        overlay.remove();
      } catch (err) {
        errorEl.textContent = err instanceof Error ? err.message : String(err);
      }
    });
  });
}

/**
 * Renders a "Leave Ride" button. Deliberately generic/small: it only
 * handles the button itself (click, disabled/loading state, removing
 * itself once done), the actual leaving logic (stop polling, release
 * the wake lock, delete the participant row, update the banner) is
 * the caller's job, passed in as `onLeave`, since main() is the only
 * place that actually has `stopPolling`/`participant`/`banner` in
 * scope.
 *
 * @param onLeave - called on click, should do the real work of
 *   leaving and throw if it fails (the button re-enables itself then,
 *   letting someone retry rather than being stuck).
 */
function setUpLeaveRideButton(onLeave: () => Promise<void>): void {
  const button = document.createElement("button");
  button.id = "leave-ride-button";
  button.textContent = "Leave Ride";
  document.body.appendChild(button);

  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Leaving...";
    try {
      await onLeave();
      button.remove(); // done, nothing left for this button to do
    } catch (err) {
      console.error("Failed to leave ride:", err);
      button.disabled = false;
      button.textContent = "Leave Ride";
    }
  });
}

function setUpRosterView(): (participants: RideParticipant[]) => void {
  let latestParticipants: RideParticipant[] = []; // remembered so opening the panel always shows current data
  let isOpen = false;

  const toggleButton = document.createElement("button");
  toggleButton.id = "roster-toggle";
  toggleButton.textContent = "Roster";
  document.body.appendChild(toggleButton);

  const panel = document.createElement("div");
  panel.id = "roster-panel";
  panel.style.display = "none"; // hidden until toggled open
  panel.innerHTML = `<button class="close-roster">Close</button><h2>Roster</h2><div class="summary"></div><ul></ul>`;
  document.body.appendChild(panel);

  function render(): void {
    const nowMs = Date.now(); // one shared "now" for this whole render, not re-read per row

    // Only spectators are excluded from the count/list entirely, they
    // never broadcast a position and aren't part of "who's on the
    // road" the way the build prompt's roster example describes.
    const tracked = latestParticipants.filter((p) => !p.is_spectator && p.lat !== null);

    const rows = tracked
      .map((p) => {
        const lastSeenMs = new Date(p.last_seen_at).getTime();
        const status = signalStatus(lastSeenMs, p.accuracy_m ?? 0, nowMs);
        const lastMovedMs = new Date(p.last_moved_at).getTime();
        const stuck = isPossiblyStuck(lastMovedMs, nowMs); // reuses the same detection logic, no new code path
        const minutesAgo = Math.round((nowMs - lastSeenMs) / 60000);
        return { p, status, stuck, minutesAgo };
      })
      .sort((a, b) => ROSTER_SORT_ORDER[a.status] - ROSTER_SORT_ORDER[b.status]); // needs-attention rows float to the top

    const counts = { green: 0, yellow: 0, red: 0 };
    for (const row of rows) counts[row.status]++;

    const summaryEl = panel.querySelector(".summary") as HTMLDivElement;
    // Matches the build prompt's own example phrasing: "34 riders
    // joined, 31 green, 2 yellow, 1 red".
    summaryEl.textContent = `${rows.length} ${bikeTheme.participantWord}s joined, ${counts.green} green, ${counts.yellow} yellow, ${counts.red} red`;

    const listEl = panel.querySelector("ul") as HTMLUListElement;
    listEl.innerHTML = rows
      .map(
        (row) => `
        <li>
          <span class="dot ${row.status}"></span>
          <span>${row.status === "red" ? `lost signal ${row.minutesAgo} min ago` : row.status}</span>
          ${row.p.tag ? `<span>· ${tagLabel(row.p.tag)}</span>` : ""}
          ${row.stuck ? `<span class="stuck-flag">possibly stuck</span>` : ""}
        </li>
      `,
      )
      .join("");
  }

  toggleButton.addEventListener("click", () => {
    isOpen = true;
    panel.style.display = "block";
    render();
  });
  (panel.querySelector(".close-roster") as HTMLButtonElement).addEventListener("click", () => {
    isOpen = false;
    panel.style.display = "none";
  });

  return (participants: RideParticipant[]) => {
    latestParticipants = participants;
    if (isOpen) render(); // keep it live while someone's actually looking at it
  };
}

async function main(): Promise<void> {
  applyBaseStyles();
  registerServiceWorker();
  setUpInstallPrompt();
  setUpBrandLogo();

  const map = createMap("map", bikeTheme.defaultMapCenter, bikeTheme.defaultMapZoom, "satellite");

  // WHY THIS AWAIT MATTERS (a real bug found by actually testing on a
  // real device): setParticipantLayer() calls map.addSource()/
  // addLayer(), which MapLibre only allows once the map's style has
  // actually finished loading. The join flow below (GPS read +
  // Supabase round trips) can easily finish FASTER than the map's
  // style/tiles fetch, especially on a fast connection. Without this
  // await, the very first real-data setParticipantLayer() call could
  // race ahead of the map being ready, fail silently (caught by
  // sync.ts's poll-loop try/catch, so nothing visibly errors), and
  // since the source never actually got created, EVERY later poll
  // fails the exact same way, permanently, a rider granted location
  // and broadcasting real GPS data that Supabase confirms receiving,
  // just never rendered. Waiting here guarantees the map is fully
  // ready before the join/poll flow below ever calls
  // setParticipantLayer for the first time.
  await new Promise<void>((resolve) => map.once("load", () => resolve()));
  setParticipantLayer(map, { type: "FeatureCollection", features: [] }); // empty until real data arrives

  // Tracks whatever the map is currently showing, so switching views
  // (see setUpViewSwitcher() below) can redraw the SAME data on the
  // new base map, MapLibre wipes custom layers on every style change,
  // there's no way to keep them across a setMapView() call, only to
  // quickly re-add them with data already on hand.
  let latestParticipantFeatures: ParticipantFeature[] = [];
  setUpViewSwitcher(map, () => latestParticipantFeatures);
  const updateRoster = setUpRosterView(); // returns a function to call with fresh data on every poll
  const updateOfflineIndicator = setUpOfflineIndicator(); // returns a function matching startPolling's onOnlineStatusChange shape

  // The URL holds either a short slug (new links, e.g. "/08112026")
  // or, for backward compatibility with any already-shared old-style
  // link, a raw ?ride=<uuid> query param. Try the slug lookup first
  // (the common case going forward), fall back to the uuid lookup so
  // an old link never just breaks.
  const urlValue = getRideIdFromUrl();
  if (!urlValue) {
    const banner = document.createElement("div");
    banner.id = "join-banner";
    banner.textContent = "No ride link provided, open a real ride's join link to see its live map.";
    document.body.appendChild(banner);
    return;
  }

  const ride = (await fetchRideBySlug(urlValue)) ?? (await fetchRide(urlValue));
  if (!ride) {
    const banner = document.createElement("div");
    banner.id = "join-banner";
    banner.textContent = "This ride link doesn't match any real ride, check it was typed/scanned correctly.";
    document.body.appendChild(banner);
    return;
  }
  if (ride.status === "created" || ride.status === "ended") {
    // Either the admin hasn't clicked "Start Ride" yet, or the ride
    // already ended, either way joining would just fail against RLS
    // ("anyone can join an active ride" requires status = 'active'),
    // show a plain, honest message for each case instead of letting
    // someone hit a confusing permission error. (The "already
    // mid-ride, admin ends it while I'm connected" case is handled
    // separately, see onRideEnded below, this only covers arriving at
    // an already-ended ride's link fresh.)
    const banner = document.createElement("div");
    banner.id = "join-banner";
    banner.textContent =
      ride.status === "created"
        ? `This ${bikeTheme.eventWordSingular} hasn't started yet, check back soon.`
        : `This ${bikeTheme.eventWordSingular} has ended. Thanks for joining!`;
    document.body.appendChild(banner);
    return;
  }

  const rideId = ride.id; // the real internal uuid, used for every call from here on, the slug's only job was finding this
  setUpShareButton(ride.name); // build prompt's "social sharing links", native share sheet, no per-platform links needed
  setUpFeedbackButton(rideId); // in-app replacement for the originally-planned external feedback form

  // Draw the ride's planned route, if it has one uploaded (a "no
  // fixed route" ride, per the build prompt, is valid too, in which
  // case this is just null and setRouteLayer() draws nothing).
  const route = await fetchRouteForRide(rideId);
  if (route?.geojson) setRouteLayer(map, route.geojson);

  const banner = document.createElement("div");
  banner.id = "join-banner";
  banner.textContent = "Joining ride...";
  document.body.appendChild(banner);

  try {
    const choice = await showJoinChoice(); // the explicit up-front choice, see its docstring above
    const tag = await showTagPicker(); // optional self-select role, see its docstring above

    let result: JoinResult;
    if (choice === "watch") {
      result = await joinAsSpectator(rideId, tag); // no location permission ever requested
    } else {
      result = await joinAsRider(rideId, tag); // requests permission, only falls back to spectator on real failure
      // A real failure (not a deliberate choice) gets the detailed,
      // device-specific recovery screen instead of just a banner
      // message, then one retry attempt inline before falling back
      // to the same banner+retry-button pattern for any later
      // attempts.
      if (result.isSpectator) {
        await showLocationHelp(result.spectatorReason);
        const retryOutcome = await retryLocationShare(result.participant.id);
        if (retryOutcome.granted) {
          result = { ...result, isSpectator: false, spectatorReason: undefined };
        }
      }
    }

    const { participant } = result;
    if (!result.isSpectator) keepWakeLockAlive(); // active rider from the start, keep the screen on (see wakeLock.ts's honest limits)
    let currentlySpectator = result.isSpectator; // tracked mutably, a retry can flip this mid-session
    let currentSpectatorReason = result.spectatorReason;
    let stopPolling: () => void; // assigned below, re-assigned again if a retry restarts polling

    const redrawBanner = () => {
      if (!currentlySpectator) {
        banner.innerHTML = "Joined, sharing your live location.";
        return;
      }
      banner.innerHTML = "";
      banner.append(
        currentSpectatorReason ? spectatorReasonMessage(currentSpectatorReason) : "Watching as a spectator.",
      );
      const retryButton = document.createElement("button");
      retryButton.textContent = "Share my location";
      retryButton.addEventListener("click", async () => {
        retryButton.disabled = true;
        retryButton.textContent = "Checking...";
        try {
          const outcome = await retryLocationShare(participant.id); // see join.ts, flips the existing row, not a new one
          if (outcome.granted) {
            currentlySpectator = false;
            keepWakeLockAlive(); // just became an active rider via retry, keep the screen on too
            stopPolling(); // stop the spectator-mode loop (which never posts a position)
            stopPolling = startPolling(
              participant.id,
              rideId,
              false, // now sharing for real
              bikeTheme.defaultUpdateIntervalSeconds,
              onPollUpdate,
              updateOfflineIndicator,
              onRideEnded,
            );
            redrawBanner();
          } else {
            currentSpectatorReason = outcome.reason;
            redrawBanner();
          }
        } catch (err) {
          console.error(err);
          redrawBanner();
        }
      });
      banner.appendChild(retryButton);
    };

    const onPollUpdate = (participants: RideParticipant[]) => {
      // Called after every successful poll (see sync.ts), redraw the
      // map with the freshest data.
      latestParticipantFeatures = toParticipantFeatures(participants); // remembered for the view-switcher, see above
      setParticipantLayer(map, {
        type: "FeatureCollection",
        features: latestParticipantFeatures,
      });
      updateRoster(participants); // same poll data, no extra network request, see setUpRosterView()'s docstring
    };

    const onRideEnded = () => {
      // sync.ts already stopped the poll loop itself by this point,
      // this is purely about telling the person what happened instead
      // of the app just silently going quiet.
      banner.innerHTML = "";
      banner.append(`This ${bikeTheme.eventWordSingular} has ended. Thanks for joining!`);
    };

    redrawBanner();
    stopPolling = startPolling(
      participant.id,
      rideId,
      currentlySpectator,
      bikeTheme.defaultUpdateIntervalSeconds,
      onPollUpdate,
      updateOfflineIndicator,
      onRideEnded,
    );

    setUpLeaveRideButton(async () => {
      stopPolling(); // whatever the current poll loop is, a retry may have replaced it
      await releaseWakeLock();
      await leaveRide(participant.id); // removes the row entirely, not just stops updating it
      banner.innerHTML = "";
      banner.append("You've left this ride.");
    });
  } catch (err) {
    banner.textContent = `Couldn't join this ride: ${err instanceof Error ? err.message : String(err)}`;
    console.error(err);
  }
}

main();
