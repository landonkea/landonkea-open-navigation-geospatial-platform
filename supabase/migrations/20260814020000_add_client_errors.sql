-- Write-only client-side error log: an uncaught exception on a
-- rider's phone was previously invisible, nobody would ever know it
-- happened unless the rider reported it themselves. Same "anonymous,
-- write-only" trust model as `feedback` (no participant/device id
-- attached, admin-only read), a crash report needs the same privacy
-- treatment as anonymous feedback text, not more or less.
create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  message text not null check (char_length(message) <= 500),
  stack text check (char_length(stack) <= 2000),
  page_url text check (char_length(page_url) <= 500),
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now()
);

alter table public.client_errors enable row level security;

create policy "anyone can report a client error"
  on public.client_errors
  for insert
  with check (true);

create policy "admins can read client errors"
  on public.client_errors
  for select
  to authenticated
  using (
    exists (
      select 1 from public.admin_roles
      where admin_roles.user_id = auth.uid()
    )
  );

grant insert on public.client_errors to anon, authenticated;
grant select on public.client_errors to authenticated;
