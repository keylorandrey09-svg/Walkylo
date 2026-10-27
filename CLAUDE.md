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
- Color del logo (`widgets.accent`): el selector tiene solo tres opciones —Blanco, Negro y Paleta (picker de color propio en la página, no el nativo)—. El valor es `auto` (Automático) o un `#RRGGBB` en mayúsculas; Automático es el valor por defecto y NO es un color fijo. El color solo se aplica al logo con ícono incluido (botón flotante y avatar del encabezado): fondo de ese color con el ícono en blanco o `#111` según la luminancia (WCAG), sin depender del tema; el blanco lleva un borde fino. Con foto subida el color no se ve. En Automático el logo se ve exactamente como antes (sin fondo nuevo) y se adapta al tema. `accent` NO afecta el botón de enviar, burbujas, bordes ni texto.
- En pantallas táctiles nunca llamar a `textarea.focus()` de forma automática (única excepción: al tocar "Editar" un mensaje). En laptop sí se enfoca al abrir.
- El título del estado vacío es estático: se elige uno al azar al abrir el chat o al empezar un chat nuevo, sin repetir el último, y no rota.
- Fotos: máximo 4, solo en el navegador, sin llamadas de red (queda el TODO `onSendAttachments`).
- Historial local en localStorage por widget: máximo 30 chats, 100 mensajes por chat y 30 días, solo texto.
- El widget aparece junto con la página al recargar (config en caché y estado restaurado sin animación).
- El botón flotante y el avatar nunca dependen de la red para su primer dibujo: se guarda una copia local del avatar (data URL de 128px en la caché de config), la foto se decodifica antes de insertarla y nunca se ve el fondo vacío (o está la foto, o el ícono por defecto; el botón queda oculto hasta estar listo y cae al ícono tras un tope de ~1200 ms). Cada avatar nuevo del panel ya viaja con un nombre de archivo único (URL nueva), así que ninguna caché sirve una imagen vieja. El primer dibujo del botón NUNCA espera a que se genere la copia local: esa copia se crea después, en tiempo ocioso (`requestIdleCallback`/`setTimeout`).
- La config se pide en la primera línea ejecutable (antes de construir el DOM/Shadow/CSS), con `<link rel="preconnect">` a Supabase, y la petición está aislada en `fetchConfig()` (para mover el origen a una CDN más adelante). La config se revalida SIEMPRE en cada carga (una vez por carga, sin compuerta de TTL) y también al volver de segundo plano tras más de 5 minutos oculta; si el avatar no cambió no se toca el DOM. El "TTL" ahora es la antigüedad máxima de la caché que se muestra sin revalidar antes: 30 días (más vieja = se trata como primera visita). Deuda a futuro: mover la config a una dirección cacheada en CDN cuando haya tráfico.
- Accesibilidad y `prefers-reduced-motion` en todo lo nuevo.

