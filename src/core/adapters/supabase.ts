// ── The Supabase adapter ────────────────────────────────────────────
// WHAT THIS IS: the one and only place in this app that talks to
// Supabase directly. Every other file that needs ride/participant
// data calls a function from here, never the Supabase client itself,
// see the build prompt's "Architecture principle: modular, replaceable
// services" section for why (if Supabase ever needs replacing, this
// is the only file that changes).
//
// WHAT IT'S FOR: Supabase is our backend, a hosted Postgres database
// plus a login system (Auth), reached over a plain HTTPS API. This
// app stores rides, who's in them, and their live positions here.
//
// HOW TO TELL IT'S BROKEN: every function below throws a real Error
// with a plain-language message if a request fails, look for that
// message in the browser console. Common specific symptoms:
//   - A blank map with no participants ever appearing: check the
//     browser's Network tab for failed requests to the URL in
//     VITE_SUPABASE_URL, a 401/403 usually means the anon key is
//     wrong or missing.
//   - "Failed to fetch" / a generic network error: either the local
//     Supabase isn't running (`supabase status` from the repo root
//     should show it as running), or, in production, the real
//     Supabase project is paused (see below).
//
// HOW TO FIX IT:
//   - Local development: run `supabase status` in the repo root, if
//     nothing's running, run `supabase start` (needs Docker Desktop
//     open first).
//   - Production: log into supabase.com/dashboard, open the project,
//     if it shows "paused" (happens after 7 days with zero activity
//     on the free tier), click to un-pause it, this is exactly the
//     failure mode the build prompt's "keep-alive ping" GitHub Action
//     exists to prevent, so also check that Action's run history for
//     recent failures.
//   - Wrong/missing credentials: check .env.local (local dev) or the
//     hosting provider's environment variable settings (production)
//     against the values shown by `supabase status` or the real
//     project's Settings → API page.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { baseSlugForDate, pickUniqueSlug } from "../rideSlug"; // short-link generation, see that file's docstring

// ── Client setup ────────────────────────────────────────────────────
// Read from Vite's environment variables (see .env.example), never
// hardcoded, so the exact same code works against local Supabase
// during development and the real hosted project in production, only
// the environment variables differ between them.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string; // e.g. http://127.0.0.1:54321
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string; // the public, safe-to-expose key

if (!supabaseUrl || !supabaseAnonKey) {
  // Fail loudly and immediately at startup rather than letting every
  // later call fail with a confusing generic network error, a novice
  // reading the console should see exactly what's missing.
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill in real values (see that file's comments for where to find them).",
  );
}

// A single shared client instance, reused by every function below
// rather than creating a new connection per call.
const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey);

// ── Row types ────────────────────────────────────────────────────────
// Mirror supabase/migrations/20260810000000_initial_schema.sql's
// column names exactly, if the schema changes, these types (and every
// place that fails to type-check afterward) point at exactly what
// else needs updating.

export type RideStatus = "created" | "active" | "ended"; // matches the schema's check constraint

export type Ride = {
  id: string; // uuid, the original (still-valid) internal identifier
  name: string;
  status: RideStatus;
  created_by: string; // uuid, the admin's auth.users id
  created_at: string; // ISO timestamp string
  started_at: string | null;
  ended_at: string | null;
  auto_end_after_hours: number;
  // Short, date-based public link segment (e.g. "08112026"), see
  // src/core/rideSlug.ts and its migration for the format and the
  // honest guessability tradeoff. Null for any ride created before
  // this column existed.
  slug: string | null;
};

export type RideParticipant = {
  id: string; // uuid, client-generated, see this file's joinRide()
  ride_id: string; // uuid, which ride this participant belongs to
  is_spectator: boolean;
  tag: string | null; // one of bikeTheme.tags' ids, or null
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  heading_deg: number | null;
  speed_mps: number | null;
  joined_at: string;
  last_seen_at: string;
  // Updated only when position meaningfully changes (see
  // src/core/stuckDetection.ts's countsAsMovement()), left untouched
  // while stationary. Powers the "possibly stuck" admin flag, not
  // connection-status, a rider can have perfect signal (recent
  // last_seen_at) while genuinely stopped.
  last_moved_at: string;
};

// ── Ride functions ──────────────────────────────────────────────────

/**
 * Fetches one ride's basic info (name, status) by id. Used to confirm
 * a join link is actually valid before letting someone in, and to
 * drive the rider-vs-spectator screen's copy (e.g. showing the ride
 * name).
 *
 * @param rideId - the ride's uuid, taken from the join link's URL.
 * @returns the ride row, or null if no ride with that id exists (a
 *   bad/expired link, handled by the caller as "this ride wasn't
 *   found" rather than a crash).
 */
