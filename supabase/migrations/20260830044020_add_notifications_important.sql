alter table public.notifications
  add column if not exists important boolean not null default false;
