// supabase/functions/chat/handler.ts
// Lógica del pedido. La base y la IA se inyectan (en producción: index.ts; en pruebas: falsos).
import {
  type AiArgs, type AiRaw, askWithRetry, buildQuery, busyText, cleanEmails, cleanLinks, detectNoAnswer, errorText,
  fallbackText, formatSections, instructions, laterText, LIMITS, LONG_WAIT_MS, memoryOf, notesOf, REPLY_NOTE, type SectionHit, type Turn,
  URL_RE, useSections, type Widget,
} from "./core.ts";

export type Usage = { conversations?: number; messages?: number; tokens_in?: number; tokens_out?: number } | null;

export interface Store {
  getWidget(id: string): Promise<Widget | null>;
  userIdFromToken(token: string): Promise<string | null>;
  // mensajes de visitante en el widget desde "since"; isTest separa las pruebas del dueño del tráfico real
  countVisitorMsgs(widgetId: string, sinceISO: string, isTest: boolean, visitorId?: string): Promise<number>;
  getUsage(userId: string, month: string): Promise<Usage>;
  getOpenConversation(id: string, widgetId: string, visitorId: string): Promise<{ id: string; is_test: boolean } | null>;
  createConversation(row: Record<string, unknown>): Promise<string | null>;
  history(convId: string, limit: number): Promise<Turn[]>; // más nuevos primero
  countAssistantSince(convId: string, sinceISO: string): Promise<number>;
  insertMessage(row: Record<string, unknown>): Promise<void>;
  insertEvents(rows: Record<string, unknown>[]): Promise<void>;
  // suma estos valores al uso del mes (cuánto SUMAR, no el total): dos mensajes a la vez no se pisan
  bumpUsage(row: { user_id: string; month: string; conversations: number; messages: number; tokens_in: number; tokens_out: number }): Promise<void>;
  searchSections(widgetId: string, query: string, k: number): Promise<SectionHit[]>;
}

