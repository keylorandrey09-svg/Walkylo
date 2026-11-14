// supabase/functions/import-site/index.ts  (verify_jwt: true)
import { createClient } from "npm:@supabase/supabase-js@2";
import { type Job, type PageRef, puerta, startJob, stepJob, summary } from "./flow.ts";
import { type PageForSummary, type Store2, summarize, type WidgetFull } from "./summarize.ts";
import {
  acceptMemoryDraft, discardMemoryDraft, generateMemory, type MemSection, type MemStore, type Run, type WidgetMem,
} from "./memory.ts";
import {
  cancelCards, type CardGroup, type CardMeta, type CardRun, type CardSection, type CardsStore, cardsStatus, editCardText, type LinkRow, normalizeRun,
  type StagedItem, startCards, stepCards, unEditCardText,
} from "./cards.ts";
import { type ChangeRow, diffSections, type SectionDiff } from "./changes.ts";

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

// PostgREST devuelve como máximo 1000 filas por pedido: se pide por páginas para no cortar nada en silencio.
// deno-lint-ignore no-explicit-any
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const res: T[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = must(await page(from, from + 999)) ?? [];
    res.push(...rows);
    if (rows.length < 1000) return res;
  }
}
const chunks = <T>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

const store: Store2 & MemStore & CardsStore = {
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
    const old = (must(await sb.from("sections").select("position,content_hash,heading_path,text").eq("page_id", a.page_id)
      .order("position")) ?? []) as { position: number; content_hash: string; heading_path: string; text: string }[];
    const now = new Date().toISOString();
    const same = old.length === a.sections.length && old.every((o, i) => o.position === i && o.content_hash === a.sections[i].content_hash);
    if (same) {
      must(await sb.from("sections").update({ last_seen_at: now, fetched_at: now }).eq("page_id", a.page_id));
      return [] as SectionDiff[];
    }
    let diff: SectionDiff[] = [];
    try { diff = diffSections(old, a.sections); } catch (e) { console.error("diff_error", String((e as Error).message ?? e).slice(0, 80)); }
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
    return diff;
  },
  async recordChange(r: ChangeRow) {
    must(await sb.from("site_job_changes").insert(r));
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
    return must(await sb.from("widgets").select("id,site_url,knowledge,knowledge_ai_at,memory_draft,memory_sources_hash,contact_email")
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
  // suma atómica (no "leer, sumar y escribir"): dos corridas a la vez no se pisan
  async addUsage(userId, tIn, tOut) {
    const month = new Date().toISOString().slice(0, 7) + "-01";
    must(await sb.rpc("bump_usage", { p_user: userId, p_month: month, p_conv: 0, p_msgs: 0, p_in: tIn, p_out: tOut }));
  },
  // ---------- Tarjetas ----------
  async widgetBasic(userId) {
    return must(await sb.from("widgets").select("id,language").eq("user_id", userId).maybeSingle()) as { id: string; language: string | null } | null;
  },
  async allSections(widgetId) {
    return await fetchAll<CardSection>((a, b) =>
      sb.from("sections").select("id,widget_id,user_id,document_url,position,kind,is_hidden,heading_path,text,content_hash,lang,anchor")
        .eq("widget_id", widgetId).order("document_url").order("position").range(a, b));
  },
  async cardMetas(widgetId) {
    return await fetchAll<CardMeta>((a, b) =>
      sb.from("section_cards").select("section_id,section_hash,version,updated_at,edited_at").eq("widget_id", widgetId).order("section_id").range(a, b));
  },
  // lo de cada tanda se guarda aparte; las tarjetas de siempre no se tocan hasta applyRun (todo junto, en una transacción)
  async stageItems(runId: string, items: StagedItem[]) {
    const rows = items.map((it) => ({ run_id: runId, section_id: it.section_id, widget_id: it.widget_id, user_id: it.user_id, card: it.card, links: it.links }));
    for (const c of chunks(rows, 50)) must(await sb.from("card_run_items").upsert(c, { onConflict: "run_id,section_id" }));
  },
  async stagedIds(runId: string) {
    return (await fetchAll<{ section_id: string }>((a, b) =>
      sb.from("card_run_items").select("section_id").eq("run_id", runId).order("section_id").range(a, b))).map((r) => r.section_id);
  },
  async discardStaged(runId: string) {
    must(await sb.from("card_run_items").delete().eq("run_id", runId));
  },
  async applyRun(runId: string) {
    must(await sb.rpc("apply_card_run", { p_run: runId }));
  },
  async replaceCodeLinks(widgetId: string, rows: LinkRow[]) {
    must(await sb.from("section_links").delete().eq("widget_id", widgetId).eq("source", "code"));
    for (const c of chunks(rows, 100)) must(await sb.from("section_links").upsert(c, { onConflict: "from_section,to_section,kind,label" }));
  },
  async editCard(widgetId: string, sectionId: string, purpose: string) {
    const cur = must(await sb.from("section_cards").select("purpose,purpose_ai,edited_at").eq("widget_id", widgetId).eq("section_id", sectionId)
      .maybeSingle()) as { purpose: string; purpose_ai: string | null; edited_at: string | null } | null;
    if (!cur) return false;
    // el original se guarda solo la primera vez: editar de nuevo no lo pisa
    const original = cur.edited_at && cur.purpose_ai !== null ? cur.purpose_ai : cur.purpose;
    must(await sb.from("section_cards").update({ purpose, purpose_ai: original, edited_at: new Date().toISOString() })
      .eq("widget_id", widgetId).eq("section_id", sectionId));
    return true;
  },
  async unEditCard(widgetId: string, sectionId: string) {
    const cur = must(await sb.from("section_cards").select("purpose_ai,edited_at").eq("widget_id", widgetId).eq("section_id", sectionId)
      .maybeSingle()) as { purpose_ai: string | null; edited_at: string | null } | null;
    if (!cur || !cur.edited_at || cur.purpose_ai === null) return null;
    must(await sb.from("section_cards").update({ purpose: cur.purpose_ai, purpose_ai: null, edited_at: null })
      .eq("widget_id", widgetId).eq("section_id", sectionId));
    return cur.purpose_ai;
  },
  async recentCardRuns(widgetId, since) {
    return (must(await sb.from("card_runs").select("*").eq("widget_id", widgetId).gte("started_at", since)
      .order("started_at", { ascending: false })) ?? []).map((r: Record<string, unknown>) => normalizeRun(r));
  },
  async createCardRun(row) {
    return normalizeRun(must(await sb.from("card_runs").insert(row).select("*").single()) as Record<string, unknown>);
  },
  async getCardRun(userId, id) {
    const r = must(await sb.from("card_runs").select("*").eq("id", id).eq("user_id", userId).maybeSingle()) as Record<string, unknown> | null;
    return r ? normalizeRun(r) : null;
  },
  async updateCardRun(id, patch) {
    must(await sb.from("card_runs").update({ updated_at: new Date().toISOString(), ...patch }).eq("id", id));
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

    let b: { action?: string; job_id?: string; run_id?: string; mode?: string; force?: boolean; section_ids?: unknown; group?: unknown; section_id?: unknown; purpose?: unknown } = {};
    try { b = await req.json(); } catch { /* cuerpo vacío */ }
    const action = String(b.action ?? "");
    const jobId = typeof b.job_id === "string" ? b.job_id : "";
    const runId = typeof b.run_id === "string" ? b.run_id : "";

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
    if (action === "cards_start") {
      { const g = puerta(w); if (g) return json(g.body, g.status); }
      // section_ids: SOLO esas secciones (hasta 200). Si viene y no es una lista de textos, es un pedido mal hecho.
      let sectionIds: string[] | undefined;
      if (b.section_ids !== undefined) {
        if (!Array.isArray(b.section_ids) || b.section_ids.length > 200 || b.section_ids.some((x) => typeof x !== "string")) {
          return json({ error: "section_ids_invalido" }, 400);
        }
        sectionIds = b.section_ids as string[];
      }
      // group: "public" | "internal": solo las secciones de ese grupo (sin section_ids). Si viene y no es uno de los dos, es un pedido mal hecho.
      let group: CardGroup | undefined;
      if (b.group !== undefined && b.group !== null) {
        if (b.group !== "public" && b.group !== "internal") return json({ error: "grupo_invalido" }, 400);
        group = b.group;
      }
      const r = await startCards(store, uid, w, { force: b.force === true, sectionIds, group });
      return json(r.body, r.status);
    }
    if (action === "cards_step") {
      { const g = puerta(w); if (g) return json(g.body, g.status); }
      if (!runId) return json({ error: "falta_run_id" }, 400);
      const r = await stepCards(store, uid, w, runId);
      return json(r.body, r.status);
    }
    if (action === "cards_status") {
      const r = await cardsStatus(store, uid, w, runId || undefined);
      return json(r.body, r.status);
    }
    if (action === "card_edit") {
      if (typeof b.section_id !== "string" || !b.section_id) return json({ error: "falta_section_id" }, 400);
      const r = await editCardText(store, uid, w, b.section_id, b.purpose);
      return json(r.body, r.status);
    }
    if (action === "card_unedit") {
      if (typeof b.section_id !== "string" || !b.section_id) return json({ error: "falta_section_id" }, 400);
      const r = await unEditCardText(store, uid, w, b.section_id);
      return json(r.body, r.status);
    }
    if (action === "cards_cancel") {
      if (!runId) return json({ error: "falta_run_id" }, 400);
      const r = await cancelCards(store, uid, w, runId);
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
