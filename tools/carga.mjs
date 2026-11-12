// Prueba de carga del chat de Walkylet.
// Uso (Node 18 o más nuevo):   node carga.mjs humo      (40 mensajes, 4 a la vez)
//                              node carga.mjs rafaga    (80 mensajes, 16 a la vez)
//                              node carga.mjs sostenida (250 mensajes, 5 a la vez)
//                              node carga.mjs todo      (las tres, con pausas)
// Cada mensaje usa un visitante nuevo. Quedan conversaciones de prueba en el widget (visitor_id que empieza con "carga-").
// Total de "todo": 370 mensajes. El tope diario del widget es 500, y ya hay unos 70 en las últimas 24 h: no la corras dos veces el mismo día.

const URL = "https://ejbtgkvlrkecnslpapyd.supabase.co/functions/v1/chat";
const WIDGET = "2075b5e2-207f-40ab-a621-0d70620e9ec3";
const PREGUNTAS = [
  "¿Dónde cambio el tema a oscuro?", "¿Cómo creo una automatización?", "¿Dónde elimino mi cuenta?", "¿Dónde cambio de plan?",
  "¿Dónde veo los mensajes enviados?", "¿Cómo contacto a soporte?", "¿Funciona con TikTok?", "¿Hay modo nocturno?",
  "¿Cómo borro mi cuenta?", "Me pasé del límite de mensajes, ¿qué hago?", "¿Dónde veo cuántos mensajes me quedan este mes?",
  "¿Puedo usar un emoji como palabra clave?", "¿Cuánto tarda en quedar lista una automatización?",
  "¿Pueden ver mi contraseña de Instagram?", "¿Cómo agrego otra publicación a la misma automatización?",
  "¿Dónde están las notificaciones?", "¿Puedo pausar una automatización?", "¿Funciona con WhatsApp?", "How do I contact support?",
  "¿Cuánto cuesta el plan Pro?", "¿Qué incluye el plan Max?", "¿Cómo cancelo mi plan?", "¿Cómo conecto mi cuenta de Instagram?",
];
const corrida = Math.random().toString(36).slice(2, 8);
let contador = 0;

async function una() {
  const i = contador++;
  const q = PREGUNTAS[i % PREGUNTAS.length];
  const t0 = performance.now();
  let status = 0, answer = "", err = "";
  try {
    const r = await fetch(URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ widget_id: WIDGET, visitor_id: `carga-${corrida}-${i}`, message: q }),
    });
    status = r.status;
    const j = await r.json().catch(() => ({}));
    answer = String(j.answer ?? j.error ?? "");
  } catch (e) { err = String(e).slice(0, 80); }
  const ms = Math.round(performance.now() - t0);
  const busy = /^(Ahora mismo no puedo|Estoy atendiendo|No pude responder)/.test(answer);
  return { i, status, ms, ok: status === 200 && answer.length > 0 && !busy, busy, err, answer: answer.slice(0, 70) };
}

const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };

async function etapa(nombre, total, conc) {
  console.log(`\n=== ${nombre}: ${total} mensajes, ${conc} a la vez ===`);
  const res = []; let lanzados = 0, fallos = 0, abortada = false;
  const t0 = performance.now();
  async function trabajador() {
    while (!abortada && lanzados < total) {
      lanzados++;
      const r = await una(); res.push(r);
      if (!r.ok) { fallos++; if (fallos >= 10) abortada = true; }
    }
  }
  await Promise.all(Array.from({ length: conc }, trabajador));
  const seg = (performance.now() - t0) / 1000;
  const ok = res.filter((r) => r.ok).length;
  const codigos = {};
  for (const r of res) codigos[r.status || r.err || "sin respuesta"] = (codigos[r.status || r.err || "sin respuesta"] ?? 0) + 1;
  const ms = res.map((r) => r.ms);
  console.log(`respondidos de verdad: ${ok} de ${res.length} (${((ok / Math.max(1, res.length)) * 100).toFixed(1)}%)`);
  console.log(`códigos HTTP: ${JSON.stringify(codigos)}`);
  console.log(`mensajes "ocupado / más tarde / error": ${res.filter((r) => r.busy).length}`);
  console.log(`tiempo por respuesta: mediana ${pct(ms, 0.5)} ms | p95 ${pct(ms, 0.95)} ms | máximo ${Math.max(0, ...ms)} ms`);
  console.log(`ritmo: ${(res.length / seg * 60).toFixed(0)} mensajes por minuto (${seg.toFixed(0)} s en total)`);
  for (const r of res.filter((x) => !x.ok).slice(0, 5)) console.log(`  fallo #${r.i}: HTTP ${r.status} ${r.err} "${r.answer}"`);
  if (abortada) console.log("  ** ETAPA ABORTADA: 10 fallos. No sigo para no gastar cupo. **");
  return { ok, total: res.length, abortada };
}

const pausa = (s) => new Promise((r) => setTimeout(r, s * 1000));
const modo = process.argv[2] ?? "humo";
console.log(`Corrida ${corrida}. Visitantes: carga-${corrida}-N`);
if (modo === "humo") await etapa("HUMO", 40, 4);
else if (modo === "rafaga") await etapa("RÁFAGA", 80, 16);
else if (modo === "sostenida") await etapa("SOSTENIDA", 250, 5);
else if (modo === "todo") {
  const a = await etapa("HUMO", 40, 4); if (a.abortada) process.exit(1);
  await pausa(20);
  const b = await etapa("RÁFAGA", 80, 16); if (b.abortada) process.exit(1);
  await pausa(20);
  await etapa("SOSTENIDA", 250, 5);
} else console.log("Modo desconocido. Usá: humo | rafaga | sostenida | todo");
console.log("\nListo. Avisame y reviso los registros y la base.");