export type Deps = {
  store: Store;
  ai: ((a: AiArgs) => Promise<AiRaw>) | null; // null = sin clave de OpenAI (modo simulado)
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  model: string;
  disabled?: boolean;
  log?: (tag: string, data: Record<string, unknown>) => void;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
const str = (v: unknown, max: number) => (typeof v === "string" && v ? v.slice(0, max) : null);

export async function handle(req: Request, d: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (d.disabled) return json({ error: "unavailable" }, 503);
  if (Number(req.headers.get("content-length") ?? 0) > 8192) return json({ error: "too_large" }, 413);
  const log = d.log ?? (() => {});
  const t0 = d.now();

  try {
    // deno-lint-ignore no-explicit-any
    let b: any;
    try { b = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
    const widgetId = String(b.widget_id ?? ""), visitorId = String(b.visitor_id ?? "");
    const text = String(b.message ?? "").trim();
    const convId = b.conversation_id ? String(b.conversation_id) : null;
    const regenerate = b.regenerate === true;
    const wantsTest = b.test === true;
    if (!UUID.test(widgetId) || visitorId.length < 8 || visitorId.length > 64 || !text ||
      (convId && !UUID.test(convId))) return json({ error: "bad_request" }, 400);
    if (text.length > LIMITS.MAX_MSG_CHARS) return json({ error: "message_too_long" }, 413);

    // una falla pasajera al leer el widget se reintenta una vez; solo "no existe" o "apagado" es 404
    let w: Widget | null;
    try { w = await d.store.getWidget(widgetId); } catch (e) {
      log("get_widget_retry", { m: String((e as Error).message ?? e).slice(0, 100) });
      await d.sleep(150);
      w = await d.store.getWidget(widgetId);
    }
    if (!w || !w.enabled) return json({ error: "unavailable" }, 404);

    // Modo prueba: solo con la sesión del dueño de este widget.
    let isTest = false;
    if (wantsTest) {
      const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
      const uid = token ? await d.store.userIdFromToken(token) : null;
      if (!uid || uid !== w.user_id) return json({ error: "test_no_autorizado" }, 403);
      isTest = true;
    }

    // Límites
    const now = d.now();
    const month = new Date(now).toISOString().slice(0, 7) + "-01";
    if (await d.store.countVisitorMsgs(w.id, new Date(now - 60_000).toISOString(), isTest, visitorId) >= LIMITS.PER_VISITOR_PER_MIN) {
      return json({ error: "rate_limited" }, 429);
    }
    let usage: Usage = null;
    if (isTest) {
      if (await d.store.countVisitorMsgs(w.id, new Date(now - 86_400_000).toISOString(), true) >= LIMITS.OWNER_TEST_PER_DAY) {
        return json({ error: "limit_reached" }, 429);
      }
    } else {
      if (await d.store.countVisitorMsgs(w.id, new Date(now - 86_400_000).toISOString(), false) >= LIMITS.PER_WIDGET_PER_DAY) {
        return json({ error: "limit_reached" }, 429);
      }
      usage = await d.store.getUsage(w.user_id, month);
      if ((usage?.messages ?? 0) >= LIMITS.PER_ACCOUNT_PER_MONTH) return json({ error: "limit_reached" }, 429);
    }

    // Conversación (si no existe, no está abierta o es de otro modo, se crea una nueva)
    let conv: string | null = null, isNew = false;
    if (convId) {
      const c = await d.store.getOpenConversation(convId, w.id, visitorId);
      if (c && c.is_test === isTest) conv = c.id;
    }
    if (!conv) {
      conv = await d.store.createConversation({
        user_id: w.user_id, widget_id: w.id, visitor_id: visitorId, is_test: isTest,
        page_url: str(b.page_url, 2048), language: str(b.language, 16),
      });
      if (!conv) return json({ error: "server_error" }, 500);
      isNew = true;
    }

    // Historial (antes de guardar el mensaje nuevo)
    const history = (await d.store.history(conv, LIMITS.MAX_HISTORY)).reverse()
      .filter((m) => m.from_role === "visitor" || m.from_role === "assistant");

    // Regenerar
    const lastVisitor = [...history].reverse().find((m) => m.from_role === "visitor");
    const isRetry = regenerate && !isNew && lastVisitor?.text === text;
    if (isRetry) {
      if (await d.store.countAssistantSince(conv, new Date(now - 60_000).toISOString()) >= 4 ||
        await d.store.countAssistantSince(conv, new Date(now - 3_600_000).toISOString()) >= 21) {
        return json({ error: "rate_limited" }, 429);
      }
      while (history.length && history[history.length - 1].from_role === "assistant") history.pop();
      if (history.length && history[history.length - 1].from_role === "visitor") history.pop();
    } else {
      await d.store.insertMessage({ conversation_id: conv, from_role: "visitor", text });
      if (!isTest) await d.store.insertEvents([{ user_id: w.user_id, type: "question" }]);
    }

    // Secciones (solo si el widget tiene el interruptor prendido)
    let hits: SectionHit[] = [], sectionsBlock = "", sectionsUsed = 0;
    if (useSections(w)) {
      try {
        hits = await d.store.searchSections(w.id, buildQuery(text, history), LIMITS.SECTIONS_K);
      } catch (e) {
        log("sections_search_error", { m: String((e as Error).message ?? e).slice(0, 120) });
        hits = [];
      }
      const f = formatSections(hits);
      sectionsBlock = f.block; sectionsUsed = f.used;
    }

    // Respuesta
    let answer = "", noAnswer = false, status = "complete", model = d.model, tIn = 0, tOut = 0, retried = false;
    const hasInfo = useSections(w) ? !!(notesOf(w) || memoryOf(w) || sectionsUsed) : !!(String(w.knowledge ?? "").trim() || notesOf(w));
    if (!hasInfo) {
      answer = fallbackText(w); noAnswer = true; model = "sin-informacion";
    } else if (!d.ai) {
      model = "simulado";
      if (/sinrespuesta/i.test(text)) { answer = fallbackText(w); noAnswer = true; }
      else answer = "[Modo de prueba] Recibí tu mensaje. La IA todavía no está conectada.";
    } else {
      const input = [
        ...history.map((m) => ({ role: m.from_role === "visitor" ? "user" : "assistant", content: m.text })),
        { role: "user", content: text + REPLY_NOTE },
      ];
      const r = await askWithRetry(d.ai, { instructions: instructions(w, { sections: sectionsBlock }), input, maxOut: LIMITS.MAX_OUTPUT_TOKENS }, d.sleep);
      retried = r.retried;
      if (r.ok) {
        const n = detectNoAnswer(r.text, w);
        answer = n.text; noAnswer = n.noAnswer; tIn = r.tIn; tOut = r.tOut;
      } else {
        log("openai_error", { code: r.code, retried: r.retried, wait_ms: r.waitMs ?? 0, detail: r.detail ?? "" });
        status = "error";
        answer = r.kind === "rate_limited" ? ((r.waitMs ?? 0) > LONG_WAIT_MS ? laterText(w) : busyText(w)) : errorText(w);
      }
    }
    answer = cleanEmails(cleanLinks(answer, w, hits), w).trim().slice(0, 2000) || fallbackText(w);

    await d.store.insertMessage({
      conversation_id: conv, from_role: "assistant", text: answer, status, model,
      tokens_in: tIn || null, tokens_out: tOut || null, is_fallback: noAnswer,
    });
    if (!isTest && status === "complete" && !isRetry) {
      const ev: Record<string, unknown>[] = [{ user_id: w.user_id, type: noAnswer ? "fallback" : "answer" }];
      for (let i = 0; i < (answer.match(URL_RE) ?? []).length; i++) ev.push({ user_id: w.user_id, type: "link" });
      await d.store.insertEvents(ev);
    }
    if (!isTest) {
      // se le manda a la base CUÁNTO sumar (no el total leído antes). Si la contabilidad falla, la respuesta ya guardada no se pierde.
      try {
        await d.store.bumpUsage({
          user_id: w.user_id, month,
          conversations: isNew ? 1 : 0,
          // un mensaje cuenta para el plan solo si se respondió; los fallos de la IA no gastan el cupo
          messages: isRetry || status !== "complete" ? 0 : 1,
          tokens_in: tIn, tokens_out: tOut,
        });
      } catch (e) { log("usage_error", { m: String((e as Error).message ?? e).slice(0, 100) }); }
    }

    log("chat_v15", {
      sections_mode: useSections(w), hits: hits.length, used: sectionsUsed, test: isTest, status, no_answer: noAnswer,
      retried, ms: d.now() - t0,
    });
    return json({
      conversation_id: conv, answer, no_answer: noAnswer,
      ...(isTest ? { sources: hits.slice(0, sectionsUsed).map((h) => ({ titulo: h.heading_path, tipo: h.kind })) } : {}),
    });
  } catch (e) {
    log("chat_error", { m: String((e as Error).message ?? e).slice(0, 120) });
    return json({ error: "server_error" }, 500);
  }
}
