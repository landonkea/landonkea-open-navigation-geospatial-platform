// ── App entry point ────────────────────────────────────────────────
// Wires the generic core (src/core/) together with the bike theme
// (src/theme/bike/config.ts). Page title/theme-color/layout CSS are
// set here in TypeScript rather than hardcoded in index.html/a .css
// file, see applyBaseStyles() below.

import "maplibre-gl/dist/maplibre-gl.css"; // MapLibre's required stylesheet, bundled by Vite, not a CDN link
import { createMap, setParticipantLayer, type ParticipantFeature } from "./core/map";
import { bikeTheme } from "./theme/bike/config";
import { joinRideFlow, retryLocationShare, type SpectatorReason } from "./core/join";
import { startPolling } from "./core/sync";
import { signalStatus } from "./core/geo";
import type { RideParticipant } from "./core/adapters/supabase";

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
 * Reads the ride id to join from the URL, e.g. index.html?ride=<uuid>,
 * this is the "join link" the build prompt describes riders opening.
 */
function getRideIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("ride");
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
      return "Location access was denied. Check your browser's site settings to allow it, then try again.";
    case "position_unavailable":
      return "Couldn't get a location fix (no GPS signal or location services are off). Try again outdoors or with location services enabled.";
    case "timeout":
      return "Location request timed out. Try again with a clearer view of the sky.";
    case "unsupported":
      return "This browser doesn't support location sharing.";
    default:
      return "Location wasn't shared.";
  }
}

async function main(): Promise<void> {
  applyBaseStyles();
  registerServiceWorker();

  const map = createMap("map", bikeTheme.defaultMapCenter, bikeTheme.defaultMapZoom);
  map.on("load", () => {
    setParticipantLayer(map, { type: "FeatureCollection", features: [] }); // empty until real data arrives
  });

  const rideId = getRideIdFromUrl();
  if (!rideId) {
    // No ride to join, e.g. someone opened the bare app URL with no
    // link. A real "create/find a ride" screen is future admin-side
    // work, for now just say so plainly rather than silently doing
    // nothing.
    const banner = document.createElement("div");
    banner.id = "join-banner";
    banner.textContent = "No ride link provided, open a real ride's join link to see its live map.";
    document.body.appendChild(banner);
    return;
  }

  const banner = document.createElement("div");
  banner.id = "join-banner";
  banner.textContent = "Joining ride...";
  document.body.appendChild(banner);

  try {
    const { participant, isSpectator, spectatorReason } = await joinRideFlow(rideId);
    let currentlySpectator = isSpectator; // tracked mutably, a retry can flip this mid-session
    let stopPolling: () => void; // assigned below, re-assigned again if a retry restarts polling

    const redrawBanner = () => {
      if (!currentlySpectator) {
        banner.innerHTML = "Joined, sharing your live location.";
        return;
      }
      // Spectator: show why, plus a real retry button, not a dead end.
      banner.innerHTML = "";
      banner.append(spectatorReasonMessage(spectatorReason));
      const retryButton = document.createElement("button");
      retryButton.textContent = "Try again";
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
            banner.innerHTML = "";
            banner.append(spectatorReasonMessage(outcome.reason));
            banner.appendChild(retryButton); // keep the same button usable for another attempt
            retryButton.disabled = false;
            retryButton.textContent = "Try again";
          }
        } catch (err) {
          console.error(err);
          retryButton.disabled = false;
          retryButton.textContent = "Try again";
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
