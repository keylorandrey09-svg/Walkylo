drop policy profiles_update_own on public.profiles;
alter policy profiles_select_own on public.profiles
  using ((select auth.uid()) = id);

alter policy widgets_select_own on public.widgets
  using ((select auth.uid()) = user_id);
alter policy widgets_insert_own on public.widgets
  with check ((select auth.uid()) = user_id);
alter policy widgets_update_own on public.widgets
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

alter policy notifications_select_own on public.notifications
  using ((select auth.uid()) = user_id);
alter policy notifications_update_own on public.notifications
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

alter policy support_select_own on public.support_messages
  using ((select auth.uid()) = user_id);
alter policy support_insert_own on public.support_messages
  with check ((select auth.uid()) = user_id);

alter policy conv_select_own on public.conversations
  using ((select auth.uid()) = user_id);
alter policy conv_update_own on public.conversations
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

alter policy msg_select_own on public.messages
  using (exists (select 1 from public.conversations c
                 where c.id = messages.conversation_id
                   and c.user_id = (select auth.uid())));

alter policy events_select_own on public.events
  using ((select auth.uid()) = user_id);
