// supabase/functions/import-site/flow.ts
// Flujo: empezar un trabajo, procesar por tandas, topes y espera creciente.
import {
  assertPublicUrl, extractPage, MAX_PAGE_BYTES, normalizeUrl, normHost, parseRobots, parseSitemap,
  type Rule, robotsAllowed, safeFetch, sha256,
} from "./lib.ts";
import { extractSections, type Section } from "./sections.ts";
import type { ChangeRow, SectionDiff } from "./changes.ts";

export const MAX_PAGES = 25;
export const MAX_PAGES_PER_STEP = 5;
export const STEP_BYTES_BUDGET = 600_000;
export const STEP_TIME_BUDGET_MS = 20_000;
export const MAX_DEPTH = 2;
export const DAILY_JOBS = 10;          // PROVISIONAL (se liga a los planes)
export const WAIT_BASE_S = 60;         // espera creciente: 0, 60, 120, 240... segundos
export const RESET_AFTER_MIN = 30;
export const STALE_JOB_MIN = 10;

export type Job = {
  id: string; widget_id: string; user_id: string; start_url: string; status: string;
  pages_found: number; pages_done: number; pages_new: number; pages_changed: number; pages_same: number;
  error: string | null; created_at: string; updated_at: string; finished_at: string | null;
  summarized_at?: string | null;
};
export type PageRow = {
  widget_id: string; user_id: string; job_id: string; url: string; status: string; flags: Record<string, unknown>;
};
export type PageRef = { id: string; url: string; content_hash: string | null; flags: Record<string, unknown> | null };
export type SectionRow = Section & { content_hash: string };
export type SectionsArgs = {
  widget_id: string; user_id: string; page_id: string; url: string; title: string; lang: string; sections: SectionRow[];
};

export interface Store {
  recentJobs(widgetId: string, sinceISO: string): Promise<Job[]>; // más nuevos primero
  setJobStatus(id: string, status: string): Promise<void>;
  createJob(row: { widget_id: string; user_id: string; start_url: string }): Promise<Job>;
  getJob(userId: string, id: string): Promise<Job | null>;
  latestJob(widgetId: string): Promise<Job | null>;
  updateJob(id: string, patch: Record<string, unknown>): Promise<void>;
  upsertPages(rows: PageRow[]): Promise<void>;
  pendingPages(jobId: string, limit: number): Promise<PageRef[]>;
  jobPageUrls(jobId: string): Promise<string[]>;
  pageCounts(jobId: string): Promise<{ total: number; pending: number }>;
  updatePage(id: string, patch: Record<string, unknown>): Promise<void>;
  // Opcional (aditivo): guarda las secciones de una página. Si falta o falla, la lectura sigue igual.
  // Puede devolver qué secciones cambiaron respecto de la lectura anterior (para "Actividad reciente").
  replaceSections?(a: SectionsArgs): Promise<SectionDiff[] | void>;
  // Opcional (aditivo): guarda qué cambió en una página en esta lectura. Si falta o falla, la lectura sigue igual.
  recordChange?(row: ChangeRow): Promise<void>;
}

export type Out = { status: number; body: Record<string, unknown> };
const out = (status: number, body: Record<string, unknown>): Out => ({ status, body });

// ---------- Puerta: solo se lee y se resume un sitio verificado ----------
export const hostOf = (u: string | null | undefined): string => {
  try { return normHost(new URL(u ?? "").hostname); } catch { return ""; }
};
export const isVerified = (w: { site_url: string | null; verified_host: string | null; verified_at: string | null }) =>
  !!w.verified_host && !!w.verified_at && hostOf(w.site_url) === w.verified_host;
export function puerta(w: { site_url: string | null; verified_host: string | null; verified_at: string | null }): Out | null {
  return isVerified(w) ? null : out(403, { error: "sitio_no_verificado" });
}

