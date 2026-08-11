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
  id: string; // uuid
  name: string;
  status: RideStatus;
  created_by: string; // uuid, the admin's auth.users id
  created_at: string; // ISO timestamp string
  started_at: string | null;
  ended_at: string | null;
  auto_end_after_hours: number;
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
 * @returns the newly created participant row.
 */
export async function joinRide(
  rideId: string,
  participantId: string,
  isSpectator: boolean,
): Promise<RideParticipant> {
  const { data, error } = await supabase
    .from("ride_participants")
    .insert({ id: participantId, ride_id: rideId, is_spectator: isSpectator }) // lat/lng start null, filled in by the first position update
    .select() // return the row we just inserted
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
