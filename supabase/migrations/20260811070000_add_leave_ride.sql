-- Lets a participant remove themselves from a ride (a "Leave Ride"
-- button, see leaveRide() in src/core/adapters/supabase.ts), instead
-- of just closing the tab and leaving a stale dot on the map until
-- the post-ride retention job eventually cleans it up. Same trust
-- model as the existing "a participant can update their own row"
-- policy (USING (true), no ownership check beyond knowing the
-- participant id, this schema's established pattern, see its
-- original top-of-file comment), just for DELETE instead of UPDATE.
create policy "a participant can delete their own row"
  on public.ride_participants
  for delete
  using (true);

grant delete on public.ride_participants to anon, authenticated;
