-- ── Database schema (Phase 1) ──────────────────────────────────────
-- Run this against a local Supabase instance (`supabase start`, then
-- `supabase db reset` or paste this into the local Studio SQL editor)
-- during development, and again against the real hosted free-tier
-- project once that's created, both use the same schema.
--
-- ── The security model, read this before changing access rules ────
-- Regular riders never log in (see the build prompt's "Accounts /
-- auth" section), so there's no user identity to check permissions
-- against for them. Instead, this schema treats a ride's own `id`
-- (a UUID, effectively unguessable, the same trick Google Docs/Figma
-- share links use) AS the join secret: knowing a ride's id is what a
-- join link/QR actually hands someone, and that's what grants
-- read/write access to that one ride's data below. A brand-new UUID
-- per ride already satisfies the build prompt's "fresh, unique link
-- per ride" privacy requirement for free, no extra token column
-- needed. Only real admin accounts (Supabase Auth logins) can create/
-- edit/end rides or manage routes, everything else here is scoped to
-- "if you have the ride id, you're in."
--
-- Honest limitation, worth stating plainly (a novice reading this
-- should know it, not discover it later): this means anyone who ever
-- sees a ride's id, e.g. a screenshot, a forwarded link, browser
-- history, can read/write that ride's participant data until it
-- expires. That's an accepted tradeoff for a no-login, low-friction
-- design at this club's scale and risk level, not an oversight, see
-- the build prompt's own "Privacy" note under Rides and routes.

-- Supabase turns on Row Level Security (RLS) by default with zero
-- policies, meaning "nobody can read or write anything" until we
-- explicitly say otherwise below. That's the safe default, we're
-- opting IN to access, not opting out of it.

-- ── admin_roles ─────────────────────────────────────────────────────
-- A list, not a single "is_admin" flag, per the build prompt's "Admin
-- accounts vs. marshals" section, so more admin sub-types can be added
-- later (e.g. a future "read-only admin") without a schema rework.
-- Expect roughly 10 rows total, this is a small, hand-managed table.
-- Created before `rides` below since that table's policies reference
-- this one, Postgres needs it to already exist first.
create table admin_roles (
  user_id uuid primary key references auth.users(id),
  role text not null default 'ride_organizer',
  granted_at timestamptz not null default now()
);

alter table admin_roles enable row level security;

-- An admin can see the full admin list (needed for an "admins" list
-- screen later), but only existing admins, not the public.
create policy "admins can read the admin list"
  on admin_roles for select
  to authenticated
  using (exists (select 1 from admin_roles where user_id = auth.uid()));


-- ── rides ───────────────────────────────────────────────────────────
-- One row per ride/event. `status` drives the lifecycle described in
-- the build prompt's "Ride lifecycle" section.
create table rides (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'created'
    check (status in ('created', 'active', 'ended')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  -- Auto-end safety net (build prompt: "auto-end a ride ... after some
  -- number of hours with no rider activity"). Actually enforcing this
  -- needs a scheduled job (a good fit for the same kind of GitHub
  -- Actions cron already planned for the keep-alive ping), not yet
  -- wired up, this column just makes the setting configurable per ride.
  auto_end_after_hours integer not null default 8
);

alter table rides enable row level security;

-- Anyone who has a ride's id can read that ride's basic info (name,
-- status), needed to render the map/roster for riders and spectators,
-- who never log in. See this file's top comment for why that's safe
-- enough here.
create policy "anyone can read a ride they have the id for"
  on rides for select
  using (true);

-- Only a logged-in admin can create a ride.
create policy "admins can create rides"
  on rides for insert
  to authenticated
  with check (exists (select 1 from admin_roles where user_id = auth.uid()));

-- Any admin can edit/end ANY ride, not just ones they created (build
-- prompt: "Admin permission scope", shared access on purpose so one
-- person isn't a bottleneck).
create policy "any admin can update any ride"
  on rides for update
  to authenticated
  using (exists (select 1 from admin_roles where user_id = auth.uid()));


-- ── ride_participants ───────────────────────────────────────────────
-- One row per person currently in a ride, rider, spectator, or a
-- tagged role like marshal (see build prompt's "Optional rider tags").
-- `id` here is a client-generated UUID (made once per device per ride,
-- kept in the browser's localStorage), NOT tied to any login, this is
-- what lets a rider's own phone update its own row on later polls.
create table ride_participants (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references rides(id) on delete cascade,
  is_spectator boolean not null default false,
  -- One of bikeTheme.tags' ids (see src/theme/bike/config.js), or
  -- null for a plain rider with no tag. Left as free text here rather
  -- than a fixed enum so the tag list can grow without a migration,
  -- matching the build prompt's "editable list, not hardcoded enum"
  -- requirement.
  tag text,
  lat double precision,
  lng double precision,
  -- GPS accuracy radius in meters, straight from the browser's
  -- Geolocation API, drives the yellow/green signal-color logic.
  accuracy_m double precision,
  heading_deg double precision,
  speed_mps double precision,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table ride_participants enable row level security;

-- Anyone with a ride's id can see who's in it (needed for the live
-- map and roster view, both work with no login).
create policy "anyone can read participants of a ride they have the id for"
  on ride_participants for select
  using (true);

-- Anyone can join an ACTIVE ride (not "created" or "ended", those
-- shouldn't accept new joiners).
create policy "anyone can join an active ride"
  on ride_participants for insert
  with check (
    exists (select 1 from rides where id = ride_id and status = 'active')
  );

-- A participant can update their own row (their own position on each
-- poll). Since there's no login to verify "own" against, this trusts
-- the client-generated id the same way the tag system is trust-based,
-- see this file's top comment.
create policy "a participant can update their own row"
  on ride_participants for update
  using (true);


-- ── routes ──────────────────────────────────────────────────────────
-- A ride's planned route, either parsed from an uploaded GPX file or
-- drawn on the map by an admin (build prompt: "Rides and routes").
-- `geojson` holds both the route line AND any waypoints together, one
-- GeoJSON FeatureCollection, simplest shape to render directly with
-- MapLibre with no extra parsing on the read side.
create table routes (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references rides(id) on delete cascade,
  source text not null check (source in ('gpx', 'drawn', 'none')),
  geojson jsonb,
  created_at timestamptz not null default now()
);

alter table routes enable row level security;

create policy "anyone can read the route of a ride they have the id for"
  on routes for select
  using (true);

create policy "admins can create routes"
  on routes for insert
  to authenticated
  with check (exists (select 1 from admin_roles where user_id = auth.uid()));


-- ── ride_history_samples ────────────────────────────────────────────
-- Long-term, lightweight retention (build prompt: "Data retention").
-- Live rows in ride_participants get deleted 20 minutes after a ride
-- ends (a scheduled job, not yet built, same family of work as the
-- auto-end job above); this table is what survives after that, one
-- sparse sampled point per participant per minute (or a per-rider
-- summary row, still an open call per the build prompt, sampled trail
-- chosen here as the simpler first implementation). Powers the future
-- GPX/CSV export feature.
create table ride_history_samples (
  id bigint generated always as identity primary key,
  ride_id uuid not null references rides(id) on delete cascade,
  participant_id uuid not null,
  lat double precision not null,
  lng double precision not null,
  recorded_at timestamptz not null
);

alter table ride_history_samples enable row level security;

create policy "anyone can read history of a ride they have the id for"
  on ride_history_samples for select
  using (true);

-- ── Table-level grants ──────────────────────────────────────────────
-- RLS policies above only filter WHICH rows a role can see/change,
-- Postgres separately requires the role to have base table privileges
-- at all before RLS is even evaluated, without these grants every
-- request gets a flat "permission denied for table ..." regardless of
-- how permissive the RLS policies are. `anon` is unauthenticated
-- requests (regular riders/spectators, who never log in), `authenticated`
-- is a real logged-in admin session.
grant select on admin_roles to authenticated;

grant select on rides to anon, authenticated;
grant insert, update on rides to authenticated;

grant select, insert, update on ride_participants to anon, authenticated;

grant select on routes to anon, authenticated;
grant insert on routes to authenticated;

grant select on ride_history_samples to anon, authenticated;
