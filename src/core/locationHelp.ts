// ── Device-specific guidance for fixing blocked location access ─────
// WHAT: when a browser has already permanently blocked location for
// this site (a past denial, remembered by the browser), calling
// getCurrentPosition() again never even shows a permission prompt, it
// just fails immediately with "permission_denied", every time, until
// the person manually changes it in their device's settings.
//
// HONEST LIMIT, worth stating plainly: no website can open a phone's
// Settings app or a desktop browser's settings panel for you, every
// browser deliberately blocks that (it would be a serious privacy/
// security hole if a webpage could reach into OS settings). There is
// no "automatically take them there" button anywhere on the web. What
// this file DOES do: detect the device/browser as best it can from
// the user agent string (an imperfect signal, browsers can lie about
// it, but a reasonable best-effort) and give exact, specific
// click-by-click instructions instead of one generic paragraph that
// doesn't match what's actually on their screen.

export type DeviceGuidance = {
  label: string; // short name of the detected platform, e.g. "iPhone (Safari)"
  steps: string[]; // ordered, specific instructions for that platform
};

/**
 * Best-effort detection of which device/browser guidance to show.
 * Falls back to generic instructions if detection isn't confident.
 */
export function detectLocationGuidance(): DeviceGuidance {
  const ua = navigator.userAgent;

  const isIOS = /iPhone|iPad|iPod/.test(ua);
  const isAndroid = /Android/.test(ua);
  const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS/.test(ua);
  const isChrome = /Chrome|CriOS/.test(ua);
  const isFirefox = /Firefox|FxiOS/.test(ua);

  if (isIOS && isSafari) {
    return {
      label: "iPhone/iPad (Safari)",
      steps: [
        "Open the Settings app (not Safari itself).",
        "Scroll down and tap Safari.",
        "Tap Location, then choose \"Ask\" or \"Allow\".",
        "If Location Services is off system-wide: Settings → Privacy & Security → Location Services → turn it on.",
        "Come back to this page and tap \"Try again\" below.",
      ],
    };
  }

  if (isIOS && isChrome) {
    return {
      label: "iPhone/iPad (Chrome)",
      steps: [
        "Open the Settings app (not Chrome itself).",
        "Scroll down and tap Chrome.",
        "Tap Location, then choose \"Ask\" or \"Allow\".",
        "Come back to this page and tap \"Try again\" below.",
      ],
    };
  }

  if (isAndroid && isChrome) {
    return {
      label: "Android (Chrome)",
      steps: [
        "Tap the lock or info icon (🔒 or ⓘ) just left of the address bar at the top.",
        "Tap Permissions, then Location.",
        "Choose \"Allow\".",
        "Come back to this page and tap \"Try again\" below.",
      ],
    };
  }

  if (isAndroid) {
    return {
      label: "Android",
      steps: [
        "Tap the lock or info icon just left of the address bar.",
        "Look for a Location or Site settings option and allow it.",
        "Also check your phone's Settings → Location is turned on.",
        "Come back to this page and tap \"Try again\" below.",
      ],
    };
  }

  if (isSafari) {
    return {
      label: "Mac (Safari)",
      steps: [
        "Click the Safari menu → Settings (or Preferences) → Websites tab.",
        "Click Location on the left, find this site in the list, and change it to \"Allow\".",
        "Come back to this page and click \"Try again\" below.",
      ],
    };
  }

  if (isChrome) {
    return {
      label: "Desktop (Chrome)",
      steps: [
        "Click the lock icon just left of the address bar.",
        "Click Site settings, then set Location to \"Allow\".",
        "Come back to this page and click \"Try again\" below.",
      ],
    };
  }

  if (isFirefox) {
    return {
      label: "Desktop (Firefox)",
      steps: [
        "Click the lock icon just left of the address bar.",
        "Clear the location permission (or set it to Allow), then reload this page.",
        "Click \"Try again\" below.",
      ],
    };
  }

  return {
    label: "your browser",
    steps: [
      "Look for a lock or site-info icon next to the address bar and check its permissions.",
      "Find Location in that list and set it to Allow.",
      "Also check your device's system-wide location setting is turned on.",
      "Come back to this page and tap/click \"Try again\" below.",
    ],
  };
}
