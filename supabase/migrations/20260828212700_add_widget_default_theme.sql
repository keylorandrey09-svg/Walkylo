alter table public.widgets
  add column if not exists theme text not null default 'dark'
  check (theme in ('light','dark'));
