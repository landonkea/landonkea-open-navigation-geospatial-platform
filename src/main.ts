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
import { startPolling, type PollResult } from "./core/sync";
import { distanceMetersPlain, signalStatus, staleOpacity, type SignalStatus } from "./core/geo";
import { formatDistance, formatSpeed, formatTemperatureC } from "./core/units";
import { copyToClipboardWithFeedback } from "./core/clipboard";
import { fetchNearestHospital } from "./core/nearbyHospital";
import { escapeHtml } from "./core/escapeHtml";
import type { LngLat } from "./theme/bike/config";
import { detectLocationGuidance } from "./core/locationHelp";
import { keepWakeLockAlive, releaseWakeLock } from "./core/wakeLock";
import { isPossiblyStuck } from "./core/stuckDetection";
import {
  fetchRide,
  fetchRideBySlug,
  fetchRouteForRide,
  leaveRide,
  submitFeedback,
  submitHighlight,
  fetchHighlights,
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
    /* Every button/panel below uses a semi-transparent background
       (0.85-0.9 opacity, a bit more solid than the 0.75 cards use,
       buttons need to stay clearly tappable) instead of a flat opaque
       color, so the map/gradient shows through everywhere, not just
       the cards. Semantic colors (offline-indicator's red, the
       roster's green/yellow/red status dots) keep their meaning, just
       with alpha added, never changed to a different color. */
    #join-banner { position: absolute; top: 0; left: 0; right: 0; z-index: 5; background: linear-gradient(135deg, rgba(255,179,71,0.9), rgba(255,126,31,0.9)); color: white; padding: 8px 12px; font-size: 14px; text-align: center; }
    #join-banner button { margin-left: 10px; padding: 4px 10px; font-size: 13px; background: rgba(255,248,225,0.9); color: #ff7e1f; border: none; border-radius: 4px; cursor: pointer; }
    #join-choice { position: absolute; inset: 0; z-index: 20; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; }
    /* Semi-transparent "frosted glass" cards, the blur behind them
       keeps text readable while still letting the map/gradient show
       through, applied to every card/form/field in this app. */
    #join-choice .card { background: rgba(255, 255, 255, 0.75); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: 10px; padding: 28px; max-width: 360px; text-align: center; }
    #join-choice h2 { margin-top: 0; }
    #join-choice button { display: block; width: 100%; padding: 14px; margin: 8px 0; font-size: 16px; border-radius: 6px; border: none; cursor: pointer; }
    #join-choice .ride-btn { background: linear-gradient(135deg, rgba(255,179,71,0.9), rgba(255,126,31,0.9)); color: white; }
    #join-choice .watch-btn { background: rgba(255,243,224,0.9); color: #7a4a00; }
    #tag-picker { position: absolute; inset: 0; z-index: 20; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; }
    #tag-picker .card { background: rgba(255, 255, 255, 0.75); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: 10px; padding: 28px; max-width: 360px; width: 90%; max-height: 80vh; overflow-y: auto; text-align: center; }
    #tag-picker h2 { margin-top: 0; }
    #tag-picker button { display: block; width: 100%; padding: 14px; margin: 8px 0; font-size: 16px; border-radius: 6px; border: none; cursor: pointer; }
    #tag-picker .ride-btn { background: linear-gradient(135deg, rgba(255,179,71,0.9), rgba(255,126,31,0.9)); color: white; }
    #tag-picker .watch-btn { background: rgba(255,243,224,0.9); color: #7a4a00; }
    #color-picker { position: absolute; inset: 0; z-index: 20; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; }
    #color-picker .card { background: rgba(255, 255, 255, 0.75); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: 10px; padding: 28px; max-width: 360px; width: 90%; text-align: center; }
    #color-picker h2 { margin-top: 0; }
    #color-picker .swatches { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin: 16px 0; }
    #color-picker .swatch { width: 40px; height: 40px; border-radius: 50%; border: 3px solid rgba(255,255,255,0.8); cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
    #color-picker .skip-btn { padding: 10px 16px; font-size: 14px; background: rgba(255,243,224,0.9); color: #7a4a00; border: none; border-radius: 6px; cursor: pointer; }
    #location-help { position: absolute; inset: 0; z-index: 20; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; }
    #location-help .card { background: rgba(255, 255, 255, 0.75); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: 10px; padding: 24px; max-width: 380px; }
    #location-help ol { padding-left: 20px; }
    #location-help li { margin-bottom: 8px; }
    #location-help button { padding: 10px 16px; font-size: 15px; background: linear-gradient(135deg, rgba(255,179,71,0.9), rgba(255,126,31,0.9)); color: white; border: none; border-radius: 6px; cursor: pointer; margin-top: 8px; }
    /* bottom: 84px, not a smaller offset, on purpose (found in
       review): #view-switcher below is two stacked buttons (~64px
       tall) sitting at bottom: 12px, so its top edge lands around
       76px up. #info-panel can show up to three lines (weather,
       nearest rider, own stats), a smaller offset let its text paint
       directly over the "Map" button once more than one line showed. */
    #info-panel { position: absolute; bottom: 84px; left: 12px; z-index: 10; background: rgba(255,255,255,0.85); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border-radius: 6px; box-shadow: 0 1px 4px rgba(0,0,0,0.3); padding: 6px 10px; font-size: 12px; color: #333; display: none; }
    #view-switcher { position: absolute; bottom: 12px; left: 12px; z-index: 10; background: rgba(255,255,255,0.85); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border-radius: 6px; box-shadow: 0 1px 4px rgba(0,0,0,0.3); overflow: hidden; }
    #view-switcher button { display: block; width: 90px; padding: 8px; font-size: 13px; border: none; background: transparent; cursor: pointer; }
    #view-switcher button.active { background: linear-gradient(135deg, rgba(255,179,71,0.9), rgba(255,126,31,0.9)); color: white; }
    #roster-toggle { position: absolute; bottom: 12px; right: 60px; z-index: 10; background: rgba(255,248,225,0.9); border: none; border-radius: 6px; padding: 8px 12px; font-size: 13px; box-shadow: 0 1px 4px rgba(0,0,0,0.3); cursor: pointer; }
    #roster-panel { position: absolute; inset: 0; z-index: 15; background: rgba(255,255,255,0.9); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); overflow-y: auto; padding: 16px; }
    #roster-panel h2 { margin-top: 40px; }
    #roster-panel .summary { color: #555; margin-bottom: 12px; }
    #roster-panel .close-roster { position: absolute; top: 12px; right: 12px; padding: 8px 14px; background: rgba(255,243,224,0.9); border: none; border-radius: 6px; cursor: pointer; }
    #roster-panel ul { list-style: none; padding: 0; margin: 0; }
    #roster-panel li { display: flex; align-items: center; gap: 10px; padding: 10px; border-bottom: 1px solid #eee; }
    #roster-panel .dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
    #roster-panel .dot.green { background: #2e7d32; }
    #roster-panel .dot.yellow { background: #f9a825; }
    #roster-panel .dot.red { background: #c62828; }
    #roster-panel .stuck-flag { color: #c62828; font-weight: bold; font-size: 12px; }
    #install-prompt { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); z-index: 10; background: rgba(255,248,225,0.9); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border-radius: 8px; padding: 10px 16px; box-shadow: 0 1px 6px rgba(0,0,0,0.3); font-size: 13px; display: flex; align-items: center; gap: 10px; max-width: 90%; }
    #install-prompt button { padding: 6px 12px; font-size: 13px; background: linear-gradient(135deg, rgba(255,179,71,0.9), rgba(255,126,31,0.9)); color: white; border: none; border-radius: 4px; cursor: pointer; }
    #install-prompt .dismiss { background: none; color: #888; padding: 4px; }
    #offline-indicator { position: absolute; top: 44px; left: 0; right: 0; z-index: 9; background: rgba(198,40,40,0.9); color: white; text-align: center; padding: 6px; font-size: 13px; }
    /* Semi-transparent so it reads as a watermark, not a solid badge
       fighting for attention with the map, and never intercepts
       clicks/taps meant for whatever's underneath it. */
    #brand-logo { position: absolute; top: 12px; left: 12px; z-index: 10; max-height: 32px; max-width: 140px; opacity: 0.8; pointer-events: none; }
    #share-button { position: absolute; top: 12px; right: 12px; z-index: 10; background: rgba(255,248,225,0.9); border: none; border-radius: 6px; padding: 8px 12px; font-size: 13px; box-shadow: 0 1px 4px rgba(0,0,0,0.3); cursor: pointer; }
    #feedback-button { position: absolute; top: 56px; right: 12px; z-index: 10; background: rgba(255,248,225,0.9); border: none; border-radius: 6px; padding: 8px 12px; font-size: 13px; box-shadow: 0 1px 4px rgba(0,0,0,0.3); cursor: pointer; }
    #leave-ride-button { position: absolute; top: 100px; right: 12px; z-index: 10; background: rgba(255,248,225,0.9); border: none; border-radius: 6px; padding: 8px 12px; font-size: 13px; box-shadow: 0 1px 4px rgba(0,0,0,0.3); cursor: pointer; }
    #emergency-info-button { position: absolute; top: 144px; right: 12px; z-index: 10; background: rgba(198,40,40,0.9); color: white; border: none; border-radius: 6px; padding: 8px 12px; font-size: 13px; box-shadow: 0 1px 4px rgba(0,0,0,0.3); cursor: pointer; }
    #highlights-button { position: absolute; top: 188px; right: 12px; z-index: 10; background: rgba(255,248,225,0.9); border: none; border-radius: 6px; padding: 8px 12px; font-size: 13px; box-shadow: 0 1px 4px rgba(0,0,0,0.3); cursor: pointer; }
    #emergency-info { position: absolute; inset: 0; z-index: 20; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; }
    #emergency-info .card { background: rgba(255, 255, 255, 0.9); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: 10px; padding: 24px; max-width: 360px; width: 90%; }
    #emergency-info h2 { margin-top: 0; color: #c62828; }
    #emergency-info .disclaimer { font-size: 12px; color: #777; margin-top: 16px; }
    #emergency-info button.close-btn { padding: 10px 16px; font-size: 15px; background: rgba(255,243,224,0.9); color: #7a4a00; border: none; border-radius: 6px; cursor: pointer; margin-top: 12px; }
    /* A stacking container, not one fixed-id element (found in
       review): two named waypoints close enough together could
       otherwise both fire in the same poll and render two elements at
       the exact same spot, overlapping and unreadable. flex-column
       naturally stacks any number of simultaneous toasts instead. */
    #checkpoint-toast-container { position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%); z-index: 25; display: flex; flex-direction: column-reverse; align-items: center; gap: 8px; }
    #checkpoint-toast-container .toast-item { background: rgba(46,125,50,0.92); color: white; padding: 10px 18px; border-radius: 20px; font-size: 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); white-space: nowrap; }
    #feedback-form { position: absolute; inset: 0; z-index: 20; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; }
    #feedback-form .card { background: rgba(255, 255, 255, 0.75); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: 10px; padding: 24px; max-width: 360px; width: 90%; }
    #feedback-form textarea { width: 100%; box-sizing: border-box; padding: 10px; font-size: 15px; border-radius: 6px; border: 1px solid #ffcc80; margin: 10px 0; font-family: inherit; resize: vertical; background: rgba(255, 255, 255, 0.6); }
    #feedback-form button { padding: 10px 16px; font-size: 15px; border: none; border-radius: 6px; cursor: pointer; margin-right: 8px; }
    #feedback-form .submit-btn { background: linear-gradient(135deg, rgba(255,179,71,0.9), rgba(255,126,31,0.9)); color: white; }
    #feedback-form .cancel-btn { background: rgba(255,243,224,0.9); color: #7a4a00; }
    #highlights-wall { position: absolute; inset: 0; z-index: 20; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; }
    #highlights-wall .card { background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: 10px; padding: 24px; max-width: 400px; width: 90%; max-height: 80vh; display: flex; flex-direction: column; }
    #highlights-wall .emoji-row { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0; }
    #highlights-wall .emoji-choice { font-size: 20px; padding: 4px 8px; border-radius: 6px; border: 2px solid transparent; background: rgba(255,255,255,0.6); cursor: pointer; }
    #highlights-wall .emoji-choice.selected { border-color: #ff7e1f; }
    #highlights-wall input[type="text"] { width: 100%; box-sizing: border-box; padding: 10px; font-size: 15px; border-radius: 6px; border: 1px solid #ffcc80; margin: 6px 0; font-family: inherit; background: rgba(255, 255, 255, 0.6); }
    #highlights-wall button { padding: 10px 16px; font-size: 15px; border: none; border-radius: 6px; cursor: pointer; margin-right: 8px; }
    #highlights-wall .submit-btn { background: linear-gradient(135deg, rgba(255,179,71,0.9), rgba(255,126,31,0.9)); color: white; }
    #highlights-wall .cancel-btn { background: rgba(255,243,224,0.9); color: #7a4a00; }
    #highlights-wall .highlight-list { overflow-y: auto; margin-top: 12px; border-top: 1px solid #eee; padding-top: 8px; }
    #highlights-wall .highlight-item { padding: 6px 0; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
    .confetti-piece { position: fixed; top: -10px; width: 8px; height: 14px; z-index: 30; pointer-events: none; animation: confetti-fall linear forwards; }
    @keyframes confetti-fall { to { transform: translateY(105vh) rotate(720deg); } }
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
    const opacity = staleOpacity(lastSeenMs, nowMs);

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [participant.lng, participant.lat] },
      // "color" is omitted entirely (not set to null) when the rider
      // has no preference, on purpose: map.ts's stroke-width expression
      // uses ["has", "color"] to tell "chose a color" apart from "no
      // preference", which only works if the key's absence actually
      // means absence (found in review: setting it to null made "has"
      // always true).
      properties: {
        status,
        id: participant.id,
        tag: participant.tag,
        opacity,
        ...(participant.color ? { color: participant.color } : {}),
      },
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
 * "Optional rider tags" section, e.g. "Traffic Marshal", "DJ Bike")
 * right after showJoinChoice() resolves, for either path (a spectator can tag
 * themselves "DJ Bike" without ever sharing location, see
 * joinAsSpectator()'s docs). The tag list itself comes from
 * bikeTheme.tags (src/theme/bike/config.ts), a different theme would
 * show a different list with zero changes needed here.
 *
 * @returns a promise resolving to the chosen tag id, or null if they
 *   pick "Standard rider" (the common case, this is optional).
 */
function showTagPicker(): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = "tag-picker";
    overlay.innerHTML = `
      <div class="card">
        <h2>Any role for this ${bikeTheme.eventWordSingular}? (optional)</h2>
        <button class="watch-btn" id="tag-none">Standard rider</button>
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
 * Shows an optional color-swatch picker right after showTagPicker(),
 * for someone who chose "I'm riding" (spectators never appear as a
 * map dot, so there's nothing for their color choice to apply to,
 * this screen is skipped entirely for them, see main()'s call site).
 * Lets a rider spot their own dot instantly on a crowded map, see
 * map.ts's docs on why this becomes a stroke ring, not the dot's fill.
 *
 * @returns a promise resolving to the chosen hex color, or null for
 *   "no preference" (the common case, this is entirely optional).
 */
function showColorPicker(): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = "color-picker";
    overlay.innerHTML = `
      <div class="card">
        <h2>Pick a color for your dot? (optional)</h2>
        <div class="swatches">
          ${bikeTheme.riderColors
            .map((color) => `<button class="swatch" data-color="${color}" style="background:${color};"></button>`)
            .join("")}
        </div>
        <button class="skip-btn" id="color-skip">No preference</button>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById("color-skip")!.addEventListener("click", () => {
      overlay.remove();
      resolve(null);
    });
    overlay.querySelectorAll<HTMLButtonElement>("button[data-color]").forEach((button) => {
      button.addEventListener("click", () => {
        overlay.remove();
        resolve(button.dataset.color ?? null);
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
        <button id="location-help-watch" style="background:rgba(255,243,224,0.9);color:#7a4a00;">Just watch instead</button>
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
    await copyToClipboardWithFeedback(button, url, "Share");
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
 * Renders a "Highlights" button opening the ride's public highlights
 * wall: a short list of moments anyone has posted about this ride
 * (see submitHighlight()/fetchHighlights() in supabase.ts), plus a
 * small form to post one. Unlike Feedback (private, admin-only), this
 * is genuinely public, readable by anyone with the ride's link,
 * that's the whole point of a "wall." Works on an ended ride too, a
 * highlight is often something someone wants to add after the fact.
 *
 * @param rideId - which ride the highlights belong to.
 */
function setUpHighlightsButton(rideId: string): void {
  const button = document.createElement("button");
  button.id = "highlights-button";
  button.textContent = "Highlights";
  document.body.appendChild(button);

  async function renderList(listEl: HTMLDivElement): Promise<void> {
    listEl.innerHTML = "<p>Loading…</p>";
    try {
      const highlights = await fetchHighlights(rideId);
      listEl.innerHTML =
        highlights.length === 0
          ? "<p>No highlights yet, be the first!</p>"
          : highlights
              .map((h) => `<div class="highlight-item">${h.emoji ? `${h.emoji} ` : ""}${escapeHtml(h.message)}</div>`)
              .join("");
    } catch (err) {
      listEl.innerHTML = `<p class="error">${escapeHtml(err instanceof Error ? err.message : String(err))}</p>`;
    }
  }

  button.addEventListener("click", () => {
    const overlay = document.createElement("div");
    overlay.id = "highlights-wall";
    overlay.innerHTML = `
      <div class="card">
        <h2>Highlights</h2>
        <div class="emoji-row">
          ${bikeTheme.highlightEmoji.map((e) => `<button type="button" class="emoji-choice" data-emoji="${e}">${e}</button>`).join("")}
        </div>
        <input type="text" maxlength="200" placeholder="What happened?" />
        <p class="error"></p>
        <div>
          <button class="submit-btn">Post</button>
          <button class="cancel-btn">Close</button>
        </div>
        <div class="highlight-list"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    let selectedEmoji: string | null = null;
    overlay.querySelectorAll<HTMLButtonElement>(".emoji-choice").forEach((emojiButton) => {
      emojiButton.addEventListener("click", () => {
        const isAlreadySelected = emojiButton.classList.contains("selected");
        overlay.querySelectorAll(".emoji-choice").forEach((b) => b.classList.remove("selected"));
        selectedEmoji = isAlreadySelected ? null : emojiButton.dataset.emoji ?? null; // clicking the same one again deselects it
        if (selectedEmoji) emojiButton.classList.add("selected");
      });
    });

    const listEl = overlay.querySelector(".highlight-list") as HTMLDivElement;
    renderList(listEl);

    overlay.querySelector(".cancel-btn")!.addEventListener("click", () => overlay.remove());
    overlay.querySelector(".submit-btn")!.addEventListener("click", async () => {
      const input = overlay.querySelector("input") as HTMLInputElement;
      const errorEl = overlay.querySelector(".error") as HTMLParagraphElement;
      const message = input.value.trim();
      if (!message) {
        errorEl.textContent = "Type something first.";
        return;
      }
      try {
        await submitHighlight(rideId, message, selectedEmoji);
        input.value = "";
        errorEl.textContent = "";
        overlay.querySelectorAll(".emoji-choice").forEach((b) => b.classList.remove("selected"));
        selectedEmoji = null;
        renderList(listEl); // show the new post immediately instead of making them reopen the wall
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
/**
 * Renders an "Emergency Info" button. On click, requests one fresh GPS
 * reading (independent of the regular poll loop, works even as a
 * spectator who never broadcasts a position) and shows the theme's
 * organizer contact plus the nearest hospital found near that
 * position (see fetchNearestHospital()). Informational only, says so
 * explicitly, never a substitute for calling real emergency services.
 */
function setUpEmergencyInfoButton(): void {
  const button = document.createElement("button");
  button.id = "emergency-info-button";
  button.textContent = "Emergency Info";
  document.body.appendChild(button);

  button.addEventListener("click", () => {
    const overlay = document.createElement("div");
    overlay.id = "emergency-info";
    overlay.innerHTML = `
      <div class="card">
        <h2>Emergency Info</h2>
        ${bikeTheme.emergencyContactInfo ? `<p>${escapeHtml(bikeTheme.emergencyContactInfo)}</p>` : ""}
        <p class="nearest-hospital">Finding nearest hospital…</p>
        <p class="disclaimer">In a real emergency, call your local emergency number first. This is informational only, not a substitute for that.</p>
        <button class="close-btn">Close</button>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector(".close-btn")!.addEventListener("click", () => overlay.remove());

    const hospitalEl = overlay.querySelector(".nearest-hospital") as HTMLParagraphElement;
    if (!("geolocation" in navigator)) {
      hospitalEl.textContent = "Can't look up nearby hospitals, this browser doesn't support location.";
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const hospital = await fetchNearestHospital(position.coords.latitude, position.coords.longitude);
        hospitalEl.textContent = hospital
          ? `Nearest hospital: ${hospital.name} (${formatDistance(hospital.distanceMeters, bikeTheme.unitSystem)} away)`
          : "Couldn't find a nearby hospital, check a maps app directly.";
      },
      () => {
        hospitalEl.textContent = "Couldn't get your location to look up nearby hospitals.";
      },
      // enableHighAccuracy, not the default coarse fix (found in
      // review): matches sync.ts's own getCurrentPosition(), and
      // matters more here than anywhere else in the app, a coarse
      // network-based fix (potentially off by kilometers) is exactly
      // wrong for "which hospital is actually nearest me."
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  });
}

// How close (in meters) counts as "reached" a named waypoint for the
// checkpoint toast, same bar setUpFinishCelebration() uses for the
// final one, loose enough that real GPS noise near a checkpoint
// doesn't prevent it from ever firing.
const CHECKPOINT_PROXIMITY_METERS = 40;

/**
 * Shows a brief toast the first time a rider's position comes within
 * CHECKPOINT_PROXIMITY_METERS of each NAMED waypoint on the route
 * (rest stops, regroup points, etc., see core/gpx.ts's waypoint
 * parsing), not just the final one (see setUpFinishCelebration()'s
 * separate, more celebratory handling of that specific case). Each
 * waypoint fires at most once per page load.
 *
 * @returns an update function to call with the rider's own current
 *   {lat, lng} on every poll (null if no fix yet).
 */
function setUpCheckpointProximity(
  waypoints: { lat: number; lng: number; name: string }[],
): (own: { lat: number; lng: number } | null) => void {
  const alreadyToasted = new Set<number>(); // indexes into `waypoints`

  function showToast(name: string): void {
    // One shared container (created lazily, reused across calls), not
    // a fresh fixed-id element per toast (found in review): that let
    // two waypoints close together render overlapping, unreadable
    // elements at the same spot. Each toast is its own child instead,
    // the container's CSS (flex-column) stacks any number of them.
    let container = document.getElementById("checkpoint-toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "checkpoint-toast-container";
      document.body.appendChild(container);
    }
    const toast = document.createElement("div");
    toast.className = "toast-item";
    toast.textContent = `Near: ${name}`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  return (own) => {
    if (!own) return;
    waypoints.forEach((waypoint, index) => {
      if (alreadyToasted.has(index)) return;
      const distance = distanceMetersPlain(own, waypoint);
      if (distance <= CHECKPOINT_PROXIMITY_METERS) {
        alreadyToasted.add(index);
        showToast(waypoint.name);
      }
    });
  };
}

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

/**
 * Renders a small bottom-left badge showing the current weather (once,
 * fetched at load, weather doesn't need live polling) and, once a
 * rider has a GPS fix, the closest other rider and how far away they
 * are, recomputed on every poll from data already on hand (same "no
 * new data collection required" reasoning as the roster view above).
 * Both lines are optional/best-effort: a weather-fetch failure or a
 * rider with no fix yet just hides that line, never blocks anything
 * else in the app.
 */
function setUpInfoPanel(): {
  setWeather: (text: string) => void;
  updateNearestRider: (participants: RideParticipant[], ownParticipantId: string) => void;
  updateOwnStats: (stats: PollResult["ownStats"]) => void;
} {
  const panel = document.createElement("div");
  panel.id = "info-panel";
  const weatherLine = document.createElement("div");
  const nearestLine = document.createElement("div");
  const statsLine = document.createElement("div");
  panel.append(weatherLine, nearestLine, statsLine);
  document.body.appendChild(panel);

  function showIfAnyContent(): void {
    panel.style.display =
      weatherLine.textContent || nearestLine.textContent || statsLine.textContent ? "block" : "none";
  }

  return {
    setWeather(text: string) {
      weatherLine.textContent = text;
      showIfAnyContent();
    },
    updateOwnStats(stats: PollResult["ownStats"]) {
      if (!stats || stats.totalDistanceMeters === 0) {
        statsLine.textContent = "";
      } else {
        const distanceStr = formatDistance(stats.totalDistanceMeters, bikeTheme.unitSystem);
        const paceStr = stats.currentSpeedMps !== null ? `, ${formatSpeed(stats.currentSpeedMps, bikeTheme.unitSystem)}` : "";
        statsLine.textContent = `You: ${distanceStr}${paceStr}`;
      }
      showIfAnyContent();
    },
    updateNearestRider(participants: RideParticipant[], ownParticipantId: string) {
      const ownParticipant = participants.find((p) => p.id === ownParticipantId);
      if (!ownParticipant || ownParticipant.lat === null || ownParticipant.lng === null) {
        nearestLine.textContent = "";
        showIfAnyContent();
        return;
      }
      const own = { lat: ownParticipant.lat, lng: ownParticipant.lng };

      // Tracked as one object, not two loose variables kept in sync by
      // hand (found in review): a future field on the winner (e.g. the
      // rider's id, to support centering the map on them) is an easy
      // place to introduce a bug by updating one variable but not the
      // other in some branch.
      let nearest: { meters: number; tag: string | null } | null = null;
      for (const p of participants) {
        if (p.id === ownParticipantId || p.is_spectator || p.lat === null || p.lng === null) continue;
        const meters = distanceMetersPlain(own, { lat: p.lat, lng: p.lng });
        if (nearest === null || meters < nearest.meters) nearest = { meters, tag: p.tag };
      }

      if (nearest === null) {
        nearestLine.textContent = "";
      } else {
        const who = nearest.tag ? tagLabel(nearest.tag) : `another ${bikeTheme.participantWord}`;
        nearestLine.textContent = `Nearest: ${who}, ${formatDistance(nearest.meters, bikeTheme.unitSystem)} away`;
      }
      showIfAnyContent();
    },
  };
}

/**
 * Fetches current temperature/wind for the ride's default map center
 * via Open-Meteo (free, no API key/signup, unlike most weather APIs),
 * formatted per the theme's unitSystem. Best-effort only: any failure
 * (offline, API down, unexpected response shape) returns null rather
 * than throwing, a missing weather badge is a cosmetic loss, never
 * worth blocking the actual ride-tracking experience over.
 */
async function fetchWeatherBadgeText(center: LngLat): Promise<string | null> {
  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${center.lat}&longitude=${center.lng}&current=temperature_2m,wind_speed_10m`,
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { current?: { temperature_2m?: number; wind_speed_10m?: number } };
    const tempC = data.current?.temperature_2m;
    if (typeof tempC !== "number") return null;
    const tempStr = formatTemperatureC(tempC, bikeTheme.unitSystem);
    const windKmh = data.current?.wind_speed_10m; // Open-Meteo's default wind unit
    const windStr = typeof windKmh === "number" ? `, ${formatSpeed(windKmh / 3.6, bikeTheme.unitSystem)} wind` : "";
    return `${tempStr}${windStr}`;
  } catch {
    return null;
  }
}

// Brand palette pieces, matching the sunburst-orange/light-yellow
// theme rather than generic rainbow confetti, so the celebration still
// reads as part of this app rather than a stock effect.
const CONFETTI_COLORS = ["#ff7e1f", "#ffb347", "#ffca28", "#fff8e1", "#2e7d32"];

/**
 * A short, one-time celebratory burst (build prompt-adjacent "delight"
 * touch, not a functional requirement): ~50 small pieces fall from the
 * top of the screen with a random horizontal position, fall speed, and
 * rotation, then remove themselves. Pure CSS animation (see the
 * .confetti-piece/@keyframes rules in applyBaseStyles() above), no
 * canvas/animation library needed for something this simple.
 */
function triggerConfetti(): void {
  for (let i = 0; i < 50; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.backgroundColor = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    piece.style.animationDuration = `${1.8 + Math.random() * 1.2}s`;
    piece.style.animationDelay = `${Math.random() * 0.4}s`;
    document.body.appendChild(piece);
    piece.addEventListener("animationend", () => piece.remove());
  }
}

/**
 * Finds the last named waypoint in a route's GeoJSON (e.g. a finish
 * line or final rest stop), the reference point setUpFinishCelebration()
 * checks a rider's live position against. Returns null for a route
 * with no waypoints at all (a GPX file that's just a track line, or no
 * route uploaded), in which case the celebration feature simply never
 * fires for that ride, not an error.
 */
function findFinalWaypoint(routeGeoJSON: GeoJSON.FeatureCollection | null | undefined): { lat: number; lng: number } | null {
  if (!routeGeoJSON) return null;
  const waypoints = routeGeoJSON.features.filter(
    (f): f is GeoJSON.Feature<GeoJSON.Point> => f.properties?.kind === "waypoint" && f.geometry.type === "Point",
  );
  if (waypoints.length === 0) return null;
  const last = waypoints[waypoints.length - 1];
  const [lng, lat] = last.geometry.coordinates;
  return { lat, lng };
}

/**
 * Finds every NAMED waypoint in a route's GeoJSON, for
 * setUpCheckpointProximity()'s per-waypoint toast. Unnamed points
 * (a plain click-to-draw route line with no waypoints marked) are
 * skipped, there's nothing meaningful to show a toast about.
 */
function findNamedWaypoints(
  routeGeoJSON: GeoJSON.FeatureCollection | null | undefined,
): { lat: number; lng: number; name: string }[] {
  if (!routeGeoJSON) return [];
  return routeGeoJSON.features
    .filter(
      (f): f is GeoJSON.Feature<GeoJSON.Point> => f.properties?.kind === "waypoint" && f.geometry.type === "Point",
    )
    .filter((f) => typeof f.properties?.name === "string" && f.properties.name.length > 0)
    .map((f) => ({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], name: f.properties!.name as string }));
}

// How close (in meters) counts as "reached" the final waypoint, loose
// enough that real GPS noise near the finish doesn't prevent it from
// ever firing, tight enough that it doesn't fire from across town.
const FINISH_PROXIMITY_METERS = 40;

/**
 * Watches a rider's own polled position against the route's final
 * waypoint (see findFinalWaypoint()) and fires triggerConfetti() once,
 * the first time they come within FINISH_PROXIMITY_METERS. A no-op for
 * every call after the first (celebratedRef guards it) and for a ride
 * with no route/final waypoint at all.
 *
 * @returns an update function to call with the rider's own current
 *   {lat, lng} on every poll (null if no fix yet).
 */
function setUpFinishCelebration(finalWaypoint: { lat: number; lng: number } | null): (own: { lat: number; lng: number } | null) => void {
  let celebrated = false;
  return (own) => {
    if (celebrated || !finalWaypoint || !own) return;
    const distance = distanceMetersPlain(own, finalWaypoint);
    if (distance <= FINISH_PROXIMITY_METERS) {
      celebrated = true;
      triggerConfetti();
    }
  };
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
  const infoPanel = setUpInfoPanel();
  fetchWeatherBadgeText(bikeTheme.defaultMapCenter).then((text) => {
    if (text) infoPanel.setWeather(text);
  });

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
  setUpEmergencyInfoButton(); // works for both riders and spectators, doesn't depend on the route below
  setUpHighlightsButton(rideId); // public wall, works for both riders and spectators too

  // Draw the ride's planned route, if it has one uploaded (a "no
  // fixed route" ride, per the build prompt, is valid too, in which
  // case this is just null and setRouteLayer() draws nothing).
  const route = await fetchRouteForRide(rideId);
  if (route?.geojson) setRouteLayer(map, route.geojson);
  const finalWaypoint = findFinalWaypoint(route?.geojson);
  const updateFinishCelebration = setUpFinishCelebration(finalWaypoint);
  // Excludes the final waypoint (found in review): it's already
  // covered by the confetti celebration above, without this a named
  // finish waypoint fired BOTH a plain "Near: Finish" toast and
  // confetti in the same poll tick, a confusing double notification
  // for the one waypoint that's supposed to feel like a bigger moment.
  const checkpointWaypoints = findNamedWaypoints(route?.geojson).filter(
    (wp) => !(finalWaypoint && wp.lat === finalWaypoint.lat && wp.lng === finalWaypoint.lng),
  );
  const updateCheckpointProximity = setUpCheckpointProximity(checkpointWaypoints);

  const banner = document.createElement("div");
  banner.id = "join-banner";
  banner.textContent = "Joining ride...";
  document.body.appendChild(banner);

  try {
    const choice = await showJoinChoice(); // the explicit up-front choice, see its docstring above
    const tag = await showTagPicker(); // optional self-select role, see its docstring above
    // Only riders ever appear as a map dot, a spectator's color choice
    // would have nothing to apply to, so this screen is skipped for them.
    const color = choice === "ride" ? await showColorPicker() : null;

    let result: JoinResult;
    if (choice === "watch") {
      result = await joinAsSpectator(rideId, tag, color); // no location permission ever requested
    } else {
      result = await joinAsRider(rideId, tag, color); // requests permission, only falls back to spectator on real failure
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

    const onPollUpdate = (participants: RideParticipant[], ownStats: PollResult["ownStats"]) => {
      // Called after every successful poll (see sync.ts), redraw the
      // map with the freshest data.
      latestParticipantFeatures = toParticipantFeatures(participants); // remembered for the view-switcher, see above
      setParticipantLayer(map, {
        type: "FeatureCollection",
        features: latestParticipantFeatures,
      });
      updateRoster(participants); // same poll data, no extra network request, see setUpRosterView()'s docstring
      infoPanel.updateNearestRider(participants, participant.id); // same poll data too, see setUpInfoPanel()'s docstring
      infoPanel.updateOwnStats(ownStats);

      const own = participants.find((p) => p.id === participant.id);
      const ownPosition = own?.lat !== undefined && own?.lat !== null && own.lng !== null ? { lat: own.lat, lng: own.lng } : null;
      updateFinishCelebration(ownPosition);
      updateCheckpointProximity(ownPosition);
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
