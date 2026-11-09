// supabase/functions/chat/chat_test.ts   Ejecutar: deno test -A chat_test.ts
// Sin red ni claves: almacén en memoria e IA falsa.
import { buildQuery, detectNoAnswer, formatSections, instructions, LIMITS, NO_ANSWER, type SectionHit, type Widget } from "./core.ts";
import { handle, type Store } from "./handler.ts";
import type { AiArgs, AiRaw } from "./core.ts";

function eq(a: unknown, b: unknown, msg: string) { if (a !== b) throw new Error(`${msg}: esperado ${JSON.stringify(b)}, salió ${JSON.stringify(a)}`); }
function ok(c: unknown, msg: string) { if (!c) throw new Error(msg); }

const OWNER = "11111111-1111-4111-8111-111111111111";
const WID = "22222222-2222-4222-8222-222222222222";
const baseWidget = (over: Partial<Widget> = {}): Widget => ({
  id: WID, user_id: OWNER, name: "Asistente", tone: "cercano", language: "es", fallback: "email",
  knowledge: "Planes: Free y Pro. Pro cuesta 19.99 al mes. https://walkychat.app/#lp-precios",
  owner_notes: "", site_url: "https://walkychat.app", contact_email: "hola@walkychat.app", privacy_url: null,
  enabled: true, use_sections: false, ...over,
});
const HITS: SectionHit[] = [
  { kind: "screen", is_hidden: true, heading_path: "Configuración", text: "Apariencia\nTema\nBotón: Predeterminado\nBotón: Oscuro", anchor: "view-cuenta", document_url: "https://walkychat.app/", rank: 0.6 },
  { kind: "info", is_hidden: false, heading_path: "Precios", text: "Pro cuesta 19.99 al mes.", anchor: "lp-precios", document_url: "https://walkychat.app/", rank: 0.3 },
];

type Msg = { conversation_id: string; from_role: string; text: string; [k: string]: unknown };
class Mem implements Store {
  widget: Widget;
  convs: { id: string; widget_id: string; visitor_id: string; is_test: boolean; status: string; [k: string]: unknown }[] = [];
  msgs: (Msg & { at: number })[] = [];
  events: Record<string, unknown>[] = [];
  usage: Record<string, unknown> | null = null;
  usageWrites = 0;
  searches: string[] = [];
  hits: SectionHit[] = [];
  tokens: Record<string, string> = { "tok-owner": OWNER, "tok-otro": "33333333-3333-4333-8333-333333333333" };
  seq = 0;
  clock: () => number;
  constructor(w: Widget, clock: () => number) { this.widget = w; this.clock = clock; }
  getWidget(id: string) { return Promise.resolve(id === this.widget.id ? this.widget : null); }
  userIdFromToken(t: string) { return Promise.resolve(this.tokens[t] ?? null); }
  countVisitorMsgs(widgetId: string, since: string, isTest: boolean, visitorId?: string) {
    const s = Date.parse(since);
    return Promise.resolve(this.msgs.filter((m) => {
      const c = this.convs.find((x) => x.id === m.conversation_id)!;
      return m.from_role === "visitor" && c.widget_id === widgetId && c.is_test === isTest && m.at >= s && (!visitorId || c.visitor_id === visitorId);
    }).length);
  }
  getUsage() { return Promise.resolve(this.usage); }
  getOpenConversation(id: string, widgetId: string, visitorId: string) {
    const c = this.convs.find((x) => x.id === id && x.widget_id === widgetId && x.visitor_id === visitorId);
    return Promise.resolve(c && c.status === "open" ? { id: c.id, is_test: c.is_test } : null);
  }
  createConversation(row: Record<string, unknown>) {
    const id = `${String(++this.seq).padStart(8, "0")}-0000-4000-8000-000000000000`;
    this.convs.push({ id, widget_id: String(row.widget_id), visitor_id: String(row.visitor_id), is_test: row.is_test === true, status: "open", ...row });
    return Promise.resolve(id);
  }
  history(convId: string, limit: number) {
    return Promise.resolve(this.msgs.filter((m) => m.conversation_id === convId).slice().reverse().slice(0, limit).map((m) => ({ from_role: m.from_role, text: m.text })));
  }
  countAssistantSince(convId: string, since: string) {
    const s = Date.parse(since);
    return Promise.resolve(this.msgs.filter((m) => m.conversation_id === convId && m.from_role === "assistant" && m.at >= s).length);
  }
  insertMessage(row: Record<string, unknown>) { this.msgs.push({ ...(row as Msg), at: this.clock() }); return Promise.resolve(); }
  insertEvents(rows: Record<string, unknown>[]) { this.events.push(...rows); return Promise.resolve(); }
  upsertUsage(row: Record<string, unknown>) { this.usage = row; this.usageWrites++; return Promise.resolve(); }
  searchSections(_w: string, q: string) { this.searches.push(q); return Promise.resolve(this.hits); }
}