## Sistema visual web
(Aplica a la landing `index.html`. Tokens, fuentes y componentes base en `/brand.css`; el panel también lo importa, con sus propias reglas en "Sistema visual app". No aplica al widget.)
- Paleta (variables en `:root`): `--bg #FFFFFF`, `--surface #F6F7F8`, `--border #E5E7EA`, `--text-2 #6B7079`, `--text #0E1014`, `--accent #0164FD`, `--ok #079455`.
- Botón principal: fondo `--text` con texto blanco. Secundario: borde `--border`, sin relleno.
- El azul solo para enlaces, foco (`focus-visible`) y estado activo/seleccionado. Máximo un elemento azul visible por pantalla. Nunca en títulos, íconos decorativos ni etiquetas. Excepción (pedido de Keylor): las palomas de las listas de Precios van en azul solo en la primera tarjeta (Gratis) y en verde (`--ok`) en Pro y Business.
- Prohibido: gradientes, sombras, brillos, subrayados dibujados, fondos de color en íconos.
- Tipografía: Geist (sans) y Geist Mono (solo código y números chicos), autoalojadas en `/fonts/` (licencia OFL en `fonts/OFL.txt`). Nada de Google Fonts. Pesos 400 y 500, nunca más. Títulos con `letter-spacing: -0.02em`; la jerarquía sale del tamaño, no del grosor.
- Escala: h1 `clamp(2.25rem, 5vw, 3.75rem)/1.08` con `text-wrap: balance` (máximo 2 líneas en escritorio); h2 `clamp(1.75rem, 3.5vw, 2.5rem)/1.15`; cuerpo `1rem/1.6`; secundario `0.875rem`; etiquetas `0.8125rem` peso 500, sin mayúsculas ni tracking ancho.
- Forma (pedido de Keylor, iteración 4): controles en píldora (`--r-ctl: 999px`: botones, "Próximamente", etiquetas `.tag`, barra de URL; el botón de menú es un círculo) y contenedores con radio 20px (`--r-box`: paneles, escenarios, bloque de precios, código). El marco de navegador del hero usa 14px por ir anidado. Bordes de 1px `--border`. Los dibujos SVG mantienen sus radios internos 6/10. Íconos SVG inline de línea, trazo 1.5px, sin relleno, clase `.icon`.
- Espaciado en escala de 8px, contenedor de 1120px, texto alineado a la izquierda (excepción: los títulos de "Lo que ya funciona" y "Precios" van centrados con su descripción, y en celular el cierre va centrado con ancho máximo de ~560px; desde 880px el cierre va con título y descripción a la izquierda y el botón a la derecha).
- Header: logo a la izquierda. Desde 1024px, enlaces centrados de verdad (grid `1fr auto 1fr`, máximo 5: Producto, Estado, Cómo funciona, Precios, FAQ) e "Iniciar sesión" + "Empezar" a la derecha. Debajo de 1024px: "Empezar" (píldora de 40px de alto, letra 0.875rem) y, a 8px a su derecha, el botón de menú (≡, círculo de 40px); los dos con área táctil invisible de 44px; "Iniciar sesión" va dentro del menú, que se cierra con Escape y al tocar un enlace.
- Enfoque del texto: proyecto real en desarrollo activo, no lista de espera. Nada de "acceso anticipado" ni "pronto". Presente solo para lo que funciona hoy; para la IA, "se está conectando" / futuro. Datos de confianza solo si se pueden verificar (p. ej. el peso de `w.js` medido con `gzip -c w.js | wc -c`; si `w.js` cambia mucho, volver a medir y actualizar la cifra del hero).
- Estado del proyecto (`#estado`, dentro de la banda de Producto): 3 columnas sin tarjetas con etiquetas en Geist Mono y un punto de color: "disponible hoy" (verde `--ok`), "en desarrollo" (azul, estado activo) y "después" (punto vacío). Ítems de 10 palabras o menos, sin fechas ni porcentajes. Actualizarlo cuando algo cambie de columna. No repetir el mismo molde en todas las secciones; cada elemento con una función.
- Móvil primero (360px), objetivos táctiles de 44px o más, casi sin animaciones y siempre con `prefers-reduced-motion`.
- Botones: el negro lleno solo en el header ("Empezar"), en "Copiar" del snippet del hero (mismo tamaño que la barra del código) y en el cierre ("Empezar gratis"). En Precios, botón secundario con borde en las tarjetas blancas y blanco en la oscura. El hero no lleva otros botones: su acción es el snippet. En el resto, botón secundario o enlace de texto.
- Textos cortos: función ≤ 12 palabras, paso ≤ 14, subtítulo de sección ≤ 12, respuesta de FAQ ≤ 2 frases.
- Bandas a todo el ancho, alternando: hero blanco · Producto + Estado del proyecto `--surface` · Cómo funciona blanco · Precios `--surface` · FAQ blanco · cierre `--surface` · footer blanco con línea superior. Una superficie nunca va sobre el mismo color de su fondo: en banda gris, paneles blancos con borde 1px y radio 10px (`.card`); en banda blanca, escenarios de dibujo `--surface` sin borde (`.stage`). Padding de sección 64px móvil / 80px escritorio.
- Dibujos: máximo 3 en la página, SVG inline (clase `.art`) sobre cuadrícula de 8px, radios solo 6 y 10, trazo 1px no escalable, sin animación, `aria-hidden="true"`, legibles a 360px y explicando algo real del producto. Jerarquía de trazo: `--border` = estructura del sitio ajeno, `--text-2` = secundario, `--text` = el único protagonista (lo de Walkylet). Relleno solo blanco o `--surface` (única excepción: el mini-widget oscuro de "Tema claro y oscuro" usa `--text`). Punteado solo para UN límite que importa (el Shadow DOM); las líneas de texto fingidas van sólidas en `--border`. Máximo 2 etiquetas por dibujo, Geist Mono 11–12px, ancladas a un elemento. El dibujo ocupa ~70% del alto del escenario. Sin dibujos en Precios ni FAQ.
- Precios: tres tarjetas separadas con radio 24px (blancas con borde sobre la banda gris; la del medio, Pro, oscura con fondo `--text`). Orden por tarjeta: nombre · frase · lista con palomas · al pie precio con "/mes" y "USD", acción en píldora y una nota chica. Solo Gratis lleva botón con enlace (secundario, con borde); los planes que no se pueden contratar muestran "Próximamente" con forma de botón (con borde en tarjeta blanca, blanco en la oscura) pero sin enlace, y la nota "Todavía no se puede contratar.". Sin sello de "recomendado" ni límites inventados.
- La réplica del widget en el hero es estática y muestra solo el estado vacío: nunca inventar una conversación ni respuestas de la IA.
- Réplica del widget en celular (menos de 480px): imita el w.js real en móvil, una hoja que sube desde abajo (radio 20px arriba, barrita de arrastre, borde negro de 1px separado 8px de los costados, el + de fotos, 330px de alto) con el sitio asomando arriba sobre un gris suave (`#F1F2F4`), como cuando el celular oscurece la página. Desde 480px, panel flotante anclado abajo a la derecha. Las barras del sitio de fondo del hero van un poco más oscuras que `--border` (`#CDD1D6`, relleno `#EFF1F3`) para que se lean sin competir con el widget.
- Datos verificables bajo el hero: fila centrada con íconos de línea (no palomas; ya hay muchas en la página). En celular, 2 arriba y 1 abajo con el ícono sobre el texto; mismo aire arriba (desde la línea) y abajo (hasta la banda gris).
- Números de los pasos de "Cómo funciona" en Geist normal con cifras tabulares (el 0 de Geist Mono va tachado). El paso activo muestra una manita de línea negra que señala (estilo 👉, SVG, no emoji de color).
- El snippet de instalación vive en un solo lugar (`#snippet` en `index.html`) y apunta a `https://walkylo.vercel.app/w.js` hasta que haya dominio propio.

