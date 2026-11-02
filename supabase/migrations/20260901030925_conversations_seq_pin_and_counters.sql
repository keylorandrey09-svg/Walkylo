-- número secuencial por chat (se asigna al crearse, en Fase 8) y fijado
alter table public.conversations
  add column if not exists seq bigint,
  add column if not exists pinned boolean not null default false;

-- contador que nunca baja (total de chats que entraron alguna vez = fuente del seq)
-- y marca de "última vez que el dueño abrió Conversaciones" (para el punto azul)
alter table public.profiles
  add column if not exists conversations_total bigint not null default 0,
  add column if not exists conversations_seen_at timestamptz;
