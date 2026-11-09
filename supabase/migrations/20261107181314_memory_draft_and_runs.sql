alter table public.widgets
  add column memory_draft text,
  add column memory_draft_at timestamptz,
  add column memory_sources_hash text;
alter table public.widgets
  add constraint widgets_memory_draft_len check (memory_draft is null or length(memory_draft) <= 10000);

create table public.memory_runs (
  id uuid primary key default gen_random_uuid(),
  widget_id uuid not null references public.widgets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'running' check (status in ('running','done','error')),
  mode text check (mode in ('replace','draft')),
  calls int not null default 0,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  chars int,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index memory_runs_widget_idx on public.memory_runs (widget_id, started_at desc);
create index memory_runs_user_idx on public.memory_runs (user_id);
alter table public.memory_runs enable row level security;
create policy memory_runs_select_own on public.memory_runs for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.memory_runs from anon, authenticated;
grant select on public.memory_runs to authenticated;
grant all on public.memory_runs to service_role;