const okJson = (text: string) => ({ output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 1500, output_tokens: 40 } });
function fakeAi(replies: AiRaw[]) {
  const calls: AiArgs[] = [];
  const fn = (a: AiArgs) => { calls.push(a); const r = replies.shift(); if (!r) throw new Error("sin respuesta preparada"); return Promise.resolve(r); };
  return { fn, calls };
}
function setup(w: Widget, replies: AiRaw[] = [{ status: 200, retryAfterMs: null, json: okJson("Respuesta.") }]) {
  let t = Date.parse("2026-11-07T12:00:00Z");
  const clock = () => t;
  const store = new Mem(w, clock);
  const ai = fakeAi(replies);
  const sleeps: number[] = [];
  const logs: [string, Record<string, unknown>][] = [];
  const deps = { store, ai: ai.fn, sleep: (ms: number) => { sleeps.push(ms); return Promise.resolve(); }, now: clock, model: "m", log: (a: string, b: Record<string, unknown>) => { logs.push([a, b]); } };
  const send = async (body: Record<string, unknown>, headers: Record<string, string> = {}) => {
    t += 1000;
    const r = await handle(new Request("http://x/chat", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ widget_id: WID, visitor_id: "visitante-1", ...body }) }), deps);
    return { status: r.status, body: await r.json() };
  };
  return { store, ai, sleeps, logs, send, advance: (ms: number) => { t += ms; } };
}

// ---------- núcleo ----------
Deno.test("núcleo: modo viejo arma el prompt como v14 (información en un solo texto)", () => {
  const s = instructions(baseWidget());
  ok(s.includes("INFORMACIÓN DEL SITIO:") && s.includes("Pro cuesta 19.99"), "usa knowledge");
  ok(!s.includes("SECCIONES"), "no menciona secciones");
});

Deno.test("núcleo: modo secciones ordena notas, memoria y secciones (lo fijo primero)", () => {
  const w = baseWidget({ use_sections: true, owner_notes: "Hoy cerramos a las 8." });
  const s = instructions(w, { sections: formatSections(HITS).block });
  const iN = s.indexOf("NOTAS DEL DUEÑO"), iM = s.indexOf("MEMORIA (resumen"), iS = s.indexOf("SECCIONES (lo encontrado");
  ok(iN > 0 && iM > iN && iS > iM, `orden notas<memoria<secciones: ${iN} ${iM} ${iS}`);
  ok(s.includes("Prioridad si algo se contradice: NOTAS DEL DUEÑO, después SECCIONES, después MEMORIA"), "prioridad explícita");
  ok(s.includes("contraseña de la cuenta del sitio no es la contraseña de otra plataforma"), "regla de no aplicar datos de otra cosa");
  ok(s.includes("idioma del último mensaje del visitante"), "regla de idioma");
});

Deno.test("núcleo: las pantallas ocultas no llevan enlace; las visibles sí, con ancla", () => {
  const b = formatSections(HITS).block;
  ok(b.includes("[1] Configuración — pantalla de la app — sin enlace propio"), "pantalla sin enlace: " + b);
  ok(b.includes("[2] Precios — página — https://walkychat.app/#lp-precios"), "página con ancla");
});

