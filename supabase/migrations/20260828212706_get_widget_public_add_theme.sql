drop function if exists public.get_widget_public(uuid);
create function public.get_widget_public(widget_id uuid)
returns table(name text, accent text, avatar text, welcome text, "position" text, language text, contact_email text, privacy_url text, theme text)
language sql
stable security definer
set search_path to 'public'
as $function$
  select name, accent, avatar, welcome, "position", language, contact_email, privacy_url, theme
  from public.widgets
  where id = widget_id
    and enabled = true;
$function$;
grant execute on function public.get_widget_public(uuid) to anon, authenticated;
