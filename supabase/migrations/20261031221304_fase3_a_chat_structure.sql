-- conversations
alter table public.conversations
  add column widget_id uuid not null references public.widgets(id) on delete cascade,
  add column visitor_id text check (char_length(visitor_id) <= 64),
  add column page_url text check (char_length(page_url) <= 2048),
  add column language text check (char_length(language) <= 16);
create index conversations_widget_id_idx on public.conversations (widget_id);
create index conversations_visitor_id_idx on public.conversations (visitor_id);
grant select (widget_id, visitor_id, page_url, language)
  on public.conversations to authenticated;

-- messages
alter table public.messages
  add column status text not null default 'complete'
    check (status in ('complete','stopped','error')),
  add column model text,
  add column tokens_in integer check (tokens_in >= 0),
  add column tokens_out integer check (tokens_out >= 0);
grant select (status, model, tokens_in, tokens_out)
  on public.messages to authenticated;

-- usage_monthly (el dueño solo lee; escribe el service role)
create table public.usage_monthly (
  user_id uuid not null references auth.users(id) on delete cascade,
  month date not null,
  conversations integer not null default 0,
  messages integer not null default 0,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  primary key (user_id, month)
);
alter table public.usage_monthly enable row level security;
revoke all on public.usage_monthly from anon, authenticated;
grant select on public.usage_monthly to authenticated;
create policy usage_select_own on public.usage_monthly
  for select to authenticated
  using ((select auth.uid()) = user_id);
