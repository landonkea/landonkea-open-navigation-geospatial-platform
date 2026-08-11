// ── Direct local-database access for e2e test setup/teardown ────────
// WHAT: these tests seed a ride straight into Postgres instead of
// going through the admin UI/API, so the test stays focused on the
// one thing it's actually verifying (the rider-facing join flow), not
// on also exercising admin sign-in and ride creation every run. This
// mirrors the same direct-psql verification pattern already used
// throughout this project's OPERATIONS.md.
//
// The connection string below is Supabase CLI's fixed, publicly-
// documented local-only default (`supabase start` always uses it),
// not a real secret, same as noted in OPERATIONS.md, so it's fine to
// have it directly in source here, unlike a real production password.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// The local seed's `realadmin@example.com` account, already granted
// admin_roles access, see OPERATIONS.md's "Local dev, from scratch"
// section. Only used here to satisfy rides.created_by's foreign key,
// no admin sign-in actually happens in these tests.
const LOCAL_ADMIN_USER_ID = "35af5190-c9cc-4884-aef2-41358eff048f";

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
 * Creates a ride directly in the "active" state (bypassing the normal
 * create-then-explicitly-start-it admin flow, see createRide()/
 * startRide() in src/core/adapters/supabase.ts for what this
 * shortcuts past) so a test can immediately try joining it.
 *
 * @returns the new ride's id and its short join-link slug.
 */
export function seedActiveRide(name: string): { rideId: string; slug: string } {
  const rideId = randomUUID();
  const slug = `e2e${Date.now()}`; // unique per run, avoids colliding with a real same-day ride's slug
  runSql(
    `insert into rides (id, name, status, created_by, slug, started_at)
     values (${sqlLiteral(rideId)}, ${sqlLiteral(name)}, 'active', ${sqlLiteral(LOCAL_ADMIN_USER_ID)}, ${sqlLiteral(slug)}, now());`,
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
