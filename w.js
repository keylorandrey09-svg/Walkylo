/*! WalkyUp widget runtime — w.js
 *  Un solo archivo para todos los clientes. Lee su data-id, trae la config
 *  de ese widget desde Supabase y se dibuja aislado (Shadow DOM).
 *  El asistente responde de verdad cuando se conecte la IA (Edge Function chat).
 */
(function () {
  "use strict";

  // ---- Textos del estado vacío (editables) ----
  // Rotan solos cada ~4 s en el estado vacío, al azar sin repetir el anterior.
  var EMPTY_TITLES = [
    "Preguntá lo que quieras",
    "Obtener ayuda de nuestro equipo IA",
    "¿En qué podemos ayudarte hoy?",
    "Escribí tu consulta",
    "¿Tenés alguna duda?",
    "Estamos para ayudarte"
  ];

  // ---- Fotos adjuntas (lado navegador, sin red) ----
  // Beta activa. Antes de lanzar a clientes definir el lado servidor o volver a false
  // (ver CLAUDE.md > "Pendientes antes de lanzar a clientes").
  var ATTACHMENTS_ENABLED = true;
  var ATT_MAX = 4;                 // cantidad máxima de fotos
  var ATT_MAX_MB = 5;              // tamaño máximo por foto
  var ATT_MAX_PX = 1600;          // lado mayor tras reducir
  var ATT_QUALITY = 0.8;           // calidad del canvas
  var ATT_TYPES = { "image/jpeg": 1, "image/png": 1, "image/webp": 1 };

  // ---- Historial local (solo en este dispositivo, sin red) ----
  var HIST_MAX_CHATS = 30;         // chats guardados por widget
  var HIST_MAX_MSGS = 100;         // mensajes por chat
  var HIST_TTL = 30 * 24 * 60 * 60 * 1000; // 30 días
  var CFG_TTL = 10 * 60 * 1000;    // caché de config: 10 minutos

  var SUPA_URL = "https://ejbtgkvlrkecnslpapyd.supabase.co";
  var SUPA_KEY = "sb_publishable_igO0MoubT3Na_F0RPdA2hQ_2T-qkYMQ";

  // Texto de espera actual (la IA real se conecta en la Fase 8). No inventar respuestas.
  var PENDING_REPLY = "¡Gracias por tu mensaje! El asistente estará disponible muy pronto.";

  // ---- 1) Encontrar el script y su data-id ----
  var me = document.currentScript;
  if (!me) {
    var ss = document.getElementsByTagName("script");
    for (var i = ss.length - 1; i >= 0; i--) {
      if (ss[i].src && ss[i].src.indexOf("w.js") !== -1) { me = ss[i]; break; }
    }
  }
  var dataId = me && me.getAttribute("data-id");
  if (!dataId || dataId === "TU_ID") { console.warn("[WalkyUp] Falta data-id en el <script>."); return; }
  var launcher = ((me && me.getAttribute("data-launcher")) || "").toLowerCase();
  if ((me && (me.getAttribute("data-beta") || "").toLowerCase() === "attachments")) ATTACHMENTS_ENABLED = true;
  if (window.__walkyupLoaded) { return; } window.__walkyupLoaded = true;

  var CFG_KEY = "wu_cfg_" + dataId;   // caché de config pública (localStorage)
  var instance = null;                // referencia a la instancia dibujada (para actualizar)

  // ---- 2) Dibujar YA desde la caché y revalidar en segundo plano ----
  // Así el widget aparece al instante al recargar, sin esperar a la red.
  var cached = readCfgCache();
  if (cached) { try { render(cached, true); } catch (e) {} }

  fetch(SUPA_URL + "/rest/v1/rpc/get_widget_public", {
    method: "POST",
    headers: { "apikey": SUPA_KEY, "Authorization": "Bearer " + SUPA_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ widget_id: dataId })
  })
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      var cfg = rows && rows[0];
      if (!cfg) {
        // Chat deshabilitado / id inválido: limpiar caché y no dibujar si aún no se dibujó.
        try { localStorage.removeItem(CFG_KEY); } catch (e) {}
        return;
      }
      writeCfgCache(cfg);
      if (!instance) { try { render(cfg, false); } catch (e) {} }
      else if (JSON.stringify(cfg) !== instance.cfgStr) { instance.update(cfg); }
      ping();
    })
    .catch(function () {});        // sin red: queda lo dibujado desde la caché (o nada)

  function readCfgCache() {
    try {
      var raw = localStorage.getItem(CFG_KEY); if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.cfg) return null;
      // Se usa aunque esté algo vencida (para dibujar ya); la red la revalida igual.
      return o.cfg;
    } catch (e) { return null; }
  }
  function writeCfgCache(cfg) { try { localStorage.setItem(CFG_KEY, JSON.stringify({ cfg: cfg, ts: Date.now() })); } catch (e) {} }

  // Ping de instalación: marca installed_at / last_seen_at (sin IA, liviano)
  function ping() {
    try {
      fetch(SUPA_URL + "/rest/v1/rpc/widget_ping", {
        method: "POST",
        headers: { "apikey": SUPA_KEY, "Authorization": "Bearer " + SUPA_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ widget_id: dataId }),
        keepalive: true
      });
    } catch (e) {}
  }

  // ===================== Dibujar el widget =====================
  function render(cfg, fromCache) {
    var name = cfg.name || "Asistente";
    var welcome = cfg.welcome || "¡Hola! ¿En qué te puedo ayudar?";
    var avatar = cfg.avatar || "";
    var email = cfg.contact_email || "";
    var privacy = cfg.privacy_url || "";
    var reduceMotion = false, isTouch = false;
    try { reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
    try { isTouch = window.matchMedia("(hover: none), (pointer: coarse)").matches; } catch (e) {}

    function isImgUrl(a) { return !!a && (a.indexOf("data:") === 0 || /^https?:\/\//.test(a)); }
    var spark = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3l1.9 5.6a3 3 0 0 0 1.9 1.9L21 12l-5.2 1.5a3 3 0 0 0-1.9 1.9L12 21l-1.9-5.6a3 3 0 0 0-1.9-1.9L3 12l5.2-1.5a3 3 0 0 0 1.9-1.9z"/></svg>';
    function avaMarkup(a) { return isImgUrl(a) ? '<img src="' + esc(a) + '" alt="">' : spark; }

    var host = document.createElement("div");
    host.setAttribute("id", "walkyup-widget");
    host.style.cssText = "position:fixed;z-index:2147483647;top:0;left:0;";
    document.body.appendChild(host);
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

    root.innerHTML =
      '<style>' + wuCSS() + '</style>' +
      '<button class="fab" part="fab" aria-label="Abrir chat">' + avaMarkup(avatar) + '</button>' +
      '<div class="panel" tabindex="-1" data-theme="dark" role="dialog" aria-modal="true" aria-label="Chat de ' + esc(name) + '" aria-hidden="true">' +
        '<div class="grip" aria-hidden="true"></div>' +
        '<div class="head">' +
          '<button class="ico menu" aria-label="Ajustes"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg></button>' +
          '<span class="ava sm">' + avaMarkup(avatar) + '</span>' +
          '<span class="nm"></span>' +
          '<span class="sp"></span>' +
          '<button class="ico newchat" aria-label="Nuevo chat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg></button>' +
          '<button class="ico history" aria-label="Historial del chat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></button>' +
          '<button class="ico close" aria-label="Cerrar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
        '</div>' +
        '<div class="body">' +
          '<div class="hero"><h2 class="herotitle"></h2></div>' +
          '<div class="msgs"></div>' +
          '<div class="typing" role="status" aria-live="polite" hidden><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="sr">Escribiendo…</span></div>' +
        '</div>' +
        '<div class="composer-wrap">' +
          '<div class="composer">' +
            '<div class="thumbs" hidden></div>' +
            '<textarea class="ta" rows="1" placeholder="Escribí tu mensaje…" aria-label="Escribí tu mensaje"></textarea>' +
            '<button class="plus" aria-label="Agregar fotos"' + (ATTACHMENTS_ENABLED ? '' : ' hidden') + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>' +
            '<button class="send" aria-label="Enviar" disabled><svg class="sicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg><span class="sqr" aria-hidden="true"></span></button>' +
            '<input class="fileinp" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden />' +
          '</div>' +
          '<div class="atterr" role="alert" hidden></div>' +
          '<div class="foot"><p class="disc">Las respuestas pueden no ser siempre exactas. Al usar este chat aceptás la recopilación de datos según la política del sitio.</p></div>' +
        '</div>' +
        '<div class="scrim"></div>' +
        '<div class="sheet"><div class="shead"><b>Ajustes</b><button class="sx" aria-label="Cerrar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div>' +
          '<a class="row mail"><svg class="rico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>Escribir por correo</a>' +
          '<div class="row">Tema<span class="sp"></span><span class="themeseg"><button data-theme="light">Claro</button><button data-theme="dark" class="on">Oscuro</button></span></div>' +
          '<div class="sfoot">© 2026 · <a class="priv" target="_blank" rel="noopener">Privacidad</a></div></div>' +
        '<div class="histview" role="dialog" aria-label="Historial del chat" hidden>' +
          '<div class="hhead"><button class="ico hback" aria-label="Volver al chat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button><span class="htitle">Historial del chat</span></div>' +
          '<div class="hsearch"><svg class="hsearch-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>' +
            '<input class="hsearch-inp" type="text" placeholder="Buscar chats" aria-label="Buscar chats" autocomplete="off" />' +
            '<button class="hsearch-clear" aria-label="Limpiar búsqueda" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div>' +
          '<button class="hnew"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>Nuevo chat</button>' +
          '<div class="hlist" role="list"></div>' +
          '<div class="hempty" hidden>Todavía no tenés chats guardados<span>Los chats se guardan solo en este dispositivo.</span></div>' +
          '<div class="hclear-wrap" hidden><button class="hclear">Borrar historial</button></div>' +
        '</div>' +
        '<div class="confirm" role="alertdialog" aria-modal="true" aria-labelledby="wu-cf-t" aria-describedby="wu-cf-d" hidden>' +
          '<div class="confirm-scrim"></div>' +
          '<div class="confirm-box">' +
            '<h3 class="confirm-t" id="wu-cf-t"></h3>' +
            '<p class="confirm-d" id="wu-cf-d"></p>' +
            '<div class="confirm-btns"><button class="btn-sec cf-cancel">Cancelar</button><button class="btn-pri cf-ok">Listo</button></div>' +
          '</div>' +
        '</div>' +
        '<div class="viewer" role="dialog" aria-modal="true" aria-label="Imagen adjunta" hidden>' +
          '<div class="viewer-scrim"></div>' +
          '<button class="viewer-x" aria-label="Cerrar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
          '<button class="viewer-nav viewer-prev" aria-label="Imagen anterior"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button>' +
          '<img class="viewer-img" alt="">' +
          '<button class="viewer-nav viewer-next" aria-label="Imagen siguiente"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>' +
        '</div>' +
        '<div class="copylive sr" role="status" aria-live="polite"></div>' +
      '</div>';

    var $ = function (s) { return root.querySelector(s); };
    var $$ = function (s) { return root.querySelectorAll(s); };

    var panel = $(".panel"), fab = $(".fab");

    // ---- Avatar recortado a la forma del botón (cover, sin marco) ----
    function setAvatar(a) {
      var img = isImgUrl(a);
      Array.prototype.forEach.call($$(".fab, .ava"), function (el) {
        el.innerHTML = avaMarkup(a);
        el.classList.toggle("isimg", img);
        var im = el.querySelector("img");
        if (im) im.onerror = function () { el.innerHTML = spark; el.classList.remove("isimg"); };
      });
    }
    setAvatar(avatar);
    $(".nm").textContent = name;

    // Esperar a que el avatar (imagen) esté decodificado (máx 300 ms) para no mostrar
    // un ícono y después cambiarlo por la foto.
    (function () {
      if (launcher === "none" || launcher === "off" || !isImgUrl(avatar)) return;
      var fimg = fab.querySelector("img"); if (!fimg || !fimg.decode) return;
      var shown = false; fab.style.visibility = "hidden";
      function reveal() { if (shown) return; shown = true; fab.style.visibility = ""; }
      try { fimg.decode().then(reveal, reveal); } catch (e) { reveal(); }
      setTimeout(reveal, 300);
    })();

    // Tema (se lee de localStorage y, si no, de la config del panel)
    var THEME_KEY = "wu_theme_" + dataId;
    var savedTheme = null; try { savedTheme = localStorage.getItem(THEME_KEY); } catch (e) {}
    var theme = (savedTheme === "light" || savedTheme === "dark") ? savedTheme : ((cfg.theme === "light") ? "light" : "dark");
    panel.setAttribute("data-theme", theme);
    Array.prototype.forEach.call($$(".themeseg button"), function (b) { b.classList.toggle("on", b.getAttribute("data-theme") === theme); });

    var mail = $(".mail"); if (email) mail.setAttribute("href", "mailto:" + email); else mail.style.display = "none";
    var priv = $(".priv"); if (privacy) priv.setAttribute("href", privacy); else priv.parentNode.style.display = "none";

    // ---- Almacenamiento disponible y claves ----
    var STORE_KEY = "wu_chat_" + dataId;   // chat de esta pestaña (sessionStorage)
    var UI_KEY = "wu_ui_" + dataId;         // estado de la interfaz (sessionStorage)
    var CUR_KEY = "wu_cur_" + dataId;       // id del chat actual (sessionStorage)
    var LOG_KEY = "wu_log_" + dataId;       // historial de chats (localStorage)
    var lsOk = storageOk();
    function storageOk() { try { var k = "wu_t"; localStorage.setItem(k, "1"); localStorage.removeItem(k); return true; } catch (e) { return false; } }

    // ---- Chat actual (en esta pestaña) ----
    var hist = [];   // [{ x, o, g }]  (g = había imágenes)
    try { hist = JSON.parse(sessionStorage.getItem(STORE_KEY)) || []; } catch (e) { hist = []; }
    var currentId = null; try { currentId = sessionStorage.getItem(CUR_KEY); } catch (e) {}
    if (!currentId) { currentId = genId(); try { sessionStorage.setItem(CUR_KEY, currentId); } catch (e) {} }
    // Solo texto en el storage (las URLs de fotos viven en memoria, no se serializan).
    function persist() { try { sessionStorage.setItem(STORE_KEY, JSON.stringify(hist.map(function (m) { return { x: m.x, o: m.o, g: m.g ? 1 : 0 }; }))); } catch (e) {} }

    var msgs = $(".msgs"), body = $(".body"), heroTitle = $(".herotitle");

    // ---- Íconos de las acciones (trazo 1,75; tipo ChatGPT) ----
    // Se declaran ANTES de pintar los mensajes restaurados (evita íconos "undefined").
    var ICO_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>';
    var ICO_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 6.5"/></svg>';
    var ICO_REGEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 3v5h-5"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 21v-5h5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>';
    var ICO_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
    var ICO_IMG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M4 18l5-5 4 4 3-3 4 4"/></svg>';

    // Bienvenida (no se guarda) + mensajes del chat actual
    msgs.appendChild(bubble(welcome, false, null, false, { welcome: true }));
    hist.forEach(function (m, idx) { msgs.appendChild(bubble(m.x, !!m.o, m._atts || null, !!m.g, { idx: idx })); });
    refreshActions();

    function userMsgCount() { for (var k = 0; k < hist.length; k++) { if (hist[k].o) return 1; } return 0; }

    // ---- Estado vacío: título grande ESTÁTICO (no rota) ----
    // Se elige uno al azar SOLO al abrir el chat vacío o al empezar un chat nuevo;
    // queda fijo hasta el próximo de esos momentos. No se repite el último (localStorage),
    // así varía por visita, por día y por chat. Al recargar, se mantiene (sessionStorage).
    var TITLE_KEY = "wu_title_" + dataId;
    var currentTitle = "";
    function readLastTitle() { try { var v = parseInt(localStorage.getItem(TITLE_KEY), 10); return isNaN(v) ? -1 : v; } catch (e) { return -1; } }
    function pickNewTitle() {
      var last = readLastTitle(), n = 0;
      if (EMPTY_TITLES.length > 1) { do { n = Math.floor(Math.random() * EMPTY_TITLES.length); } while (n === last); }
      try { localStorage.setItem(TITLE_KEY, String(n)); } catch (e) {}
      currentTitle = EMPTY_TITLES[n]; heroTitle.textContent = currentTitle; return currentTitle;
    }
    (function () {
      var u0 = readUI();
      if (u0 && typeof u0.title === "string" && u0.title) { currentTitle = u0.title; heroTitle.textContent = currentTitle; }
      else { pickNewTitle(); }
    })();
    function syncHero() { panel.classList.toggle("has-hero", userMsgCount() === 0); }

    // ---- Copiar al portapapeles (con respaldo para navegadores viejos) ----
    var copylive = $(".copylive");
    function announceCopied() { if (!copylive) return; copylive.textContent = ""; setTimeout(function () { copylive.textContent = "Copiado"; }, 30); }
    function copyText(text, cb) {
      function fallback() {
        try {
          var t = document.createElement("textarea"); t.value = text || "";
          t.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none;";
          document.body.appendChild(t); t.focus(); t.select();
          var ok = document.execCommand("copy"); document.body.removeChild(t); cb(ok);
        } catch (e) { cb(false); }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text || "").then(function () { cb(true); }, fallback);
      } else fallback();
    }
    function copyAndFlash(text, btn) {
      copyText(text, function (ok) {
        if (!ok) return;
        announceCopied();
        if (btn) {
          var prev = btn.innerHTML; btn.innerHTML = ICO_CHECK; btn.classList.add("ok"); btn.setAttribute("aria-label", "Copiado");
          setTimeout(function () { btn.innerHTML = prev; btn.classList.remove("ok"); btn.setAttribute("aria-label", "Copiar"); }, 1500);
        }
      });
    }

    // ---- Burbujas ----
    // Imagen adjunta dentro de una burbuja: si falla, muestra un recuadro neutro (nunca el alt suelto).
    function attImg(list, i) {
      var im = document.createElement("img"); im.src = list[i]; im.alt = "Imagen adjunta " + (i + 1) + " de " + list.length;
      im.setAttribute("role", "button"); im.setAttribute("tabindex", "0");
      im.onerror = function () {
        var ph = document.createElement("div"); ph.className = "att-fail"; ph.setAttribute("role", "img"); ph.setAttribute("aria-label", "Imagen no disponible");
        ph.innerHTML = ICO_IMG; if (im.parentNode) im.parentNode.replaceChild(ph, im);
      };
      im.addEventListener("click", function () { openViewer(list, i, im); });
      im.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openViewer(list, i, im); } });
      return im;
    }
    function attRow(list) {
      var g = document.createElement("div"); g.className = "msg-atts";
      for (var i = 0; i < list.length; i++) g.appendChild(attImg(list, i));
      return g;
    }
    function actionBtn(icon, label, cls) {
      var b = document.createElement("button"); b.type = "button"; b.className = "msg-act" + (cls ? " " + cls : "");
      b.setAttribute("aria-label", label); b.innerHTML = icon; return b;
    }
    function aiActions(idx) {
      var row = document.createElement("div"); row.className = "msg-actions";
      var copyB = actionBtn(ICO_COPY, "Copiar");
      copyB.addEventListener("click", function () { copyAndFlash(hist[idx] ? hist[idx].x : "", copyB); });
      var regen = actionBtn(ICO_REGEN, "Generar otra respuesta", "msg-regen"); regen.hidden = true;
      regen.addEventListener("click", function () { regenerateLast(); });
      row.appendChild(copyB); row.appendChild(regen);
      return row;
    }
    function bubble(text, out, atts, hadImg, opts) {
      opts = opts || {};
      var el = document.createElement("div");
      el.className = "msg " + (out ? "out" : "in") + (opts.welcome ? " welcome" : "");
      if (typeof opts.idx === "number") el.setAttribute("data-idx", opts.idx);
      if (atts && atts.length) el.appendChild(attRow(atts));
      else if (hadImg) { var note = document.createElement("div"); note.className = "noimg"; note.textContent = "Imagen no guardada"; el.appendChild(note); }
      if (text) {
        var tx = document.createElement("div"); tx.className = "tx"; tx.textContent = text;
        if (out) {
          var bub = document.createElement("div"); bub.className = "bubble"; bub.appendChild(tx); el.appendChild(bub);
          if (typeof opts.idx === "number") wireUserMenu(bub, opts.idx);
        } else el.appendChild(tx);
      }
      if (!out && !opts.welcome && typeof opts.idx === "number") el.appendChild(aiActions(opts.idx));
      return el;
    }
    // Reconstruye toda la lista desde `hist` (bienvenida + mensajes), con sus acciones.
    function rebuildMessages() {
      closeMsgMenu();
      msgs.innerHTML = "";
      msgs.appendChild(bubble(welcome, false, null, false, { welcome: true }));
      hist.forEach(function (m, idx) { msgs.appendChild(bubble(m.x, !!m.o, m._atts || null, !!m.g, { idx: idx })); });
      refreshActions();
    }
    // Muestra "Copiar" en todas las respuestas de la IA y "Generar otra respuesta" solo en la última.
    // Oculta las acciones mientras se está generando una respuesta.
    function refreshActions() {
      var busy = (state === "thinking" || state === "responding");
      Array.prototype.forEach.call(msgs.querySelectorAll(".msg-actions"), function (a) { a.style.display = busy ? "none" : ""; });
      var ins = msgs.querySelectorAll(".msg.in:not(.welcome)");
      var lastAi = ins.length ? ins[ins.length - 1] : null;
      Array.prototype.forEach.call(msgs.querySelectorAll(".msg-regen"), function (r) {
        r.hidden = busy || !(lastAi && lastAi.contains(r));
      });
    }
    function scroll() { body.scrollTop = body.scrollHeight; }

    // ---- Menú de mensaje del usuario (mantener presionado / clic derecho / teclado) ----
    var msgMenuEl = null, msgMenuReturn = null;
    function closeMsgMenu() {
      if (!msgMenuEl) return;
      var ret = msgMenuReturn; if (msgMenuEl.parentNode) msgMenuEl.parentNode.removeChild(msgMenuEl);
      msgMenuEl = null; msgMenuReturn = null;
      root.removeEventListener("click", onRootMenuOutside); document.removeEventListener("click", onDocMenuOutside);
      try { if (ret && ret.focus) ret.focus(); } catch (e) {}
    }
    // Dentro del Shadow DOM el target real llega al root; a nivel de documento todo se reporta como el host.
    function onRootMenuOutside(e) { if (msgMenuEl && !msgMenuEl.contains(e.target)) closeMsgMenu(); }
    function onDocMenuOutside(e) { if (msgMenuEl && !host.contains(e.target)) closeMsgMenu(); }
    function openMsgMenu(anchor, idx) {
      closeMsgMenu();
      var menu = document.createElement("div"); menu.className = "msgmenu"; menu.setAttribute("role", "menu");
      var copyB = document.createElement("button"); copyB.type = "button"; copyB.className = "msgmenu-item"; copyB.setAttribute("role", "menuitem"); copyB.innerHTML = ICO_COPY + "<span>Copiar</span>";
      var editB = document.createElement("button"); editB.type = "button"; editB.className = "msgmenu-item"; editB.setAttribute("role", "menuitem"); editB.innerHTML = ICO_EDIT + "<span>Editar</span>";
      menu.appendChild(copyB); menu.appendChild(editB); panel.appendChild(menu);
      var pr = panel.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
      var top = Math.min(ar.bottom - pr.top + 6, pr.height - menu.offsetHeight - 10);
      menu.style.top = Math.max(8, top) + "px";
      menu.style.right = Math.max(8, pr.right - ar.right) + "px";
      msgMenuEl = menu; msgMenuReturn = anchor;
      copyB.addEventListener("click", function () { var t = hist[idx] ? hist[idx].x : ""; closeMsgMenu(); copyAndFlash(t, null); });
      editB.addEventListener("click", function () { closeMsgMenu(); enterEdit(idx); });
      setTimeout(function () { try { copyB.focus(); } catch (e) {} }, 0);
      setTimeout(function () { root.addEventListener("click", onRootMenuOutside); document.addEventListener("click", onDocMenuOutside); }, 0);
    }
    function wireUserMenu(bub, idx) {
      bub.setAttribute("tabindex", "0"); bub.setAttribute("role", "button"); bub.setAttribute("aria-haspopup", "menu"); bub.setAttribute("aria-label", "Mensaje enviado. Mantené presionado para opciones.");
      var pressT = null, startX = 0, startY = 0, moved = false;
      function clearPress() { if (pressT) { clearTimeout(pressT); pressT = null; } }
      bub.addEventListener("pointerdown", function (e) {
        if (e.button && e.button !== 0) return;
        moved = false; startX = e.clientX; startY = e.clientY;
        clearPress(); pressT = setTimeout(function () { pressT = null; openMsgMenu(bub, idx); }, 450);
      });
      bub.addEventListener("pointermove", function (e) {
        if (!pressT) return;
        if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) { moved = true; clearPress(); }
      });
      bub.addEventListener("pointerup", clearPress);
      bub.addEventListener("pointercancel", clearPress);
      bub.addEventListener("pointerleave", clearPress);
      bub.addEventListener("contextmenu", function (e) { e.preventDefault(); openMsgMenu(bub, idx); });
      bub.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); openMsgMenu(bub, idx); }
      });
    }

    // ---- Editar un mensaje del usuario en el lugar ----
    function enterEdit(idx) {
      if (state !== "idle") return;
      var m = hist[idx]; if (!m || !m.o) return;
      var msgEl = msgs.querySelector('.msg[data-idx="' + idx + '"]'); if (!msgEl) return;
      msgEl.classList.add("editing"); msgEl.innerHTML = "";
      var box = document.createElement("div"); box.className = "editbox";
      var tarea = document.createElement("textarea"); tarea.className = "editta"; tarea.value = m.x || ""; tarea.setAttribute("aria-label", "Editar mensaje");
      var btns = document.createElement("div"); btns.className = "editbtns";
      var cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "editbtn sec"; cancel.textContent = "Cancelar";
      var save = document.createElement("button"); save.type = "button"; save.className = "editbtn pri"; save.textContent = "Enviar";
      btns.appendChild(cancel); btns.appendChild(save); box.appendChild(tarea); box.appendChild(btns); msgEl.appendChild(box);
      function grow() { tarea.style.height = "auto"; tarea.style.height = Math.min(tarea.scrollHeight, 160) + "px"; }
      tarea.addEventListener("input", grow);
      tarea.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); rebuildMessages(); } });
      cancel.addEventListener("click", function () { rebuildMessages(); });
      save.addEventListener("click", function () { var nv = tarea.value.trim(); if (!nv) { tarea.focus(); return; } submitEdit(idx, nv); });
      // Excepción a la regla táctil: el usuario pidió editar, así que SÍ enfocamos el textarea.
      setTimeout(function () { try { tarea.focus(); grow(); var L = tarea.value.length; tarea.setSelectionRange(L, L); } catch (e) {} }, 0);
      scroll();
    }
    function submitEdit(idx, newText) {
      var old = hist[idx];
      var keepAtts = (old && old._atts && old._atts.length) ? old._atts.slice() : null;
      hist = hist.slice(0, idx);
      hist.push({ x: newText, o: 1, g: keepAtts ? 1 : 0, _atts: keepAtts });
      persist(); logUpsert();
      rebuildMessages(); syncHero(); scroll(); saveUI();
      generateReply({ regenerate: false });
    }

    // ---- Generar / regenerar respuesta (una sola función; Fase 8 conecta la IA real) ----
    function generateReply(opts) {
      opts = opts || {};
      var regenerate = !!opts.regenerate;   // la Fase 8 lo usa para rehacer la última respuesta
      setState("thinking");
      try { ctrl = new AbortController(); } catch (e) { ctrl = null; }
      // TODO Fase 8: en vez de este setTimeout, llamar a la Edge Function `chat`
      //   pasando { regenerate: regenerate, signal: ctrl && ctrl.signal } y transmitir la respuesta real.
      pendingTimer = setTimeout(function () {
        setState("responding");
        hist.push({ x: PENDING_REPLY, o: 0, g: 0 });
        msgs.appendChild(bubble(PENDING_REPLY, false, null, false, { idx: hist.length - 1 }));
        persist(); logUpsert(); scroll();
        setState("idle"); refreshActions(); focusInput();
      }, 1200);
    }
    function regenerateLast() {
      if (state !== "idle") return;
      if (!hist.length || hist[hist.length - 1].o) return; // la última debe ser una respuesta de la IA
      hist.pop(); persist(); logUpsert();
      rebuildMessages(); scroll(); saveUI();
      generateReply({ regenerate: true });
    }

    // ---- Foco: en táctil nunca abrir el teclado (no enfocar el textarea) ----
    function focusInput() {
      if (isTouch) { try { panel.focus(); } catch (e) {} }
      else { try { ta.focus(); } catch (e) {} }
    }

    // ---- Estado de la interfaz (sobrevive recargas) ----
    function saveUI() {
      try { sessionStorage.setItem(UI_KEY, JSON.stringify({ open: panel.classList.contains("open"), text: ta.value, scroll: body.scrollTop, title: currentTitle })); } catch (e) {}
    }
    function readUI() { try { return JSON.parse(sessionStorage.getItem(UI_KEY)) || null; } catch (e) { return null; } }

    // ---- Abrir / cerrar ----
    var hideFab = (launcher === "none" || launcher === "off");
    if (hideFab) fab.style.display = "none";
    var lastFocus = null;
    function onOutside(e) {
      if (host.contains(e.target)) return;
      if (e.target && e.target.closest && e.target.closest("[data-walkyup-open]")) return;
      close();
    }
    function onEsc(e) {
      if (e.key !== "Escape" && e.key !== "Esc") return;
      if (msgMenuEl) { closeMsgMenu(); return; }
      if (!viewerEl.hidden) { closeViewer(); return; }
      if (!confirmEl.hidden) { cancelConfirm(); return; }
      if (!historyEl.hidden) { closeHistory(); return; }
      if (panel.classList.contains("sheet-open")) { panel.classList.remove("sheet-open"); return; }
      close();
    }
    function open(noAnim) {
      lastFocus = document.activeElement;
      // Al abrir (cerrado -> abierto) en estado vacío, se elige UN título nuevo y queda fijo.
      if (!noAnim && userMsgCount() === 0) pickNewTitle();
      if (noAnim) panel.classList.add("no-anim");
      panel.classList.add("open"); panel.setAttribute("aria-hidden", "false"); fab.style.display = "none";
      document.addEventListener("click", onOutside); document.addEventListener("keydown", onEsc);
      syncHero(); autogrow();
      if (noAnim) { scroll(); setTimeout(function () { panel.classList.remove("no-anim"); }, 60); }
      else { setTimeout(function () { focusInput(); autogrow(); scroll(); }, 250); }
      saveUI();
    }
    function close() {
      closeMsgMenu();
      panel.classList.remove("open", "sheet-open", "dragging"); panel.style.transform = ""; panel.setAttribute("aria-hidden", "true"); fab.style.display = hideFab ? "none" : "";
      document.removeEventListener("click", onOutside); document.removeEventListener("keydown", onEsc);
      var back = (!hideFab) ? fab : lastFocus;
      try { if (back && back.focus) back.focus(); } catch (e) {}
      saveUI();
    }
    function toggle() { panel.classList.contains("open") ? close() : open(); }
    fab.addEventListener("click", function () { open(); });
    $(".close").addEventListener("click", close);

    // ---- Arrastrar para cerrar (solo hoja móvil ≤640px) ----
    // Desde el agarre o el encabezado (NO desde la lista de mensajes, para no pelear con el scroll).
    var grip = $(".grip"), head = $(".head");
    var dragging = false, dragStartY = 0, dragLastY = 0, dragLastT = 0, dragV = 0;
    function isSheet() { try { return window.matchMedia("(max-width:640px)").matches; } catch (e) { return false; } }
    function onDragMove(e) {
      if (!dragging) return;
      var dy = e.clientY - dragStartY; if (dy < 0) dy = 0;
      var now = Date.now(); dragV = (e.clientY - dragLastY) / Math.max(1, now - dragLastT); dragLastY = e.clientY; dragLastT = now;
      panel.style.transform = "translateY(" + dy + "px)";
      if (e.cancelable) e.preventDefault();
    }
    function onDragEnd() {
      if (!dragging) return; dragging = false;
      document.removeEventListener("pointermove", onDragMove); document.removeEventListener("pointerup", onDragEnd); document.removeEventListener("pointercancel", onDragEnd);
      panel.classList.remove("dragging");
      var dy = Math.max(0, dragLastY - dragStartY);
      if (dy > 110 || dragV > 0.5) {
        if (reduceMotion) { panel.style.transform = ""; close(); return; }
        panel.style.transform = "translateY(100%)";
        var done = function () { panel.removeEventListener("transitionend", done); clearTimeout(tm); panel.style.transform = ""; close(); };
        var tm = setTimeout(done, 340); panel.addEventListener("transitionend", done);
      } else { panel.style.transform = ""; } // vuelve a su lugar con el resorte del CSS
    }
    function onDragStart(e) {
      if (dragging || !isSheet() || !panel.classList.contains("open")) return;
      if (e.target && e.target.closest && e.target.closest("button,a,input,textarea,.msgmenu")) return;
      if (panel.classList.contains("sheet-open") || !historyEl.hidden || !confirmEl.hidden || !viewerEl.hidden || msgMenuEl) return;
      dragging = true; dragStartY = e.clientY; dragLastY = e.clientY; dragLastT = Date.now(); dragV = 0;
      panel.classList.add("dragging");
      document.addEventListener("pointermove", onDragMove, { passive: false });
      document.addEventListener("pointerup", onDragEnd); document.addEventListener("pointercancel", onDragEnd);
    }
    if (grip) grip.addEventListener("pointerdown", onDragStart);
    if (head) head.addEventListener("pointerdown", onDragStart);

    // API pública: el dueño abre el chat desde su propio botón, donde quiera.
    window.WalkyUp = { open: function () { open(); }, close: close, toggle: toggle };
    document.addEventListener("click", function (e) {
      var t = e.target && e.target.closest && e.target.closest("[data-walkyup-open]");
      if (t) { e.preventDefault(); open(); }
    });

    // ---- Campo de texto (autogrow hasta ~5 líneas) ----
    var ta = $(".ta"), sendBtn = $(".send"), typing = $(".typing");
    function autogrow() { ta.style.height = "auto"; var h = Math.min(ta.scrollHeight, 132); ta.style.height = h + "px"; ta.style.overflowY = (ta.scrollHeight > 132) ? "auto" : "hidden"; }
    function canSend() { return ta.value.trim().length > 0 || attachments.length > 0; }
    function syncSend() { if (state === "idle") sendBtn.disabled = !canSend(); }
    ta.addEventListener("input", function () { autogrow(); syncSend(); saveUI(); });
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (state === "idle") send(); }
    });
    // El realce de la tarjeta solo reacciona al textarea, NO a los botones + / enviar.
    var composerEl = $(".composer");
    ta.addEventListener("focus", function () { composerEl.classList.add("focus"); });
    ta.addEventListener("blur", function () { composerEl.classList.remove("focus"); });
    var scrollSaveT = null;
    body.addEventListener("scroll", function () { if (scrollSaveT) return; scrollSaveT = setTimeout(function () { scrollSaveT = null; saveUI(); }, 250); });

    // ---- Máquina de estados: idle | thinking | responding ----
    var state = "idle", pendingTimer = null, ctrl = null;
    function setState(s) {
      state = s;
      var busy = (s !== "idle");
      sendBtn.classList.toggle("busy", busy);
      sendBtn.setAttribute("aria-label", busy ? "Detener" : "Enviar");
      typing.hidden = (s !== "thinking");
      if (busy) { sendBtn.disabled = false; } else { syncSend(); }
      if (s === "thinking") scroll();
    }

    function send() {
      if (!canSend()) return;
      var v = ta.value.trim();
      // Las URLs pasan a ser del mensaje: se mantienen vivas (no se revocan al limpiar).
      var atts = attachments.map(function (a) { return a.url; });
      var hadImg = atts.length > 0;
      if (hadImg) atts.forEach(function (u) { liveUrls.push(u); });
      hist.push({ x: v, o: 1, g: hadImg ? 1 : 0, _atts: hadImg ? atts : null });
      msgs.appendChild(bubble(v, true, hadImg ? atts : null, false, { idx: hist.length - 1 }));
      persist(); logUpsert();
      // TODO Fase 8: onSendAttachments(attachments) -> subir/enviar al backend (hoy NO hay red)
      detachAttachments();   // vacía el compositor SIN revocar (las URLs ya son del mensaje)
      ta.value = ""; autogrow(); syncHero(); scroll(); saveUI();
      generateReply({ regenerate: false });
    }

    function stop() {
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      try { if (ctrl) ctrl.abort(); } catch (e) {}
      ctrl = null;
      var last = msgs.querySelector(".msg.in:last-child .tx");
      if (state === "responding" && last && last.textContent) {
        var tag = document.createElement("span"); tag.className = "stopped"; tag.textContent = " (detenido)"; last.appendChild(tag);
      }
      setState("idle");
      refreshActions();
      focusInput();
    }
    sendBtn.addEventListener("click", function () { if (state === "idle") send(); else stop(); });

    // ---- Fotos (+): solo lado navegador ----
    var attachments = [];     // fotos del compositor (aún sin enviar)
    var liveUrls = [];        // URLs de fotos ya enviadas: vivas hasta chat nuevo o descarga
    var fileInp = $(".fileinp"), thumbs = $(".thumbs"), atterr = $(".atterr");
    function showAttErr(msg) { if (!atterr) return; atterr.textContent = msg; atterr.hidden = false; setTimeout(function () { atterr.hidden = true; }, 3500); }
    function renderThumbs() {
      thumbs.innerHTML = "";
      attachments.forEach(function (a, idx) {
        var t = document.createElement("div"); t.className = "thumb";
        var im = document.createElement("img"); im.src = a.url; im.alt = "";
        var x = document.createElement("button"); x.className = "thumbx"; x.setAttribute("aria-label", "Quitar imagen " + (idx + 1));
        x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';
        x.addEventListener("click", function () { removeAttachment(idx); });
        t.appendChild(im); t.appendChild(x); thumbs.appendChild(t);
      });
      thumbs.hidden = attachments.length === 0;
      syncSend();
    }
    function removeAttachment(idx) {
      var a = attachments[idx]; if (!a) return;
      try { if (a.url && a.url.indexOf("blob:") === 0) URL.revokeObjectURL(a.url); } catch (e) {}
      attachments.splice(idx, 1); renderThumbs();
    }
    // Vacía el compositor revocando las fotos NO enviadas (descartadas).
    function clearAttachments() {
      attachments.forEach(function (a) { try { if (a.url && a.url.indexOf("blob:") === 0) URL.revokeObjectURL(a.url); } catch (e) {} });
      attachments = []; renderThumbs();
    }
    // Vacía el compositor SIN revocar (las fotos pasaron a un mensaje y siguen vivas).
    function detachAttachments() { attachments = []; renderThumbs(); }
    // Libera todas las fotos enviadas (al empezar un chat nuevo o al descargar la página).
    function revokeLive() {
      liveUrls.forEach(function (u) { try { if (u && u.indexOf("blob:") === 0) URL.revokeObjectURL(u); } catch (e) {} });
      liveUrls = [];
    }
    // Reduce la foto en el navegador y la devuelve como DATA URL (imagen incrustada), no como
    // blob temporal: así la vista previa y el mensaje se ven SIEMPRE, sin depender de una URL
    // que se pueda romper o liberar al cambiar de chat. Usa createImageBitmap (confiable y
    // respeta la rotación EXIF); si no, FileReader->Image. Una foto válida nunca devuelve null.
    // Nota Fase 8: `blob` queda null; para subir, reconstruirlo desde la data URL.
    function downscale(file, cb) {
      function fromFile() {
        try { var r = new FileReader(); r.onload = function () { cb({ url: r.result, blob: null }); }; r.onerror = function () { cb(null); }; r.readAsDataURL(file); }
        catch (e) { cb(null); }
      }
      function toCanvas(src, w, h) {
        try {
          var scale = Math.min(1, ATT_MAX_PX / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
          var cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
          cv.getContext("2d").drawImage(src, 0, 0, cw, ch);
          var durl = cv.toDataURL("image/jpeg", ATT_QUALITY);
          if (durl && durl.indexOf("data:image") === 0) cb({ url: durl, blob: null });
          else fromFile();   // canvas vacío (p. ej. imagen enorme): usa el archivo original
        } catch (e) { fromFile(); }
      }
      function viaReader() {
        try {
          var reader = new FileReader();
          reader.onload = function () {
            var img = new Image();
            img.onload = function () { toCanvas(img, img.width, img.height); };
            img.onerror = function () { cb({ url: reader.result, blob: null }); }; // el original ya es una data URL válida
            img.src = reader.result;
          };
          reader.onerror = function () { cb(null); };
          reader.readAsDataURL(file);
        } catch (e) { fromFile(); }
      }
      if (window.createImageBitmap) {
        var p; try { p = createImageBitmap(file, { imageOrientation: "from-image" }); } catch (e) { p = null; }
        if (p && p.then) p.then(function (bmp) { toCanvas(bmp, bmp.width, bmp.height); try { bmp.close(); } catch (e) {} }, viaReader);
        else viaReader();
      } else viaReader();
    }
    if (ATTACHMENTS_ENABLED) {
      $(".plus").addEventListener("click", function () { fileInp.click(); });
      fileInp.addEventListener("change", function () {
        var files = Array.prototype.slice.call(fileInp.files || []);
        fileInp.value = "";
        files.forEach(function (f) {
          if (attachments.length >= ATT_MAX) { showAttErr("Hasta " + ATT_MAX + " fotos."); return; }
          if (!ATT_TYPES[f.type]) { showAttErr("Solo JPG, PNG o WEBP."); return; }
          if (f.size > ATT_MAX_MB * 1024 * 1024) { showAttErr("Cada foto hasta " + ATT_MAX_MB + " MB."); return; }
          downscale(f, function (a) { if (!a) { showAttErr("No se pudo procesar esa foto."); return; } if (attachments.length >= ATT_MAX) { try { URL.revokeObjectURL(a.url); } catch (e) {} return; } attachments.push(a); renderThumbs(); });
        });
      });
    }

    // ---- Hoja de ajustes ----
    $(".menu").addEventListener("click", function () { panel.classList.add("sheet-open"); });
    $(".sx").addEventListener("click", function () { panel.classList.remove("sheet-open"); });
    $(".scrim").addEventListener("click", function () { panel.classList.remove("sheet-open"); });
    $(".themeseg").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      var t = b.getAttribute("data-theme");
      panel.setAttribute("data-theme", t);
      try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
      Array.prototype.forEach.call(this.querySelectorAll("button"), function (x) { x.classList.toggle("on", x === b); });
    });

    // ---- Foco atrapado (Tab) dentro de un diálogo/vista ----
    function focusables(el) {
      return Array.prototype.slice.call(el.querySelectorAll('button,[href],input,textarea,[tabindex]:not([tabindex="-1"])'))
        .filter(function (n) { return !n.disabled && !n.hidden && n.getClientRects().length; });
    }
    function trap(el, e) {
      if (e.key !== "Tab") return;
      var f = focusables(el); if (!f.length) return;
      var first = f[0], last = f[f.length - 1], cur = root.activeElement;
      if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
    }

    // ---- Visor de imágenes ----
    var viewerEl = $(".viewer"), viewerImg = $(".viewer-img"), viewerPrev = $(".viewer-prev"), viewerNext = $(".viewer-next");
    var viewerList = [], viewerIdx = 0, viewerReturn = null;
    function showViewerImg() {
      viewerImg.src = viewerList[viewerIdx];
      viewerImg.alt = "Imagen adjunta " + (viewerIdx + 1) + " de " + viewerList.length;
      var multi = viewerList.length > 1; viewerPrev.hidden = !multi; viewerNext.hidden = !multi;
    }
    function openViewer(list, idx, returnTo) {
      viewerList = list.slice(); viewerIdx = idx || 0; viewerReturn = returnTo || null;
      showViewerImg(); viewerEl.hidden = false;
      setTimeout(function () { $(".viewer-x").focus(); }, 0);
    }
    function closeViewer() { viewerEl.hidden = true; try { if (viewerReturn && viewerReturn.focus) viewerReturn.focus(); } catch (e) {} }
    function viewerStep(d) { if (viewerList.length < 2) return; viewerIdx = (viewerIdx + d + viewerList.length) % viewerList.length; showViewerImg(); }
    $(".viewer-x").addEventListener("click", closeViewer);
    $(".viewer-scrim").addEventListener("click", closeViewer);
    viewerPrev.addEventListener("click", function () { viewerStep(-1); });
    viewerNext.addEventListener("click", function () { viewerStep(1); });
    viewerEl.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { e.preventDefault(); viewerStep(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); viewerStep(1); }
      else trap(viewerEl, e);
    });

    // ---- Confirmación genérica ----
    var confirmEl = $(".confirm"), cfCancel = $(".cf-cancel"), cfOk = $(".cf-ok"), cfTitle = $(".confirm-t"), cfDesc = $(".confirm-d");
    var cfReturn = null, cfOnOk = null;
    function askConfirm(title, desc, onOk) {
      cfTitle.textContent = title; cfDesc.textContent = desc || ""; cfDesc.style.display = desc ? "" : "none";
      cfOnOk = onOk; cfReturn = root.activeElement; confirmEl.hidden = false;
      setTimeout(function () { cfCancel.focus(); }, 0);
    }
    function cancelConfirm() { confirmEl.hidden = true; try { if (cfReturn && cfReturn.focus) cfReturn.focus(); } catch (e) {} }
    cfCancel.addEventListener("click", cancelConfirm);
    $(".confirm-scrim").addEventListener("click", cancelConfirm);
    cfOk.addEventListener("click", function () { confirmEl.hidden = true; var fn = cfOnOk; cfOnOk = null; if (fn) fn(); });
    confirmEl.addEventListener("keydown", function (e) { trap(confirmEl, e); });

    // ---- Historial (localStorage, solo este dispositivo) ----
    var historyEl = $(".histview"), hlist = $(".hlist"), hempty = $(".hempty");
    var hsearchInp = $(".hsearch-inp"), hsearchClear = $(".hsearch-clear");
    var hclearWrap = $(".hclear-wrap"), hclearBtn = $(".hclear");
    var histBtn = root.querySelector(".ico.history");
    if (!lsOk && histBtn) histBtn.style.display = "none";

    function loadLog() {
      if (!lsOk) return [];
      var log = [];
      try { log = JSON.parse(localStorage.getItem(LOG_KEY)) || []; } catch (e) { log = []; }
      var cut = Date.now() - HIST_TTL;
      log = log.filter(function (c) { return c && c.ts && c.ts >= cut && c.msgs && c.msgs.length; });
      if (log.length > HIST_MAX_CHATS) log = log.slice(0, HIST_MAX_CHATS);
      return log;
    }
    function saveLog(log) { if (!lsOk) return; try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch (e) {} }
    function chatTitle(c) {
      for (var i = 0; i < c.msgs.length; i++) { if (c.msgs[i].o && c.msgs[i].x) return c.msgs[i].x; }
      return (c.msgs[0] && c.msgs[0].x) || "Chat";
    }
    // Guarda el chat actual en el historial (solo si tiene mensajes del usuario)
    function logUpsert() {
      if (!lsOk || !userMsgCount()) return;
      var log = loadLog();
      log = log.filter(function (c) { return c.id !== currentId; });
      var m = hist.slice(-HIST_MAX_MSGS).map(function (x) { return { x: x.x, o: x.o, g: x.g ? 1 : 0 }; });
      log.unshift({ id: currentId, ts: Date.now(), msgs: m });
      if (log.length > HIST_MAX_CHATS) log = log.slice(0, HIST_MAX_CHATS);
      saveLog(log);
    }
    function openHistory() {
      if (!lsOk) return;
      hsearchInp.value = ""; hsearchClear.hidden = true;
      renderHistList("");
      historyEl.hidden = false; historyEl.classList.add("open");
      setTimeout(function () { $(".hback").focus(); }, 0);
    }
    function closeHistory() {
      historyEl.hidden = true; historyEl.classList.remove("open");
      try { histBtn.focus(); } catch (e) {}
    }
    function renderHistList(q) {
      var full = loadLog(), total = full.length, log = full;
      q = (q || "").trim().toLowerCase();
      if (q) {
        log = full.filter(function (c) {
          if (chatTitle(c).toLowerCase().indexOf(q) !== -1) return true;
          for (var i = 0; i < c.msgs.length; i++) { if (c.msgs[i].x && c.msgs[i].x.toLowerCase().indexOf(q) !== -1) return true; }
          return false;
        });
      }
      hlist.innerHTML = "";
      hempty.hidden = total > 0;       // "no hay chats" solo si de verdad no hay guardados
      hclearWrap.hidden = total === 0; // "Borrar historial" solo si hay chats guardados
      if (!log.length) return;
      var nowT = Date.now(), lastGroup = null;
      log.forEach(function (c) {
        var grp = dayGroup(c.ts, nowT);
        if (grp !== lastGroup) {
          lastGroup = grp;
          var gh = document.createElement("div"); gh.className = "hgroup"; gh.textContent = grp; hlist.appendChild(gh);
        }
        var row = document.createElement("div"); row.className = "hrow" + (c.id === currentId ? " is-current" : ""); row.setAttribute("role", "listitem");
        var main = document.createElement("button"); main.type = "button"; main.className = "hrow-main";
        main.innerHTML = '<span class="hrow-title"></span><span class="hrow-time"></span>';
        main.querySelector(".hrow-title").textContent = chatTitle(c);
        main.querySelector(".hrow-time").textContent = fmtTime(c.ts, nowT);
        if (c.id === currentId) main.setAttribute("aria-current", "true");
        main.addEventListener("click", function () { openChatFromLog(c.id); });
        var kebab = document.createElement("button"); kebab.type = "button"; kebab.className = "hrow-kebab"; kebab.setAttribute("aria-label", "Opciones del chat");
        kebab.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>';
        var menu = document.createElement("div"); menu.className = "hrow-menu"; menu.hidden = true;
        var del = document.createElement("button"); del.type = "button"; del.className = "hrow-del"; del.textContent = "Eliminar este chat";
        menu.appendChild(del);
        kebab.addEventListener("click", function (e) { e.stopPropagation(); closeRowMenus(menu); menu.hidden = !menu.hidden; });
        del.addEventListener("click", function (e) {
          e.stopPropagation(); menu.hidden = true;
          askConfirm("¿Eliminar este chat?", "Esta acción no se puede deshacer.", function () { deleteChat(c.id); setTimeout(function () { hsearchInp.focus(); }, 0); });
        });
        row.appendChild(main); row.appendChild(kebab); row.appendChild(menu);
        hlist.appendChild(row);
      });
    }
    function closeRowMenus(except) {
      Array.prototype.forEach.call(hlist.querySelectorAll(".hrow-menu"), function (m) { if (m !== except) m.hidden = true; });
    }
    function openChatFromLog(id) {
      logUpsert(); // guarda el chat del que salimos
      var log = loadLog(), c = null;
      for (var i = 0; i < log.length; i++) { if (log[i].id === id) { c = log[i]; break; } }
      if (!c) { closeHistory(); return; }
      currentId = id; try { sessionStorage.setItem(CUR_KEY, currentId); } catch (e) {}
      hist = c.msgs.map(function (m) { return { x: m.x, o: m.o, g: m.g ? 1 : 0 }; }); persist();
      clearAttachments(); setState("idle");
      rebuildMessages();
      closeHistory(); syncHero(); scroll(); saveUI();
    }
    function deleteChat(id) {
      var log = loadLog().filter(function (c) { return c.id !== id; });
      saveLog(log);
      if (id === currentId) { freshChat(); }
      renderHistList(hsearchInp.value);
    }
    function clearHistory() { saveLog([]); renderHistList(hsearchInp.value); }
    // Empieza un chat nuevo en blanco (sin guardar: el actual ya quedó en el log vía logUpsert)
    function freshChat() {
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      try { if (ctrl) ctrl.abort(); } catch (e) {} ctrl = null; setState("idle");
      currentId = genId(); try { sessionStorage.setItem(CUR_KEY, currentId); } catch (e) {}
      hist = []; persist();
      clearAttachments(); revokeLive();   // chat nuevo: liberar las fotos del chat anterior
      rebuildMessages();
      pickNewTitle();
      syncHero(); scroll(); saveUI();
    }
    // "Nuevo chat": guarda el actual al historial (si hay) y empieza uno nuevo
    function doNewChat() { logUpsert(); freshChat(); }

    // Eventos de historial
    if (histBtn) histBtn.addEventListener("click", openHistory);
    $(".hback").addEventListener("click", closeHistory);
    $(".hnew").addEventListener("click", function () { doNewChat(); closeHistory(); focusInput(); });
    hsearchInp.addEventListener("input", function () { hsearchClear.hidden = !hsearchInp.value; renderHistList(hsearchInp.value); });
    hsearchClear.addEventListener("click", function () { hsearchInp.value = ""; hsearchClear.hidden = true; renderHistList(""); hsearchInp.focus(); });
    historyEl.addEventListener("click", function (e) { if (!e.target.closest(".hrow-kebab") && !e.target.closest(".hrow-menu")) closeRowMenus(null); });
    historyEl.addEventListener("keydown", function (e) { if (e.key === "Escape" || e.key === "Esc") { e.stopPropagation(); closeHistory(); } else trap(historyEl, e); });

    // Nuevo chat (icono del encabezado) con confirmación
    $(".newchat").addEventListener("click", function () {
      if (!userMsgCount()) { freshChat(); return; } // nada que guardar/borrar
      var saves = lsOk;
      askConfirm("¿Crear un chat nuevo?", saves ? "El chat actual quedará en el historial." : "La conversación actual se borrará.", function () { doNewChat(); focusInput(); });
    });
    // Borrar historial (botón discreto al fondo de la vista de Historial)
    if (hclearBtn) hclearBtn.addEventListener("click", function () {
      askConfirm("¿Borrar todo el historial?", "Se eliminarán todos los chats guardados en este dispositivo.", function () {
        clearHistory(); setTimeout(function () { try { $(".hback").focus(); } catch (e) {} }, 0);
      });
    });

    // ---- Instancia (para que la red actualice la config sin rehacer el widget) ----
    instance = {
      cfgStr: JSON.stringify(cfg),
      update: function (nc) {
        instance.cfgStr = JSON.stringify(nc);
        name = nc.name || "Asistente"; $(".nm").textContent = name; panel.setAttribute("aria-label", "Chat de " + name);
        var na = nc.avatar || ""; if (na !== avatar) { avatar = na; setAvatar(avatar); }
        welcome = nc.welcome || welcome;
        if (!userMsgCount()) { var wb = msgs.querySelector(".msg.in .tx"); if (wb) wb.textContent = welcome; }
        var ne = nc.contact_email || ""; if (ne) { mail.style.display = ""; mail.setAttribute("href", "mailto:" + ne); } else mail.style.display = "none";
        var np = nc.privacy_url || ""; if (np) { priv.parentNode.style.display = ""; priv.setAttribute("href", np); }
        // El tema por defecto solo aplica si el visitante no eligió uno.
        if (!savedTheme) { var t2 = (nc.theme === "light") ? "light" : "dark"; panel.setAttribute("data-theme", t2); Array.prototype.forEach.call($$(".themeseg button"), function (b) { b.classList.toggle("on", b.getAttribute("data-theme") === t2); }); }
      }
    };

    // ---- Restaurar estado al recargar (sin animación) ----
    var ui = readUI();
    if (ui) {
      if (typeof ui.text === "string") { ta.value = ui.text; }
      if (ui.open && !hideFab) { open(true); if (typeof ui.scroll === "number") body.scrollTop = ui.scroll; }
    }
    syncHero(); autogrow();

    // Primera visita (sin caché ni estado previo): aparición con un fundido breve.
    if (!fromCache && !ui) { fab.classList.add("fab-in"); }

    // Guardar estado al salir / bfcache (y liberar las fotos en memoria al descargar)
    window.addEventListener("pagehide", function () { saveUI(); revokeLive(); });
    window.addEventListener("beforeunload", function () { saveUI(); revokeLive(); });
    window.addEventListener("pageshow", function (e) {
      if (!e.persisted) return; // bfcache: re-sincronizar sin animación
      var u = readUI(); if (!u) return;
      if (u.open && !panel.classList.contains("open") && !hideFab) { open(true); if (typeof u.scroll === "number") body.scrollTop = u.scroll; }
    });
  }

  // ===================== Utilidades a nivel de módulo =====================
  function esc(s) { return String(s).replace(/"/g, "&quot;"); }
  function genId() { return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function startOfDay(t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function dayGroup(ts, nowT) {
    var today = startOfDay(nowT), day = 86400000;
    if (ts >= today) return "Hoy";
    if (ts >= today - day) return "Ayer";
    if (ts >= today - 7 * day) return "Últimos 7 días";
    return "Más antiguos";
  }
  function fmtTime(ts, nowT) {
    var d = new Date(ts), today = startOfDay(nowT);
    if (ts >= today) return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
    return d.getDate() + "/" + (d.getMonth() + 1);
  }

  function wuCSS() { return (
    ':host{all:initial;}' +
    '*{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;-webkit-tap-highlight-color:transparent;}' +
    '.panel button:focus-visible{outline:none;box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--ink2);}' +
    '.ta:focus,.panel:focus{outline:none;}' +
    '.no-anim,.no-anim *{animation:none!important;transition:none!important;}' +
    // ----- Launcher -----
    '.fab{position:fixed;right:20px;bottom:20px;width:52px;height:52px;border:0;border-radius:16px;cursor:pointer;display:grid;place-items:center;background:#111;color:#fff;box-shadow:0 10px 24px rgba(0,0,0,.26);overflow:hidden;padding:0;}' +
    '.fab img{width:100%;height:100%;object-fit:cover;display:block;} .fab svg{width:24px;height:24px;}' +
    '.fab.fab-in{animation:wu-fab-in .15s ease both;}' +
    '@keyframes wu-fab-in{from{opacity:0}to{opacity:1}}' +
    // ----- Variables de tema -----
    '.panel{--bg:#0e0f12;--surface:#1b1c20;--surface2:#26272c;--ink:#f4f5f7;--ink2:#9aa0a8;--line:rgba(255,255,255,.1);' +
      '--ubub:#2a2b31;--uink:#f4f5f7;--ava-bg:#f4f5f7;--ava-ink:#0e0f12;--thumb:#26272c;' +
      '--send-bg:#f4f5f7;--send-ink:#0e0f12;--stop-bg:#3a3b41;--stop-ink:#f4f5f7;--dot:#52545b;--dot-on:#c9ccd1;--sb:rgba(255,255,255,.18);' +
      '--imgline:rgba(255,255,255,.1);--danger:#ff6b6b;--danger-bg:rgba(255,107,107,.12);' +
      'position:fixed;right:16px;top:16px;bottom:16px;width:420px;max-width:calc(100vw - 32px);background:var(--bg);color:var(--ink);overscroll-behavior:contain;' +
      'border:1px solid var(--line);border-radius:18px;overflow:hidden;display:none;flex-direction:column;box-shadow:0 24px 70px rgba(0,0,0,.32);}' +
    '.panel[data-theme=light]{--bg:#fff;--surface:#f6f6f7;--surface2:#ececed;--ink:#0a0a0a;--ink2:#6b7280;--line:#ececec;' +
      '--ubub:#ededee;--uink:#0a0a0a;--ava-bg:#0a0a0a;--ava-ink:#fff;--thumb:#ececed;' +
      '--send-bg:#0a0a0a;--send-ink:#fff;--stop-bg:#e6e6e8;--stop-ink:#0a0a0a;--dot:#c7c7cc;--dot-on:#6b7280;--sb:rgba(0,0,0,.18);' +
      '--imgline:rgba(0,0,0,.08);--danger:#dc2626;--danger-bg:rgba(220,38,38,.08);}' +
    '.panel.open{display:flex;animation:wu-pop .26s cubic-bezier(.2,.8,.2,1);}' +
    '@keyframes wu-pop{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}' +
    // ----- Agarre (arrastrar para cerrar, solo móvil) -----
    '.grip{display:none;}' +
    // ----- Encabezado -----
    '.head{display:flex;align-items:center;gap:6px;padding:10px 8px 6px;flex-shrink:0;}' +
    '.ava{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;flex-shrink:0;overflow:hidden;background:var(--ava-bg);color:var(--ava-ink);margin:0 2px;padding:0;}' +
    '.ava img{width:100%;height:100%;object-fit:cover;display:block;} .ava svg{width:60%;height:60%;}' +
    '.nm{font-weight:650;font-size:.95rem;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;} .sp{margin-left:auto;}' +
    '.ico{width:40px;height:40px;border-radius:50%;border:0;background:none;color:var(--ink);display:grid;place-items:center;cursor:pointer;flex-shrink:0;}' +
    '.ico:hover{background:var(--surface);} .ico svg{width:20px;height:20px;}' +
    // ----- Cuerpo / scroll -----
    '.body{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:10px 16px 4px;display:flex;flex-direction:column;scrollbar-width:thin;scrollbar-color:var(--sb) transparent;}' +
    '.body::-webkit-scrollbar{width:7px;} .body::-webkit-scrollbar-thumb{background:var(--sb);border-radius:4px;} .body::-webkit-scrollbar-track{background:transparent;}' +
    // ----- Estado vacío -----
    '.hero{display:none;flex:1;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:18px 10px;min-height:150px;}' +
    '.panel.has-hero .hero{display:flex;}' +
    '.herotitle{margin:0;font-size:1.6rem;line-height:1.25;font-weight:800;letter-spacing:-.01em;color:var(--ink);}' +
    '.panel.has-hero .herotitle{animation:wu-title-in .15s ease both;}' +
    '@keyframes wu-title-in{from{opacity:0}to{opacity:1}}' +
    '@media(prefers-reduced-motion:reduce){.panel.has-hero .herotitle{animation:none;}}' +
    // ----- Mensajes -----
    '.msgs{display:flex;flex-direction:column;gap:14px;padding:6px 0;}' +
    '.msg{max-width:85%;font-size:.92rem;line-height:1.5;overflow-wrap:anywhere;word-break:break-word;}' +
    '.msg .tx{white-space:pre-wrap;}' +
    '.in{align-self:flex-start;color:var(--ink);max-width:100%;}' +
    '.out{align-self:flex-end;display:flex;flex-direction:column;align-items:flex-end;gap:6px;}' +
    '.out .bubble{background:var(--ubub);color:var(--uink);border-radius:20px;padding:10px 14px;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;cursor:default;}' +
    '.out.editing{max-width:100%;width:100%;align-items:stretch;}' +
    '.stopped{color:var(--ink2);font-style:italic;} .noimg{font-size:.78rem;color:var(--ink2);font-style:italic;margin-bottom:4px;}' +
    // Miniaturas en el chat: sin burbuja ni fondo, fila que envuelve, alineadas a la derecha.
    '.msg-atts{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;max-width:100%;}' +
    '.msg-atts img{width:88px;height:88px;object-fit:cover;border-radius:14px;border:1px solid var(--imgline);cursor:pointer;display:block;}' +
    '.att-fail{width:88px;height:88px;border-radius:14px;border:1px solid var(--imgline);background:var(--surface);display:grid;place-items:center;color:var(--ink2);} .att-fail svg{width:26px;height:26px;}' +
    // Acciones debajo de los mensajes de la IA (copiar / generar otra respuesta)
    '.msg-actions{display:flex;gap:2px;margin-top:2px;margin-left:-11px;align-self:flex-start;}' +
    '.msg-act{width:40px;height:40px;border:0;border-radius:9px;background:none;color:var(--ink2);display:grid;place-items:center;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;user-select:none;-webkit-user-select:none;} .msg-act:hover{background:var(--surface);color:var(--ink);} .msg-act:active{background:var(--surface2);} .msg-act.ok{color:var(--ink);} .msg-act svg{width:18px;height:18px;} .msg-regen[hidden]{display:none;}' +
    // Menú al mantener presionado un mensaje del usuario
    '.msgmenu{position:absolute;z-index:7;min-width:150px;background:var(--bg);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 34px rgba(0,0,0,.4);padding:5px;}' +
    '.msgmenu-item{display:flex;align-items:center;gap:11px;width:100%;border:0;background:none;color:var(--ink);font:inherit;font-size:.9rem;padding:10px 12px;border-radius:8px;cursor:pointer;text-align:left;} .msgmenu-item:hover,.msgmenu-item:focus-visible{background:var(--surface);outline:none;} .msgmenu-item svg{width:17px;height:17px;color:var(--ink2);flex-shrink:0;}' +
    // Editar un mensaje del usuario en el lugar
    '.editbox{width:100%;display:flex;flex-direction:column;gap:8px;}' +
    '.editta{width:100%;border:1px solid var(--ink2);background:var(--surface);color:var(--ink);border-radius:16px;padding:10px 13px;font:inherit;font-size:16px;line-height:1.4;resize:none;outline:none;min-height:42px;max-height:160px;}' +
    '.editbtns{display:flex;justify-content:flex-end;gap:8px;}' +
    '.editbtn{border-radius:11px;padding:7px 15px;font:inherit;font-size:.86rem;font-weight:600;cursor:pointer;} .editbtn.sec{border:1px solid var(--line);background:none;color:var(--ink);} .editbtn.sec:hover{background:var(--surface);} .editbtn.pri{border:0;background:var(--send-bg);color:var(--send-ink);} .editbtn.pri:hover{opacity:.9;}' +
    // ----- Puntos de carga -----
    '.typing{display:flex;align-items:center;gap:6px;padding:2px 2px 10px;align-self:flex-start;}' +
    '.typing[hidden]{display:none;}' +
    '.typing .dot{width:8px;height:8px;border-radius:50%;background:var(--dot-on);opacity:.35;animation:wu-blink 1.2s infinite ease-in-out;will-change:transform,opacity;}' +
    '.typing .dot:nth-child(2){animation-delay:.2s;} .typing .dot:nth-child(3){animation-delay:.4s;}' +
    '@keyframes wu-blink{0%,80%,100%{opacity:.35;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}' +
    '@keyframes wu-blink-rm{0%,100%{opacity:.35}50%{opacity:1}}' +
    '@media(prefers-reduced-motion:reduce){.typing .dot{animation:wu-blink-rm 1.4s infinite ease-in-out;transform:none;}}' +
    '.sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;}' +
    // ----- Composer -----
    '.composer-wrap{padding:6px 14px 8px;flex-shrink:0;}' +
    '.composer{display:grid;gap:7px 8px;align-items:end;background:var(--surface);border:1px solid var(--line);border-radius:24px;padding:7px 8px 7px 12px;' +
      'grid-template-columns:auto 1fr auto;grid-template-areas:"thumbs thumbs thumbs" "plus text send";}' +
    '.composer.focus{border-color:var(--ink2);}' +
    '.thumbs{grid-area:thumbs;display:flex;flex-wrap:wrap;gap:7px;padding:4px 2px 2px;}' +
    '.thumbs[hidden]{display:none;}' +
    '.thumb{position:relative;width:56px;height:56px;border-radius:14px;overflow:hidden;background:var(--thumb);border:1px solid var(--line);}' +
    '.thumb img{width:100%;height:100%;object-fit:cover;display:block;}' +
    '.thumbx{position:absolute;top:3px;right:3px;width:20px;height:20px;padding:0;border:0;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;display:grid;place-items:center;cursor:pointer;line-height:0;-webkit-tap-highlight-color:transparent;touch-action:manipulation;} .thumbx svg{width:12px;height:12px;display:block;}' +
    '.ta{grid-area:text;width:100%;border:0;background:none;color:var(--ink);resize:none;outline:none;font:inherit;font-size:16px;line-height:1.4;padding:7px 2px;min-height:36px;max-height:132px;overflow-y:hidden;scrollbar-width:thin;scrollbar-color:var(--sb) transparent;}' +
    '.ta::-webkit-scrollbar{width:6px;} .ta::-webkit-scrollbar-thumb{background:var(--sb);border-radius:3px;} .ta::-webkit-scrollbar-track{background:transparent;}' +
    '.ta::placeholder{color:var(--ink2);}' +
    '.plus{grid-area:plus;align-self:end;width:44px;height:44px;border-radius:50%;border:0;background:none;color:var(--ink2);display:grid;place-items:center;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;user-select:none;-webkit-user-select:none;} .plus:hover{color:var(--ink);} .plus:active{background:var(--surface2);color:var(--ink);} .plus svg{width:24px;height:24px;} .plus[hidden]{display:none;}' +
    '.send{grid-area:send;align-self:end;width:44px;height:44px;flex-shrink:0;border:0;border-radius:50%;background:var(--send-bg);color:var(--send-ink);display:grid;place-items:center;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;user-select:none;-webkit-user-select:none;transition:background .15s,opacity .15s,transform .1s;} .send:active:not(:disabled){transform:scale(.94);}' +
    '.send:disabled{opacity:.35;cursor:default;} .send svg{width:18px;height:18px;} .send .sqr{display:none;width:11px;height:11px;border-radius:3px;background:var(--stop-ink);}' +
    '.send.busy{background:var(--stop-bg);opacity:1;} .send.busy .sicon{display:none;} .send.busy .sqr{display:block;}' +
    // ----- Pie -----
    '.foot{text-align:center;padding:9px 6px 2px;} .foot .disc{margin:0;font-size:.68rem;line-height:1.45;color:var(--ink2);}' +
    '.atterr{color:#e5484d;font-size:.74rem;text-align:center;padding:4px 6px 0;} .atterr[hidden]{display:none;}' +
    // ----- Hoja de ajustes -----
    '.scrim{position:absolute;inset:0;background:rgba(0,0,0,.45);opacity:0;pointer-events:none;transition:opacity .2s;}' +
    '.panel.sheet-open .scrim{opacity:1;pointer-events:auto;}' +
    '.sheet{position:absolute;left:0;right:0;bottom:0;background:var(--bg);border-top:1px solid var(--line);border-radius:18px 18px 0 0;transform:translateY(100%);transition:transform .24s cubic-bezier(.4,0,.2,1);padding-bottom:env(safe-area-inset-bottom);}' +
    '.panel.sheet-open .sheet{transform:translateY(0);}' +
    '.shead{display:flex;align-items:center;justify-content:center;position:relative;padding:14px;border-bottom:1px solid var(--line);}' +
    '.sx{position:absolute;right:10px;top:50%;transform:translateY(-50%);width:30px;height:30px;border:0;background:none;color:var(--ink2);cursor:pointer;display:grid;place-items:center;} .sx svg{width:17px;height:17px;}' +
    '.row{display:flex;align-items:center;gap:12px;padding:13px 18px;width:100%;text-align:left;color:var(--ink);cursor:pointer;text-decoration:none;font:inherit;font-size:.9rem;background:none;border:0;}' +
    '.row:hover{background:var(--surface);} .rico{width:19px;height:19px;color:var(--ink2);flex-shrink:0;}' +
    '.themeseg{display:inline-flex;background:var(--surface);border:1px solid var(--line);border-radius:9px;padding:3px;}' +
    '.themeseg button{border:0;background:none;border-radius:6px;padding:4px 11px;font:inherit;font-size:.78rem;font-weight:600;color:var(--ink2);cursor:pointer;} .themeseg button.on{background:var(--bg);color:var(--ink);}' +
    '.sfoot{text-align:center;font-size:.72rem;color:var(--ink2);padding:12px;border-top:1px solid var(--line);} .sfoot a{color:var(--ink2);text-decoration:none;}' +
    // ----- Historial -----
    '.histview{position:absolute;inset:0;z-index:4;background:var(--bg);display:flex;flex-direction:column;}' +
    '.histview[hidden]{display:none;}' +
    '.hhead{display:flex;align-items:center;gap:6px;padding:10px 8px 6px;flex-shrink:0;}' +
    '.htitle{font-weight:700;font-size:.98rem;}' +
    '.hsearch{position:relative;margin:4px 14px 8px;flex-shrink:0;}' +
    '.hsearch-ico{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:17px;height:17px;color:var(--ink2);pointer-events:none;}' +
    '.hsearch-inp{width:100%;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:999px;padding:9px 36px 9px 36px;font:inherit;font-size:16px;outline:none;}' +
    '.hsearch-inp:focus{border-color:var(--ink2);} .hsearch-inp::placeholder{color:var(--ink2);}' +
    '.hsearch-clear{position:absolute;right:8px;top:50%;transform:translateY(-50%);width:26px;height:26px;border:0;border-radius:50%;background:none;color:var(--ink2);display:grid;place-items:center;cursor:pointer;} .hsearch-clear:hover{background:var(--surface2);} .hsearch-clear svg{width:15px;height:15px;} .hsearch-clear[hidden]{display:none;}' +
    '.hnew{display:flex;align-items:center;gap:10px;margin:0 10px 6px;padding:11px 12px;width:calc(100% - 20px);border:0;border-radius:12px;background:none;color:var(--ink);font:inherit;font-size:.92rem;font-weight:600;cursor:pointer;flex-shrink:0;} .hnew:hover{background:var(--surface);} .hnew svg{width:19px;height:19px;color:var(--ink2);}' +
    '.hlist{flex:1;overflow-y:auto;padding:2px 10px 10px;scrollbar-width:thin;scrollbar-color:var(--sb) transparent;}' +
    '.hlist:empty{flex:0 0 auto;}' +   // sin chats: no crecer, para que el estado vacío quede centrado
    '.hlist::-webkit-scrollbar{width:7px;} .hlist::-webkit-scrollbar-thumb{background:var(--sb);border-radius:4px;}' +
    '.hgroup{font-size:.72rem;font-weight:700;letter-spacing:.03em;color:var(--ink2);text-transform:uppercase;padding:12px 8px 4px;}' +
    '.hrow{position:relative;display:flex;align-items:center;border-radius:12px;} .hrow:hover{background:var(--surface);}' +
    '.hrow.is-current{background:var(--surface);}' +
    '.hrow-main{flex:1;min-width:0;display:flex;align-items:center;gap:10px;border:0;background:none;color:var(--ink);font:inherit;text-align:left;padding:11px 8px 11px 12px;cursor:pointer;}' +
    '.hrow-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.9rem;}' +
    '.hrow.is-current .hrow-title{font-weight:700;}' +
    '.hrow-time{flex-shrink:0;font-size:.74rem;color:var(--ink2);}' +
    '.hrow-kebab{flex-shrink:0;width:34px;height:34px;margin-right:4px;border:0;border-radius:50%;background:none;color:var(--ink2);display:grid;place-items:center;cursor:pointer;} .hrow-kebab:hover{background:var(--surface2);color:var(--ink);} .hrow-kebab svg{width:18px;height:18px;}' +
    '.hrow-menu{position:absolute;right:8px;top:calc(100% - 6px);z-index:2;background:var(--bg);border:1px solid var(--line);border-radius:10px;box-shadow:0 12px 30px rgba(0,0,0,.35);padding:4px;} .hrow-menu[hidden]{display:none;}' +
    '.hrow-del{border:0;background:none;color:var(--ink);font:inherit;font-size:.86rem;padding:8px 12px;border-radius:7px;cursor:pointer;white-space:nowrap;} .hrow-del:hover{background:var(--surface);}' +
    '.hempty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--ink2);font-size:.95rem;padding:20px;gap:6px;} .hempty span{font-size:.8rem;} .hempty[hidden]{display:none;}' +
    // "Borrar historial": barra completa al fondo, toda tocable, se tiñe de rojo al interactuar.
    '.hclear-wrap{flex-shrink:0;border-top:1px solid var(--line);padding-bottom:env(safe-area-inset-bottom);} .hclear-wrap[hidden]{display:none;}' +
    '.hclear{display:block;width:100%;height:52px;border:0;background:none;color:var(--ink);font:inherit;font-size:15px;font-weight:500;text-align:center;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;transition:background .12s,color .12s;} ' +
    '.hclear:hover,.hclear:focus-visible,.hclear:active{background:var(--danger-bg);color:var(--danger);outline:none;box-shadow:none;}' +
    // ----- Confirmación -----
    '.confirm{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;padding:22px;}' +
    '.confirm[hidden]{display:none;}' +
    '.confirm-scrim{position:absolute;inset:0;background:rgba(0,0,0,.45);}' +
    '.confirm-box{position:relative;width:100%;max-width:300px;background:var(--bg);border:1px solid var(--line);border-radius:16px;padding:20px;box-shadow:0 20px 50px rgba(0,0,0,.4);text-align:center;}' +
    '.confirm-t{margin:0 0 6px;font-size:1.05rem;font-weight:800;color:var(--ink);}' +
    '.confirm-d{margin:0 0 16px;font-size:.88rem;line-height:1.45;color:var(--ink2);}' +
    '.confirm-btns{display:flex;gap:9px;}' +
    '.btn-sec,.btn-pri{flex:1;border-radius:11px;padding:10px 12px;font:inherit;font-size:.9rem;font-weight:600;cursor:pointer;}' +
    '.btn-sec{border:1px solid var(--line);background:none;color:var(--ink);} .btn-sec:hover{background:var(--surface);}' +
    '.btn-pri{border:0;background:var(--send-bg);color:var(--send-ink);} .btn-pri:hover{opacity:.9;}' +
    // ----- Visor de imágenes -----
    '.viewer{position:absolute;inset:0;z-index:6;display:flex;align-items:center;justify-content:center;padding:44px 16px;}' +
    '.viewer[hidden]{display:none;}' +
    '.viewer-scrim{position:absolute;inset:0;background:rgba(0,0,0,.82);}' +
    '.viewer-img{position:relative;max-width:100%;max-height:100%;object-fit:contain;border-radius:10px;}' +
    '.viewer-x{position:absolute;top:12px;right:12px;z-index:2;width:40px;height:40px;border:0;border-radius:50%;background:rgba(255,255,255,.14);color:#fff;display:grid;place-items:center;cursor:pointer;} .viewer-x:hover{background:rgba(255,255,255,.26);} .viewer-x svg{width:20px;height:20px;}' +
    '.viewer-nav{position:absolute;top:50%;transform:translateY(-50%);z-index:2;width:40px;height:40px;border:0;border-radius:50%;background:rgba(255,255,255,.14);color:#fff;display:grid;place-items:center;cursor:pointer;} .viewer-nav:hover{background:rgba(255,255,255,.26);} .viewer-nav svg{width:22px;height:22px;} .viewer-nav[hidden]{display:none;}' +
    '.viewer-prev{left:10px;} .viewer-next{right:10px;}' +
    // ----- Móvil: hoja que sube desde abajo -----
    '@media(max-width:640px){' +
      '.panel{left:0;right:0;top:auto;bottom:0;width:auto;max-width:100vw;height:92dvh;max-height:92dvh;border-radius:20px 20px 0 0;border-left:0;border-right:0;border-bottom:0;padding-bottom:env(safe-area-inset-bottom);transition:transform .26s cubic-bezier(.2,.8,.2,1);}' +
      '.panel.dragging{transition:none;}' +
      '.panel.open{animation:wu-up .28s cubic-bezier(.2,.8,.2,1);}' +
      '@keyframes wu-up{from{transform:translateY(100%)}to{transform:none}}' +
      '.grip{display:block;width:36px;height:4px;border-radius:999px;background:var(--ink2);opacity:.4;margin:9px auto 2px;flex-shrink:0;touch-action:none;}' +
      '.head{padding-top:16px;touch-action:none;}' +
      '.herotitle{font-size:1.5rem;}' +
      '.composer{grid-template-columns:auto 1fr auto;grid-template-areas:"thumbs thumbs thumbs" "text text text" "plus . send";padding:8px 10px 10px;border-radius:22px;}' +
      '.ta{padding:6px 4px 2px;}' +
      '.ico{width:44px;height:44px;}' +
      '.fab{right:16px;bottom:16px;}' +
    '}' +
    '@media(prefers-reduced-motion:reduce){.panel{transition:none!important;}.panel.open{animation:none!important;}}'); }
})();
