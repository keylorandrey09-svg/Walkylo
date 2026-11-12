// supabase/functions/chat/index.ts  (verify_jwt: false)
// v15: búsqueda de secciones (si el widget tiene use_sections), modo prueba del dueño, reintento ante 429.
import { createClient } from "npm:@supabase/supabase-js@2";
import type { AiArgs, AiRaw, SectionHit, Turn, Widget } from "./core.ts";
import { parseRetryAfter, LIMITS } from "./core.ts";
import { handle, type Store, type Usage } from "./handler.ts";

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-6-luna";
const EFFORT = Deno.env.get("OPENAI_REASONING_EFFORT") ?? "low";
const DISABLED = Deno.env.get("CHAT_DISABLED") === "true";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const store: Store = {
  async getWidget(id) {
    const { data, error } = await sb.from("widgets")
      .select("id,user_id,name,tone,language,fallback,knowledge,owner_notes,site_url,contact_email,privacy_url,enabled,use_sections")
      .eq("id", id).maybeSingle();
    // un error de lectura NO es "el widget no existe": se avisa para que el pedido lo reintente o falle como error
    if (error) throw new Error("db_widget:" + String(error.message ?? error).slice(0, 80));
    return (data ?? null) as Widget | null;
  },
  async userIdFromToken(token) {
    const { data, error } = await sb.auth.getUser(token);
    return error || !data?.user ? null : data.user.id;
  },
  async countVisitorMsgs(widgetId, since, isTest, visitorId) {
    let q = sb.from("messages")
      .select("id, conversations!inner(visitor_id, widget_id, is_test)", { count: "exact", head: true })
      .eq("from_role", "visitor").eq("conversations.widget_id", widgetId).eq("conversations.is_test", isTest)
      .gte("created_at", since);
    if (visitorId) q = q.eq("conversations.visitor_id", visitorId);
    const { count, error } = await q;
    if (error) throw new Error("db_conteo");
    return count ?? 0;
  },
  async getUsage(userId, month) {
    const { data } = await sb.from("usage_monthly").select("*").eq("user_id", userId).eq("month", month).maybeSingle();
    return (data ?? null) as Usage;
  },
  async getOpenConversation(id, widgetId, visitorId) {
    const { data } = await sb.from("conversations").select("id,status,is_test")
      .eq("id", id).eq("widget_id", widgetId).eq("visitor_id", visitorId).maybeSingle();
    return data && data.status === "open" ? { id: data.id, is_test: !!data.is_test } : null;
  },
  async createConversation(row) {
    const { data, error } = await sb.from("conversations").insert(row).select("id").single();
    return error || !data ? null : data.id;
  },
  async history(convId, limit) {
    const { data } = await sb.from("messages").select("from_role,text")
      .eq("conversation_id", convId).order("created_at", { ascending: false }).limit(limit);
    return (data ?? []) as Turn[];
  },
  async countAssistantSince(convId, since) {
    const { count } = await sb.from("messages").select("id", { count: "exact", head: true })
      .eq("conversation_id", convId).eq("from_role", "assistant").gte("created_at", since);
    return count ?? 0;
  },
  async insertMessage(row) { await sb.from("messages").insert(row); },
  async insertEvents(rows) { await sb.from("events").insert(rows); },
  async bumpUsage(r) {
    const { error } = await sb.rpc("bump_usage", {
      p_user: r.user_id, p_month: r.month, p_conv: r.conversations, p_msgs: r.messages, p_in: r.tokens_in, p_out: r.tokens_out,
    });
    if (error) throw new Error("db_usage:" + String(error.message ?? error).slice(0, 80));
  },
  async searchSections(widgetId, query, k) {
    const { data, error } = await sb.rpc("search_sections", { p_widget: widgetId, p_query: query, p_k: k });
    if (error) throw new Error("db_busqueda");
    return (data ?? []) as SectionHit[];
  },
};

async function openai(a: AiArgs): Promise<AiRaw> {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LIMITS.AI_TIMEOUT_MS);
  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: MODEL, instructions: a.instructions, input: a.input,
        max_output_tokens: a.maxOut, reasoning: { effort: EFFORT }, store: false,
      }),
      signal: ctrl.signal,
    });
    let j: unknown = null;
    try { j = await r.json(); } catch { /* sin cuerpo */ }
    if (r.status === 200) {
      // deno-lint-ignore no-explicit-any
      const u = (j as any)?.usage;
      console.log("openai_usage", JSON.stringify({
        model: MODEL, in: u?.input_tokens ?? 0, out: u?.output_tokens ?? 0,
        cached: u?.input_tokens_details?.cached_tokens ?? 0,
        reasoning: u?.output_tokens_details?.reasoning_tokens ?? 0, ms: Date.now() - t0,
        // holgura que informa OpenAI en cada llamada buena (para ver cuánto margen queda antes de chocar con un límite)
        lim_req: r.headers.get("x-ratelimit-limit-requests"), rem_req: r.headers.get("x-ratelimit-remaining-requests"),
        lim_tok: r.headers.get("x-ratelimit-limit-tokens"), rem_tok: r.headers.get("x-ratelimit-remaining-tokens"),
      }));
    }
    // Nunca se registra el contenido del mensaje del visitante.
    const hs: Record<string, string> = {};
    r.headers.forEach((v, k) => { if (/^(x-ratelimit-|retry-after)/.test(k) && Object.keys(hs).length < 12) hs[k] = v; });
    return { status: r.status, retryAfterMs: parseRetryAfter(r.headers), json: j, headers: hs };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("timeout");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve((req) =>
  handle(req, {
    store,
    ai: OPENAI_KEY ? openai : null,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    model: MODEL,
    disabled: DISABLED,
    log: (tag, data) => console.log(tag, JSON.stringify(data)),
  })
);
