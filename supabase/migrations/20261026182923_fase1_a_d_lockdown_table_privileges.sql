-- (a) profiles: solo lectura para el usuario
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

-- (b) widgets: SELECT completo; INSERT y UPDATE solo por columnas
revoke all on public.widgets from anon, authenticated;
grant select on public.widgets to authenticated;
grant insert (user_id, name, accent, position, welcome, tone, language,
              fallback, knowledge, avatar, avatar_hidden, site_url,
              contact_email, privacy_url, theme, enabled, updated_at)
  on public.widgets to authenticated;
grant update (user_id, name, accent, position, welcome, tone, language,
              fallback, knowledge, avatar, avatar_hidden, site_url,
              contact_email, privacy_url, theme, enabled, updated_at)
  on public.widgets to authenticated;

-- (c) resto de tablas
revoke all on public.notifications     from anon, authenticated;
revoke all on public.conversations     from anon, authenticated;
revoke all on public.support_messages  from anon, authenticated;
revoke all on public.messages          from anon, authenticated;
revoke all on public.events            from anon, authenticated;

grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

grant select on public.conversations to authenticated;
grant update (status, pinned) on public.conversations to authenticated;

grant select on public.messages to authenticated;
grant select on public.events   to authenticated;

grant select on public.support_messages to authenticated;
grant insert (user_id, text, photos) on public.support_messages to authenticated;

-- (d) anon: nada en tablas de public (las RPC SECURITY DEFINER siguen)
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon, authenticated;

-- (d) privilegios por defecto de objetos NUEVOS (rol postgres)
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;
