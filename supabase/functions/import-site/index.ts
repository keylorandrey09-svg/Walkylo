// supabase/functions/import-site/index.ts  (verify_jwt: true)
import { createClient } from "npm:@supabase/supabase-js@2";
import { type Job, type PageRef, puerta, startJob, stepJob, summary } from "./flow.ts";
import { type PageForSummary, type Store2, summarize, type WidgetFull } from "./summarize.ts";
import {
  acceptMemoryDraft, discardMemoryDraft, generateMemory, type MemSection, type MemStore, type Run, type WidgetMem,
} from "./memory.ts";

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

const store: Store2 & MemStore = {
  async recentJobs(widgetId, since) {
    return (must(await sb.from("site_import_jobs").select("*").eq("widget_id", widgetId)
      .gte("created_at", since).order("created_at", { ascending: false })) ?? []) as Job[];
  },
  async setJobStatus(id, status) {
    must(await sb.from("site_import_jobs").update({ status, updated_at: new Date().toISOString() }).eq("id", id));
  },
  async createJob(row) {
    return must(await sb.from("site_import_jobs").insert(row).select("*").single()) as Job;
  },
  async getJob(userId, id) {
    return must(await sb.from("site_import_jobs").select("*").eq("id", id).eq("user_id", userId).maybeSingle()) as Job | null;
  },
  async latestJob(widgetId) {
    return must(await sb.from("site_import_jobs").select("*").eq("widget_id", widgetId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle()) as Job | null;
  },
  async updateJob(id, patch) {
    must(await sb.from("site_import_jobs").update(patch).eq("id", id));
  },
  async upsertPages(rows) {
    must(await sb.from("site_pages").upsert(rows, { onConflict: "widget_id,url" }));
  },
  async pendingPages(jobId, limit) {
    return (must(await sb.from("site_pages").select("id,url,content_hash,flags").eq("job_id", jobId)
      .eq("status", "pending").order("created_at").order("url").limit(limit)) ?? []) as PageRef[];
  },
  async jobPageUrls(jobId) {
    return (must(await sb.from("site_pages").select("url").eq("job_id", jobId)) ?? []).map((r: { url: string }) => r.url);
  },
  async pageCounts(jobId) {
    const t = await sb.from("site_pages").select("id", { count: "exact", head: true }).eq("job_id", jobId);
    const p = await sb.from("site_pages").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("status", "pending");
    if (t.error || p.error) throw new Error("db_conteo");
    return { total: t.count ?? 0, pending: p.count ?? 0 };
  },
  async updatePage(id, patch) {
    must(await sb.from("site_pages").update(patch).eq("id", id));
  },
  // Secciones de una página: se actualizan en el lugar (nunca queda la página sin secciones) y se borran las que sobran.
  async replaceSections(a) {
    const old = (must(await sb.from("sections").select("position,content_hash").eq("page_id", a.page_id)
      .order("position")) ?? []) as { position: number; content_hash: string }[];
    const now = new Date().toISOString();
    const same = old.length === a.sections.length && old.every((o, i) => o.position === i && o.content_hash === a.sections[i].content_hash);
    if (same) {
      must(await sb.from("sections").update({ last_seen_at: now, fetched_at: now }).eq("page_id", a.page_id));
      return;
    }
    const rows = a.sections.map((s, i) => ({
      widget_id: a.widget_id, user_id: a.user_id, page_id: a.page_id, source_kind: "site", document_url: a.url,
      document_title: a.title || null, heading_path: s.heading_path, kind: s.kind, is_hidden: s.is_hidden, lang: a.lang,
      position: i, text: s.text, content_hash: s.content_hash, anchor: s.anchor, id_path: s.id_path,
      fetched_at: now, last_seen_at: now,
    }));
    for (let i = 0; i < rows.length; i += 100) {
      must(await sb.from("sections").upsert(rows.slice(i, i + 100), { onConflict: "widget_id,document_url,position" }));
    }
    must(await sb.from("sections").delete().eq("page_id", a.page_id).gte("position", rows.length));
  },
  async widgetFull(userId) {
    return must(await sb.from("widgets").select("id,knowledge,knowledge_ai_at").eq("user_id", userId).maybeSingle()) as WidgetFull | null;
  },
  async latestDoneJob(widgetId) {
    return must(await sb.from("site_import_jobs").select("*").eq("widget_id", widgetId).eq("status", "done")
      .order("created_at", { ascending: false }).limit(1).maybeSingle()) as Job | null;
  },
  async donePages(jobId) {
    return (must(await sb.from("site_pages").select("id,url,title,text,hidden_text,content_hash,summarized_hash,flags")
      .eq("job_id", jobId).eq("status", "done").order("url")) ?? []) as PageForSummary[];
  },
  async saveSummary(a) {
    const now = new Date().toISOString();
    if (a.knowledge !== null) {
      must(await sb.from("widgets").update({ knowledge: a.knowledge, knowledge_ai_at: now })
        .eq("id", a.widgetId).eq("user_id", a.userId));
    }
    const res = await Promise.all(a.pages.map((p) =>
      sb.from("site_pages").update({ summarized_hash: p.content_hash }).eq("id", p.id)
    ));
    if (res.some((r) => r.error)) throw new Error("db_marcar_paginas");
    must(await sb.from("site_import_jobs").update({ summarized_at: now }).eq("id", a.jobId));
  },
  // ---------- Memoria ----------
  async widgetMem(userId) {
    return must(await sb.from("widgets").select("id,site_url,knowledge,knowledge_ai_at,memory_draft,memory_sources_hash")
      .eq("user_id", userId).maybeSingle()) as WidgetMem | null;
  },
  async memorySections(widgetId) {
    return (must(await sb.from("sections").select("position,kind,is_hidden,heading_path,text,anchor,document_url,content_hash")
      .eq("widget_id", widgetId).order("document_url").order("position").limit(1000)) ?? []) as MemSection[];
  },
  async recentRuns(widgetId, since) {
    return (must(await sb.from("memory_runs").select("id,status,started_at").eq("widget_id", widgetId)
      .gte("started_at", since).order("started_at", { ascending: false })) ?? []) as Run[];
  },
  async createRun(row) {
    return (must(await sb.from("memory_runs").insert(row).select("id").single()) as { id: string }).id;
  },
  async finishRun(id, patch) {
    must(await sb.from("memory_runs").update(patch).eq("id", id));
  },
  async saveMemory(a) {
    const now = new Date().toISOString();
    const patch = a.mode === "replace"
      ? { knowledge: a.text, knowledge_ai_at: now, memory_draft: null, memory_draft_at: null, memory_sources_hash: a.sourcesHash }
      : { memory_draft: a.text, memory_draft_at: now, memory_sources_hash: a.sourcesHash };
    must(await sb.from("widgets").update(patch).eq("id", a.widgetId).eq("user_id", a.userId));
  },
  async acceptDraft(widgetId, userId) {
    const w = must(await sb.from("widgets").select("memory_draft").eq("id", widgetId).eq("user_id", userId)
      .maybeSingle()) as { memory_draft: string | null } | null;
    if (!w?.memory_draft) return false;
    must(await sb.from("widgets").update({
      knowledge: w.memory_draft, knowledge_ai_at: new Date().toISOString(), memory_draft: null, memory_draft_at: null,
    }).eq("id", widgetId).eq("user_id", userId));
    return true;
  },
  async discardDraft(widgetId, userId) {
    must(await sb.from("widgets").update({ memory_draft: null, memory_draft_at: null }).eq("id", widgetId).eq("user_id", userId));
  },
  async addUsage(userId, tIn, tOut) {
    const month = new Date().toISOString().slice(0, 7) + "-01";
    const u = must(await sb.from("usage_monthly").select("*").eq("user_id", userId).eq("month", month).maybeSingle());
    must(await sb.from("usage_monthly").upsert({
      user_id: userId, month, conversations: u?.conversations ?? 0, messages: u?.messages ?? 0,
      tokens_in: (u?.tokens_in ?? 0) + tIn, tokens_out: (u?.tokens_out ?? 0) + tOut,
    }));
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
    const uid = ud.user.id;

    let b: { action?: string; job_id?: string; mode?: string; force?: boolean } = {};
    try { b = await req.json(); } catch { /* cuerpo vacío */ }
    const action = String(b.action ?? "");
    const jobId = typeof b.job_id === "string" ? b.job_id : "";

    const { data: w } = await sb.from("widgets").select("id,site_url,verified_host,verified_at,language").eq("user_id", uid).maybeSingle();
    if (!w) return json({ error: "sin_widget" }, 404);

    if (action === "start") {
      { const g = puerta(w); if (g) return json(g.body, g.status); }
      const r = await startJob(store, uid, w);
      return json(r.body, r.status);
    }
    if (action === "step") {
      { const g = puerta(w); if (g) return json(g.body, g.status); }
      if (!jobId) return json({ error: "falta_job_id" }, 400);
      const r = await stepJob(store, uid, w, jobId);
      return json(r.body, r.status);
    }
    if (action === "summarize") {
      { const g = puerta(w); if (g) return json(g.body, g.status); }
      const r = await summarize(store, uid, w, { mode: typeof b.mode === "string" ? b.mode : undefined });
      return json(r.body, r.status);
    }
    if (action === "memory_generate") {
      { const g = puerta(w); if (g) return json(g.body, g.status); }
      const r = await generateMemory(store, uid, w, { force: b.force === true });
      return json(r.body, r.status);
    }
    if (action === "memory_accept") {
      const r = await acceptMemoryDraft(store, uid, w);
      return json(r.body, r.status);
    }
    if (action === "memory_discard") {
      const r = await discardMemoryDraft(store, uid, w);
      return json(r.body, r.status);
    }
    if (action === "status") {
      const j = jobId ? await store.getJob(uid, jobId) : await store.latestJob(w.id);
      return j && j.widget_id === w.id ? json(summary(j)) : json({ status: "none" });
    }
    if (action === "cancel") {
      if (!jobId) return json({ error: "falta_job_id" }, 400);
      const j = await store.getJob(uid, jobId);
      if (!j || j.widget_id !== w.id) return json({ error: "trabajo_no_encontrado" }, 404);
      if (j.status === "running") await store.setJobStatus(j.id, "cancelled");
      return json({ ok: true });
    }
    return json({ error: "accion_desconocida" }, 400);
  } catch (e) {
    console.error("import_site_error", (e as Error).message);
    return json({ error: "server_error" }, 500);
  }
});
