// ── App entry point ────────────────────────────────────────────────
// Wires the generic core (src/core/) together with the bike theme
// (src/theme/bike/config.ts). Page title/theme-color/layout CSS are
// set here in TypeScript rather than hardcoded in index.html/a .css
// file, see applyBaseStyles() below.

import "maplibre-gl/dist/maplibre-gl.css"; // MapLibre's required stylesheet, bundled by Vite, not a CDN link
import { createMap, setParticipantLayer, type ParticipantFeature } from "./core/map";
import { bikeTheme } from "./theme/bike/config";
import { joinAsRider, joinAsSpectator, retryLocationShare, type JoinResult, type SpectatorReason } from "./core/join";
import { startPolling } from "./core/sync";
import { signalStatus } from "./core/geo";
import { detectLocationGuidance } from "./core/locationHelp";
import { fetchRide, fetchRideBySlug, type RideParticipant } from "./core/adapters/supabase";

function applyBaseStyles(): void {
  document.title = `${bikeTheme.eventWordSingular} live map`; // e.g. "ride live map"

  const themeColorMeta = document.createElement("meta");
  themeColorMeta.name = "theme-color";
  themeColorMeta.content = "#1f6feb";
  document.head.appendChild(themeColorMeta);

  const layoutStyle = document.createElement("style");
  layoutStyle.textContent = `
    html, body { margin: 0; height: 100%; font-family: system-ui, sans-serif; }
    #map { position: absolute; inset: 0; }
    #join-banner { position: absolute; top: 0; left: 0; right: 0; z-index: 10; background: #1f6feb; color: white; padding: 8px 12px; font-size: 14px; text-align: center; }
    #join-banner button { margin-left: 10px; padding: 4px 10px; font-size: 13px; background: white; color: #1f6feb; border: none; border-radius: 4px; cursor: pointer; }
    #join-choice { position: absolute; inset: 0; z-index: 20; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; }
    #join-choice .card { background: white; border-radius: 10px; padding: 28px; max-width: 360px; text-align: center; }
    #join-choice h2 { margin-top: 0; }
    #join-choice button { display: block; width: 100%; padding: 14px; margin: 8px 0; font-size: 16px; border-radius: 6px; border: none; cursor: pointer; }
    #join-choice .ride-btn { background: #1f6feb; color: white; }
    #join-choice .watch-btn { background: #eee; color: #222; }
    #location-help { position: absolute; inset: 0; z-index: 20; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; }
    #location-help .card { background: white; border-radius: 10px; padding: 24px; max-width: 380px; }
    #location-help ol { padding-left: 20px; }
    #location-help li { margin-bottom: 8px; }
    #location-help button { padding: 10px 16px; font-size: 15px; background: #1f6feb; color: white; border: none; border-radius: 6px; cursor: pointer; margin-top: 8px; }
  `;
  document.head.appendChild(layoutStyle);
}

function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js");
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

  const pathSlug = window.location.pathname.replace(/^\/+/, ""); // strip the leading slash
  return pathSlug || null; // empty path (just "/") means no ride
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
        <button class="ride-btn" id="choice-ride">I'm ${bikeTheme.participantWord}ing</button>
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
        <button id="location-help-watch" style="background:#eee;color:#222;">Just watch instead</button>
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

async function main(): Promise<void> {
  applyBaseStyles();
  registerServiceWorker();

  const map = createMap("map", bikeTheme.defaultMapCenter, bikeTheme.defaultMapZoom);

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
  const rideId = ride.id; // the real internal uuid, used for every call from here on, the slug's only job was finding this

  const banner = document.createElement("div");
  banner.id = "join-banner";
  banner.textContent = "Joining ride...";
  document.body.appendChild(banner);

  try {
    const choice = await showJoinChoice(); // the explicit up-front choice, see its docstring above

    let result: JoinResult;
    if (choice === "watch") {
      result = await joinAsSpectator(rideId); // no location permission ever requested
    } else {
      result = await joinAsRider(rideId); // requests permission, only falls back to spectator on real failure
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
            stopPolling(); // stop the spectator-mode loop (which never posts a position)
            stopPolling = startPolling(
              participant.id,
              rideId,
              false, // now sharing for real
              bikeTheme.defaultUpdateIntervalSeconds,
              onPollUpdate,
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
      setParticipantLayer(map, {
        type: "FeatureCollection",
        features: toParticipantFeatures(participants),
      });
    };

    redrawBanner();
    stopPolling = startPolling(
      participant.id,
      rideId,
      currentlySpectator,
      bikeTheme.defaultUpdateIntervalSeconds,
      onPollUpdate,
    );
  } catch (err) {
    banner.textContent = `Couldn't join this ride: ${err instanceof Error ? err.message : String(err)}`;
    console.error(err);
  }
}

main();
