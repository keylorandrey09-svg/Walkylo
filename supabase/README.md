# Respaldo del backend (Supabase)

Proyecto Supabase: `ejbtgkvlrkecnslpapyd` (us-east-2).
Este directorio es un RESPALDO de lo que vive en Supabase. La fuente de verdad sigue siendo Supabase;
si algo cambia allá, hay que actualizar esta carpeta (y al revés).

## Contenido
- `migrations/` — las 33 migraciones aplicadas, en orden de versión (nombre = `<version>_<nombre>.sql`).
  Cada archivo es el SQL guardado en `supabase_migrations.schema_migrations` más un salto de línea final.
  Comprobación: `md5(array_to_string(statements, E';\n'))` coincide con el md5 del archivo sin ese último salto.
- `functions/chat/` — Edge Function del chat, v15 (verify_jwt = false: la usan visitantes anónimos):
  `index.ts` (conexión a la base y a OpenAI), `handler.ts` (lógica del pedido), `core.ts` (partes puras),
  más su prueba `chat_test.ts`.
- `functions/delete-account/index.ts` — borrado de cuenta (verify_jwt = true).
- `functions/import-site/` — lectura del sitio y Memoria, v7 (verify_jwt = true): `index.ts`, `flow.ts`, `lib.ts`,
  `summarize.ts`, `sections.ts`, `memory.ts`, más sus pruebas (`sections_test.ts`, `flow_sections_test.ts`,
  `memory_test.ts`) y `fixtures/`.
- `functions/verify-site/` — verificación del sitio, v1 (verify_jwt = true): `index.ts`, `verify.ts`, `lib.ts`.
- `manual/cron_purge_old_notifications.sql` — tarea programada creada a mano (no es migración).

Las huellas (sha256) de los archivos se calculan con saltos de línea LF, que es como los guarda git. En Windows, con
`core.autocrlf=true`, la copia de trabajo puede tener CRLF y dar otra huella: comparar con `git show HEAD:<ruta> | sha256sum`.

## chat v15: secciones y modo prueba
- **Secciones solo si el widget tiene `use_sections = true`** (columna nueva, por defecto `false`; migración
  `chat_v15_sections_test`). Con el interruptor apagado, el chat funciona como v14: responde con todo el texto de
  `widgets.knowledge` (hasta 20.000 caracteres) y las Notas. Con el interruptor prendido, en cada pregunta busca hasta
  8 secciones con la función SQL `search_sections` (solo la puede llamar `service_role`) y arma el contexto con, en
  este orden de prioridad: Notas del dueño, Secciones encontradas y Memoria (`knowledge`, hasta 8.000 caracteres).
  Si la búsqueda falla, sigue sin secciones. Si no hay Notas, Memoria ni secciones, responde el aviso de "no sé"
  sin llamar a la IA.
- **Modo prueba del dueño**: el pedido trae `test: true` y la sesión del dueño en `Authorization`. Si el token no es del
  dueño de ese widget, responde 403 `test_no_autorizado`. Las conversaciones de prueba se guardan con
  `conversations.is_test = true`, no cuentan para el uso del mes ni crean eventos, tienen su propio tope diario
  (`OWNER_TEST_PER_DAY`, 200) y la respuesta incluye `sources` (título y tipo de las secciones usadas).
- Ante un 429 de OpenAI reintenta una vez (salvo `insufficient_quota`), esperando lo que indique `retry-after`
  (entre 0,5 y 4 s).
- Sin `OPENAI_API_KEY` sigue en modo simulado.

## import-site v7: secciones y Memoria
Además del texto de cada página, la lectura la divide en secciones con estructura (`sections.ts`) y las guarda en la
tabla `sections` (una fila por sección: título, tipo, si está oculta, texto). Si guardar las secciones falla, la página
igual queda leída.

v7 **genera la Memoria** (`memory.ts`, acción `memory_generate`): toma las secciones leídas, las resume por lotes
(sitio, app, legales) y une esas notas en un texto de hasta 8.000 caracteres que guarda en `widgets.knowledge`.
- Si las secciones no cambiaron desde la última Memoria (huella en `memory_sources_hash`), responde `sin_cambios`
  sin llamar a la IA; `force: true` la regenera igual.
- Si el dueño había editado la Memoria a mano, la nueva NO pisa su texto: queda como borrador en `memory_draft`.
  `memory_accept` lo pasa a `knowledge` y `memory_discard` lo borra.
- Cada intento queda registrado en la tabla `memory_runs` (migración `memory_draft_and_runs`). Límites
  provisionales por día: 10 Memorias creadas y 30 intentos en total.

## Cómo correr las pruebas
Hace falta [Deno](https://deno.com/). Las pruebas no tocan Supabase, OpenAI ni sitios reales: usan servidores locales,
un almacén en memoria y una IA falsa. La primera vez Deno descarga dependencias desde npm.

chat (`chat_test.ts`, 21 pruebas):
```
cd supabase/functions/chat
deno test -A
```

import-site (`sections_test.ts`, `flow_sections_test.ts` y `memory_test.ts`, 30 pruebas):
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