Deno.test("núcleo: el presupuesto de secciones se respeta", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ ...HITS[1], heading_path: `S${i}`, text: "x".repeat(1500) }));
  const f = formatSections(many);
  ok(f.block.length <= LIMITS.SECTIONS_BUDGET_CHARS + 50, "largo " + f.block.length);
  ok(f.used >= 3 && f.used < 20, "usadas " + f.used);
});

Deno.test("núcleo: pregunta corta de seguimiento suma la anterior", () => {
  const h = [{ from_role: "visitor", text: "¿Cuánto cuesta el plan Pro?" }, { from_role: "assistant", text: "19.99" }];
  eq(buildQuery("¿y qué incluye?", h), "¿y qué incluye? ¿Cuánto cuesta el plan Pro?", "seguimiento");
  eq(buildQuery("¿Dónde cambio el tema de la aplicación a oscuro?", h), "¿Dónde cambio el tema de la aplicación a oscuro?", "pregunta completa no se toca");
});

Deno.test("núcleo: 'no sé' se detecta por marcador o por frase corta; las parciales no", () => {
  const w = baseWidget();
  eq(detectNoAnswer(`${NO_ANSWER} No tengo esa información.`, w).noAnswer, true, "marcador");
  eq(detectNoAnswer("No tengo información sobre cómo cambiar el tema a oscuro. Podés escribir a hola@walkychat.app.", w).noAnswer, true, "frase v14");
  eq(detectNoAnswer("I don't have that information. You can write to x.", w).noAnswer, true, "inglés");
  eq(detectNoAnswer("Podés cambiar de plan en cualquier momento, aunque no tengo el enlace.", w).noAnswer, false, "parcial");
  eq(detectNoAnswer("No tengo información sobre el modo nocturno, pero en Configuración › Apariencia › Tema podés elegir Oscuro, que es lo más parecido. " + "x".repeat(200), w).noAnswer, false, "larga con contenido");
});

// ---------- manejador ----------
Deno.test("manejador: modo viejo no busca secciones y responde", async () => {
  const s = setup(baseWidget());
  const r = await s.send({ message: "¿Cuánto cuesta Pro?" });
  eq(r.status, 200, "200"); eq(r.body.answer, "Respuesta.", "respuesta");
  eq(s.store.searches.length, 0, "sin búsqueda");
  ok(s.ai.calls[0].instructions.includes("INFORMACIÓN DEL SITIO"), "prompt viejo");
  eq(s.store.usageWrites, 1, "cuenta uso");
  ok(s.store.events.some((e) => e.type === "question") && s.store.events.some((e) => e.type === "answer"), "eventos");
});

Deno.test("manejador: modo secciones busca, arma el prompt y no muestra fuentes a visitantes", async () => {
  const s = setup(baseWidget({ use_sections: true }));
  s.store.hits = HITS;
  const r = await s.send({ message: "¿Dónde cambio el tema a oscuro?" });
  eq(s.store.searches[0], "¿Dónde cambio el tema a oscuro?", "consulta");
  ok(s.ai.calls[0].instructions.includes("Botón: Oscuro"), "sección en el prompt");
  eq(r.body.sources, undefined, "un visitante no ve las fuentes");
});

Deno.test("manejador: sin notas, sin memoria y sin secciones no llama a la IA", async () => {
  const s = setup(baseWidget({ use_sections: true, knowledge: "" }));
  const r = await s.send({ message: "¿Funciona con WhatsApp?" });
  eq(s.ai.calls.length, 0, "no gasta IA");
  eq(r.body.no_answer, true, "no sé");
  eq(r.body.answer, "No tengo esa información. Podés escribir a hola@walkychat.app.", "aviso");
});

