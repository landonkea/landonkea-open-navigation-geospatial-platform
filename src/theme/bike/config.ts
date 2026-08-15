// ── The bike-specific "theme" layer ──────────────────────────────
// WHAT: everything genuinely specific to bikeMesa/cycling lives here,
// wording, default tags, default update interval. Nothing in
// src/core/ ever imports from here directly, this file gets handed
// TO the core, not woven through it (see workingTitle-BUILD-PROMPT.md's
// "Generalize the core, keep bike-specific things swappable" section).
// A future non-bike group would copy this one file and change the
// values, not touch src/core/ at all.

// A single tag a participant can optionally self-select (e.g.
// "Marshal"), see the build prompt's "Optional rider tags" section.
// Declared as a TypeScript type (not just inline shapes) so every
// place that uses a tag gets real autocomplete/type-checking.
export type ParticipantTag = {
  id: string; // stable machine id, stored in the database, e.g. "marshal"
  label: string; // human-readable name shown in the UI, e.g. "Marshal"
  icon: string; // a small emoji icon shown next to the label/marker
};

// A map coordinate, {longitude, latitude}, matches the order MapLibre
// itself expects ([lng, lat], not [lat, lng], a common source of bugs
// if mixed up, this named type makes the order explicit everywhere).
export type LngLat = {
  lng: number; // longitude, east/west position
  lat: number; // latitude, north/south position
};

// The full shape of a theme config, typed so a future non-bike theme
// (e.g. a running-club theme) is forced by the compiler to provide
// every field the core actually needs, nothing silently missing.
export type EventTheme = {
  eventWordSingular: string; // shown wherever the generic core says "event"
  eventWordPlural: string; // plural form of the above
  participantWord: string; // shown wherever the generic core says "participant"
  // The "I'm ___ing" join-choice button's verb (e.g. "riding"), a
  // separate field rather than deriving it from participantWord by
  // appending "ing": that broke for "rider" (produced "ridering", a
  // real bug found by actually looking at the rendered button, not
  // every participant noun turns into its matching verb by suffix
  // alone, English doesn't work that way generically.
  participantVerbGerund: string;
  tags: ParticipantTag[]; // the starter list of self-select tags
  defaultUpdateIntervalSeconds: number; // how often a phone posts its location by default
  defaultMapCenter: LngLat; // where the map opens before any real ride is loaded
  defaultMapZoom: number; // initial zoom level, higher number = more zoomed in
  // Path to a client's logo, shown small and semi-transparent in the
  // corner of every screen (rider map + admin), see #brand-logo in
  // main.ts/admin.ts. Swapping a client's real logo in is just
  // replacing this one path (and the file it points to), no other
  // code changes anywhere. Null skips rendering it entirely, for a
  // theme with no logo yet.
  logoUrl: string | null;
  // "imperial" (mi/ft, mph, °F) or "metric" (km/m, km/h, °C), drives
  // every formatted distance/speed/temperature string via
  // src/core/units.ts. A per-theme setting rather than per-device,
  // since a given client's whole audience typically shares one
  // convention (this project's first client, bikeMesa, is a US group).
  unitSystem: "imperial" | "metric";
  // Curated hex colors a rider can pick for their own map dot's stroke
  // ring (see showColorPicker() in main.ts and src/core/map.ts), NOT
  // the dot's fill, which stays status-driven (green/yellow/red).
  // Chosen for contrast against both the satellite/street basemaps and
  // this app's own orange brand palette, not just any CSS color name.
  riderColors: string[];
  // Shown on the rider-facing "Emergency Info" card (see
  // setUpEmergencyInfoButton() in main.ts), alongside the nearest
  // hospital to the rider's current position (looked up live via
  // OpenStreetMap's Overpass API, not stored here, that's a function
  // of where the rider is, not a fixed theme value). Null skips the
  // "organizer contact" line, the nearest-hospital lookup still shows.
  emergencyContactInfo: string | null;
  // Curated emoji a rider can optionally attach to a highlights-wall
  // post (see setUpHighlightsButton() in main.ts). A fixed short list,
  // not a full emoji picker, matching riderColors' "curated, not
  // unlimited" reasoning above.
  highlightEmoji: string[];
};

// The actual bike/bikeMesa theme values, this is the one export other
// files (src/main.ts) actually import and use.
export const bikeTheme: EventTheme = {
  eventWordSingular: "ride", // "ride" instead of the generic "event"
  eventWordPlural: "rides", // plural of the above
  participantWord: "rider", // "rider" instead of the generic "participant"
  participantVerbGerund: "riding", // "I'm riding", the join-choice button's verb

  // Narrowed down from the build prompt's original 7-tag starter list
  // to just these two, per explicit request, plus the always-present
  // "No tag" option in showTagPicker() (main.ts) covers "a standard
  // rider, nothing special." A plain array, not a hardcoded enum, so
  // an admin can add more later without a code change (once an admin
  // UI for editing this list exists, not yet built). Any ride's
  // existing participant rows tagged with a since-removed id (e.g.
  // "sweep") still work fine, tagLabel() in main.ts just falls back
  // to showing the raw id for those instead of a pretty label.
  tags: [
    { id: "marshal", label: "Traffic Marshal", icon: "🚦" }, // directs traffic, usually stationary
    { id: "dj", label: "DJ Bike", icon: "🎵" }, // provides music for the group
  ],

  // 15 seconds is the build prompt's recommended default, riders can
  // change this per-device at any time from a picker (not yet built).
  defaultUpdateIntervalSeconds: 15,

  // Mesa, Arizona, a bikeMesa-specific placeholder map center, a
  // future non-bike theme would set its own location here instead.
  defaultMapCenter: { lng: -111.8315, lat: 33.4152 },
  defaultMapZoom: 12, // roughly "whole city" zoom level

  // A placeholder mark, not bikeMesa's real logo (none exists yet).
  // Swap this path (and public/logo-placeholder.svg itself) for a
  // real client logo whenever one's ready.
  logoUrl: "/logo-placeholder.svg",

  unitSystem: "imperial", // bikeMesa is a US audience

  riderColors: ["#2196f3", "#e91e63", "#9c27b0", "#00bcd4", "#8bc34a", "#ffeb3b", "#795548"],

  // Placeholder, not a real bikeMesa organizer contact (none provided
  // yet). Swap for a real name/phone number whenever one's ready, same
  // as logoUrl above.
  emergencyContactInfo: "Ride organizer: see event listing for contact info",

  highlightEmoji: ["🔥", "😂", "💪", "🚴", "😅", "🌅", "🏆"],
};
