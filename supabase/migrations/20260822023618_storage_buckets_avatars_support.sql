-- Buckets: avatars (público de lectura) y support (privado)
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('support', 'support', false)
  on conflict (id) do nothing;

-- AVATARS: cualquiera puede leer (el widget lo muestra); el dueño escribe en su carpeta {uid}/...
create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');
create policy "avatars_insert_own" on storage.objects
  for insert with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars_update_own" on storage.objects
  for update using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars_delete_own" on storage.objects
  for delete using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- SUPPORT: privado; el dueño solo lee/escribe su propia carpeta {uid}/...
create policy "support_insert_own" on storage.objects
  for insert with check (bucket_id = 'support' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "support_select_own" on storage.objects
  for select using (bucket_id = 'support' and (storage.foldername(name))[1] = auth.uid()::text);
