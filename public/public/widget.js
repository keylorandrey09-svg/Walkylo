/* ============================================================
   WalkyLo — widget.js  (v1 visual, respuestas simuladas)
   Widget de chat embebible y auto-contenido.
   Se pega en la app de otro con una sola línea:
     <script src="https://walkylo.app/widget.js" data-app="mi-app" defer></script>
   Todo (HTML + estilos) va aislado acá adentro con prefijo wlw-
   para no chocar con el diseño del cliente.
   ============================================================ */
(function () {
  "use strict";

  // Evita insertarlo dos veces si el script se carga repetido.
  if (window.__walkyloLoaded) return;
  window.__walkyloLoaded = true;

  // Paleta WalkyLo (misma que la landing).
  var C = {
    bg: "#FAFAFA",
    surface: "#FFFFFF",
    ink: "#18181b",
    muted: "#71717A",
    line: "#E8E8EB",
    accent: "#0164FD",
    accentSoft: "#E7F0FF",
    active: "#34d399" // verde: SOLO estado activo ("en línea")
  };

  // --- Respuestas simuladas (se reemplazan por la IA real más adelante) ---
  // Cada regla: si el mensaje incluye alguna palabra, responde eso.
  var REGLAS = [
    {
      claves: ["hola", "buenas", "hey"],
      texto: "¡Hola! Soy el asistente de esta app. Contame qué necesitás y te ayudo."
    },
    {
      claves: ["contraseña", "clave", "password"],
      texto: "Para cambiar tu contraseña entrá a Ajustes → Seguridad y tocá “Cambiar contraseña”."
    },
    {
      claves: ["precio", "plan", "cuesta", "pagar"],
      texto: "Los planes están en la sección de Precios. Si querés, te paso el link de soporte para dudas de facturación.",
      chip: { texto: "Ir a soporte", href: "#" }
    },
    {
      claves: ["soporte", "ayuda", "humano", "contacto"],
      texto: "Te dejo el contacto de soporte por si preferís hablar con una persona.",
      chip: { texto: "Escribir a soporte", href: "#" }
    }
  ];

  var RESPUESTA_DEFECTO =
    "Todavía estoy en modo demo con respuestas de ejemplo. Cuando conectemos la IA voy a responder con la info real de tu app.";

  function responderSimulado(texto) {
    var t = texto.toLowerCase();
    for (var i = 0; i < REGLAS.length; i++) {
      var r = REGLAS[i];
      for (var j = 0; j < r.claves.length; j++) {
        if (t.indexOf(r.claves[j]) !== -1) return r;
      }
    }
    return { texto: RESPUESTA_DEFECTO };
  }

  // ---------------- Estilos aislados ----------------
  var css = `
  .wlw-root{position:fixed;right:20px;bottom:20px;z-index:2147483000;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    font-size:15px;line-height:1.5;color:${C.ink};}
  .wlw-root *{box-sizing:border-box;}
  .wlw-launcher{width:56px;height:56px;border:0;border-radius:50%;
    background:${C.accent};color:#fff;cursor:pointer;display:flex;
    align-items:center;justify-content:center;margin-left:auto;
    box-shadow:0 10px 26px -8px rgba(1,100,253,.55);transition:transform .15s ease;}
  .wlw-launcher:hover{transform:translateY(-2px);}
  .wlw-launcher svg{width:24px;height:24px;}
  .wlw-panel{position:absolute;right:0;bottom:72px;width:min(340px,calc(100vw - 40px));
    height:min(520px,calc(100vh - 120px));background:${C.surface};
    border:1px solid ${C.line};border-radius:18px;display:flex;flex-direction:column;
    overflow:hidden;box-shadow:0 24px 60px -20px rgba(24,24,27,.35);
    opacity:0;transform:translateY(10px) scale(.98);transform-origin:bottom right;
    pointer-events:none;transition:opacity .18s ease,transform .18s ease;}
  .wlw-root.wlw-open .wlw-panel{opacity:1;transform:none;pointer-events:auto;}
  .wlw-head{display:flex;align-items:center;gap:8px;padding:14px;
    border-bottom:1px solid ${C.line};}
  .wlw-title{font-weight:700;font-size:15px;}
  .wlw-status{display:inline-flex;align-items:center;gap:6px;margin-left:auto;
    font-size:12px;color:${C.muted};}
  .wlw-dot{width:7px;height:7px;border-radius:50%;background:${C.active};}
  .wlw-close{border:0;background:transparent;color:${C.muted};font-size:20px;
    line-height:1;cursor:pointer;padding:0 2px;}
  .wlw-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;
    padding:16px 14px;display:flex;flex-direction:column;gap:10px;background:${C.bg};}
  .wlw-msg{max-width:85%;padding:10px 13px;border-radius:14px;font-size:14px;
    line-height:1.45;white-space:pre-wrap;word-wrap:break-word;}
  .wlw-msg-user{align-self:flex-end;background:${C.accent};color:#fff;
    border-bottom-right-radius:5px;}
  .wlw-msg-bot{align-self:flex-start;background:${C.surface};
    border:1px solid ${C.line};border-bottom-left-radius:5px;}
  .wlw-chip{display:inline-block;margin-top:10px;padding:6px 11px;border-radius:999px;
    background:${C.accentSoft};color:${C.accent};font-size:13px;font-weight:500;
    text-decoration:none;}
  .wlw-foot{display:flex;gap:8px;padding:12px 14px;border-top:1px solid ${C.line};
    background:${C.surface};}
  .wlw-input{flex:1;border:1px solid ${C.line};border-radius:10px;padding:10px 12px;
    font:inherit;font-size:14px;outline:none;}
  .wlw-input:focus{border-color:${C.accent};}
  .wlw-send{border:0;border-radius:10px;background:${C.accent};color:#fff;
    padding:0 14px;font-weight:600;cursor:pointer;}
  .wlw-send:disabled{opacity:.5;cursor:default;}
  @media (prefers-reduced-motion: reduce){
    .wlw-panel{transition:none;} .wlw-launcher{transition:none;}
  }`;

  // ---------------- Construcción del DOM ----------------
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function init() {
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    var root = el("div", "wlw-root");

    // Panel
    var panel = el("div", "wlw-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Chat de ayuda");

    var head = el("div", "wlw-head");
    head.appendChild(el("span", "wlw-title", "WalkyLo"));
    var status = el("span", "wlw-status", '<span class="wlw-dot"></span>en línea');
    head.appendChild(status);
    var closeBtn = el("button", "wlw-close", "×");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Cerrar chat");
    head.appendChild(closeBtn);

    var body = el("div", "wlw-body");

    var foot = el("div", "wlw-foot");
    var input = el("input", "wlw-input");
    input.type = "text";
    input.placeholder = "Escribí tu pregunta…";
    input.setAttribute("aria-label", "Escribí tu pregunta");
    var send = el("button", "wlw-send", "Enviar");
    send.type = "button";
    foot.appendChild(input);
    foot.appendChild(send);

    panel.appendChild(head);
    panel.appendChild(body);
    panel.appendChild(foot);

    // Launcher
    var launcher = el("button", "wlw-launcher");
    launcher.type = "button";
    launcher.setAttribute("aria-label", "Abrir chat de ayuda");
    launcher.setAttribute("aria-expanded", "false");
    launcher.innerHTML =
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M12 3c5 0 9 3.4 9 7.6 0 4.2-4 7.6-9 7.6-1 0-2-.13-2.9-.37L4 20l1-3.3C3.7 15.4 3 13.1 3 10.6 3 6.4 7 3 12 3Z"/></svg>';

    root.appendChild(panel);
    root.appendChild(launcher);
    document.body.appendChild(root);

    // ---------------- Comportamiento ----------------
    function scrollAbajo() { body.scrollTop = body.scrollHeight; }

    function agregarMensaje(texto, quien, chip) {
      var msg = el("div", "wlw-msg " + (quien === "user" ? "wlw-msg-user" : "wlw-msg-bot"));
      msg.textContent = texto;
      if (chip) {
        var a = el("a", "wlw-chip", chip.texto);
        a.href = chip.href || "#";
        a.target = "_blank";
        a.rel = "noopener";
        msg.appendChild(a);
      }
      body.appendChild(msg);
      scrollAbajo();
    }

    function setOpen(open) {
      root.classList.toggle("wlw-open", open);
      launcher.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) setTimeout(function () { input.focus(); }, 60);
    }

    function enviar() {
      var texto = input.value.trim();
      if (!texto) return;
      agregarMensaje(texto, "user");
      input.value = "";
      // Pequeña pausa para simular que "piensa".
      setTimeout(function () {
        var r = responderSimulado(texto);
        agregarMensaje(r.texto, "bot", r.chip);
      }, 350);
    }

    launcher.addEventListener("click", function () {
      setOpen(!root.classList.contains("wlw-open"));
    });
    closeBtn.addEventListener("click", function () { setOpen(false); launcher.focus(); });
    send.addEventListener("click", enviar);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); enviar(); }
    });

    // Mensaje de bienvenida.
    agregarMensaje("¡Hola! Soy el asistente de esta app. ¿En qué te ayudo?", "bot");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
