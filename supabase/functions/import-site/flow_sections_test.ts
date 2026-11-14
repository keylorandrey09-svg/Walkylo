// supabase/functions/import-site/flow_sections_test.ts
// Ejecutar: deno test -A flow_sections_test.ts  (necesita ./fixtures/*.html)
// Corre startJob/stepJob de verdad contra servidores locales (sin red real ni claves) y un almacén en memoria.
import { cfg } from "./lib.ts";
import { type Job, type PageRow, type SectionsArgs, startJob, type Store, stepJob } from "./flow.ts";
import { type ChangeRow, diffSections, type SectionDiff } from "./changes.ts";

cfg.allowLocal = true; // solo pruebas: permite 127.0.0.1

function eq(a: unknown, b: unknown, msg: string) { if (a !== b) throw new Error(`${msg}: esperado ${JSON.stringify(b)}, salió ${JSON.stringify(a)}`); }
function ok(c: unknown, msg: string) { if (!c) throw new Error(msg); }

function serve(html: string) {
  const ac = new AbortController();
  const s = Deno.serve({ port: 0, hostname: "127.0.0.1", signal: ac.signal, onListen() {} }, (req) => {
    const p = new URL(req.url).pathname;
    if (p === "/") return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    return new Response("no", { status: 404 });
  });
  return { url: `http://127.0.0.1:${(s.addr as Deno.NetAddr).port}/`, close: async () => { ac.abort(); await s.finished; } };
}
const fx = (n: string) => Deno.readTextFileSync(new URL(`./fixtures/${n}`, import.meta.url));

type PageMem = PageRow & { id: string; seq: number; content_hash: string | null; [k: string]: unknown };
class Mem implements Store {
  jobs: Job[] = [];
  pages: PageMem[] = [];
  secs = new Map<string, SectionsArgs>();
  history: SectionsArgs[] = [];
  failSections = false;
  seq = 0;
  changes: ChangeRow[] = [];
  failChange = false;
  // igual que el almacén real: compara con lo que había guardado y devuelve qué cambió
  replaceSections?: (a: SectionsArgs) => Promise<SectionDiff[] | void> = (a) => {
    if (this.failSections) return Promise.reject(new Error("boom"));
    const prev = (this.secs.get(a.page_id)?.sections ?? []).map((x, i) => ({ position: i, heading_path: x.heading_path, text: x.text, content_hash: x.content_hash }));
    const diff = diffSections(prev, a.sections);
    this.secs.set(a.page_id, a);
    this.history.push(a);
    return Promise.resolve(diff);
  };
  recordChange?: (r: ChangeRow) => Promise<void> = (r) => {
    if (this.failChange) return Promise.reject(new Error("boom_cambio"));
    this.changes.push(r); return Promise.resolve();
  };
  constructor(conSecciones = true) { if (!conSecciones) { this.replaceSections = undefined; this.recordChange = undefined; } }
  recentJobs(widgetId: string, since: string) { return Promise.resolve(this.jobs.filter((j) => j.widget_id === widgetId && j.created_at >= since).sort((a, b) => b.created_at.localeCompare(a.created_at))); }
  setJobStatus(id: string, status: string) { const j = this.jobs.find((x) => x.id === id); if (j) j.status = status; return Promise.resolve(); }
  createJob(row: { widget_id: string; user_id: string; start_url: string }) {
    const now = new Date().toISOString();
    const j: Job = { id: "job" + (++this.seq), ...row, status: "running", pages_found: 0, pages_done: 0, pages_new: 0, pages_changed: 0, pages_same: 0, error: null, created_at: now, updated_at: now, finished_at: null };
    this.jobs.push(j); return Promise.resolve(j);
  }
  getJob(userId: string, id: string) { return Promise.resolve(this.jobs.find((j) => j.id === id && j.user_id === userId) ?? null); }
  latestJob(widgetId: string) { return Promise.resolve([...this.jobs].reverse().find((j) => j.widget_id === widgetId) ?? null); }
  updateJob(id: string, patch: Record<string, unknown>) { const j = this.jobs.find((x) => x.id === id); if (j) Object.assign(j, patch); return Promise.resolve(); }
  upsertPages(rows: PageRow[]) {
    for (const r of rows) {
      const f = this.pages.find((p) => p.widget_id === r.widget_id && p.url === r.url);
      if (f) Object.assign(f, r); else this.pages.push({ ...r, id: "pg" + (++this.seq), seq: this.seq, content_hash: null });
    }
    return Promise.resolve();
  }
  pendingPages(jobId: string, limit: number) {
    return Promise.resolve(this.pages.filter((p) => p.job_id === jobId && p.status === "pending").sort((a, b) => a.seq - b.seq).slice(0, limit)
      .map((p) => ({ id: p.id, url: p.url, content_hash: p.content_hash, flags: p.flags })));
  }
  jobPageUrls(jobId: string) { return Promise.resolve(this.pages.filter((p) => p.job_id === jobId).map((p) => p.url)); }
  pageCounts(jobId: string) { const l = this.pages.filter((p) => p.job_id === jobId); return Promise.resolve({ total: l.length, pending: l.filter((p) => p.status === "pending").length }); }
  updatePage(id: string, patch: Record<string, unknown>) { const p = this.pages.find((x) => x.id === id); if (p) Object.assign(p, patch); return Promise.resolve(); }
}

