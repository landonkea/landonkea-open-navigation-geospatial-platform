-- Lets a signed-in admin delete a ride entirely (a "Delete Ride"
-- button in the admin ride list, for real cleanup of test/duplicate
-- rides), matching the existing "any admin can update any ride"
-- policy's pattern. Every related table (ride_participants, routes,
-- ride_history_samples, feedback) already has "on delete cascade" on
-- its ride_id foreign key (see the original schema), so deleting a
-- ride automatically removes everything attached to it, no separate
-- cleanup needed.
create policy "any admin can delete any ride"
  on public.rides
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.admin_roles
      where admin_roles.user_id = auth.uid()
    )
  );

grant delete on public.rides to authenticated;