export function summary(j: Job): Record<string, unknown> {
  return {
    job_id: j.id, status: j.status, pages_found: j.pages_found, pages_done: j.pages_done,
    pages_pending: Math.max(0, j.pages_found - j.pages_done), pages_new: j.pages_new,
    pages_changed: j.pages_changed, pages_same: j.pages_same, error: j.error,
  };
}

const ASSET_EXT = /\.(css|js|mjs|json|xml|ico|png|jpe?g|gif|webp|svg|avif|woff2?|ttf|otf|eot)$/i;

// Enlaces importantes de una página (texto y dirección completa, incluso los de sitios que navegan con #).
export function pickLinks(
  items: { text: string; href: string }[], pageUrl: string, baseHost: string,
): { t: string; h: string }[] {
  const self = pageUrl.split("#")[0];
  const seen = new Set<string>();
  const res: { t: string; h: string }[] = [];
  for (const it of items) {
    const t = it.text.trim();
    if (!t || /^(saltar|skip|ir al contenido|ir a contenido)/i.test(t)) continue;
    let u: URL;
    try { u = new URL(it.href, pageUrl); } catch { continue; }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    if (u.username || u.password || normHost(u.hostname) !== baseHost) continue;
    if (ASSET_EXT.test(u.pathname)) continue;
    const abs = u.toString();
    if (abs.split("#")[0] === self && (u.hash === "" || u.hash === "#")) continue; // enlace a la misma página
    if (seen.has(abs)) continue;
    seen.add(abs);
    res.push({ t: t.slice(0, 60), h: abs.slice(0, 300) });
    if (res.length >= 40) break;
  }
  return res;
}

async function loadRobots(origin: string, baseHost: string): Promise<{ rules: Rule[]; sitemaps: string[] }> {
  try {
    const r = await safeFetch(origin + "/robots.txt", { baseHost, maxBytes: 100_000, accept: "text/plain,*/*;q=0.5" });
    if (r.status === 200) return parseRobots(r.text);
  } catch { /* sin robots.txt: todo permitido */ }
  return { rules: [], sitemaps: [] };
}

export async function startJob(
  store: Store, uid: string, w: { id: string; site_url: string | null }, now = Date.now(),
): Promise<Out> {
  if (!w.site_url) return out(400, { error: "sin_url" });
  let startUrl: URL;
  try { startUrl = await assertPublicUrl(w.site_url); } catch (e) {
    return out(400, { error: "url_no_permitida", detalle: (e as Error).message });
  }
  const first = normalizeUrl(startUrl.toString());
  if (!first) return out(400, { error: "url_no_permitida", detalle: "url_con_parametros_o_archivo" });
  const baseHost = normHost(startUrl.hostname);

  // topes: un trabajo a la vez, espera creciente, límite diario
  const jobs = await store.recentJobs(w.id, new Date(now - 86_400_000).toISOString());
  const running = jobs.find((j) => j.status === "running" && now - Date.parse(j.updated_at) < STALE_JOB_MIN * 60_000);
  if (running) return out(200, { ...summary(running), resumed: true });
  for (const j of jobs) if (j.status === "running") await store.setJobStatus(j.id, "cancelled");
  if (jobs.length >= DAILY_JOBS) return out(429, { error: "limite_diario" });
  const inWindow = jobs.filter((j) => now - Date.parse(j.created_at) < RESET_AFTER_MIN * 60_000);
  if (inWindow.length > 0) {
    const waitS = Math.min(3600, WAIT_BASE_S * 2 ** (inWindow.length - 1));
    const elapsedS = (now - Date.parse(inWindow[0].created_at)) / 1000;
    if (elapsedS < waitS) return out(429, { error: "espera", retry_after_s: Math.ceil(waitS - elapsedS) });
  }

  // descubrimiento: portada + sitemap (si existe)
  const robots = await loadRobots(startUrl.origin, baseHost);
  const seeds = new Map<string, { url: string; depth: number }>();
  seeds.set(first.key, { url: first.url, depth: 0 });
  const queue = robots.sitemaps.length ? [...robots.sitemaps] : [startUrl.origin + "/sitemap.xml"];
  const locs: string[] = [];
  let fetched = 0;
  while (queue.length && fetched < 4 && locs.length < 100) {
    const sm = queue.shift()!;
    fetched++;
    try {
      const r = await safeFetch(sm, { baseHost, maxBytes: 500_000, accept: "application/xml,text/xml,*/*;q=0.5" });
      if (r.status !== 200) continue;
      const p = parseSitemap(r.text);
      if (p.isIndex) queue.push(...p.locs.slice(0, 3)); else locs.push(...p.locs);
    } catch { /* el sitemap es opcional */ }
  }
  for (const loc of locs) {
    if (seeds.size >= MAX_PAGES) break;
    const n = normalizeUrl(loc);
    if (!n) continue;
    const u = new URL(n.url);
    if (normHost(u.hostname) !== baseHost || !robotsAllowed(robots.rules, u.pathname)) continue;
    if (!seeds.has(n.key)) seeds.set(n.key, { url: n.url, depth: 1 });
  }

  const job = await store.createJob({ widget_id: w.id, user_id: uid, start_url: first.url });
  await store.upsertPages([...seeds.values()].map((s) => ({
    widget_id: w.id, user_id: uid, job_id: job.id, url: s.url, status: "pending", flags: { depth: s.depth },
  })));
  const c = await store.pageCounts(job.id);
  await store.updateJob(job.id, { pages_found: c.total, updated_at: new Date().toISOString() });
  return out(200, { ...summary({ ...job, pages_found: c.total }), resumed: false });
}

