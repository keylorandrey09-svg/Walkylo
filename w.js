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
          '<button class="row clearhist"><svg class="rico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>Borrar historial</button>' +
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
    function persist() { try { sessionStorage.setItem(STORE_KEY, JSON.stringify(hist)); } catch (e) {} }

    var msgs = $(".msgs"), body = $(".body"), heroTitle = $(".herotitle");

    // Bienvenida (no se guarda) + mensajes del chat actual
    msgs.appendChild(bubble(welcome, false));
    hist.forEach(function (m) { msgs.appendChild(bubble(m.x, !!m.o, null, !!m.g)); });

    function userMsgCount() { for (var k = 0; k < hist.length; k++) { if (hist[k].o) return 1; } return 0; }

    // ---- Estado vacío: título grande que rota ----
    var lastTitleIdx = -1;
    function pickTitle() {
      if (EMPTY_TITLES.length <= 1) return 0;
      var n; do { n = Math.floor(Math.random() * EMPTY_TITLES.length); } while (n === lastTitleIdx);
      lastTitleIdx = n; return n;
    }
    heroTitle.textContent = EMPTY_TITLES[pickTitle()];
    var titleTimer = null;
    function startTitles() {
      if (reduceMotion || titleTimer) return;
      titleTimer = setInterval(function () {
        heroTitle.classList.add("fade");
        setTimeout(function () { heroTitle.textContent = EMPTY_TITLES[pickTitle()]; heroTitle.classList.remove("fade"); }, 240);
      }, 4000);
    }
    function stopTitles() { if (titleTimer) { clearInterval(titleTimer); titleTimer = null; } }
    function syncHero() {
      var empty = userMsgCount() === 0;
      panel.classList.toggle("has-hero", empty);
      if (empty && panel.classList.contains("open")) startTitles(); else stopTitles();
    }

    // ---- Burbujas ----
    function bubble(text, out, atts, hadImg) {
      var el = document.createElement("div");
      el.className = "msg " + (out ? "out" : "in");
      if (atts && atts.length) {
        var g = document.createElement("div"); g.className = "msg-atts";
        atts.forEach(function (src, i) {
          var im = document.createElement("img"); im.src = src; im.alt = "Imagen adjunta " + (i + 1) + " de " + atts.length;
          im.setAttribute("role", "button"); im.setAttribute("tabindex", "0");
          im.onerror = function () { im.style.display = "none"; };
          im.addEventListener("click", function () { openViewer(atts, i, im); });
          im.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openViewer(atts, i, im); } });
          g.appendChild(im);
        });
        el.appendChild(g);
      } else if (hadImg) {
        var note = document.createElement("div"); note.className = "noimg"; note.textContent = "Imagen no guardada"; el.appendChild(note);
      }
      if (text) { var tx = document.createElement("div"); tx.className = "tx"; tx.textContent = text; el.appendChild(tx); }
      return el;
    }
    function scroll() { body.scrollTop = body.scrollHeight; }

    // ---- Foco: en táctil nunca abrir el teclado (no enfocar el textarea) ----
    function focusInput() {
      if (isTouch) { try { panel.focus(); } catch (e) {} }
      else { try { ta.focus(); } catch (e) {} }
    }

    // ---- Estado de la interfaz (sobrevive recargas) ----
    function saveUI() {
      try { sessionStorage.setItem(UI_KEY, JSON.stringify({ open: panel.classList.contains("open"), text: ta.value, scroll: body.scrollTop })); } catch (e) {}
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
      if (!viewerEl.hidden) { closeViewer(); return; }
      if (!confirmEl.hidden) { cancelConfirm(); return; }
      if (!historyEl.hidden) { closeHistory(); return; }
      if (panel.classList.contains("sheet-open")) { panel.classList.remove("sheet-open"); return; }
      close();
    }
    function open(noAnim) {
      lastFocus = document.activeElement;
      if (noAnim) panel.classList.add("no-anim");
      panel.classList.add("open"); panel.setAttribute("aria-hidden", "false"); fab.style.display = "none";
      document.addEventListener("click", onOutside); document.addEventListener("keydown", onEsc);
      syncHero(); autogrow();
      if (noAnim) { scroll(); setTimeout(function () { panel.classList.remove("no-anim"); }, 60); }
      else { setTimeout(function () { focusInput(); autogrow(); scroll(); }, 250); }
      saveUI();
    }
    function close() {
      panel.classList.remove("open", "sheet-open"); panel.setAttribute("aria-hidden", "true"); fab.style.display = hideFab ? "none" : "";
      document.removeEventListener("click", onOutside); document.removeEventListener("keydown", onEsc);
      stopTitles();
      var back = (!hideFab) ? fab : lastFocus;
      try { if (back && back.focus) back.focus(); } catch (e) {}
      saveUI();
    }
    function toggle() { panel.classList.contains("open") ? close() : open(); }
    fab.addEventListener("click", function () { open(); });
    $(".close").addEventListener("click", close);

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
      var atts = attachments.map(function (a) { return a.url; });
      var hadImg = atts.length > 0;
      msgs.appendChild(bubble(v, true, atts));
      hist.push({ x: v, o: 1, g: hadImg ? 1 : 0 }); persist(); logUpsert();
      // TODO Fase 8: onSendAttachments(attachments) -> subir/enviar al backend (hoy NO hay red)
      clearAttachments();
      ta.value = ""; autogrow(); syncHero(); scroll(); saveUI();

      setState("thinking");
      try { ctrl = new AbortController(); } catch (e) { ctrl = null; }
      pendingTimer = setTimeout(function () {
        setState("responding");
        msgs.appendChild(bubble(PENDING_REPLY, false)); hist.push({ x: PENDING_REPLY, o: 0, g: 0 }); persist(); logUpsert();
        scroll();
        setState("idle");
        focusInput();
      }, 1200);
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
      focusInput();
    }
    sendBtn.addEventListener("click", function () { if (state === "idle") send(); else stop(); });

    // ---- Fotos (+): solo lado navegador ----
    var attachments = [];
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
    function clearAttachments() {
      attachments.forEach(function (a) { try { if (a.url && a.url.indexOf("blob:") === 0) URL.revokeObjectURL(a.url); } catch (e) {} });
      attachments = []; renderThumbs();
    }
    function downscale(file, cb) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height, scale = Math.min(1, ATT_MAX_PX / Math.max(w, h));
        var cw = Math.round(w * scale), ch = Math.round(h * scale);
        try {
          var cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
          cv.getContext("2d").drawImage(img, 0, 0, cw, ch);
          cv.toBlob(function (blob) {
            try { URL.revokeObjectURL(url); } catch (e) {}
            if (!blob) { cb(null); return; }
            cb({ url: URL.createObjectURL(blob), blob: blob });
          }, "image/jpeg", ATT_QUALITY);
        } catch (e) { try { URL.revokeObjectURL(url); } catch (_) {} cb({ url: URL.createObjectURL(file), blob: file }); }
      };
      img.onerror = function () { try { URL.revokeObjectURL(url); } catch (e) {} cb(null); };
      img.src = url;
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
    var histBtn = root.querySelector(".ico.history");
    if (!lsOk) {
      if (histBtn) histBtn.style.display = "none";
      var clr0 = $(".clearhist"); if (clr0) clr0.style.display = "none";
    }

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
      var log = loadLog();
      q = (q || "").trim().toLowerCase();
      if (q) {
        log = log.filter(function (c) {
          if (chatTitle(c).toLowerCase().indexOf(q) !== -1) return true;
          for (var i = 0; i < c.msgs.length; i++) { if (c.msgs[i].x && c.msgs[i].x.toLowerCase().indexOf(q) !== -1) return true; }
          return false;
        });
      }
      hlist.innerHTML = "";
      hempty.hidden = log.length > 0;
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
      msgs.innerHTML = ""; msgs.appendChild(bubble(welcome, false));
      hist.forEach(function (m) { msgs.appendChild(bubble(m.x, !!m.o, null, !!m.g)); });
      lastTitleIdx = -1; heroTitle.textContent = EMPTY_TITLES[pickTitle()];
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
      msgs.innerHTML = ""; msgs.appendChild(bubble(welcome, false));
      clearAttachments();
      lastTitleIdx = -1; heroTitle.textContent = EMPTY_TITLES[pickTitle()];
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
    // Borrar historial (hoja de ajustes)
    var clearBtn = $(".clearhist");
    if (clearBtn) clearBtn.addEventListener("click", function () {
      panel.classList.remove("sheet-open");
      askConfirm("¿Borrar todo el historial?", "Se eliminarán todos los chats guardados en este dispositivo.", clearHistory);
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

    // Guardar estado al salir / bfcache
    window.addEventListener("pagehide", saveUI);
    window.addEventListener("beforeunload", saveUI);
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
      'position:fixed;right:16px;top:16px;bottom:16px;width:420px;max-width:calc(100vw - 32px);background:var(--bg);color:var(--ink);' +
      'border:1px solid var(--line);border-radius:18px;overflow:hidden;display:none;flex-direction:column;box-shadow:0 24px 70px rgba(0,0,0,.32);}' +
    '.panel[data-theme=light]{--bg:#fff;--surface:#f6f6f7;--surface2:#ececed;--ink:#0a0a0a;--ink2:#6b7280;--line:#ececec;' +
      '--ubub:#ededee;--uink:#0a0a0a;--ava-bg:#0a0a0a;--ava-ink:#fff;--thumb:#ececed;' +
      '--send-bg:#0a0a0a;--send-ink:#fff;--stop-bg:#e6e6e8;--stop-ink:#0a0a0a;--dot:#c7c7cc;--dot-on:#6b7280;--sb:rgba(0,0,0,.18);}' +
    '.panel.open{display:flex;animation:wu-pop .26s cubic-bezier(.2,.8,.2,1);}' +
    '@keyframes wu-pop{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}' +
    // ----- Encabezado -----
    '.head{display:flex;align-items:center;gap:6px;padding:10px 8px 6px;flex-shrink:0;}' +
    '.ava{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;flex-shrink:0;overflow:hidden;background:var(--ava-bg);color:var(--ava-ink);margin:0 2px;padding:0;}' +
    '.ava img{width:100%;height:100%;object-fit:cover;display:block;} .ava svg{width:60%;height:60%;}' +
    '.nm{font-weight:650;font-size:.95rem;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;} .sp{margin-left:auto;}' +
    '.ico{width:40px;height:40px;border-radius:50%;border:0;background:none;color:var(--ink);display:grid;place-items:center;cursor:pointer;flex-shrink:0;}' +
    '.ico:hover{background:var(--surface);} .ico svg{width:20px;height:20px;}' +
    // ----- Cuerpo / scroll -----
    '.body{flex:1;overflow-y:auto;padding:10px 16px 4px;display:flex;flex-direction:column;scrollbar-width:thin;scrollbar-color:var(--sb) transparent;}' +
    '.body::-webkit-scrollbar{width:7px;} .body::-webkit-scrollbar-thumb{background:var(--sb);border-radius:4px;} .body::-webkit-scrollbar-track{background:transparent;}' +
    // ----- Estado vacío -----
    '.hero{display:none;flex:1;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:18px 10px;min-height:150px;}' +
    '.panel.has-hero .hero{display:flex;}' +
    '.herotitle{margin:0;font-size:1.6rem;line-height:1.25;font-weight:800;letter-spacing:-.01em;color:var(--ink);transition:opacity .24s ease;}' +
    '.herotitle.fade{opacity:0;}' +
    '@media(prefers-reduced-motion:reduce){.herotitle{transition:none;}}' +
    // ----- Mensajes -----
    '.msgs{display:flex;flex-direction:column;gap:14px;padding:6px 0;}' +
    '.msg{max-width:85%;font-size:.92rem;line-height:1.5;overflow-wrap:anywhere;word-break:break-word;}' +
    '.msg .tx{white-space:pre-wrap;}' +
    '.in{align-self:flex-start;color:var(--ink);max-width:100%;}' +
    '.out{align-self:flex-end;background:var(--ubub);color:var(--uink);border-radius:20px;padding:10px 14px;}' +
    '.stopped{color:var(--ink2);font-style:italic;} .noimg{font-size:.78rem;color:var(--ink2);font-style:italic;margin-bottom:4px;}' +
    '.msg-atts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;justify-content:flex-end;max-width:100%;}' +
    '.msg-atts img{width:72px;height:72px;object-fit:cover;border-radius:14px;border:1px solid var(--line);cursor:pointer;display:block;}' +
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
    '.composer:focus-within{border-color:var(--ink2);}' +
    '.thumbs{grid-area:thumbs;display:flex;flex-wrap:wrap;gap:7px;padding:4px 2px 2px;}' +
    '.thumbs[hidden]{display:none;}' +
    '.thumb{position:relative;width:56px;height:56px;border-radius:14px;overflow:hidden;background:var(--thumb);border:1px solid var(--line);}' +
    '.thumb img{width:100%;height:100%;object-fit:cover;display:block;}' +
    '.thumbx{position:absolute;top:2px;right:2px;width:20px;height:20px;border:0;border-radius:7px;background:rgba(0,0,0,.6);color:#fff;display:grid;place-items:center;cursor:pointer;} .thumbx svg{width:13px;height:13px;}' +
    '.ta{grid-area:text;width:100%;border:0;background:none;color:var(--ink);resize:none;outline:none;font:inherit;font-size:16px;line-height:1.4;padding:7px 2px;min-height:36px;max-height:132px;overflow-y:hidden;scrollbar-width:thin;scrollbar-color:var(--sb) transparent;}' +
    '.ta::-webkit-scrollbar{width:6px;} .ta::-webkit-scrollbar-thumb{background:var(--sb);border-radius:3px;} .ta::-webkit-scrollbar-track{background:transparent;}' +
    '.ta::placeholder{color:var(--ink2);}' +
    '.plus{grid-area:plus;align-self:end;width:36px;height:36px;border-radius:50%;border:0;background:none;color:var(--ink2);display:grid;place-items:center;cursor:pointer;} .plus:hover{background:var(--surface2);color:var(--ink);} .plus svg{width:20px;height:20px;} .plus[hidden]{display:none;}' +
    '.send{grid-area:send;align-self:end;width:36px;height:36px;flex-shrink:0;border:0;border-radius:50%;background:var(--send-bg);color:var(--send-ink);display:grid;place-items:center;cursor:pointer;transition:background .15s,opacity .15s;}' +
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
      '.panel{left:0;right:0;top:auto;bottom:0;width:auto;max-width:100vw;height:92dvh;max-height:92dvh;border-radius:20px 20px 0 0;border-left:0;border-right:0;border-bottom:0;padding-bottom:env(safe-area-inset-bottom);}' +
      '.panel.open{animation:wu-up .28s cubic-bezier(.2,.8,.2,1);}' +
      '@keyframes wu-up{from{transform:translateY(100%)}to{transform:none}}' +
      '.herotitle{font-size:1.5rem;}' +
      '.composer{grid-template-columns:auto 1fr auto;grid-template-areas:"thumbs thumbs thumbs" "text text text" "plus . send";padding:8px 10px 10px;border-radius:22px;}' +
      '.ta{padding:6px 4px 2px;}' +
      '.ico{width:44px;height:44px;}' +
      '.fab{right:16px;bottom:16px;}' +
    '}'); }
})();
