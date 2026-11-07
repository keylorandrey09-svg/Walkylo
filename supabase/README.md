# Respaldo del backend (Supabase)

Proyecto Supabase: `ejbtgkvlrkecnslpapyd` (us-east-2).
Este directorio es un RESPALDO de lo que vive en Supabase. La fuente de verdad sigue siendo Supabase;
si algo cambia allá, hay que actualizar esta carpeta (y al revés).

## Contenido
- `migrations/` — las 31 migraciones aplicadas, en orden de versión (nombre = `<version>_<nombre>.sql`).
  Cada archivo es el SQL guardado en `supabase_migrations.schema_migrations` más un salto de línea final.
  Comprobación: `md5(array_to_string(statements, E';\n'))` coincide con el md5 del archivo sin ese último salto.
- `functions/chat/index.ts` — Edge Function del chat, v14 (verify_jwt = false: la usan visitantes anónimos).
- `functions/delete-account/index.ts` — borrado de cuenta (verify_jwt = true).
- `functions/import-site/` — lectura y resumen del sitio, v5 (verify_jwt = true): `index.ts`, `flow.ts`, `lib.ts`,
  `summarize.ts`, `sections.ts`, más sus pruebas (`sections_test.ts`, `flow_sections_test.ts`) y `fixtures/`.
- `functions/verify-site/` — verificación del sitio, v1 (verify_jwt = true): `index.ts`, `verify.ts`, `lib.ts`.
- `manual/cron_purge_old_notifications.sql` — tarea programada creada a mano (no es migración).

## import-site v5: secciones
Además del texto de cada página, v5 la divide en secciones con estructura (`sections.ts`) y las guarda en la tabla
`sections` (una fila por sección: título, tipo, si está oculta, texto). Si guardar las secciones falla, la página igual
queda leída.

Pruebas (Deno; no tocan Supabase ni sitios reales: usan servidores locales y un almacén en memoria. La primera vez
Deno descarga `node-html-parser` desde npm):
```
cd supabase/functions/import-site
deno test -A
```
`fixtures/walkychat-home.html` y `fixtures/walkylet-home.html` son copias del HTML público de 2 sitios
(https://walkychat.app/ y https://walkylo.vercel.app/), bajadas tal cual el 2026-11-06. No hay que editarlas: las pruebas dependen de ellas.

## `lib.ts` está duplicado
`import-site/lib.ts` y `verify-site/lib.ts` son el mismo archivo (hoy idénticos byte a byte; los dos empiezan con el
comentario `// supabase/functions/import-site/lib.ts`). Supabase despliega cada función por separado, así que cada una
lleva su copia. Si se cambia uno, hay que cambiar el otro y desplegar las dos funciones.

## Secretos
NUNCA van en esta carpeta. Se cargan en Supabase → Edge Functions → Secrets:
- `OPENAI_API_KEY` (cuando exista; sin ella `chat` responde en modo simulado)
- Opcionales: `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT`, `CHAT_DISABLED=true` (interruptor de emergencia).
`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta Supabase solo.

## Lo que NO está respaldado todavía
- Buckets de Storage y sus políticas más allá de lo que figura en las migraciones.
- Configuración de Auth (plantillas de correo, URL Configuration, proveedores).
