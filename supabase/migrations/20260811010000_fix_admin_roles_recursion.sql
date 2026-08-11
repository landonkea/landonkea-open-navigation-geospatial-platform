-- ── Fix infinite recursion in admin_roles' own SELECT policy ────────
-- WHAT WAS WRONG: the original policy checked "is the caller an admin"
-- by querying admin_roles from WITHIN a policy ON admin_roles itself.
-- Postgres re-applies a table's RLS policy to every query against
-- that table, including the subquery inside the policy's own
-- definition, so this triggered itself forever ("infinite recursion
-- detected in policy for relation admin_roles"). Caught by actually
-- running a real sign-in against local Supabase, not by reading the
-- SQL and assuming it was fine.
--
-- THE FIX: a user can read their OWN admin_roles row (a plain,
-- non-recursive comparison against auth.uid(), no subquery on this
-- table at all) which is all this app actually needs today, checking
-- "is the account I just signed in with an admin". A full "see every
-- admin" list screen would need a different pattern (a
-- SECURITY DEFINER function that bypasses RLS internally), not built
-- since nothing uses it yet.
drop policy "admins can read the admin list" on admin_roles;

create policy "a user can read their own admin_roles row"
  on admin_roles for select
  to authenticated
  using (user_id = auth.uid());
