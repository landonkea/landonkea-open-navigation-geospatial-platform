-- Lets a signed-in admin import history samples (from an uploaded
-- GPX/CSV file, see importHistorySamples() in
-- src/core/adapters/supabase.ts) for a ride regardless of its
-- status, unlike the existing "a participant can record a history
-- sample for an active ride" policy, which only allows inserts while
-- status = 'active'. Real test/demo data often needs importing
-- before a ride has started or after it's already ended, an admin
-- doing this deliberately is a different, more trusted case than a
-- live rider's phone posting its own position, matching the existing
-- "admins can create routes"/"admins can create rides" pattern of a
-- separate, admin-only policy alongside the participant-facing one.
create policy "admins can import history samples for any ride"
  on public.ride_history_samples
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.admin_roles
      where admin_roles.user_id = auth.uid()
    )
  );
