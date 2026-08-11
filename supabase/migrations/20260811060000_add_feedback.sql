-- Anonymous, in-app feedback for a ride. No external form service
-- needed (Google Form/Tally were the original plan, blocked on the
-- user creating one), a plain table + RLS does the same job:
-- anyone can submit, no identifying info is stored (no participant_id
-- or device id column, deliberately, "anonymous" means actually
-- anonymous here, not just unauthenticated), only a signed-in admin
-- can read submissions back.
create table if not exists public.feedback (
  id bigint generated always as identity primary key,
  ride_id uuid not null references public.rides(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;

-- Anyone can submit feedback for any real ride (the foreign key
-- constraint above is the only real validation needed, feedback is
-- deliberately allowed even after a ride ends, that's often when
-- people actually have something to say).
create policy "anyone can submit feedback"
  on public.feedback
  for insert
  with check (true);

-- Only signed-in admins can read submissions back, matching the same
-- admin-only pattern as "admins can create routes" elsewhere in this
-- schema.
create policy "admins can read feedback"
  on public.feedback
  for select
  to authenticated
  using (
    exists (
      select 1 from public.admin_roles
      where admin_roles.user_id = auth.uid()
    )
  );

grant insert on public.feedback to anon, authenticated;
grant select on public.feedback to authenticated;
