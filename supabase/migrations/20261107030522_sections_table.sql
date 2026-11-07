create extension if not exists unaccent with schema extensions;

create table public.sections (
  id uuid primary key default gen_random_uuid(),
  widget_id uuid not null references public.widgets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  page_id uuid references public.site_pages(id) on delete cascade,
  source_kind text not null default 'site'
    check (source_kind in ('site','docs','app','file','manual')),
  document_url text not null,
  document_title text,
  heading_path text not null default '',
  kind text not null default 'info'
    check (kind in ('info','steps','menu','screen','faq','legal','ui')),
  is_hidden boolean not null default false,
  lang text not null default 'es',
  position int not null check (position >= 0),
  text text not null check (length(text) between 1 and 4000),
  content_hash text not null,
  fetched_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  tsv tsvector,
  unique (widget_id, document_url, position)
);

create or replace function public.sections_fill_tsv()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare cfg regconfig;
begin
  cfg := case new.lang
    when 'es' then 'spanish'::regconfig
    when 'en' then 'english'::regconfig
    when 'pt' then 'portuguese'::regconfig
    else 'simple'::regconfig end;
  new.tsv :=
    setweight(to_tsvector(cfg, unaccent(new.heading_path)), 'A') ||
    setweight(to_tsvector(cfg, unaccent(coalesce(new.document_title,''))), 'B') ||
    setweight(to_tsvector(cfg, unaccent(new.text)), 'C');
  return new;
end $$;

create trigger sections_fill_tsv
before insert or update of heading_path, document_title, text, lang
on public.sections
for each row execute function public.sections_fill_tsv();

create index sections_tsv_idx on public.sections using gin (tsv);
create index sections_user_idx on public.sections (user_id);
create index sections_page_idx on public.sections (page_id);

alter table public.sections enable row level security;
create policy sections_select_own on public.sections for select
  to authenticated using ((select auth.uid()) = user_id);
revoke all on public.sections from anon, authenticated;
grant select on public.sections to authenticated;
grant all on public.sections to service_role;
