alter table public.messages
  add constraint messages_from_role_check
  check (from_role in ('visitor','assistant','owner'));
alter table public.conversations
  add constraint conversations_status_check
  check (status in ('open','resolved'));
alter table public.events
  add constraint events_type_check
  check (type in ('question','answer','link','fallback'));