Deno.test("manejador: seguimiento usa la pregunta anterior en la búsqueda", async () => {
  const s = setup(baseWidget({ use_sections: true }), [
    { status: 200, retryAfterMs: null, json: okJson("Pro cuesta 19.99.") },
    { status: 200, retryAfterMs: null, json: okJson("Incluye más mensajes.") },
  ]);
  s.store.hits = HITS;
  const r1 = await s.send({ message: "¿Cuánto cuesta el plan Pro?" });
  await s.send({ message: "¿y qué incluye?", conversation_id: r1.body.conversation_id });
  eq(s.store.searches[1], "¿y qué incluye? ¿Cuánto cuesta el plan Pro?", "consulta con contexto");
  eq(s.ai.calls[1].input.length, 3, "historial de 2 + pregunta");
});

Deno.test("manejador: 429 una vez → espera y reintenta, responde bien", async () => {
  const s = setup(baseWidget(), [
    { status: 429, retryAfterMs: 1500, json: { error: { code: "rate_limit_exceeded" } } },
    { status: 200, retryAfterMs: null, json: okJson("Ok tras reintento.") },
  ]);
  const r = await s.send({ message: "hola, ¿precios?" });
  eq(r.body.answer, "Ok tras reintento.", "respuesta");
  eq(s.sleeps.join(","), "1500", "esperó lo que pidió OpenAI");
  eq(s.ai.calls.length, 2, "dos llamadas");
});

Deno.test("manejador: 429 dos veces → mensaje de ocupado, guardado como error, sin evento de respuesta", async () => {
  const s = setup(baseWidget(), [
    { status: 429, retryAfterMs: null, json: { error: { code: "rate_limit_exceeded" } } },
    { status: 429, retryAfterMs: null, json: { error: { code: "rate_limit_exceeded" } } },
  ]);
  const r = await s.send({ message: "¿precios?" });
  ok(String(r.body.answer).startsWith("Estoy atendiendo muchas consultas"), "ocupado: " + r.body.answer);
  eq(r.body.no_answer, false, "no es un 'no sé'");
  eq(s.sleeps.join(","), String(LIMITS.RETRY_WAIT_DEFAULT_MS), "espera por defecto");
  eq(s.store.msgs.at(-1)!.status, "error", "guardado como error");
  ok(!s.store.events.some((e) => e.type === "answer"), "sin evento de respuesta");
  ok(s.logs.some(([t, d]) => t === "openai_error" && d.retried === true), "registro del error");
});

Deno.test("manejador: sin cupo (insufficient_quota) no reintenta", async () => {
  const s = setup(baseWidget(), [{ status: 429, retryAfterMs: null, json: { error: { code: "insufficient_quota" } } }]);
  await s.send({ message: "¿precios?" });
  eq(s.ai.calls.length, 1, "una sola llamada");
  eq(s.sleeps.length, 0, "sin espera");
});

Deno.test("manejador: frase 'No tengo información…' sin marcador cuenta como no sé (evento fallback)", async () => {
  const s = setup(baseWidget(), [{ status: 200, retryAfterMs: null, json: okJson("No tengo información sobre eso. Podés escribir a hola@walkychat.app.") }]);
  const r = await s.send({ message: "¿Hay modo nocturno?" });
  eq(r.body.no_answer, true, "no_answer");
  ok(s.store.events.some((e) => e.type === "fallback"), "evento fallback");
});

Deno.test("prueba del dueño: sin sesión o con sesión ajena → 403", async () => {
  const s = setup(baseWidget());
  eq((await s.send({ message: "hola", test: true })).status, 403, "sin token");
  eq((await s.send({ message: "hola", test: true }, { Authorization: "Bearer tok-otro" })).status, 403, "otro usuario");
  eq(s.ai.calls.length, 0, "no gasta IA");
});

Deno.test("prueba del dueño: marca la conversación, no cuenta uso ni eventos y devuelve fuentes", async () => {
  const s = setup(baseWidget({ use_sections: true }));
  s.store.hits = HITS;
  const r = await s.send({ message: "¿Dónde cambio el tema?", test: true }, { Authorization: "Bearer tok-owner" });
  eq(r.status, 200, "200");
  eq(s.store.convs[0].is_test, true, "conversación de prueba");
  eq(s.store.usageWrites, 0, "no toca el uso del plan");
  eq(s.store.events.length, 0, "sin eventos (no ensucia Analíticas)");
  ok(Array.isArray(r.body.sources) && r.body.sources[0].titulo === "Configuración", "fuentes para el dueño");
  ok(s.store.msgs.at(-1)!.tokens_in === 1500, "los tokens quedan en el mensaje");
});

