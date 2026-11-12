# Respaldo del backend (Supabase)

Proyecto Supabase: `ejbtgkvlrkecnslpapyd` (us-east-2).
Este directorio es un RESPALDO de lo que vive en Supabase. La fuente de verdad sigue siendo Supabase;
si algo cambia allá, hay que actualizar esta carpeta (y al revés).

## Contenido
- `migrations/` — las 34 migraciones aplicadas, en orden de versión (nombre = `<version>_<nombre>.sql`).
  Cada archivo es el SQL guardado en `supabase_migrations.schema_migrations` más un salto de línea final.
  Comprobación: `md5(array_to_string(statements, E';\n'))` coincide con el md5 del archivo sin ese último salto.
- `functions/chat/` — Edge Function del chat, v21 (verify_jwt = false: la usan visitantes anónimos):
  `index.ts` (conexión a la base y a OpenAI), `handler.ts` (lógica del pedido), `core.ts` (partes puras),
  más su prueba `chat_test.ts`.
- `functions/delete-account/index.ts` — borrado de cuenta (verify_jwt = true).
- `functions/import-site/` — lectura del sitio y Memoria, v11 (verify_jwt = true): `index.ts`, `flow.ts`, `lib.ts`,
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

## chat v16 → v20: qué cambió
- Si OpenAI rechaza un pedido, el registro `openai_error` guarda el motivo (su mensaje de error y los encabezados de
  límites), nunca el texto del visitante.
- No reintenta si OpenAI pide esperar más de 4 s; si la espera pasa de 60 s, el visitante ve "Probá de nuevo más tarde".
- Las reglas piden responder en el idioma del último mensaje y con un solo tratamiento (vos por defecto, tú si el
  visitante escribe de tú).
- Al último mensaje se le suma un recordatorio de idioma (`REPLY_NOTE`) solo en lo que va a la IA: no se guarda ni se muestra.
- Las ventanas emergentes y los menús (`ui`, `menu`) nunca llevan enlace.
- Si falla la lectura del widget, reintenta una vez antes de dar error (solo "no existe" o "apagado" es 404).
- El uso del mes se suma con la función SQL `bump_usage` (migración `bump_usage_atomic`): dos mensajes a la vez no se pisan.
- En cada llamada buena, `openai_usage` registra la holgura de OpenAI (encabezados `x-ratelimit-*`).

## chat v21: qué cambió
- Si hay más de un punto de entrada para la misma acción, da primero el camino principal y menciona la alternativa en una línea.
- No repite los identificadores internos de los menús (los nombres entre paréntesis en sus títulos).
- Si falta un dato, dice "no figura" una sola vez por respuesta.
- El correo del campo del widget (`contact_email`) es el único contacto válido: la IA no da otro correo ni teléfono, y
  `cleanEmails` reemplaza cualquier otro correo de la respuesta por el configurado.

## import-site v11: Memoria m5
`MEMORY_VERSION` pasa a `m5` (cambia la huella: la próxima lectura regenera la Memoria).
- La sección "Contacto" la arma el código desde el correo del campo del widget; la IA ya no la escribe.
- A la IA le llegan todas las secciones legales (cada una hasta 1.200 caracteres, hasta 30.000 en total), para que
  ningún documento quede afuera.

## import-site v8: Memoria m2
`MEMORY_VERSION` pasa a `m2` (cambia la huella, así que la próxima lectura regenera la Memoria). Las instrucciones
ignoran maquetas y ejemplos con cifras de muestra, ponen "Enlaces" (máx. 12) antes que "Políticas" (máx. 8 líneas)
y apuntan a 4.000–6.000 letras, nunca más de 6.500.

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

chat (`chat_test.ts`, 41 pruebas):
```
cd supabase/functions/chat
deno test -A
```

import-site (`sections_test.ts`, `flow_sections_test.ts` y `memory_test.ts`, 43 pruebas: 13 + 7 + 23):
```
cd supabase/functions/import-site
deno test -A
```
`fixtures/walkychat-home.html` y `fixtures/walkylet-home.html` son copias del HTML público de 2 sitios
(https://walkychat.app/ y https://walkylo.vercel.app/), bajadas tal cual el 2026-11-06. No hay que editarlas: las pruebas dependen de ellas.

## Prueba de carga
`tools/carga.mjs` (Node 18 o más nuevo) manda mensajes REALES a la función `chat` del widget de prueba:
- `node tools/carga.mjs humo` — 40 mensajes, 4 a la vez.
- `node tools/carga.mjs rafaga` — 80 mensajes, 16 a la vez.
- `node tools/carga.mjs sostenida` — 250 mensajes, 5 a la vez.
- `todo` corre las tres seguidas (370 mensajes). Cada etapa se corta sola a los 10 fallos.

El widget tiene un tope de 500 mensajes por día (`PER_WIDGET_PER_DAY`): no correr `todo` dos veces el mismo día.
Cada mensaje usa un visitante nuevo, así que deja conversaciones con `visitor_id` que empieza con `carga-`.

## Calificación de respuestas
`tools/calificada.ps1` (PowerShell) manda 23 preguntas REALES a la función `chat` del widget de prueba (21 sueltas y
2 seguidas en la misma conversación) y califica cada respuesta con lo que "debe decir" y lo que "no debe decir"
(además: texto interno filtrado, correos que no son el configurado, mezcla de vos y tú).
- `$MAIL`, en la primera línea, tiene que ir a la par del correo configurado en el widget (escrito como expresión regular).
- Deja conversaciones reales en el widget, con `visitor_id` que empieza con `chk-`.

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
