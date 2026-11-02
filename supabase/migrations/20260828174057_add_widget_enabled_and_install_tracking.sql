alter table public.widgets
  add column if not exists enabled boolean not null default true,
  add column if not exists installed_at timestamptz,
  add column if not exists last_seen_at timestamptz;
