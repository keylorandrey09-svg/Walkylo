# Respaldo del backend (Supabase)

Proyecto Supabase: `ejbtgkvlrkecnslpapyd` (us-east-2).
Este directorio es un RESPALDO de lo que vive en Supabase. La fuente de verdad sigue siendo Supabase;
si algo cambia allá, hay que actualizar esta carpeta (y al revés).

## Contenido
- `migrations/` — las 25 migraciones aplicadas, en orden de versión (nombre = `<version>_<nombre>.sql`).
  Cada archivo es idéntico al guardado en el historial de migraciones de Supabase.
- `functions/chat/index.ts` — Edge Function del chat (verify_jwt = false: la usan visitantes anónimos).
- `functions/delete-account/index.ts` — borrado de cuenta (verify_jwt = true).
- `manual/cron_purge_old_notifications.sql` — tarea programada creada a mano (no es migración).

## Secretos
NUNCA van en esta carpeta. Se cargan en Supabase → Edge Functions → Secrets:
- `OPENAI_API_KEY` (cuando exista; sin ella `chat` responde en modo simulado)
- Opcionales: `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT`, `CHAT_DISABLED=true` (interruptor de emergencia).
`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta Supabase solo.

## Lo que NO está respaldado todavía
- Buckets de Storage y sus políticas más allá de lo que figura en las migraciones.
- Configuración de Auth (plantillas de correo, URL Configuration, proveedores).
