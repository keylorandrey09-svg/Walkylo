update storage.buckets
   set file_size_limit = 1048576,
       allowed_mime_types = array['image/jpeg','image/png','image/webp']
 where id = 'avatars';

update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg','image/png','image/webp']
 where id = 'support';

drop policy avatars_public_read on storage.objects;

create policy avatars_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars'
         and (storage.foldername(name))[1] = (select auth.uid())::text);
