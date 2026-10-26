# Walkylet (carpeta y repo: Walkylo)

Nombre anterior: WalkyUp (es el mismo proyecto). El nombre ya está cambiado a Walkylet en todos los textos visibles y en el logo. Siguen pendientes del dominio propio: el snippet de instalación (`walkyup.app/widget.js`) y el correo de soporte (`walkyup@gmail.com`). A propósito NO se cambian los identificadores internos de `w.js`: la API pública `window.WalkyUp`, el tag de consola `[WalkyUp]`, el `id` `walkyup-widget` y los atributos `data-walkyup-*`.

## Qué es
Widget de chat con IA que se instala en cualquier web con una línea de código. Piezas: landing (`index.html`), login (`login/`), panel (`app/`), páginas legales (`legal/`) y el widget instalable (`w.js`). Backend: Supabase.

## Reglas técnicas
- HTML, CSS y JavaScript vanilla. NO agregar React, Next.js, bundlers ni dependencias sin justificación aprobada por Keylor.
- Hosting actual: Vercel (`vercel.json` solo tiene cleanUrls). Se migrará a Cloudflare Pages: no introducir nada exclusivo de Vercel.
- Supabase (tablas, RLS, funciones, Edge Functions) se gestiona en otro chat. Claude Code NO modifica Supabase.
- Usar rutas absolutas (`/assets/...`) en archivos nuevos.

## Reglas de oro
1. `w.js` es un contrato público: no moverlo ni renombrarlo, mantenerlo autónomo (sin importar archivos del sitio, usa Shadow DOM) y sin cambios incompatibles.
2. Nunca secretos en el repo. En el frontend solo van claves públicas (`sb_publishable_...`). Jamás `service_role`, `sb_secret_`, ni llaves de OpenAI o Dodo.
3. No inventar datos ni promesas comerciales. Hoy el chat del widget NO responde con IA real. Los datos de demostración deben decir que son ilustrativos.
4. Cada botón o flujo debe funcionar, o no existir.
5. Marca: azul #0164FD. El verde se usa solo para estados confirmados.

## Reglas del widget
(Para no repetirlas en cada sesión. Aplican a `w.js` y a la vista previa del panel `app/index.html`.)
- Contrato público de `w.js`: el nombre del archivo, su URL, los atributos `data-*`, las claves de storage y las llamadas a Supabase NO cambian. Un solo archivo autónomo, con Shadow DOM, sin dependencias ni recursos remotos.
- Blanco y negro con variables de tema (Predeterminado/Claro y Oscuro). Nunca `#0164FD` ni colores sueltos; el rojo solo para acciones destructivas.
- En pantallas táctiles nunca llamar a `textarea.focus()` de forma automática (única excepción: al tocar "Editar" un mensaje). En laptop sí se enfoca al abrir.
- El título del estado vacío es estático: se elige uno al azar al abrir el chat o al empezar un chat nuevo, sin repetir el último, y no rota.
- Fotos: máximo 4, solo en el navegador, sin llamadas de red (queda el TODO `onSendAttachments`). El pipeline completo está en «Fotos del widget» más abajo.
- Historial local en localStorage por widget: máximo 30 chats, 100 mensajes por chat y 30 días, solo texto.
- El widget aparece junto con la página al recargar (config en caché y estado restaurado sin animación).
- Accesibilidad y `prefers-reduced-motion` en todo lo nuevo.

## Fotos del widget
Reglas del pipeline de carga de fotos (aplican a `w.js` y a la vista previa `cw*` en `app/index.html`). Pensado para ser confiable aun en móvil, galerías de Android/nube y sitios con CSP estricto.
- **(a) Leer antes de limpiar**: en el `change`, copiar enseguida cada archivo a un Blob propio en memoria (`file.arrayBuffer()`), con reintentos ante fallos pasajeros (200/500/1000 ms: `NotReadableError`, `AbortError`, `SecurityError`). Recién después resetear `input.value`. (Resetear antes invalidaba el File en móvil: era la causa principal del “no se pudo procesar”.)
- **(b) Tipo por firma**: detectar JPEG/PNG/WebP por los primeros bytes, nunca por `file.type` (en Android viene vacío). HEIC/HEIF/AVIF, GIF y desconocidos: mensaje “Este formato no es compatible, elegí una foto JPG, PNG o WEBP.”.
- **(c) Límites**: entrada hasta 25 MB; el tope real (~1,5 MB) aplica al RESULTADO procesado. Si lo supera, se baja calidad y, si hace falta, tamaño.
- **(d) Decodificar reducido**: `createImageBitmap(blob, {resizeWidth|resizeHeight, resizeQuality, imageOrientation:'from-image'})` ≤1600px (dimensiones leídas del encabezado); si falla, baja el tope (2048/1280/1024) y al final cae a `Image`+`decode()`. Cerrar el bitmap al terminar.
- **(e) Canvas fondo blanco**: pintar blanco antes de dibujar (los PNG/WebP transparentes no quedan negros). Verificar que `toBlob` no sea null; si lo es, reintentar con otros parámetros.
- **(f) Estado fuera del DOM**: los adjuntos viven en el arreglo de estado, nunca dependen del input ni del render. Un solo input persistente con un solo listener. Ningún re-render (config revalidada, restauración, `pageshow`, `visibilitychange`, abrir/cerrar) recrea el input, reemplaza la tarjeta ni borra adjuntos.
- **(g) Cola secuencial**: máximo 2 en paralelo. Cada adjunto tiene estado (leyendo/procesando/listo/error). Miniatura con indicador discreto mientras procesa; solo “enviar” espera si hay alguno procesándose.
- **(h) URLs**: una por adjunto (blob del resultado), liberada solo al quitar el adjunto, empezar un chat nuevo o descargar la página. Ninguna rutina de limpieza revoca URLs en uso.
- **(i) Respaldo CSP**: si la miniatura/visor no cargan el `blob:` (CSP estricto), se dibuja desde el lienzo procesado en un `<canvas>`.
- **(j) Errores**: un reintento automático y silencioso antes de mostrar nada. Si al final falla, mensaje específico por causa y botón “Reintentar” junto a esa miniatura (reusa el Blob en memoria, sin reabrir el selector). El mensaje genérico queda solo para errores inesperados, siempre con el detalle en el log.
- **Modo diagnóstico**: apagado por defecto. Se activa con `?wdebug=1` en la URL, con `localStorage.walkylet_debug="1"`, o siempre en `widget-test.html`. Muestra un panel chico (abajo a la izquierda) con botón “Copiar log”; registra tiempos y SOLO metadatos de las fotos (nunca su contenido). En modo debug, `w.js` expone `window.WalkyUp.__debug` para las pruebas de `widget-test.html` (batería de regresión del pipeline).