async function readAll(store: Mem, url: string, w: { language?: string | null } = {}, now = Date.now()) {
  const widget = { id: "w1", site_url: url, ...w };
  const st = await startJob(store, "u1", widget, now);
  ok(st.status === 200, "startJob: " + JSON.stringify(st.body));
  const jobId = String(st.body.job_id);
  let last = st.body;
  for (let i = 0; i < 12 && last.status === "running"; i++) last = (await stepJob(store, "u1", widget, jobId)).body;
  eq(last.status, "done", "el trabajo termina");
  return last;
}

Deno.test("flujo: leer WalkyChat guarda secciones con estructura", async () => {
  const srv = serve(fx("walkychat-home.html"));
  try {
    const store = new Mem();
    const r = await readAll(store, srv.url, { language: "es" });
    eq(r.pages_new, 1, "una página nueva");
    eq(store.secs.size, 1, "secciones guardadas para 1 página");
    const a = [...store.secs.values()][0];
    ok(a.sections.length >= 40, "cantidad de secciones: " + a.sections.length);
    ok(a.sections.every((s) => /^[0-9a-f]{64}$/.test(s.content_hash)), "hash por sección");
    ok(a.sections.some((s) => s.kind === "steps" && s.text.includes("Paso 4")), "asistente de pasos");
    eq(a.lang, "es", "idioma");
    eq(a.widget_id, "w1", "widget"); eq(a.user_id, "u1", "usuario");
    const page = store.pages[0];
    eq((page.flags as { sections?: number }).sections, a.sections.length, "conteo de secciones en flags de la página");
    eq(page.status, "done", "página leída");
    ok(String(page.text).length > 1000 && String(page.hidden_text).length > 1000, "la lectura de siempre (texto y oculto) sigue intacta");
  } finally { await srv.close(); }
});

Deno.test("flujo: segunda lectura sin cambios da exactamente las mismas secciones", async () => {
  const srv = serve(fx("walkychat-home.html"));
  try {
    const store = new Mem();
    await readAll(store, srv.url);
    const r2 = await readAll(store, srv.url, {}, Date.now() + 2 * 3600_000);
    eq(r2.pages_same, 1, "la página no cambió");
    eq(store.history.length, 2, "se entregaron dos veces");
    eq(JSON.stringify(store.history[0].sections.map((s) => s.content_hash)), JSON.stringify(store.history[1].sections.map((s) => s.content_hash)), "mismos hashes");
    eq(store.history[0].page_id, store.history[1].page_id, "misma página");
  } finally { await srv.close(); }
});

Deno.test("flujo: si guardar secciones falla, la página igual queda leída", async () => {
  const srv = serve(fx("walkylet-home.html"));
  try {
    const store = new Mem(); store.failSections = true;
    const r = await readAll(store, srv.url);
    eq(r.status, "done", "el trabajo termina igual");
    eq(store.pages[0].status, "done", "página done");
    ok(String(store.pages[0].text).length > 500, "texto guardado");
    eq(store.secs.size, 0, "no se guardaron secciones");
  } finally { await srv.close(); }
});

Deno.test("compatibilidad: un almacén viejo (sin replaceSections) sigue funcionando igual", async () => {
  const srv = serve(fx("walkylet-home.html"));
  try {
    const store = new Mem(false);
    const r = await readAll(store, srv.url);
    eq(r.status, "done", "termina");
    eq((store.pages[0].flags as Record<string, unknown>).sections, undefined, "no se agrega nada a flags");
  } finally { await srv.close(); }
});

