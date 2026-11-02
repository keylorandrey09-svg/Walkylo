create or replace function public.get_widget_public(widget_id uuid)
returns table (
  name text, accent text, avatar text, welcome text,
  "position" text, language text, contact_email text, privacy_url text
)
language sql
security definer
set search_path = public
stable
as $$
  select name, accent, avatar, welcome, "position", language, contact_email, privacy_url
  from public.widgets
  where id = widget_id;
$$;

grant execute on function public.get_widget_public(uuid) to anon, authenticated;
