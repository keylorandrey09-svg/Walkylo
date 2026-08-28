/*! WalkyUp widget runtime — w.js
 *  Un solo archivo para todos los clientes. Lee su data-id, trae la config
 *  de ese widget desde Supabase y se dibuja aislado (Shadow DOM).
 *  El asistente responde de verdad cuando se conecte la IA (Edge Function chat).
 */
(function () {
  "use strict";

  var SUPA_URL = "https://ejbtgkvlrkecnslpapyd.supabase.co";
  var SUPA_KEY = "sb_publishable_igO0MoubT3Na_F0RPdA2hQ_2T-qkYMQ";

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
  if (window.__walkyupLoaded) { return; } window.__walkyupLoaded = true;

  // ---- 2) Traer la config pública del widget ----
  fetch(SUPA_URL + "/rest/v1/rpc/get_widget_public", {
    method: "POST",
    headers: { "apikey": SUPA_KEY, "Authorization": "Bearer " + SUPA_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ widget_id: dataId })
  })
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) { render((rows && rows[0]) || {}); })
    .catch(function () { render({}); });

  // ---- 3) Dibujar el widget (aislado con Shadow DOM) ----
  function render(cfg) {
    var name = cfg.name || "Asistente";
    var accent = cfg.accent || "#0164FD";
    var welcome = cfg.welcome || "¡Hola! ¿En qué te puedo ayudar?";
    var avatar = cfg.avatar || "";
    var email = cfg.contact_email || "";
    var privacy = cfg.privacy_url || "";

    var isImg = !!avatar && (avatar.indexOf("data:") === 0 || /^https?:\/\//.test(avatar));
    var spark = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/></svg>';
    var avaInner = isImg ? '<img src="' + esc(avatar) + '" alt="">' : spark;

    var host = document.createElement("div");
    host.setAttribute("id", "walkyup-widget");
    host.style.cssText = "position:fixed;z-index:2147483647;top:0;left:0;";
    document.body.appendChild(host);
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

    root.innerHTML =
      '<style>' + CSS + '</style>' +
      '<button class="fab" part="fab" aria-label="Abrir chat">' + avaInner + '</button>' +
      '<div class="panel" data-theme="dark" aria-hidden="true">' +
        '<div class="head">' +
          '<span class="ava sm">' + avaInner + '</span>' +
          '<span class="nm"></span>' +
          '<span class="sp"></span>' +
          '<button class="ico menu" aria-label="Ajustes"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg></button>' +
          '<button class="ico close" aria-label="Cerrar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
        '</div>' +
        '<div class="body">' +
          '<div class="intro"><span class="ava lg">' + avaInner + '</span><h2 class="nm2"></h2>' +
            '<p>Las respuestas pueden no ser siempre exactas. Al usar este chat aceptás la recopilación de datos según la política del sitio.</p></div>' +
          '<div class="day">Hoy</div><div class="msgs"></div>' +
        '</div>' +
        '<div class="inputbar"><input class="inp" type="text" placeholder="Escribí tu mensaje…" autocomplete="off"/>' +
          '<button class="send" aria-label="Enviar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></div>' +
        '<div class="foot">AI Agent powered by · <a href="https://walkyup.app" target="_blank" rel="noopener">WalkyUp</a></div>' +
        '<div class="scrim"></div>' +
        '<div class="sheet"><div class="shead"><b>Ajustes</b><button class="sx" aria-label="Cerrar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div>' +
          '<a class="row mail"><svg class="rico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>Escribir por correo</a>' +
          '<div class="row">Tema<span class="sp"></span><span class="themeseg"><button data-theme="light">Claro</button><button data-theme="dark" class="on">Oscuro</button></span></div>' +
          '<div class="sfoot">© 2026 · <a class="priv" target="_blank" rel="noopener">Privacidad</a></div></div>' +
      '</div>';

    // Aplicar config
    var $ = function (s) { return root.querySelector(s); };
    var $$ = function (s) { return root.querySelectorAll(s); };
    $(".fab").style.background = accent;
    var panel = $(".panel");
    panel.style.setProperty("--accent", accent);
    $(".nm").textContent = name;
    $(".nm2").textContent = name;
    Array.prototype.forEach.call($$(".ava"), function (a) { if (!isImg) a.style.background = accent; else a.style.background = "transparent"; });
    var mail = $(".mail"); if (email) mail.setAttribute("href", "mailto:" + email); else mail.style.display = "none";
    var priv = $(".priv"); if (privacy) priv.setAttribute("href", privacy); else priv.parentNode.style.display = "none";

    // Mensaje de bienvenida
    var msgs = $(".msgs"), body = $(".body");
    msgs.appendChild(bubble(welcome, false));

    function bubble(text, out) {
      var el = document.createElement("div");
      el.className = "msg " + (out ? "out" : "in");
      el.appendChild(document.createTextNode(text));
      var t = document.createElement("span"); t.className = "t"; t.textContent = hhmm(); el.appendChild(t);
      return el;
    }
    function scroll() { body.scrollTop = body.scrollHeight; }

    // Abrir / cerrar
    function open() { panel.classList.add("open"); panel.setAttribute("aria-hidden", "false"); $(".fab").style.display = "none"; setTimeout(function () { $(".inp").focus(); }, 250); }
    function close() { panel.classList.remove("open"); panel.setAttribute("aria-hidden", "true"); $(".fab").style.display = ""; }
    $(".fab").addEventListener("click", open);
    $(".close").addEventListener("click", close);

    // Enviar (sin IA todavía: respuesta de espera, honesta)
    var inp = $(".inp");
    function send() {
      var v = inp.value.trim(); if (!v) return;
      msgs.appendChild(bubble(v, true)); inp.value = ""; scroll();
      setTimeout(function () { msgs.appendChild(bubble("¡Gracias por tu mensaje! El asistente estará disponible muy pronto.", false)); scroll(); }, 700);
    }
    $(".send").addEventListener("click", send);
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") send(); });

    // Menú de ajustes
    $(".menu").addEventListener("click", function () { panel.classList.add("sheet-open"); });
    $(".sx").addEventListener("click", function () { panel.classList.remove("sheet-open"); });
    $(".scrim").addEventListener("click", function () { panel.classList.remove("sheet-open"); });
    $(".themeseg").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      panel.setAttribute("data-theme", b.getAttribute("data-theme"));
      Array.prototype.forEach.call(this.querySelectorAll("button"), function (x) { x.classList.toggle("on", x === b); });
    });
  }

  function hhmm() { var d = new Date(); return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); }
  function esc(s) { return String(s).replace(/"/g, "&quot;"); }

  var CSS =
    ':host{all:initial;}' +
    '*{box-sizing:border-box;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}' +
    '.fab{position:fixed;right:20px;bottom:20px;width:58px;height:58px;border:0;border-radius:18px;cursor:pointer;display:grid;place-items:center;box-shadow:0 12px 30px rgba(0,0,0,.28);overflow:hidden;}' +
    '.fab img{width:100%;height:100%;object-fit:cover;} .fab svg{width:26px;height:26px;}' +
    '.panel{--accent:#0164FD;--bg:#0e0f12;--surface:#17181c;--ink:#f4f5f7;--ink2:#9aa0a8;--line:rgba(255,255,255,.09);--in:#1e2025;' +
      'position:fixed;right:20px;bottom:20px;width:372px;height:min(600px,calc(100vh - 96px));background:var(--bg);color:var(--ink);' +
      'border:1px solid var(--line);border-radius:20px;overflow:hidden;display:none;flex-direction:column;box-shadow:0 26px 64px rgba(0,0,0,.32);}' +
    '.panel.open{display:flex;animation:wu-in .22s ease;}' +
    '.panel[data-theme=light]{--bg:#fff;--surface:#fff;--ink:#0a0a0a;--ink2:#5b6472;--line:#ececf1;--in:#f2f4f7;}' +
    '@keyframes wu-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}' +
    '.head{display:flex;align-items:center;gap:10px;padding:12px 13px;border-bottom:1px solid var(--line);}' +
    '.ava{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;flex-shrink:0;overflow:hidden;}' +
    '.ava img{width:100%;height:100%;object-fit:cover;} .ava svg{width:60%;height:60%;} .ava.lg{width:74px;height:74px;} .ava.lg svg{width:56%;height:56%;}' +
    '.nm{font-weight:700;font-size:.96rem;} .sp{margin-left:auto;}' +
    '.ico{width:34px;height:34px;border-radius:9px;border:1px solid var(--line);background:none;color:var(--ink2);display:grid;place-items:center;cursor:pointer;}' +
    '.ico svg{width:17px;height:17px;}' +
    '.body{flex:1;overflow-y:auto;padding:22px 15px 6px;display:flex;flex-direction:column;scrollbar-width:none;-ms-overflow-style:none;}' +
    '.body::-webkit-scrollbar{width:0;height:0;display:none;}' +
    '.intro{text-align:center;display:flex;flex-direction:column;align-items:center;gap:9px;}' +
    '.intro h2{margin:2px 0 0;font-size:1.15rem;font-weight:800;} .intro p{margin:0;font-size:.82rem;line-height:1.5;color:var(--ink2);max-width:290px;}' +
    '.day{align-self:center;font-size:.73rem;color:var(--ink2);margin:20px 0 12px;}' +
    '.msgs{display:flex;flex-direction:column;gap:9px;}' +
    '.msg{max-width:82%;padding:9px 12px;border-radius:15px;font-size:.88rem;line-height:1.45;overflow-wrap:anywhere;word-break:break-word;}' +
    '.msg .t{display:block;font-size:.64rem;margin-top:4px;opacity:.6;}' +
    '.in{align-self:flex-start;background:var(--in);border-bottom-left-radius:5px;color:var(--ink);}' +
    '.out{align-self:flex-end;background:var(--accent);color:#fff;border-bottom-right-radius:5px;}' +
    '.inputbar{display:flex;align-items:center;gap:7px;padding:11px;border-top:1px solid var(--line);}' +
    '.inp{flex:1;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:12px;padding:11px 13px;font-size:.9rem;outline:none;}' +
    '.inp::placeholder{color:var(--ink2);} .inp:focus{border-color:var(--accent);}' +
    '.send{width:42px;height:42px;flex-shrink:0;border:0;border-radius:12px;background:var(--accent);color:#fff;display:grid;place-items:center;cursor:pointer;} .send svg{width:19px;height:19px;}' +
    '.foot{text-align:center;font-size:.7rem;color:var(--ink2);padding:0 0 10px;} .foot a{color:var(--ink2);text-decoration:none;font-weight:600;}' +
    '.scrim{position:absolute;inset:0;background:rgba(0,0,0,.45);opacity:0;pointer-events:none;transition:opacity .2s;}' +
    '.panel.sheet-open .scrim{opacity:1;pointer-events:auto;}' +
    '.sheet{position:absolute;left:0;right:0;bottom:0;background:var(--surface);border-top:1px solid var(--line);border-radius:18px 18px 0 0;transform:translateY(100%);transition:transform .24s cubic-bezier(.4,0,.2,1);}' +
    '.panel.sheet-open .sheet{transform:translateY(0);}' +
    '.shead{display:flex;align-items:center;justify-content:center;position:relative;padding:14px;border-bottom:1px solid var(--line);}' +
    '.sx{position:absolute;right:10px;top:50%;transform:translateY(-50%);width:30px;height:30px;border:0;background:none;color:var(--ink2);cursor:pointer;} .sx svg{width:16px;height:16px;}' +
    '.row{display:flex;align-items:center;gap:12px;padding:13px 18px;color:var(--ink);cursor:pointer;text-decoration:none;font-size:.9rem;}' +
    '.rico{width:19px;height:19px;color:var(--ink2);flex-shrink:0;}' +
    '.themeseg{display:inline-flex;background:var(--in);border:1px solid var(--line);border-radius:8px;padding:3px;}' +
    '.themeseg button{border:0;background:none;border-radius:6px;padding:4px 10px;font-size:.75rem;font-weight:600;color:var(--ink2);cursor:pointer;} .themeseg button.on{background:var(--surface);color:var(--ink);}' +
    '.sfoot{text-align:center;font-size:.72rem;color:var(--ink2);padding:12px;border-top:1px solid var(--line);} .sfoot a{color:var(--ink2);text-decoration:none;}' +
    '@media(max-width:520px){.panel{left:0;right:0;top:0;width:auto;height:100dvh;border-radius:0;border:0;}.fab{right:16px;bottom:16px;}}';
})();
