-- Campos nuevos del widget: URL del sitio (para que la IA lo lea), correo de contacto y URL de privacidad (menú del chat)
alter table public.widgets add column if not exists site_url text not null default '';
alter table public.widgets add column if not exists contact_email text not null default '';
alter table public.widgets add column if not exists privacy_url text not null default '';
