alter table public.widgets
  add column owner_notes text not null default ''
    check (char_length(owner_notes) <= 2000),
  add column knowledge_ai_at timestamptz;
grant insert (owner_notes), update (owner_notes) on public.widgets to authenticated;

alter table public.site_pages add column summarized_hash text;
alter table public.site_import_jobs add column summarized_at timestamptz;