export async function stepJob(
  store: Store, uid: string, w: { id: string; language?: string | null }, jobId: string,
): Promise<Out> {
  const lang = ["es", "en", "pt"].includes(String(w.language ?? "")) ? String(w.language) : "es";
  const job = await store.getJob(uid, jobId);
  if (!job || job.widget_id !== w.id) return out(404, { error: "trabajo_no_encontrado" });
  if (job.status !== "running") return out(200, summary(job));

  let startUrl: URL;
  try { startUrl = await assertPublicUrl(job.start_url); } catch (e) {
    await store.updateJob(job.id, { status: "error", error: (e as Error).message.slice(0, 300), finished_at: new Date().toISOString() });
    return out(400, { error: "url_no_permitida", detalle: (e as Error).message });
  }
  const baseHost = normHost(startUrl.hostname);
  const robots = await loadRobots(startUrl.origin, baseHost);
  const pend = await store.pendingPages(job.id, MAX_PAGES_PER_STEP);
  const knownKeys = new Set<string>();
  for (const u of await store.jobPageUrls(job.id)) {
    const n = normalizeUrl(u);
    if (n) knownKeys.add(n.key);
  }

  const t0 = Date.now();
  let bytes = 0, processed = 0;
  const inc = { new: 0, changed: 0, same: 0 };
  for (const p of pend) {
    if (processed > 0 && (bytes >= STEP_BYTES_BUDGET || Date.now() - t0 > STEP_TIME_BUDGET_MS)) break;
    processed++;
    const iso = new Date().toISOString();
    const depth = Number((p.flags as { depth?: number } | null)?.depth ?? 0);
    try {
      if (!robotsAllowed(robots.rules, new URL(p.url).pathname)) {
        await store.updatePage(p.id, { status: "blocked", error: "robots_txt", fetched_at: iso });
        continue;
      }
      const r = await safeFetch(p.url, { baseHost, maxBytes: MAX_PAGE_BYTES });
      bytes += r.bytes;
      if (r.status >= 400) throw new Error(`http_${r.status}`);
      if (r.contentType && !r.contentType.includes("html")) throw new Error("no_es_html");
      const ex = extractPage(r.text);
      const hash = await sha256(ex.text + "\u0000" + ex.hidden_text);
      const change: "new" | "changed" | "same" = !p.content_hash ? "new" : p.content_hash !== hash ? "changed" : "same";
      inc[change]++;
      // secciones con estructura (aditivo: un error aquí nunca rompe la lectura de la página)
      let secRows: SectionRow[] | null = null, secErr = "";
      if (store.replaceSections) {
        try {
          const sec = extractSections(r.text);
          secRows = [];
          for (const s of sec.sections) secRows.push({ ...s, content_hash: await sha256(s.heading_path + "\u0000" + s.text) });
          if (sec.warnings.length) console.log("sections_warn", JSON.stringify({ url: p.url, w: sec.warnings }));
        } catch (e) { secErr = String((e as Error).message ?? e).slice(0, 80); secRows = null; }
      }
      await store.updatePage(p.id, {
        status: "done", http_status: r.status, title: ex.title, text: ex.text, hidden_text: ex.hidden_text,
        text_chars: ex.text.length, content_hash: hash, error: null, fetched_at: iso,
        flags: {
          depth, posible_js: ex.posible_js, recortada: r.truncated, ocultos_quitados: ex.hidden_removed,
          headings: ex.headings, hidden_chars: ex.hidden_text.length,
          links: pickLinks(ex.linkItems, p.url, baseHost),
          ...(store.replaceSections ? { sections: secRows ? secRows.length : 0, ...(secErr ? { sections_error: secErr } : {}) } : {}),
        },
      });
      let diff: SectionDiff[] = [];
      if (store.replaceSections && secRows) {
        try {
          const d = await store.replaceSections({ widget_id: job.widget_id, user_id: uid, page_id: p.id, url: p.url, title: ex.title, lang, sections: secRows });
          if (Array.isArray(d)) diff = d;
        } catch (e) { console.error("sections_save_error", String((e as Error).message ?? e).slice(0, 120)); }
      }
      // qué cambió en esta lectura (solo páginas nuevas o cambiadas); aditivo: un error acá nunca rompe la lectura
      if (store.recordChange && change !== "same") {
        try {
          await store.recordChange({ job_id: job.id, widget_id: job.widget_id, user_id: uid, url: p.url, title: ex.title || null, change, sections: diff });
        } catch (e) { console.error("change_save_error", String((e as Error).message ?? e).slice(0, 120)); }
      }
      // descubrir páginas nuevas desde los enlaces (el menú cuenta)
      if (depth < MAX_DEPTH && knownKeys.size < MAX_PAGES) {
        const add: PageRow[] = [];
        for (const href of ex.links) {
          if (knownKeys.size >= MAX_PAGES) break;
          const n = normalizeUrl(href, p.url);
          if (!n || knownKeys.has(n.key)) continue;
          const nu = new URL(n.url);
          if (normHost(nu.hostname) !== baseHost || !robotsAllowed(robots.rules, nu.pathname)) continue;
          knownKeys.add(n.key);
          add.push({ widget_id: job.widget_id, user_id: uid, job_id: job.id, url: n.url, status: "pending", flags: { depth: depth + 1 } });
        }
        if (add.length) await store.upsertPages(add);
      }
    } catch (e) {
      await store.updatePage(p.id, { status: "error", error: String((e as Error).message).slice(0, 300), fetched_at: iso });
    }
  }

  const c = await store.pageCounts(job.id);
  const done = c.pending === 0;
  const patch = {
    pages_found: c.total, pages_done: c.total - c.pending, pages_new: job.pages_new + inc.new,
    pages_changed: job.pages_changed + inc.changed, pages_same: job.pages_same + inc.same,
    updated_at: new Date().toISOString(), status: done ? "done" : "running",
    finished_at: done ? new Date().toISOString() : null,
  };
  await store.updateJob(job.id, patch);
  console.log("import_step", JSON.stringify({ processed, bytes, ms: Date.now() - t0, done }));
  return out(200, summary({ ...job, ...patch }));
}
