-- ride_history_samples could be SELECTed by anyone (the original
-- schema already granted that, for a future export/playback feature)
-- but nothing could ever INSERT into it, no policy, no grant. Now
-- that src/core/sync.ts actually writes samples during a poll (see
-- insertHistorySample() in src/core/adapters/supabase.ts), regular
-- riders' devices (the "anon"/"authenticated" Supabase roles, same as
-- every other client-side write in this schema) need permission.
--
-- Same trust model as the existing "a participant can update their
-- own row" policy on ride_participants (USING (true), no ownership
-- check beyond knowing the ride/participant id, see this schema's
-- original top-of-file comment on why that's an accepted tradeoff for
-- this project), just requiring the ride still be active, mirroring
-- "anyone can join an active ride"'s own check.
create policy "a participant can record a history sample for an active ride"
  on public.ride_history_samples
  for insert
  with check (
    exists (
      select 1 from public.rides
      where rides.id = ride_history_samples.ride_id
        and rides.status = 'active'
    )
  );

grant insert on public.ride_history_samples to anon, authenticated;
