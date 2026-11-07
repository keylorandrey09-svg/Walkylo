alter table public.sections
  add column anchor text,
  add column id_path text not null default '';

alter table public.sections
  add constraint sections_anchor_len check (anchor is null or length(anchor) <= 200),
  add constraint sections_id_path_len check (length(id_path) <= 300);

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
    setweight(to_tsvector(cfg, unaccent(replace(replace(
      coalesce(new.anchor, '') || ' ' || coalesce(new.id_path, ''), '-', ' '), '_', ' '))), 'B') ||
    setweight(to_tsvector(cfg, unaccent(coalesce(new.document_title, ''))), 'B') ||
    setweight(to_tsvector(cfg, unaccent(new.text)), 'C');
  return new;
end $$;

drop trigger sections_fill_tsv on public.sections;
create trigger sections_fill_tsv
before insert or update of heading_path, document_title, text, lang, anchor, id_path
on public.sections
for each row execute function public.sections_fill_tsv();
