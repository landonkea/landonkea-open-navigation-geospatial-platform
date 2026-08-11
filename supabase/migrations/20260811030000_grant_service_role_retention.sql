-- The scheduled data-retention GitHub Action (.github/workflows/
-- data-retention.yml) uses the SERVICE ROLE key to delete
-- ride_participants rows for rides that ended long ago. The
-- service_role Postgres role has BYPASSRLS (confirmed: `select
-- rolbypassrls from pg_roles where rolname = 'service_role'` returns
-- true), so Row Level Security policies never block it, but RLS
-- bypass does NOT imply table grants, Postgres still checks plain
-- GRANT privileges first. Without these, the same class of bug as
-- the earlier "missing GRANT statements" fix in the initial schema
-- (RLS alone doesn't grant base table access) hits service_role too:
-- confirmed locally, the retention job's DELETE failed with
-- "permission denied for table ride_participants" until this ran.
--
-- rides only needs SELECT here (the job reads which rides are long-
-- ended before deleting their participants), ride_participants needs
-- both SELECT (so `Prefer: return=representation` can report what it
-- deleted) and DELETE (the actual cleanup).
grant select on public.rides to service_role;
grant select, delete on public.ride_participants to service_role;
