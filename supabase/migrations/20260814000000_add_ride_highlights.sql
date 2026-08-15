-- Post-ride "highlights wall": short, optional-emoji moments anyone
-- can post about a ride and everyone with the ride's link can read
-- back, a lightweight community/fun touch distinct from `feedback`
-- (private, admin-only, meant for the organizer) and from `tags`
-- (a role, not a moment). Same "trust the ride id, no ownership
-- check" model as the rest of this schema, NOT anonymous the way
-- `feedback` deliberately is (a highlight is public by design, meant
-- to be read by other riders, so there's nothing to protect by
-- stripping identity, there was never any identity attached to strip).
create table if not exists public.ride_highlights (
  id bigint generated always as identity primary key,
  ride_id uuid not null references public.rides(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 200),
  emoji text, -- one optional emoji, client-validated to a curated set (see bikeTheme), not enforced here, same "editable list, not hardcoded enum" reasoning as participant tags
  created_at timestamptz not null default now()
);

alter table public.ride_highlights enable row level security;

create policy "anyone can post a highlight for a ride they have the id for"
  on public.ride_highlights
  for insert
  with check (true);

create policy "anyone can read highlights of a ride they have the id for"
  on public.ride_highlights
  for select
  using (true);

grant insert, select on public.ride_highlights to anon, authenticated;
