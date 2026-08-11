// ── Direct local-database access for e2e test setup/teardown ────────
// WHAT: these tests seed a ride straight into Postgres instead of
// going through the admin UI/API, so the test stays focused on the
// one thing it's actually verifying (the rider-facing join flow), not
// on also exercising admin sign-in and ride creation every run. This
// mirrors the same direct-psql verification pattern already used
// throughout this project's OPERATIONS.md.
//
// The connection string, API URL, and service-role key below are all
// Supabase CLI's fixed, publicly-documented local-only defaults
// (`supabase start` always uses them unless supabase/config.toml
// overrides the JWT secret, which this project's config doesn't), not
// real secrets, same as noted in OPERATIONS.md, so it's fine to have
// them directly in source here, unlike a real production credential.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const LOCAL_API_URL = "http://127.0.0.1:54321";
const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

/**
 * Runs a single SQL statement against the local Supabase database via
 * `psql`. Values are escaped with sqlLiteral() below rather than
 * relying on psql's `-v`/`:'name'` substitution, which turned out to
 * not apply to `-c` commands on the locally installed psql version
 * (confirmed directly: `psql -c "select :'foo'"` errors with a syntax
 * error even with a `-v foo=bar` set). Safe here because every value
 * passed in is either a UUID this file generated itself or a fixed
 * test string, never real user input.
 */
function runSql(sql: string): string {
  const args = ["-A", "-t", "-q", LOCAL_DB_URL, "-c", sql]; // -A/-t/-q: unaligned, tuples-only, quiet output, easy to parse
  return execFileSync("psql", args, { encoding: "utf-8" }).trim();
}

/** Escapes a string for safe use as a single-quoted SQL literal. */
function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Creates a throwaway admin account through the real Supabase Auth
 * Admin API (not a raw SQL insert into auth.users, that table has
 * several GoTrue-managed columns a hand-written insert easily gets
 * wrong), then grants it admin_roles access. This is what makes the
 * e2e suite self-contained: it doesn't depend on any account a human
 * happened to set up by hand before (like this project's real local
 * `realadmin@example.com`), so it works the same on a first-time
 * contributor's machine or a completely fresh CI runner.
 *
 * @returns the new user's id, only ever used to satisfy
 *   rides.created_by's foreign key, no admin sign-in actually happens
 *   in these tests.
 */
export async function createTestAdminUser(): Promise<string> {
  const email = `e2e-admin-${randomUUID()}@example.local`; // unique every run, never collides with a real or previous test account
  const response = await fetch(`${LOCAL_API_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: LOCAL_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${LOCAL_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password: randomUUID(), email_confirm: true }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create test admin user: HTTP ${response.status} ${await response.text()}`);
  }
  const user = (await response.json()) as { id: string };
  runSql(`insert into admin_roles (user_id) values (${sqlLiteral(user.id)});`);
  return user.id;
}

/** Removes a throwaway admin account created by createTestAdminUser(), reverse order (FK) of how it was set up. */
export async function deleteTestAdminUser(userId: string): Promise<void> {
  runSql(`delete from admin_roles where user_id = ${sqlLiteral(userId)};`);
  const response = await fetch(`${LOCAL_API_URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: { apikey: LOCAL_SERVICE_ROLE_KEY, Authorization: `Bearer ${LOCAL_SERVICE_ROLE_KEY}` },
  });
  if (!response.ok) {
    throw new Error(`Failed to delete test admin user: HTTP ${response.status} ${await response.text()}`);
  }
}

/**
 * Creates a ride directly in the "active" state (bypassing the normal
 * create-then-explicitly-start-it admin flow, see createRide()/
 * startRide() in src/core/adapters/supabase.ts for what this
 * shortcuts past) so a test can immediately try joining it.
 *
 * @param createdByUserId - an existing auth.users id, see
 *   createTestAdminUser() above.
 * @returns the new ride's id and its short join-link slug.
 */
export function seedActiveRide(name: string, createdByUserId: string): { rideId: string; slug: string } {
  const rideId = randomUUID();
  // Date.now() alone isn't unique enough: a test that seeds two rides
  // back-to-back (see multi-ride-isolation.spec.ts) can call this
  // twice within the same millisecond on a fast CI runner, a real
  // collision confirmed on a real CI run ("duplicate key value
  // violates unique constraint rides_slug_key"). A short random
  // suffix makes that practically impossible regardless of timing.
  const slug = `e2e${Date.now()}${randomUUID().slice(0, 8)}`;
  runSql(
    `insert into rides (id, name, status, created_by, slug, started_at)
     values (${sqlLiteral(rideId)}, ${sqlLiteral(name)}, 'active', ${sqlLiteral(createdByUserId)}, ${sqlLiteral(slug)}, now());`,
  );
  return { rideId, slug };
}

/** Counts real (non-spectator) participant rows for a ride, the proof a join actually wrote to the database. */
export function countRiderParticipants(rideId: string): number {
  const result = runSql(
    `select count(*) from ride_participants where ride_id = ${sqlLiteral(rideId)} and is_spectator = false;`,
  );
  return Number(result);
}

/** Deletes a test ride and everything attached to it (cascades, see the "any admin can delete any ride" migration). */
export function deleteRide(rideId: string): void {
  runSql(`delete from rides where id = ${sqlLiteral(rideId)};`);
}
