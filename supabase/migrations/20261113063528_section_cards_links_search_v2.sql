create table public.section_cards (
  section_id uuid primary key references public.sections(id) on delete cascade,
  widget_id uuid not null references public.widgets(id) on delete cascade,
  user_id uuid not null,
  lang text,
  purpose text not null default '',
  keywords text not null default '',
  source text not null default 'code' check (source in ('code','ai','mixed')),
  section_hash text not null,
  version text not null,
  tsv tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index section_cards_widget_idx on public.section_cards (widget_id);
create index section_cards_user_idx on public.section_cards (user_id);
create index section_cards_tsv_idx on public.section_cards using gin (tsv);

create or replace function public.section_cards_fill_tsv() returns trigger
language plpgsql set search_path to 'public','extensions' as $f$
declare cfg regconfig;
begin
  cfg := case new.lang when 'es' then 'spanish'::regconfig when 'en' then 'english'::regconfig
         when 'pt' then 'portuguese'::regconfig else 'simple'::regconfig end;
  new.tsv := setweight(to_tsvector(cfg, unaccent(coalesce(new.keywords,''))), 'A')
          || setweight(to_tsvector(cfg, unaccent(coalesce(new.purpose,''))), 'B');
  new.updated_at := now();
  return new;
end $f$;
create trigger section_cards_fill_tsv
  before insert or update of purpose, keywords, lang on public.section_cards
  for each row execute function public.section_cards_fill_tsv();

create table public.section_links (
  from_section uuid not null references public.sections(id) on delete cascade,
  to_section uuid not null references public.sections(id) on delete cascade,
  widget_id uuid not null references public.widgets(id) on delete cascade,
  user_id uuid not null,
  kind text not null check (kind in ('menu','button','step','related')),
  label text not null default '',
  source text not null default 'code' check (source in ('code','ai')),
  created_at timestamptz not null default now(),
  primary key (from_section, to_section, kind, label),
  check (from_section <> to_section)
);
create index section_links_to_idx on public.section_links (to_section);
create index section_links_widget_idx on public.section_links (widget_id);

alter table public.section_cards enable row level security;
alter table public.section_links enable row level security;
create policy section_cards_select_own on public.section_cards
  for select using ((select auth.uid()) = user_id);
create policy section_links_select_own on public.section_links
  for select using ((select auth.uid()) = user_id);
revoke all on public.section_cards, public.section_links from anon, authenticated, public;
grant select on public.section_cards, public.section_links to authenticated;
grant all on public.section_cards, public.section_links to service_role;

create or replace function public.search_sections_v2(p_widget uuid, p_query text, p_k integer default 8)
returns table(id uuid, "position" integer, kind text, is_hidden boolean, heading_path text,
  text text, anchor text, document_url text, rank real, via text, purpose text)
language sql stable set search_path to 'public','extensions' as $f$
  with cfg as (
    select case w.language when 'en' then 'english'::regconfig when 'pt' then 'portuguese'::regconfig
           else 'spanish'::regconfig end as c
    from public.widgets w where w.id = p_widget
  ), q as (
    select replace(plainto_tsquery(cfg.c, unaccent(left(coalesce(p_query, ''), 1000)))::text, ' & ', ' | ') as qs from cfg
  )
  select s.id, s.position, s.kind, s.is_hidden, s.heading_path, s.text, s.anchor, s.document_url,
    (((case when s.tsv @@ q.qs::tsquery then ts_rank_cd(s.tsv, q.qs::tsquery) else 0 end)
      + (case when c.tsv @@ q.qs::tsquery then 0.8 * ts_rank_cd(c.tsv, q.qs::tsquery) else 0 end))
      * case when s.kind = 'legal'
              and coalesce(p_query, '') !~* '(pol[ií]tica|t[eé]rminos|privacidad|reembols|cookies|legal|privacy|terms|refund)'
             then 0.5 else 1 end)::real as rank,
    case when s.tsv @@ q.qs::tsquery and c.tsv @@ q.qs::tsquery then 'ambos'
         when s.tsv @@ q.qs::tsquery then 'texto' else 'tarjeta' end as via,
    c.purpose
  from public.sections s
  join q on true
  left join public.section_cards c on c.section_id = s.id
  where s.widget_id = p_widget and q.qs <> '' and (s.tsv @@ q.qs::tsquery or c.tsv @@ q.qs::tsquery)
  order by rank desc, s.position
  limit greatest(1, least(coalesce(p_k, 8), 20));
$f$;
revoke all on function public.search_sections_v2(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.search_sections_v2(uuid, text, integer) to service_role;