Deno.test("prueba del dueño: tope oculto de 200 por 24 h; los topes de visitantes no la frenan", async () => {
  const s = setup(baseWidget());
  // 500 mensajes reales hoy (tope del widget alcanzado)
  const real = await s.store.createConversation({ widget_id: WID, visitor_id: "otro-visitante", is_test: false });
  for (let i = 0; i < LIMITS.PER_WIDGET_PER_DAY; i++) s.store.msgs.push({ conversation_id: real!, from_role: "visitor", text: "x", at: Date.parse("2026-11-07T11:00:00Z") });
  eq((await s.send({ message: "¿precios?" })).status, 429, "visitante frenado por el tope del widget");
  const owner = { Authorization: "Bearer tok-owner" };
  eq((await s.send({ message: "¿precios?", test: true, visitor_id: "panel-prueba" }, owner)).status, 200, "la prueba pasa");
  // llenar el tope de pruebas
  const tc = await s.store.createConversation({ widget_id: WID, visitor_id: "panel-otro", is_test: true });
  for (let i = 0; i < LIMITS.OWNER_TEST_PER_DAY; i++) s.store.msgs.push({ conversation_id: tc!, from_role: "visitor", text: "x", at: Date.parse("2026-11-07T11:30:00Z") });
  const r = await s.send({ message: "¿precios?", test: true, visitor_id: "panel-prueba" }, owner);
  eq(r.status, 429, "tope de pruebas");
  eq(r.body.error, "limit_reached", "mismo error genérico (el tope no se anuncia)");
});

Deno.test("prueba del dueño: no continúa una conversación real (y al revés)", async () => {
  const s = setup(baseWidget(), [
    { status: 200, retryAfterMs: null, json: okJson("A.") }, { status: 200, retryAfterMs: null, json: okJson("B.") },
  ]);
  const r1 = await s.send({ message: "¿precios?" });
  const r2 = await s.send({ message: "¿precios?", test: true, conversation_id: r1.body.conversation_id }, { Authorization: "Bearer tok-owner" });
  ok(r2.body.conversation_id !== r1.body.conversation_id, "crea otra conversación");
  eq(s.store.convs.length, 2, "dos conversaciones");
});

Deno.test("enlaces: se conservan los del sitio y de las secciones; se borran los ajenos", async () => {
  const s = setup(baseWidget({ use_sections: true }), [{ status: 200, retryAfterMs: null, json: okJson("Mirá https://walkychat.app/#lp-precios o https://malicioso.example/x") }]);
  s.store.hits = HITS;
  const r = await s.send({ message: "¿precios?" });
  ok(String(r.body.answer).includes("https://walkychat.app/#lp-precios"), "enlace del sitio");
  ok(!String(r.body.answer).includes("malicioso"), "enlace ajeno borrado");
});

Deno.test("pedidos inválidos y widget apagado", async () => {
  const s = setup(baseWidget());
  eq((await s.send({ message: "" })).status, 400, "vacío");
  eq((await s.send({ message: "x".repeat(1001) })).status, 413, "largo");
  eq((await s.send({ message: "hola", widget_id: "no-uuid" })).status, 400, "id inválido");
  s.store.widget.enabled = false;
  eq((await s.send({ message: "hola" })).status, 404, "apagado");
});

Deno.test("si la búsqueda falla, responde igual con notas y memoria (no se cae)", async () => {
  const s = setup(baseWidget({ use_sections: true }));
  s.store.searchSections = () => Promise.reject(new Error("db_busqueda"));
  const r = await s.send({ message: "¿precios?" });
  eq(r.status, 200, "200");
  ok(s.logs.some(([t]) => t === "sections_search_error"), "registra el error");
});
