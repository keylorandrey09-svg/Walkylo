alter table public.messages
  add column is_fallback boolean not null default false;
grant select (is_fallback) on public.messages to authenticated;

update public.messages
   set is_fallback = true
 where from_role = 'assistant'
   and text like 'No tengo esa información.%';