## Cómo trabajar con Keylor
- Keylor es principiante: explicá en español sencillo, con voseo costarricense, respuestas cortas.
- Un cambio pequeño por vez, siempre en una rama. Nunca commit directo a main. El push a ramas de trabajo está autorizado, nunca a main.
- Antes de editar, explicá qué vas a cambiar y por qué. Después, listá los archivos tocados y cómo probar el cambio.
- Para cambios grandes, proponé primero un plan y esperá aprobación.
- Nada destructivo (borrar archivos, reset --hard, force push) sin confirmación explícita.

## Flujo estándar
- Los cambios chicos y medianos se aplican directo en una rama con nombre `tipo/tema` (p. ej. `rename-walkylet`, `fix/config-overflow`), sin una fase de solo lectura aparte ni pedir confirmación previa: se revisan después en la vista previa.
- Solo los cambios grandes —base de datos, rutas, seguridad o borrados— llevan plan y aprobación antes de tocar código.

## Calidad mínima en cada cambio
Formularios con estado de carga, error útil y confirmación; etiquetas, foco visible y buen contraste; diseño pensado primero para móvil.

## Panel y rutas
- El panel (`app/index.html`) es una sola página con vistas. Decide qué vista mostrar SOLO leyendo `location.pathname`. Nunca uses el hash ni el query para elegir vista: Supabase los usa para confirmación de correo y supabase-js debe procesarlos solo. Única excepción: convertir `/app#<id-de-vista>` a su ruta nueva.
- Rutas: `/app` (resumen), `/app/conversaciones`, `/app/widget`, `/app/analiticas`, `/app/notificaciones` y `/app/configuracion` (la vista interna se llama "config").
- `vercel.json` tiene un rewrite `{ "/app/:path*" → "/app" }` y dos redirects que ocultan CLAUDE.md y README.md del sitio público. Si se migra a Cloudflare Pages hay que traducir ambos a su formato (`_redirects` o similar) y probarlos, o sacar esos archivos del sitio publicado.
- La recuperación de contraseña vuelve a `/login`, no a `/app`.

## Flujo de trabajo y pendientes
- Todo cambio va en una rama, con Pull Request y vista previa de Vercel antes de unir a main. Probar en la vista previa antes de unir.
- Carpeta de trabajo local: `C:\dev\Walkylo` (fuera de OneDrive).
- Pendientes conocidos (NO implementar sin que Keylor lo pida): dominio propio, corregir el snippet de la landing (hoy apunta a `walkyup.app/widget.js`, que no corresponde al archivo real `w.js`), conectar la IA real al widget (hoy responde un mensaje fijo), CSS compartido (`brand.css`) y respaldo del backend de Supabase en el repo.

## Pendientes antes de lanzar a clientes
- **Fotos del widget (`+`)**: hoy `ATTACHMENTS_ENABLED = true` en `w.js`, pero las fotos son SOLO del lado del navegador (vista local, sin red ni Supabase; el enganche real está marcado con el TODO `onSendAttachments` para la Fase 8). Antes de habilitarlas para clientes reales hay que definir el lado servidor: bucket privado con límites (cantidad/tamaño/ritmo contra abuso); subida por la función `chat`; columna de adjuntos; `widget_id` y `visitor_id` en `conversations`; visión de la IA sobre las imágenes; retención y borrado; y política de privacidad. Si eso no está listo al lanzar, poné `ATTACHMENTS_ENABLED = false`.
- **Historial del chat**: hoy es SOLO local en el dispositivo (localStorage, namespaced por id del widget; sin red). No se sincroniza entre dispositivos ni con el servidor. La sincronización con el servidor queda para la Fase 8.
- **Regenerar y editar mensajes**: hoy "Generar otra respuesta" (en los mensajes de la IA) y "Editar" (en los del usuario) pasan por la misma función que genera respuestas, con un flag `regenerate` y un `AbortController`, pero la respuesta sigue siendo el mensaje fijo. En la Fase 8 hay que conectar esos dos flujos con la IA real (la función `chat`), respetando el flag y el aborto.
