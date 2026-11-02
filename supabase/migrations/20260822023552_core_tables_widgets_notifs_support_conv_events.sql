-- ========== WIDGETS (config del widget, 1 por usuario) ==========
create table public.widgets (
  id uuid primary key default gen_random_uuid(),           -- este id es el data-id del snippet
  user_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null default 'Asistente',
  accent text not null default '#0164FD',
  position text not null default 'right',
  welcome text not null default '¡Hola! ¿En qué te puedo ayudar?',
  tone text not null default 'cercano',
  language text not null default 'es',
  fallback text not null default 'email',
  knowledge text not null default '',
  avatar text not null default 'w1',
  avatar_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.widgets enable row level security;
create policy "widgets_select_own" on public.widgets for select using (auth.uid() = user_id);
create policy "widgets_insert_own" on public.widgets for insert with check (auth.uid() = user_id);
create policy "widgets_update_own" on public.widgets for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ========== NOTIFICATIONS ==========
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tag text not null default 'NOVEDAD',
  title text not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
alter table public.notifications enable row level security;
create policy "notifications_select_own" on public.notifications for select using (auth.uid() = user_id);
create policy "notifications_update_own" on public.notifications for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index notifications_user_idx on public.notifications(user_id, created_at desc);

-- ========== SUPPORT MESSAGES (límite 4/30min lo verifica el front por conteo) ==========
create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  photos text[] not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.support_messages enable row level security;
create policy "support_select_own" on public.support_messages for select using (auth.uid() = user_id);
create policy "support_insert_own" on public.support_messages for insert with check (auth.uid() = user_id);
create index support_user_idx on public.support_messages(user_id, created_at desc);

-- ========== CONVERSATIONS + MESSAGES (las llena el runtime del widget, Fase 8) ==========
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,   -- dueño (cliente WalkyUp)
  visitor_name text not null default 'Visitante',
  initial text not null default 'V',
  status text not null default 'open',                                  -- 'open' | 'resolved'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.conversations enable row level security;
create policy "conv_select_own" on public.conversations for select using (auth.uid() = user_id);
create policy "conv_update_own" on public.conversations for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index conv_user_idx on public.conversations(user_id, updated_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  from_role text not null,                                              -- 'visitor' | 'assistant'
  text text not null,
  created_at timestamptz not null default now()
);
alter table public.messages enable row level security;
create policy "msg_select_own" on public.messages for select using (
  exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid())
);
create index messages_conv_idx on public.messages(conversation_id, created_at);

-- ========== EVENTS (analíticas; las llena el runtime del widget, Fase 8) ==========
create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,                                                   -- 'question' | 'answer' | 'link'
  created_at timestamptz not null default now()
);
alter table public.events enable row level security;
create policy "events_select_own" on public.events for select using (auth.uid() = user_id);
create index events_user_idx on public.events(user_id, created_at);
