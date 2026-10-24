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

  // ---- Fotos adjuntas: apagado en producción ----
  // Solo se enciende si el <script> trae data-beta="attachments" (lado navegador).
  var ATTACHMENTS_ENABLED = false;
  var ATT_MAX = 3;                 // cantidad máxima de fotos
  var ATT_MAX_MB = 5;              // tamaño máximo por foto
  var ATT_MAX_PX = 1600;          // lado mayor tras reducir
  var ATT_QUALITY = 0.8;           // calidad del canvas
  var ATT_TYPES = { "image/jpeg": 1, "image/png": 1, "image/webp": 1 };

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

  // ---- 2) Traer la config pública del widget ----
  fetch(SUPA_URL + "/rest/v1/rpc/get_widget_public", {
    method: "POST",
    headers: { "apikey": SUPA_KEY, "Authorization": "Bearer " + SUPA_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ widget_id: dataId })
  })
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      var cfg = rows && rows[0];
      if (!cfg) return;          // chat deshabilitado, id inválido o sin config -> no dibujar
      render(cfg);
      ping();                    // avisar a Supabase que el widget está vivo en este sitio
    })
    .catch(function () {});        // error de red -> no dibujar (mejor nada que algo roto)

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

  // ---- 3) Dibujar el widget (aislado con Shadow DOM) ----
  function render(cfg) {
    var name = cfg.name || "Asistente";
    var welcome = cfg.welcome || "¡Hola! ¿En qué te puedo ayudar?";
    var avatar = cfg.avatar || "";
    var accent = cfg.accent || "";       // color del cliente: por ahora NO se aplica (ver resumen)
    var email = cfg.contact_email || "";
    var privacy = cfg.privacy_url || "";
    var lang = (cfg.language || "es").toLowerCase().slice(0, 2);
    var reduceMotion = false;
    try { reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

    var isImg = !!avatar && (avatar.indexOf("data:") === 0 || /^https?:\/\//.test(avatar));
    var spark = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3l1.9 5.6a3 3 0 0 0 1.9 1.9L21 12l-5.2 1.5a3 3 0 0 0-1.9 1.9L12 21l-1.9-5.6a3 3 0 0 0-1.9-1.9L3 12l5.2-1.5a3 3 0 0 0 1.9-1.9z"/></svg>';
    var avaInner = isImg ? '<img src="' + esc(avatar) + '" alt="">' : spark;

    var host = document.createElement("div");
    host.setAttribute("id", "walkyup-widget");
    host.style.cssText = "position:fixed;z-index:2147483647;top:0;left:0;";
    document.body.appendChild(host);
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

    root.innerHTML =
      '<style>' + CSS + '</style>' +
      '<button class="fab" part="fab" aria-label="Abrir chat">' + avaInner + '</button>' +
      '<div class="panel" data-theme="dark" role="dialog" aria-modal="true" aria-label="Chat de ' + esc(name) + '" aria-hidden="true">' +
        '<div class="head">' +
          '<button class="ico menu" aria-label="Ajustes"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg></button>' +
          '<span class="ava sm">' + avaInner + '</span>' +
          '<span class="nm"></span>' +
          '<span class="sp"></span>' +
          '<button class="ico newchat" aria-label="Nuevo chat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg></button>' +
          '<button class="ico close" aria-label="Cerrar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
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
          '<div class="foot"><p class="disc">Las respuestas pueden no ser siempre exactas. Al usar este chat aceptás la recopilación de datos según la política del sitio.</p>' +
            '<p class="brand">AI Agent powered by · <a href="https://walkyup.app" target="_blank" rel="noopener">Walkylet</a></p></div>' +
        '</div>' +
        '<div class="scrim"></div>' +
        '<div class="sheet"><div class="shead"><b>Ajustes</b><button class="sx" aria-label="Cerrar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div>' +
          '<a class="row mail"><svg class="rico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>Escribir por correo</a>' +
          '<div class="row">Tema<span class="sp"></span><span class="themeseg"><button data-theme="light">Claro</button><button data-theme="dark" class="on">Oscuro</button></span></div>' +
          '<div class="sfoot">© 2026 · <a class="priv" target="_blank" rel="noopener">Privacidad</a></div></div>' +
      '</div>';

    // Atajos
    var $ = function (s) { return root.querySelector(s); };
    var $$ = function (s) { return root.querySelectorAll(s); };

    var panel = $(".panel");
    $(".nm").textContent = name;

    // Avatar: fondo neutro (sin color de marca); si es imagen, mostrarla
    Array.prototype.forEach.call($$(".ava, .fab"), function (a) { if (isImg) a.classList.add("isimg"); });

    // Tema (se lee de localStorage y, si no, de la config del panel)
    var THEME_KEY = "wu_theme_" + dataId;
    var savedTheme = null; try { savedTheme = localStorage.getItem(THEME_KEY); } catch (e) {}
    var theme = (savedTheme === "light" || savedTheme === "dark") ? savedTheme : ((cfg.theme === "light") ? "light" : "dark");
    panel.setAttribute("data-theme", theme);
    Array.prototype.forEach.call($$(".themeseg button"), function (b) { b.classList.toggle("on", b.getAttribute("data-theme") === theme); });

    var mail = $(".mail"); if (email) mail.setAttribute("href", "mailto:" + email); else mail.style.display = "none";
    var priv = $(".priv"); if (privacy) priv.setAttribute("href", privacy); else priv.parentNode.style.display = "none";

    // ---- Persistencia por pestaña: sobrevive recargas, se borra al cerrar ----
    var msgs = $(".msgs"), body = $(".body"), hero = $(".hero"), heroTitle = $(".herotitle");
    var STORE_KEY = "wu_chat_" + dataId;
    var hist = [];
    try { hist = JSON.parse(sessionStorage.getItem(STORE_KEY)) || []; } catch (e) { hist = []; }
    function persist() { try { sessionStorage.setItem(STORE_KEY, JSON.stringify(hist)); } catch (e) {} }

    // Bienvenida (no se guarda) como primer mensaje del asistente + historial
    msgs.appendChild(bubble(welcome, false));
    hist.forEach(function (m) { msgs.appendChild(bubble(m.x, !!m.o, m.a)); });

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
      if (empty) startTitles(); else stopTitles();
    }
    syncHero();

    // ---- Burbujas / texto ----
    function bubble(text, out, atts) {
      var el = document.createElement("div");
      el.className = "msg " + (out ? "out" : "in");
      if (atts && atts.length) {
        var g = document.createElement("div"); g.className = "msg-atts";
        atts.forEach(function (src) { var im = document.createElement("img"); im.src = src; im.alt = ""; g.appendChild(im); });
        el.appendChild(g);
      }
      if (text) { var tx = document.createElement("div"); tx.className = "tx"; tx.textContent = text; el.appendChild(tx); }
      return el;
    }
    function scroll() { body.scrollTop = body.scrollHeight; }

    // ---- Abrir / cerrar ----
    var hideFab = (launcher === "none" || launcher === "off");
    var fab = $(".fab");
    if (hideFab) fab.style.display = "none";
    var lastFocus = null;
    function onOutside(e) {
      if (host.contains(e.target)) return;
      if (e.target && e.target.closest && e.target.closest("[data-walkyup-open]")) return;
      close();
    }
    function onEsc(e) { if (e.key === "Escape" || e.key === "Esc") { if (panel.classList.contains("sheet-open")) { panel.classList.remove("sheet-open"); return; } close(); } }
    function open() {
      lastFocus = document.activeElement;
      panel.classList.add("open"); panel.setAttribute("aria-hidden", "false"); fab.style.display = "none";
      setTimeout(function () { autogrow(); scroll(); document.addEventListener("click", onOutside); document.addEventListener("keydown", onEsc); }, 0);
      setTimeout(function () { ta.focus(); autogrow(); scroll(); }, 250);
    }
    function close() {
      panel.classList.remove("open"); panel.setAttribute("aria-hidden", "true"); fab.style.display = hideFab ? "none" : "";
      document.removeEventListener("click", onOutside); document.removeEventListener("keydown", onEsc);
      var back = (!hideFab) ? fab : lastFocus;
      try { if (back && back.focus) back.focus(); } catch (e) {}
    }
    function toggle() { panel.classList.contains("open") ? close() : open(); }
    fab.addEventListener("click", open);
    $(".close").addEventListener("click", close);

    // API pública: el dueño abre el chat desde su propio botón, donde quiera.
    window.WalkyUp = { open: open, close: close, toggle: toggle };
    document.addEventListener("click", function (e) {
      var t = e.target && e.target.closest && e.target.closest("[data-walkyup-open]");
      if (t) { e.preventDefault(); open(); }
    });

    // ---- Campo de texto (autogrow hasta ~5 líneas) ----
    var ta = $(".ta"), sendBtn = $(".send"), typing = $(".typing");
    function autogrow() { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 132) + "px"; }
    function canSend() { return ta.value.trim().length > 0 || attachments.length > 0; }
    function syncSend() { if (state === "idle") sendBtn.disabled = !canSend(); }
    ta.addEventListener("input", function () { autogrow(); syncSend(); });
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (state === "idle") send(); }
    });

    // ---- Máquina de estados: idle | thinking | responding ----
    var state = "idle";
    var pendingTimer = null;
    var ctrl = null; // AbortController para la Fase 8 (fetch/stream real)
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
      // Mostrar el mensaje del usuario (texto y/o fotos, solo local)
      msgs.appendChild(bubble(v, true, atts));
      hist.push({ x: v, o: 1, a: atts }); persist();
      // TODO Fase 8: onSendAttachments(attachments) -> subir/enviar al backend (hoy NO hay red)
      clearAttachments();
      ta.value = ""; autogrow(); syncHero(); scroll();

      setState("thinking");
      try { ctrl = new AbortController(); } catch (e) { ctrl = null; }
      // Hoy la respuesta es fija: simulamos ~1,2 s de "pensando" para ver los estados.
      pendingTimer = setTimeout(function () {
        setState("responding");
        var r = PENDING_REPLY;
        msgs.appendChild(bubble(r, false)); hist.push({ x: r, o: 0 }); persist();
        scroll();
        setState("idle");
        ta.focus();
      }, 1200);
    }

    function stop() {
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      try { if (ctrl) ctrl.abort(); } catch (e) {}
      ctrl = null;
      // Se conserva lo ya mostrado (marcado como detenido si había texto parcial).
      var last = msgs.querySelector(".msg.in:last-child .tx");
      if (state === "responding" && last && last.textContent) {
        var tag = document.createElement("span"); tag.className = "stopped"; tag.textContent = " (detenido)"; last.appendChild(tag);
      }
      setState("idle");
      ta.focus();
    }

    sendBtn.addEventListener("click", function () { if (state === "idle") send(); else stop(); });

    // ---- Fotos (+): solo lado navegador, apagado en producción ----
    var attachments = []; // { url, blob }
    var fileInp = $(".fileinp"), thumbs = $(".thumbs"), atterr = $(".atterr");
    function showAttErr(msg) { if (!atterr) return; atterr.textContent = msg; atterr.hidden = false; setTimeout(function () { atterr.hidden = true; }, 3500); }
    function renderThumbs() {
      thumbs.innerHTML = "";
      attachments.forEach(function (a, idx) {
        var t = document.createElement("div"); t.className = "thumb";
        var im = document.createElement("img"); im.src = a.url; im.alt = "";
        var x = document.createElement("button"); x.className = "thumbx"; x.setAttribute("aria-label", "Quitar foto " + (idx + 1));
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
      var url = URL.createObjectURL(file);
      var img = new Image();
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

    // ---- Menú de ajustes ----
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

    // ---- Nuevo chat: borra el historial de esta sesión y vuelve al inicio ----
    $(".newchat").addEventListener("click", function () {
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      try { if (ctrl) ctrl.abort(); } catch (e) {} ctrl = null;
      setState("idle");
      hist = []; persist();
      msgs.innerHTML = "";
      msgs.appendChild(bubble(welcome, false));
      clearAttachments();
      lastTitleIdx = -1; heroTitle.textContent = EMPTY_TITLES[pickTitle()];
      syncHero(); scroll();
      ta.focus();
    });

    autogrow();
  }

  function esc(s) { return String(s).replace(/"/g, "&quot;"); }

  var CSS =
    ':host{all:initial;}' +
    '*{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;}' +
    // ----- Launcher -----
    '.fab{position:fixed;right:20px;bottom:20px;width:52px;height:52px;border:0;border-radius:16px;cursor:pointer;display:grid;place-items:center;background:#111;color:#fff;box-shadow:0 10px 24px rgba(0,0,0,.26);overflow:hidden;}' +
    '.fab.isimg{background:#111;} .fab img{width:100%;height:100%;object-fit:cover;} .fab svg{width:24px;height:24px;}' +
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
    // ----- Encabezado (sin línea divisoria) -----
    '.head{display:flex;align-items:center;gap:9px;padding:12px 12px 6px;}' +
    '.ava{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;flex-shrink:0;overflow:hidden;background:var(--ava-bg);color:var(--ava-ink);}' +
    '.ava img{width:100%;height:100%;object-fit:cover;} .ava svg{width:60%;height:60%;}' +
    '.nm{font-weight:650;font-size:.95rem;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;} .sp{margin-left:auto;}' +
    '.ico{width:34px;height:34px;border-radius:9px;border:0;background:none;color:var(--ink2);display:grid;place-items:center;cursor:pointer;}' +
    '.ico:hover{background:var(--surface);color:var(--ink);} .ico svg{width:18px;height:18px;} .ico.menu svg{width:19px;height:19px;}' +
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
    '.stopped{color:var(--ink2);font-style:italic;}' +
    '.msg-atts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;justify-content:flex-end;}' +
    '.msg-atts img{width:92px;height:92px;object-fit:cover;border-radius:12px;border:1px solid var(--line);}' +
    // ----- Puntos de carga -----
    '.typing{display:flex;align-items:center;gap:6px;padding:2px 2px 10px;align-self:flex-start;}' +
    '.typing[hidden]{display:none;}' +
    '.typing .dot{width:8px;height:8px;border-radius:50%;background:var(--dot);animation:wu-blink 1.2s infinite ease-in-out;}' +
    '.typing .dot:nth-child(2){animation-delay:.2s;} .typing .dot:nth-child(3){animation-delay:.4s;}' +
    '@keyframes wu-blink{0%,80%,100%{background:var(--dot);transform:translateY(0)}40%{background:var(--dot-on);transform:translateY(-3px)}}' +
    '@media(prefers-reduced-motion:reduce){.typing .dot{animation:none;} .typing .dot:nth-child(2){background:var(--dot-on);}}' +
    '.sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;}' +
    // ----- Composer -----
    '.composer-wrap{padding:6px 14px 8px;}' +
    '.composer{display:grid;gap:7px 8px;align-items:end;background:var(--surface);border:1px solid var(--line);border-radius:24px;padding:7px 8px 7px 12px;' +
      'grid-template-columns:auto 1fr auto;grid-template-areas:"thumbs thumbs thumbs" "plus text send";}' +
    '.composer:focus-within{border-color:var(--ink2);}' +
    '.thumbs{grid-area:thumbs;display:flex;flex-wrap:wrap;gap:7px;padding:4px 2px 2px;}' +
    '.thumbs[hidden]{display:none;}' +
    '.thumb{position:relative;width:54px;height:54px;border-radius:11px;overflow:hidden;background:var(--thumb);border:1px solid var(--line);}' +
    '.thumb img{width:100%;height:100%;object-fit:cover;}' +
    '.thumbx{position:absolute;top:2px;right:2px;width:20px;height:20px;border:0;border-radius:7px;background:rgba(0,0,0,.6);color:#fff;display:grid;place-items:center;cursor:pointer;} .thumbx svg{width:13px;height:13px;}' +
    '.ta{grid-area:text;width:100%;border:0;background:none;color:var(--ink);resize:none;outline:none;font:inherit;font-size:16px;line-height:1.4;padding:7px 2px;min-height:36px;max-height:132px;overflow-y:auto;scrollbar-width:thin;}' +
    '.ta::placeholder{color:var(--ink2);}' +
    '.plus{grid-area:plus;align-self:end;width:36px;height:36px;border-radius:50%;border:0;background:none;color:var(--ink2);display:grid;place-items:center;cursor:pointer;} .plus:hover{background:var(--surface2);color:var(--ink);} .plus svg{width:20px;height:20px;} .plus[hidden]{display:none;}' +
    '.send{grid-area:send;align-self:end;width:36px;height:36px;flex-shrink:0;border:0;border-radius:50%;background:var(--send-bg);color:var(--send-ink);display:grid;place-items:center;cursor:pointer;transition:background .15s,opacity .15s;}' +
    '.send:disabled{opacity:.35;cursor:default;} .send svg{width:18px;height:18px;} .send .sqr{display:none;width:11px;height:11px;border-radius:3px;background:var(--stop-ink);}' +
    '.send.busy{background:var(--stop-bg);} .send.busy .sicon{display:none;} .send.busy .sqr{display:block;} .send.busy{opacity:1;}' +
    // ----- Pie -----
    '.foot{text-align:center;padding:9px 6px 2px;} .foot .disc{margin:0;font-size:.68rem;line-height:1.45;color:var(--ink2);} .foot .brand{margin:5px 0 0;font-size:.66rem;color:var(--ink2);} .foot a{color:var(--ink2);text-decoration:none;font-weight:600;} .foot a:hover{text-decoration:underline;}' +
    '.atterr{color:#e5484d;font-size:.74rem;text-align:center;padding:4px 6px 0;} .atterr[hidden]{display:none;}' +
    // ----- Hoja de ajustes -----
    '.scrim{position:absolute;inset:0;background:rgba(0,0,0,.45);opacity:0;pointer-events:none;transition:opacity .2s;}' +
    '.panel.sheet-open .scrim{opacity:1;pointer-events:auto;}' +
    '.sheet{position:absolute;left:0;right:0;bottom:0;background:var(--bg);border-top:1px solid var(--line);border-radius:18px 18px 0 0;transform:translateY(100%);transition:transform .24s cubic-bezier(.4,0,.2,1);padding-bottom:env(safe-area-inset-bottom);}' +
    '.panel.sheet-open .sheet{transform:translateY(0);}' +
    '.shead{display:flex;align-items:center;justify-content:center;position:relative;padding:14px;border-bottom:1px solid var(--line);}' +
    '.sx{position:absolute;right:10px;top:50%;transform:translateY(-50%);width:30px;height:30px;border:0;background:none;color:var(--ink2);cursor:pointer;display:grid;place-items:center;} .sx svg{width:17px;height:17px;}' +
    '.row{display:flex;align-items:center;gap:12px;padding:13px 18px;color:var(--ink);cursor:pointer;text-decoration:none;font-size:.9rem;}' +
    '.row:hover{background:var(--surface);} .rico{width:19px;height:19px;color:var(--ink2);flex-shrink:0;}' +
    '.themeseg{display:inline-flex;background:var(--surface);border:1px solid var(--line);border-radius:9px;padding:3px;}' +
    '.themeseg button{border:0;background:none;border-radius:6px;padding:4px 11px;font:inherit;font-size:.78rem;font-weight:600;color:var(--ink2);cursor:pointer;} .themeseg button.on{background:var(--bg);color:var(--ink);}' +
    '.sfoot{text-align:center;font-size:.72rem;color:var(--ink2);padding:12px;border-top:1px solid var(--line);} .sfoot a{color:var(--ink2);text-decoration:none;}' +
    // ----- Móvil: hoja que sube desde abajo -----
    '@media(max-width:640px){' +
      '.panel{left:0;right:0;top:auto;bottom:0;width:auto;max-width:100vw;height:92dvh;max-height:92dvh;border-radius:20px 20px 0 0;border-left:0;border-right:0;border-bottom:0;' +
        'padding-bottom:env(safe-area-inset-bottom);}' +
      '.panel.open{animation:wu-up .28s cubic-bezier(.2,.8,.2,1);}' +
      '@keyframes wu-up{from{transform:translateY(100%)}to{transform:none}}' +
      '.herotitle{font-size:1.5rem;}' +
      '.composer{grid-template-columns:auto 1fr auto;grid-template-areas:"thumbs thumbs thumbs" "text text text" "plus . send";padding:8px 10px 10px;border-radius:22px;}' +
      '.ta{padding:6px 4px 2px;}' +
      '.fab{right:16px;bottom:16px;}' +
    '}';
})();