export async function fetchRide(rideId: string): Promise<Ride | null> {
  const { data, error } = await supabase
    .from("rides") // the table to query
    .select("*") // every column, we need all of them here
    .eq("id", rideId) // filter to just this one ride
    .maybeSingle(); // expect 0 or 1 row, not an array

  if (error) throw new Error(`Failed to fetch ride: ${error.message}`); // surface a real error, don't fail silently
  return data as Ride | null; // null means "no ride with that id", a normal, expected case
}

/**
 * Fetches just a ride's status, a much smaller query than fetchRide()'s
 * full row, used on every poll (see sync.ts's pollOnce()) specifically
 * so a rider's app can notice an admin ending the ride and stop
 * broadcasting, without paying the cost of re-fetching the whole ride
 * row that often.
 *
 * @param rideId - which ride to check.
 * @returns the current status, or null if the ride somehow no longer
 *   exists (treated the same as "ended" by the caller, either way
 *   there's nothing left to broadcast to).
 */
export async function fetchRideStatus(rideId: string): Promise<RideStatus | null> {
  const { data, error } = await supabase.from("rides").select("status").eq("id", rideId).maybeSingle();

  if (error) throw new Error(`Failed to check ride status: ${error.message}`);
  return data ? (data.status as RideStatus) : null;
}

/**
 * Fetches one ride by its short slug (e.g. "08112026") instead of its
 * internal uuid. This is what the rider-facing app actually looks up
 * first, since join links/QR codes now use the short slug (see
 * src/core/rideSlug.ts), the app then uses the returned ride's real
 * `id` for every other call (joining, polling, etc.), the slug itself
 * is never used as a database foreign key anywhere else.
 *
 * @param slug - the short link segment from the URL.
 * @returns the ride row, or null if no ride has that slug (a bad/
 *   mistyped link, handled by the caller as "not found", not a crash).
 */
export async function fetchRideBySlug(slug: string): Promise<Ride | null> {
  const { data, error } = await supabase
    .from("rides") // same table as fetchRide() above
    .select("*") // every column
    .eq("slug", slug) // filter by the short slug instead of the uuid
    .maybeSingle(); // expect 0 or 1 row

  if (error) throw new Error(`Failed to fetch ride by slug: ${error.message}`);
  return data as Ride | null;
}

/**
 * Fetches every slug currently in use, so a new ride's slug can be
 * checked for same-day collisions (see rideSlug.ts's pickUniqueSlug())
 * before it's actually created.
 *
 * @returns a Set of every non-null slug string in the rides table.
 */
export async function fetchAllRideSlugs(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("rides")
    .select("slug") // only need this one column, not the whole row
    .not("slug", "is", null); // skip any old rides created before slugs existed

  if (error) throw new Error(`Failed to fetch existing ride slugs: ${error.message}`);
  return new Set((data ?? []).map((row) => row.slug as string)); // build a Set for fast "already taken?" checks
}

/**
 * Fetches every ride, newest first, for the admin panel's ride list
 * (renderRideList() in admin.ts) so an admin can find/manage/export a
 * ride from a past session, not only the one they just created.
 * Admin-only BY UI CONVENTION, not by RLS: the `rides` table's SELECT
 * policy is `USING (true)` (anyone with the anon key can already read
 * any ride, confirmed against the schema, that's what makes
 * fetchAllRideSlugs() above possible too), this function is only ever
 * called from behind admin.ts's sign-in gate, deliberately, the
 * rider-facing app never lists rides publicly, see OPERATIONS.md's
 * "Decisions made" section for the reasoning.
 *
 * @param limit - how many rides to fetch, newest first, defaults to a
 *   reasonable page size rather than the entire table's history.
 */