Deno.test("idioma: del widget (es, en, pt); cualquier otro valor cae en es", async () => {
  const srv = serve(fx("walkylet-home.html"));
  try {
    for (const [lang, esperado] of [["en", "en"], ["pt", "pt"], ["xx", "es"], [null, "es"], [undefined, "es"]] as const) {
      const store = new Mem();
      await readAll(store, srv.url, { language: lang });
      eq([...store.secs.values()][0].lang, esperado, `idioma ${lang}`);
    }
  } finally { await srv.close(); }
});

Deno.test("flujo: landing de Walkylet trae instalación, precios y preguntas frecuentes", async () => {
  const srv = serve(fx("walkylet-home.html"));
  try {
    const store = new Mem();
    await readAll(store, srv.url);
    const secs = [...store.secs.values()][0].sections;
    ok(secs.some((s) => s.text.includes("w.js")), "snippet de instalación");
    ok(secs.some((s) => /Pro/.test(s.text) && /Precios/.test(s.heading_path)), "precios");
    ok(secs.some((s) => s.kind === "faq"), "faq");
  } finally { await srv.close(); }
});

Deno.test("flujo: HTML roto no rompe la lectura", async () => {
  const srv = serve("<div><p>uno<div><h2>Título<ul><li>a<li>b</div>");
  try {
    const store = new Mem();
    const r = await readAll(store, srv.url);
    eq(r.status, "done", "termina");
    eq(store.pages[0].status, "done", "página done");
  } finally { await srv.close(); }
});

// ---------- qué cambió en cada lectura ----------
function serveDyn(get: () => string) {
  const ac = new AbortController();
  const s = Deno.serve({ port: 0, hostname: "127.0.0.1", signal: ac.signal, onListen() {} }, (req) => {
    const p = new URL(req.url).pathname;
    if (p === "/") return new Response(get(), { headers: { "content-type": "text/html; charset=utf-8" } });
    return new Response("no", { status: 404 });
  });
  return { url: `http://127.0.0.1:${(s.addr as Deno.NetAddr).port}/`, close: async () => { ac.abort(); await s.finished; } };
}
const para = (t: string) => `<p>${t} ${"Texto de relleno para que la sección sea lo bastante larga y no se una con la siguiente. ".repeat(4)}</p>`;
const pagina = (precio: string, extra = "") =>
  `<html><head><title>Inicio</title></head><body><main><h1>Producto</h1>${para("Hacemos cosas útiles para tu negocio.")}` +
  `<h2>Precios</h2>${para("Plan Free gratis.")}<p>${precio}</p>${extra}<h2>Contacto</h2>${para("Escribinos para consultas.")}</main></body></html>`;

Deno.test("cambios: en la primera lectura la página es 'new' y se anotan sus secciones; sin cambios no se anota nada", async () => {
  let html = pagina("Plan Pro 19 dólares al mes.");
  const srv = serveDyn(() => html);
  try {
    const store = new Mem();
    await readAll(store, srv.url);
    eq(store.changes.length, 1, "una página nueva"); eq(store.changes[0].change, "new", "es nueva");
    eq(store.changes[0].url, srv.url, "con su dirección"); eq(store.changes[0].title, "Inicio", "con su título");
    eq(store.changes[0].job_id, store.jobs[0].id, "de esta lectura"); eq(store.changes[0].user_id, "u1", "del dueño");
    ok(store.changes[0].sections.length >= 2 && store.changes[0].sections.every((x) => x.change === "new" && x.added === undefined), "solo los títulos de las secciones, sin líneas");
    await readAll(store, srv.url, {}, Date.now() + 2 * 3600_000);
    eq(store.changes.length, 1, "sin cambios no se anota nada nuevo");
  } finally { await srv.close(); }
});

