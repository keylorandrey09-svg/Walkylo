-- Tarjetas: lo nuevo se guarda APARTE (card_run_items) y reemplaza a lo viejo todo junto al terminar (apply_card_run).
-- Cancelar descarta lo guardado aparte: las tarjetas de antes quedan como estaban.
alter table public.card_runs add column if not exists scope uuid[];

create table if not exists public.card_run_items (
  run_id uuid not null references public.card_runs(id) on delete cascade,
  section_id uuid not null references public.sections(id) on delete cascade,
  widget_id uuid not null references public.widgets(id) on delete cascade,
  user_id uuid not null,
  card jsonb not null,
  links jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (run_id, section_id)
);
create index if not exists card_run_items_widget_idx on public.card_run_items (widget_id);
alter table public.card_run_items enable row level security; -- sin políticas: solo el servicio la lee y escribe

create or replace function public.apply_card_run(p_run uuid)
returns integer
language plpgsql
set search_path = public, extensions
as $$
declare n integer;
begin
  perform 1 from public.card_runs where id = p_run and status = 'running' for update;
  if not found then raise exception 'corrida_no_activa'; end if;

  insert into public.section_cards (section_id, widget_id, user_id, lang, purpose, keywords, source, section_hash, version, evidence)
  select i.section_id, i.widget_id, i.user_id, i.card->>'lang', i.card->>'purpose', coalesce(i.card->>'keywords', ''),
         i.card->>'source', i.card->>'section_hash', i.card->>'version', coalesce(i.card->>'evidence', '')
  from public.card_run_items i where i.run_id = p_run
  on conflict (section_id) do update set
    lang = excluded.lang, purpose = excluded.purpose, keywords = excluded.keywords, source = excluded.source,
    section_hash = excluded.section_hash, version = excluded.version, evidence = excluded.evidence;
  get diagnostics n = row_count;

  delete from public.section_links
  where source = 'ai' and from_section in (select section_id from public.card_run_items where run_id = p_run);

  insert into public.section_links (from_section, to_section, widget_id, user_id, kind, label, source, line)
  select (l->>'from_section')::uuid, (l->>'to_section')::uuid, (l->>'widget_id')::uuid, (l->>'user_id')::uuid,
         l->>'kind', coalesce(l->>'label', ''), 'ai', nullif(l->>'line', '')::int
  from public.card_run_items i, jsonb_array_elements(i.links) l where i.run_id = p_run
  on conflict (from_section, to_section, kind, label) do update set line = excluded.line;

  delete from public.card_run_items where run_id = p_run;
  return n;
end $$;
revoke all on function public.apply_card_run(uuid) from public, anon, authenticated;
grant execute on function public.apply_card_run(uuid) to service_role;