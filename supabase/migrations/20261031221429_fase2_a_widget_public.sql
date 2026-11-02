-- 1) columna nueva
alter table public.widgets
  add column avatar_thumb text
    check (avatar_thumb is null or char_length(avatar_thumb) <= 12000);
grant select (avatar_thumb), insert (avatar_thumb), update (avatar_thumb)
  on public.widgets to authenticated;

-- 2) get_widget_public con campos nuevos (cambia el tipo de retorno)
drop function public.get_widget_public(uuid);
create function public.get_widget_public(widget_id uuid)
returns table(name text, accent text, avatar text, avatar_hidden boolean,
  avatar_thumb text, welcome text, "position" text, language text,
  contact_email text, privacy_url text, theme text, updated_at timestamptz)
language sql stable security definer set search_path to 'public'
as $$
  select name, accent, avatar, avatar_hidden, avatar_thumb, welcome,
         "position", language, contact_email, privacy_url, theme, updated_at
  from public.widgets
  where id = widget_id and enabled = true;
$$;
revoke execute on function public.get_widget_public(uuid) from public;
grant execute on function public.get_widget_public(uuid) to anon, authenticated;

-- 3) widget_ping: solo si pasaron más de 5 minutos
create or replace function public.widget_ping(widget_id uuid)
returns void language plpgsql security definer set search_path to ''
as $$
begin
  update public.widgets
     set last_seen_at = now(),
         installed_at = coalesce(installed_at, now())
   where id = widget_id
     and (last_seen_at is null or last_seen_at < now() - interval '5 minutes');
end;
$$;

-- 4) updated_at solo cuando cambia la configuración
create function public.widgets_touch_updated_at()
returns trigger language plpgsql set search_path to ''
as $$
begin
  if (to_jsonb(new) - 'updated_at' - 'last_seen_at' - 'installed_at')
     is distinct from
     (to_jsonb(old) - 'updated_at' - 'last_seen_at' - 'installed_at') then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke execute on function public.widgets_touch_updated_at()
  from public, anon, authenticated;
create trigger widgets_touch_updated_at
  before update on public.widgets
  for each row execute function public.widgets_touch_updated_at();