Deno.test("cambios: una página cambiada anota QUÉ sección cambió y qué líneas se agregaron y quitaron (sin IA)", async () => {
  let html = pagina("Plan Pro 19 dólares al mes.");
  const srv = serveDyn(() => html);
  try {
    const store = new Mem();
    await readAll(store, srv.url);
    html = pagina("Plan Pro 25 dólares al mes.", "<p>Plan Equipo 99 dólares al mes.</p>");
    const r = await readAll(store, srv.url, {}, Date.now() + 2 * 3600_000);
    eq(r.pages_changed, 1, "una cambiada");
    eq(store.changes.length, 2, "la nueva de antes + la cambiada"); const c = store.changes[1];
    eq(c.change, "changed", "cambiada"); eq(c.job_id, store.jobs[1].id, "de la segunda lectura");
    const precios = c.sections.filter((x) => x.change === "changed");
    eq(precios.length, 1, "solo cambió UNA sección: " + JSON.stringify(c.sections));
    ok(/Precios/.test(precios[0].title), "la de Precios");
    ok(precios[0].added!.some((l) => /25 dólares/.test(l)) && precios[0].added!.some((l) => /Equipo 99/.test(l)), "líneas agregadas: " + JSON.stringify(precios[0].added));
    ok(precios[0].removed!.some((l) => /19 dólares/.test(l)), "línea quitada: " + JSON.stringify(precios[0].removed));
    ok(!c.sections.some((x) => /Contacto|Producto$/.test(x.title)), "lo que no cambió no aparece");
  } finally { await srv.close(); }
});

Deno.test("cambios: si guardar el registro falla (o el almacén no lo tiene), la lectura sigue igual", async () => {
  const srv = serveDyn(() => pagina("Plan Pro 19 dólares al mes."));
  try {
    const a = new Mem(); a.failChange = true;
    eq((await readAll(a, srv.url)).status, "done", "termina aunque falle el registro"); eq(a.pages[0].status, "done", "página leída"); eq(a.changes.length, 0, "no se anotó");
    const b = new Mem(); b.recordChange = undefined;
    eq((await readAll(b, srv.url)).status, "done", "almacén sin registro de cambios funciona como siempre");
    const c = new Mem(false); eq((await readAll(c, srv.url)).status, "done", "almacén viejo (sin secciones) también");
  } finally { await srv.close(); }
});

Deno.test("diffSections: nuevas, cambiadas, quitadas; títulos repetidos se emparejan por orden; topes de líneas y secciones", () => {
  const o = (t: string, text: string, i = 0) => ({ position: i, heading_path: t, text, content_hash: "h" + text });
  const n = (t: string, text: string) => ({ heading_path: t, text, content_hash: "h" + text });
  const d = diffSections([o("A", "uno\ndos"), o("B", "x", 1), o("C", "y", 2)], [n("A", "uno\ntres"), n("B", "x"), n("D", "nueva")]);
  eq(JSON.stringify(d.map((x) => x.change + ":" + x.title)), JSON.stringify(["changed:A", "new:D", "removed:C"]), "tipos y orden");
  eq(JSON.stringify(d[0].added), JSON.stringify(["tres"]), "agregada"); eq(JSON.stringify(d[0].removed), JSON.stringify(["dos"]), "quitada");
  // un título repetido: la 1.ª con la 1.ª y la 2.ª con la 2.ª
  const r = diffSections([o("Q", "a"), o("Q", "b", 1)], [n("Q", "a"), n("Q", "c")]);
  eq(r.length, 1, "solo cambió la segunda"); eq(JSON.stringify(r[0].added), JSON.stringify(["c"]), "la segunda ahora dice c");
  // repeticiones: si estaba una vez y ahora dos, sobra una
  const rep = diffSections([o("R", "x")], [n("R", "x\nx")]); eq(JSON.stringify(rep[0].added), JSON.stringify(["x"]), "una repetida de más");
  // topes
  const largo = Array.from({ length: 20 }, (_, i) => "línea " + i).join("\n");
  const t = diffSections([o("T", "base")], [n("T", "base\n" + largo)]);
  eq(t[0].added!.length, 9, "8 líneas y el aviso"); ok(/… y 12 más/.test(t[0].added![8]), "aviso con cuántas faltan");
  const un = diffSections([o("U", "z")], [n("U", "q".repeat(500))]); ok(un[0].added![0].length <= 200, "línea larga cortada");
  const muchas = diffSections([], Array.from({ length: 50 }, (_, i) => n("S" + i, "t" + i))); eq(muchas.length, 30, "como máximo 30 secciones");
  eq(diffSections([], []).length, 0, "vacío"); eq(diffSections([o("A", "a")], [n("A", "a")]).length, 0, "igual no da nada");
  eq(diffSections([o("", "a")], [n("", "b")])[0].title, "(sin título)", "sin título");
});
