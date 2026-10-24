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
