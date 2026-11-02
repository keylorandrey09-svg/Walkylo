create or replace function public.widget_ping(widget_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  update public.widgets
     set last_seen_at = now(),
         installed_at = coalesce(installed_at, now())
   where id = widget_id;
end;
$function$;

revoke all on function public.widget_ping(uuid) from public;
grant execute on function public.widget_ping(uuid) to anon, authenticated;