export async function fetchAllRides(limit = 50): Promise<Ride[]> {
  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to fetch rides: ${error.message}`);
  return (data ?? []) as Ride[];
}

// ── Participant functions ───────────────────────────────────────────

/**
 * Joins a participant to a ride, either as a tracked rider or a
 * spectator (see the build prompt's "Spectator mode" section, both
 * use this exact same function, the only difference is the
 * `isSpectator` flag).
 *
 * @param rideId - which ride to join.
 * @param participantId - a UUID generated once per device per ride
 *   (see src/core/participantId.ts, not yet built) and reused for
 *   every later update, this is what lets a rider's own phone update
 *   its own row on subsequent polls with no login involved.
 * @param isSpectator - true if location permission was denied/never
 *   requested, see the build prompt's rider-vs-spectator branch.
 * @param tag - one of bikeTheme.tags' ids (e.g. "marshal"), or null
 *   for no tag, the build prompt's "Optional rider tags" section is
 *   explicitly self-select, this is whatever the person picked on
 *   their own join screen (see showTagPicker() in main.ts), not
 *   anything assigned to them by an admin.
 * @returns the participant row, either freshly created or the
 *   existing one for this device+ride.
 */
export async function joinRide(
  rideId: string,
  participantId: string,
  isSpectator: boolean,
  tag: string | null = null,
): Promise<RideParticipant> {
  // upsert, not insert: participantId is stable per device+ride (see
  // participantId.ts), so a page reload mid-ride reuses the same id.
  // A plain insert would fail with a duplicate-key error on that
  // second attempt, a real bug found by actually reloading the app,
  // not by reading the code. upsert resumes the existing row instead
  // of erroring.
  const { data, error } = await supabase
    .from("ride_participants")
    .upsert({ id: participantId, ride_id: rideId, is_spectator: isSpectator, tag }) // lat/lng start null, filled in by the first position update
    .select() // return the row, whether it was just created or already existed
    .single(); // expect exactly one row back

  if (error) throw new Error(`Failed to join ride: ${error.message}`);
  return data as RideParticipant;
}

/**
 * Updates a participant's own position, called on every poll interval
 * for anyone who isn't a spectator (see the build prompt's "Critical
 * architecture decision: polling, not persistent realtime
 * connections" section, this is a plain HTTPS request, not a held-
 * open connection).
 *
 * @param participantId - this device's own participant id (from
 *   joinRide's return value).
 * @param position - the latest GPS reading plus derived heading/speed
 *   (see src/core/geo.ts for how heading/speed get computed).
 * @param movedSinceLastPoll - whether this update counts as real
 *   movement, not just GPS jitter (see stuckDetection.ts's
 *   countsAsMovement(), computed by the caller since it needs the
 *   previous point, which this adapter doesn't track). When true,
 *   last_moved_at is bumped to now; when false, it's left as-is, so
 *   it keeps reflecting whenever this participant last actually moved.
 */
export async function updateParticipantPosition(
  participantId: string,
  position: {
    lat: number;
    lng: number;
    accuracyM: number;
    headingDeg: number | null;
    speedMps: number | null;
  },
  movedSinceLastPoll: boolean,
): Promise<void> {
  const update: Record<string, unknown> = {
    lat: position.lat,
    lng: position.lng,
    accuracy_m: position.accuracyM,
    heading_deg: position.headingDeg,
    speed_mps: position.speedMps,
    last_seen_at: new Date().toISOString(), // marks this update as "fresh" for signal-status purposes
  };
  if (movedSinceLastPoll) {
    update.last_moved_at = new Date().toISOString(); // only bumped on real movement, see this function's docs
  }

  const { error } = await supabase
    .from("ride_participants")
    .update(update)
    .eq("id", participantId); // only ever update this device's own row

  if (error) throw new Error(`Failed to update position: ${error.message}`);
}

/**
 * Persists one point into `ride_history_samples`, the append-only log
 * a ride's route gets exported from later (GPX/CSV, not built yet).
 * Deliberately separate from updateParticipantPosition above, which
 * overwrites a single "current position" row every poll, this instead
 * inserts a new row every call, building up a full trail over time.
 * The caller (src/core/sync.ts) throttles how often it actually calls
 * this to HISTORY_SAMPLE_INTERVAL_SECONDS (see policy.ts), not every
 * single live poll, to keep row count bounded at real scale.
 *
 * @param rideId - which ride this sample belongs to.
 * @param participantId - which participant this sample belongs to.
 * @param lat - latitude at the moment sampled.
 * @param lng - longitude at the moment sampled.
 * @param recordedAtIso - when this position was actually read on the
 *   device (not "now", the device's own GPS timestamp), so exported
 *   routes reflect real timing even if the insert itself lands late.
 */
export async function insertHistorySample(
  rideId: string,
  participantId: string,
  lat: number,
  lng: number,
  recordedAtIso: string,
): Promise<void> {
  const { error } = await supabase.from("ride_history_samples").insert({
    ride_id: rideId,
    participant_id: participantId,
    lat,
    lng,
    recorded_at: recordedAtIso,
  });

  if (error) throw new Error(`Failed to record history sample: ${error.message}`);
}

/**
 * Fetches every current participant in a ride, riders, spectators,
 * and tagged roles alike (the caller decides how to render each,
 * e.g. spectators never get drawn as a map dot). This is the other
 * half of the polling loop, called on the same interval as
 * updateParticipantPosition, per the same "plain HTTPS request, not a
 * held-open connection" design.
 *
 * @param rideId - which ride's participants to fetch.
 */
export async function fetchParticipants(rideId: string): Promise<RideParticipant[]> {
  const { data, error } = await supabase
    .from("ride_participants")
    .select("*")
    .eq("ride_id", rideId);

  if (error) throw new Error(`Failed to fetch participants: ${error.message}`);
  return (data ?? []) as RideParticipant[]; // default to an empty list, never null, simpler for callers
}

// ── Admin auth + ride management ────────────────────────────────────
// WHAT: unlike regular riders/spectators, the ~10 admins genuinely log
// in (build prompt's "Accounts / auth" section), using Supabase Auth's
// plain email+password sign-in, the simplest option and enough for a
// small, known admin list.

/**
 * Signs in an admin with email + password. Throws a plain-language
 * error on failure (wrong password, unknown email, account not yet
 * granted admin access), the caller shows this directly to the user
 * rather than a generic "login failed".
 *
 * @returns the signed-in user's id, needed to check admin_roles.
 */
export async function signInAdmin(email: string, password: string): Promise<string> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed: ${error.message}`);
  if (!data.user) throw new Error("Sign-in succeeded but no user was returned, this shouldn't happen.");
  return data.user.id;
}

