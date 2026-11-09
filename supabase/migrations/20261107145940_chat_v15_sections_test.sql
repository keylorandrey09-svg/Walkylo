alter table public.widgets add column use_sections boolean not null default false;
alter table public.conversations add column is_test boolean not null default false;
create index conversations_widget_test_idx on public.conversations (widget_id, is_test, created_at);

create or replace function public.search_sections(p_widget uuid, p_query text, p_k int default 8)
returns table (id uuid, "position" int, kind text, is_hidden boolean, heading_path text, text text,
               anchor text, document_url text, rank real)
language sql stable
set search_path = public, extensions
as $f$
  with cfg as (
    select case w.language when 'en' then 'english'::regconfig when 'pt' then 'portuguese'::regconfig
                           else 'spanish'::regconfig end as c
    from public.widgets w where w.id = p_widget
  ), q as (
    select replace(plainto_tsquery(cfg.c, unaccent(left(coalesce(p_query, ''), 1000)))::text, ' & ', ' | ') as qs
    from cfg
  )
  select s.id, s.position, s.kind, s.is_hidden, s.heading_path, s.text, s.anchor, s.document_url,
    (ts_rank_cd(s.tsv, q.qs::tsquery)
      * case when s.kind = 'legal'
              and coalesce(p_query, '') !~* '(pol[ií]tica|t[eé]rminos|privacidad|reembols|cookies|legal|privacy|terms|refund)'
             then 0.5 else 1 end)::real as rank
  from public.sections s, q
  where s.widget_id = p_widget and q.qs <> '' and s.tsv @@ q.qs::tsquery
  order by rank desc, s.position
  limit greatest(1, least(coalesce(p_k, 8), 20));
$f$;

revoke all on function public.search_sections(uuid, text, int) from public, anon, authenticated;
grant execute on function public.search_sections(uuid, text, int) to service_role;
