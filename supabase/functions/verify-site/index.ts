// supabase/functions/verify-site/index.ts  (verify_jwt: true)
import { createClient } from "npm:@supabase/supabase-js@2";
import { startVerify, statusVerify, type VStore, type Verification, type WidgetInfo } from "./verify.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
// deno-lint-ignore no-explicit-any
function must<T>(r: { data: T; error: any }): T {
  if (r.error) throw new Error("db_" + String(r.error.message ?? r.error).slice(0, 120));
  return r.data;
}

const store: VStore = {
  async widgetInfo(userId) {
    return must(await sb.from("widgets").select("id,site_url,verify_token,verified_host,verified_at").eq("user_id", userId).maybeSingle()) as WidgetInfo | null;
  },
  async recent(widgetId, since) {
    return (must(await sb.from("site_verifications").select("*").eq("widget_id", widgetId).gte("created_at", since)
      .order("created_at", { ascending: false })) ?? []) as Verification[];
  },
  async create(row) {
    return must(await sb.from("site_verifications").insert(row).select("*").single()) as Verification;
  },
  async update(id, patch) {
    must(await sb.from("site_verifications").update(patch).eq("id", id));
  },
  async markVerified(widgetId, host) {
    must(await sb.from("widgets").update({ verified_host: host, verified_at: new Date().toISOString() }).eq("id", widgetId));
  },
  async latest(widgetId) {
    return must(await sb.from("site_verifications").select("*").eq("widget_id", widgetId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle()) as Verification | null;
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "no_auth" }, 401);
    const { data: ud, error: ue } = await sb.auth.getUser(token);
    if (ue || !ud?.user) return json({ error: "token_invalido" }, 401);
    let b: { action?: string } = {};
    try { b = await req.json(); } catch { /* cuerpo vacío */ }
    const action = String(b.action ?? "");
    if (action === "start") { const r = await startVerify(store, ud.user.id); return json(r.body, r.status); }
    if (action === "status") { const r = await statusVerify(store, ud.user.id); return json(r.body, r.status); }
    return json({ error: "accion_desconocida" }, 400);
  } catch (e) {
    console.error("verify_site_error", (e as Error).message);
    return json({ error: "server_error" }, 500);
  }
});
