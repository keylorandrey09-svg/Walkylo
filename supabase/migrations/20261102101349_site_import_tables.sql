create table public.site_import_jobs (
  id uuid primary key default gen_random_uuid(),
  widget_id uuid not null references public.widgets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  start_url text not null check (char_length(start_url) <= 2048),
  status text not null default 'running'
    check (status in ('running','done','error','cancelled')),
  pages_found integer not null default 0,
  pages_done integer not null default 0,
  pages_new integer not null default 0,
  pages_changed integer not null default 0,
  pages_same integer not null default 0,
  error text check (char_length(error) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create table public.site_pages (
  id uuid primary key default gen_random_uuid(),
  widget_id uuid not null references public.widgets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.site_import_jobs(id) on delete set null,
  url text not null check (char_length(url) <= 2048),
  status text not null default 'pending'
    check (status in ('pending','done','error','blocked','removed')),
  http_status integer,
  title text check (char_length(title) <= 300),
  text text,
  hidden_text text,
  text_chars integer not null default 0,
  content_hash text,
  flags jsonb not null default '{}'::jsonb,
  error text check (char_length(error) <= 300),
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  unique (widget_id, url)
);

create index site_pages_widget_status_idx on public.site_pages (widget_id, status);
create index site_import_jobs_user_idx on public.site_import_jobs (user_id, created_at desc);
create index site_pages_user_idx on public.site_pages (user_id);
create index site_pages_job_idx on public.site_pages (job_id);
create index site_import_jobs_widget_idx on public.site_import_jobs (widget_id);

alter table public.site_import_jobs enable row level security;
alter table public.site_pages enable row level security;
revoke all on public.site_import_jobs from anon, authenticated;
revoke all on public.site_pages from anon, authenticated;
grant select on public.site_import_jobs to authenticated;
grant select on public.site_pages to authenticated;
create policy site_jobs_select_own on public.site_import_jobs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy site_pages_select_own on public.site_pages
  for select to authenticated using ((select auth.uid()) = user_id);