/**
 * Checks whether a signed-in user is actually a granted admin (has a
 * row in admin_roles), separate from just being logged in, since
 * Supabase Auth alone doesn't know about our club-specific admin
 * list. A real account can exist without admin access, e.g. someone
 * who signed up but was never granted a role.
 */
export async function isGrantedAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("admin_roles")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Failed to check admin status: ${error.message}`);
  return data !== null;
}

/**
 * Creates a new ride, immediately active and joinable (build prompt's
 * ride lifecycle starts at "created", but for this first admin screen
 * we skip straight to "active" since there's no separate "prepare,
 * then start" step built yet, see workingTitle-BUILD-PROMPT.md's
 * "Ride lifecycle: explicit start and end" for the fuller version).
 *
 * @param name - the ride's display name, e.g. "Saturday Morning Loop".
 * @param createdByUserId - the signed-in admin's user id.
 * @returns the newly created ride row.
 */
export async function createRide(name: string, createdByUserId: string): Promise<Ride> {
  // Build today's short slug (e.g. "08112026"), checking every
  // existing slug first so two rides created the same day don't
  // collide (see rideSlug.ts's pickUniqueSlug() for the "-2", "-3"
  // suffix behavior).
  const existingSlugs = await fetchAllRideSlugs(); // one query, every slug currently in use
  const baseSlug = baseSlugForDate(); // today's date, formatted
  const slug = pickUniqueSlug(baseSlug, existingSlugs); // the actual slug this ride will get

  const { data, error } = await supabase
    .from("rides")
    .insert({
      name,
      // Not "active": the schema's own default is "created" (an
      // explicit not-yet-started state, `rides_status_check` has
      // always allowed it), this used to be overridden here to jump
      // straight to "active" on creation, skipping that state
      // entirely, an admin now has to explicitly call startRide()
      // below (build prompt's "Ride lifecycle" section wants a real
      // start step, matching the "End Ride" control this already had).
      status: "created",
      created_by: createdByUserId,
      slug, // started_at stays null until startRide() actually starts it
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create ride: ${error.message}`);
  return data as Ride;
}

/**
 * Explicitly starts a ride: flips it from "created" to "active" and
 * stamps started_at. Until this is called, riders can't actually join
 * (the "anyone can join an active ride" RLS policy on
 * ride_participants requires status = 'active', see that policy in
 * the schema), the rider-facing app shows a plain "hasn't started
 * yet" message instead (see main.ts). Symmetric with endRide() below.
 *
 * @param rideId - which ride to start.
 */
export async function startRide(rideId: string): Promise<void> {
  const { error } = await supabase
    .from("rides")
    .update({ status: "active", started_at: new Date().toISOString() })
    .eq("id", rideId);

  if (error) throw new Error(`Failed to start ride: ${error.message}`);
}

/**
 * Flips an existing participant from spectator to rider, used when
 * someone retries granting location access after an initial denial
 * (see src/core/join.ts's retryLocationShare()). Updates the same
 * row/id rather than creating a second participant, so this stays one
 * consistent identity for the rest of the ride.
 */
