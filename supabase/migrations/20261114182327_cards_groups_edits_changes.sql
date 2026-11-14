-- Tarjetas por grupo (público / interno), tarjetas editadas por el dueño y registro de cambios por lectura.
alter table public.section_cards add column if not exists edited_at timestamptz;
alter table public.section_cards add column if not exists purpose_ai text;
alter table public.card_runs add column if not exists scope_group text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'card_runs_scope_group_check') then
    alter table public.card_runs add constraint card_runs_scope_group_check check (scope_group is null or scope_group in ('public', 'internal'));
  end if;
end $$;

-- Al terminar una corrida: lo nuevo reemplaza a lo viejo, TODO JUNTO. Una tarjeta editada por el dueño NO se pisa,
-- salvo que el dueño la haya elegido a propósito para regenerar (scope). También se actualiza updated_at (fecha de generación).
create or replace function public.apply_card_run(p_run uuid)
returns integer
language plpgsql
set search_path = public, extensions
as $$
declare n integer; v_scope uuid[]; v_written uuid[];
begin
  select scope into v_scope from public.card_runs where id = p_run and status = 'running' for update;
  if not found then raise exception 'corrida_no_activa'; end if;

  with up as (
    insert into public.section_cards (section_id, widget_id, user_id, lang, purpose, keywords, source, section_hash, version, evidence)
    select i.section_id, i.widget_id, i.user_id, i.card->>'lang', i.card->>'purpose', coalesce(i.card->>'keywords', ''),
           i.card->>'source', i.card->>'section_hash', i.card->>'version', coalesce(i.card->>'evidence', '')
    from public.card_run_items i where i.run_id = p_run
    on conflict (section_id) do update set
      lang = excluded.lang, purpose = excluded.purpose, keywords = excluded.keywords, source = excluded.source,
      section_hash = excluded.section_hash, version = excluded.version, evidence = excluded.evidence,
      edited_at = null, purpose_ai = null, updated_at = now()
    where public.section_cards.edited_at is null
       or (v_scope is not null and public.section_cards.section_id = any(v_scope))
    returning section_id
  )
  select coalesce(array_agg(section_id), '{}'::uuid[]), count(*)::integer into v_written, n from up;

  delete from public.section_links
  where source = 'ai' and from_section = any(v_written);

  insert into public.section_links (from_section, to_section, widget_id, user_id, kind, label, source, line)
  select (l->>'from_section')::uuid, (l->>'to_section')::uuid, (l->>'widget_id')::uuid, (l->>'user_id')::uuid,
         l->>'kind', coalesce(l->>'label', ''), 'ai', nullif(l->>'line', '')::int
  from public.card_run_items i, jsonb_array_elements(i.links) l
  where i.run_id = p_run and i.section_id = any(v_written)
  on conflict (from_section, to_section, kind, label) do update set line = excluded.line;

  delete from public.card_run_items where run_id = p_run;
  return n;
end $$;
revoke all on function public.apply_card_run(uuid) from public, anon, authenticated;
grant execute on function public.apply_card_run(uuid) to service_role;

-- Qué cambió en cada lectura del sitio (solo páginas nuevas o cambiadas), sin IA.
create table if not exists public.site_job_changes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.site_import_jobs(id) on delete cascade,
  widget_id uuid not null references public.widgets(id) on delete cascade,
  user_id uuid not null,
  url text not null,
  title text,
  change text not null check (change in ('new', 'changed')),
  sections jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists site_job_changes_job_idx on public.site_job_changes (job_id);
create index if not exists site_job_changes_widget_idx on public.site_job_changes (widget_id, created_at desc);
alter table public.site_job_changes enable row level security;
drop policy if exists site_job_changes_select_own on public.site_job_changes;
create policy site_job_changes_select_own on public.site_job_changes for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.site_job_changes from anon, authenticated, public;
grant select on public.site_job_changes to authenticated;
grant all on public.site_job_changes to service_role;