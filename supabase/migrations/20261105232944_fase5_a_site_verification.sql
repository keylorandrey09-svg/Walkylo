alter table public.widgets
  add column verify_token text not null default replace(gen_random_uuid()::text, '-', ''),
  add column verified_host text,
  add column verified_at timestamptz;

create table public.site_verifications (
  id uuid primary key default gen_random_uuid(),
  widget_id uuid not null references public.widgets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null check (char_length(url) <= 2048),
  host text not null check (char_length(host) <= 255),
  method text check (method in ('install_code','meta_tag')),
  status text not null default 'running' check (status in ('running','verified','failed')),
  steps jsonb not null default '[]'::jsonb,
  preview jsonb,
  error text check (char_length(error) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index site_verifications_widget_idx on public.site_verifications (widget_id, created_at desc);
create index site_verifications_user_idx on public.site_verifications (user_id);
alter table public.site_verifications enable row level security;
revoke all on public.site_verifications from anon, authenticated;
grant select on public.site_verifications to authenticated;
create policy site_verifications_select_own on public.site_verifications
  for select to authenticated using ((select auth.uid()) = user_id);

create table public.site_url_changes (
  id uuid primary key default gen_random_uuid(),
  widget_id uuid not null references public.widgets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  old_url text,
  new_url text,
  created_at timestamptz not null default now()
);
create index site_url_changes_widget_idx on public.site_url_changes (widget_id, created_at desc);
create index site_url_changes_user_idx on public.site_url_changes (user_id);
alter table public.site_url_changes enable row level security;
revoke all on public.site_url_changes from anon, authenticated;
grant select on public.site_url_changes to authenticated;
create policy site_url_changes_select_own on public.site_url_changes
  for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.widgets_site_url_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare n int; h text;
begin
  if new.site_url is distinct from old.site_url then
    select count(*) into n from public.site_url_changes
     where widget_id = new.id and created_at > now() - interval '24 hours';
    if n >= 5 then
      raise exception 'site_url_change_limit' using errcode = 'P0001';
    end if;
    insert into public.site_url_changes (widget_id, user_id, old_url, new_url)
    values (new.id, new.user_id, old.site_url, new.site_url);
    h := lower(regexp_replace(coalesce(new.site_url, ''), '^(https?://)?(www\.)?([^/:?#]+).*$', '\3'));
    if new.verified_host is not null and h is distinct from new.verified_host then
      new.verified_host := null;
      new.verified_at := null;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.widgets_site_url_guard() from public, anon, authenticated;
create trigger widgets_site_url_guard
  before update on public.widgets
  for each row execute function public.widgets_site_url_guard();