export async function becomeRider(participantId: string): Promise<void> {
  const { error } = await supabase
    .from("ride_participants")
    .update({ is_spectator: false })
    .eq("id", participantId);

  if (error) throw new Error(`Failed to switch to rider mode: ${error.message}`);
}

/**
 * Ends a ride: sets status to 'ended' and records when. Build
 * prompt's "Ride lifecycle" section, this is what should "stop new
 * broadcasts and trigger deletion after the real 20-minute window."
 * The actual stopping-new-broadcasts part happens client-side, see
 * sync.ts's pollOnce(), which now also checks ride status on every
 * poll and stops itself once it sees 'ended'. Any admin can end any
 * ride, not just ones they created (same shared-access policy as
 * ride creation/editing, see the RLS policy on `rides`).
 *
 * @param rideId - which ride to end.
 */
export async function endRide(rideId: string): Promise<void> {
  const { error } = await supabase
    .from("rides")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", rideId);

  if (error) throw new Error(`Failed to end ride: ${error.message}`);
}

// ── Route functions ──────────────────────────────────────────────────

export type Route = {
  id: string;
  ride_id: string;
  source: "gpx" | "drawn" | "none";
  geojson: GeoJSON.FeatureCollection | null;
  created_at: string;
};

/**
 * Saves a route (the route line plus any waypoints) for a ride.
 * Admin-only, matches the "admins can create routes" RLS policy. The
 * schema's `source` column just labels how the route was produced
 * (`routes_source_check` constrains it to "gpx"/"drawn"/"none"), it
 * doesn't change how the route is stored or rendered, both GPX upload
 * (src/core/gpx.ts) and hand-drawing (renderRouteDrawer() in
 * admin.ts) end up as the exact same GeoJSON shape and go through
 * this one function.
 *
 * @param rideId - which ride this route belongs to.
 * @param geojson - the route as GeoJSON (parsed from a GPX file, or
 *   built point-by-point from map clicks).
 * @param source - how this route was produced, defaults to "gpx"
 *   since that was this function's only caller until drawing existed.
 * @returns the newly created route row.
 */
export async function createRoute(
  rideId: string,
  geojson: GeoJSON.FeatureCollection,
  source: "gpx" | "drawn" = "gpx",
): Promise<Route> {
  const { data, error } = await supabase
    .from("routes")
    .insert({ ride_id: rideId, source, geojson })
    .select()
    .single();

  if (error) throw new Error(`Failed to save route: ${error.message}`);
  return data as Route;
}

/**
 * Fetches a ride's route, if it has one. Used by the rider-facing map
 * to draw the planned route line/waypoints (see the build prompt's
 * "Rides and routes" section, not every ride has a fixed route, a
 * "no fixed route" ride is valid too, this simply returns null then).
 *
 * @param rideId - which ride's route to fetch.
 * @returns the route row, or null if this ride has no route yet.
 */
export async function fetchRouteForRide(rideId: string): Promise<Route | null> {
  const { data, error } = await supabase.from("routes").select("*").eq("ride_id", rideId).maybeSingle();

  if (error) throw new Error(`Failed to fetch route: ${error.message}`);
  return data as Route | null;
}

// ── History/export functions ────────────────────────────────────────

/**
 * Fetches every history sample recorded for a ride (see
 * insertHistorySample() above for how these rows get written), used
 * by the admin export feature (src/core/rideExport.ts turns this raw
 * list into a downloadable GPX/CSV file). No pagination: a ride's
 * total sample count is bounded by HISTORY_SAMPLE_INTERVAL_SECONDS
 * (policy.ts) and realistic ride length, not expected to be large
 * enough to need it.
 *
 * @param rideId - which ride's samples to fetch.
 * @returns every sample for the ride, oldest and newest mixed
 *   together across participants, the caller groups/sorts as needed
 *   (see samplesToGpx/samplesToCsv).
 */
export async function fetchHistorySamples(
  rideId: string,
): Promise<{ participantId: string; lat: number; lng: number; recordedAt: string }[]> {
  const { data, error } = await supabase
    .from("ride_history_samples")
    .select("participant_id, lat, lng, recorded_at")
    .eq("ride_id", rideId);

  if (error) throw new Error(`Failed to fetch history samples: ${error.message}`);
  return (data ?? []).map((row) => ({
    participantId: row.participant_id as string,
    lat: row.lat as number,
    lng: row.lng as number,
    recordedAt: row.recorded_at as string,
  }));
}
