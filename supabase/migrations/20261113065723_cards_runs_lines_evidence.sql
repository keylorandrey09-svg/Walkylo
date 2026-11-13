alter table public.section_links add column line integer check (line is null or line >= 1);
alter table public.section_cards add column evidence text not null default '';

create table public.card_runs (
  id uuid primary key default gen_random_uuid(),
  widget_id uuid not null references public.widgets(id) on delete cascade,
  user_id uuid not null,
  status text not null default 'running' check (status in ('running','done','error','cancelled')),
  force boolean not null default false,
  version text not null,
  total integer not null default 0,
  done integer not null default 0,
  degraded integer not null default 0,
  steps integer not null default 0,
  calls integer not null default 0,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  effort text,
  error text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index card_runs_widget_idx on public.card_runs (widget_id, started_at desc);
alter table public.card_runs enable row level security;
create policy card_runs_select_own on public.card_runs
  for select using ((select auth.uid()) = user_id);
revoke all on public.card_runs from anon, authenticated, public;
grant select on public.card_runs to authenticated;
grant all on public.card_runs to service_role;