## Sistema visual app
(Aplica al panel `app/index.html`. Misma dirección que la landing; no aplica al interior de la vista previa del chat, que imita a `w.js`.)
- Tokens compartidos: el panel importa `/brand.css` con ruta absoluta en la capa `brand` (`@import url("/brand.css") layer(brand)`), así sus reglas ganan sin pelear especificidad. Su CSS propio sigue inline en `app/index.html`; no crear archivos dentro de `/app/` (el rewrite de `vercel.json` los taparía).
- Tema: `data-theme="dark"` en `<html>` (se guarda en `localStorage` `wu-theme`). Los valores oscuros viven en `brand.css` (`:root[data-theme="dark"]`, tomados del tema oscuro de `w.js`). `--danger` (rojo) solo para acciones destructivas y errores.
- Tipografía: Geist 400/500, nunca más. Título de vista 1.5rem/1.2 peso 500, `letter-spacing -0.01em`; cuerpo 0.9375rem; secundario 0.8125rem; etiquetas en oración, sin mayúsculas ni tracking. Geist Mono solo para números o códigos chicos.
- Fondos: contenido en `--bg`; menú en `--surface` con borde derecho 1px `--border`. Prohibido: sombras, gradientes (excepción: la muestra "Paleta" y el selector de color, que son el color mismo) y grises azulados.
- Botones: principal con fondo `--text` y texto `--bg`, radio 6px, alto 40px, y uno solo por vista. Secundario con borde 1px `--border`, sin relleno. Destructivo: texto `--danger`, sin relleno. No existe el botón azul lleno.
- Campos: fondo `--bg`, borde 1px `--border`, radio 6px, alto 40px (44px en móvil); al enfocar, borde y anillo `--accent`.
- Control segmentado: radio 6px; seleccionado con fondo `--bg` y borde.
- Paneles y tarjetas: borde 1px `--border`, radio 10px, fondo `--bg`. Radios solo 6/10 (4px solo en un control anidado dentro de otro de 6px).
- Íconos de línea de 20px, trazo 1.5px, sin fondo tintado.
- Azul solo en enlaces, foco (`focus-visible`) y el punto de notificaciones no leídas (8px). El ítem activo del menú y los seleccionados van en negro/gris, nunca en azul. Verde solo para estados confirmados.
- Menú lateral (≥769px): 240px fijo; logo arriba; grupos con etiqueta chica gris: "Producto" (Resumen, Conversaciones, Widget, Analíticas) y "Cuenta" (Notificaciones, Configuración); abajo, separados por una línea, Soporte y Cerrar sesión. Ítem de 40px, radio 6px, texto `--text-2`; hover `--text`; activo con fondo `--bg`, borde 1px y texto `--text` peso 500. Sin barra superior en escritorio.
- Móvil (≤768px): barra fija de 56px con el logo a la izquierda y ≡ a la derecha (44px). El ≡ abre un cajón desde la izquierda con la misma lista, más un velo `--text` al 40% (negro al 60% en oscuro). Cierra con Escape, al tocar un enlace y al tocar el velo; bloquea el scroll del fondo; sin animaciones. Objetivos táctiles de 44px o más.
- Vista Widget: 5 pestañas (General, Apariencia, Conocimiento, Comportamiento, Contacto y privacidad) en memoria, sin cambiar la URL; todos los paneles quedan en el DOM (`hidden`) y un solo Editar/Guardar vale para todas. La vista previa solo se muestra en Apariencia y Comportamiento.
- Los IDs, clases y `data-*` que usa el JS (`#shell`, `#nav`, `#burger`, `#scrim`, `#navNoti`, `.wa-sidebar`, `.wa-brand`, `.is-open`, `.is-active`, `.has-unread`, `data-view`, `data-action`, etc.) no se renombran.

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
