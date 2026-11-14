// supabase/functions/import-site/cards_test.ts   Ejecutar: deno test -A cards_test.ts
// Sin red ni claves: secciones reales de las páginas de prueba, almacén en memoria e IA falsa.
import { extractSections } from "./sections.ts";
import { sha256 } from "./lib.ts";
import { type AiArgs, aiCfg } from "./summarize.ts";
import {
  aiCard, BATCH_MAX_CHARS, BATCH_MAX_SECTIONS, buildCardsInput, buildCatalog, CARDS_ATTEMPTS_DAILY, CARDS_INSTRUCTIONS, CARDS_VERSION,
  cancelCards, type CardMeta, type CardRow, type CardRun, type CardSection, type CardsStore, cardsStatus, codeCard, coverage, deriveLinks, lastGeneratedAt,
  type LinkRow, makeBatches, MAX_RELATED, norm, normalizeRun, numberLines, parseCards, parseEvidence, pendingSections, rawLines, RUN_STALE_MIN, runTargets, sourceLink, startCards, type StagedItem,
  stepCards, titleOf, ungroundedQuotes, validateRelated,
  MAX_INLINE_LINKS, resolveInlineRefs,
  coverageByGroup, editCardText, groupOf, MAX_EDIT_CHARS, unEditCardText,
} from "./cards.ts";

function eq(a: unknown, b: unknown, msg: string) { if (a !== b) throw new Error(`${msg}: esperado ${JSON.stringify(b)}, salió ${JSON.stringify(a)}`); }
function ok(c: unknown, msg: string) { if (!c) throw new Error(msg); }

async function realSections(): Promise<CardSection[]> {
  const secs = extractSections(Deno.readTextFileSync(new URL("./fixtures/walkychat-home.html", import.meta.url))).sections;
  const res: CardSection[] = [];
  for (const s of secs) {
    res.push({ id: "s" + s.position, widget_id: "w1", user_id: "u1", document_url: "https://walkychat.app/", position: s.position, kind: s.kind,
      is_hidden: s.is_hidden, heading_path: s.heading_path, text: s.text, content_hash: await sha256(s.heading_path + "\u0000" + s.text), lang: "es", anchor: s.anchor });
  }
  return res;
}
const mk = (id: string, title: string, kind = "screen", text = "Texto de la sección " + id + " con varias palabras para que no sea corta.", doc = "https://x.com/", pos = 0): CardSection =>
  ({ id, widget_id: "w1", user_id: "u1", document_url: doc, position: pos, kind, is_hidden: false, heading_path: title, text, content_hash: "h-" + id + "-" + text.length, lang: "es", anchor: null });

// ---------- almacén en memoria ----------
class Mem implements CardsStore {
  secs: CardSection[] = [];
  cards = new Map<string, CardRow & { updated_at: string; edited_at?: string | null; purpose_ai?: string | null }>();
  aiLinks: LinkRow[] = [];
  codeLinks: LinkRow[] = [];
  runs: CardRun[] = [];
  usage = { in: 0, out: 0, writes: 0 };
  language = "es";
  tick = 1_800_000_000_000;
  staged = new Map<string, Map<string, StagedItem>>();
  failApply = false;
  now() { this.tick += 1000; return new Date(this.tick).toISOString(); }
  widgetBasic(uid: string) { return Promise.resolve(uid === "u1" ? { id: "w1", language: this.language } : null); }
  allSections() { return Promise.resolve(this.secs); }
  cardMetas(): Promise<CardMeta[]> { return Promise.resolve([...this.cards.values()].map((c) => ({ section_id: c.section_id, section_hash: c.section_hash, version: c.version, updated_at: c.updated_at, edited_at: c.edited_at ?? null }))); }
  stageItems(runId: string, items: StagedItem[]) { const m = this.staged.get(runId) ?? new Map(); for (const it of items) m.set(it.section_id, it); this.staged.set(runId, m); return Promise.resolve(); }
  stagedIds(runId: string) { return Promise.resolve([...(this.staged.get(runId)?.keys() ?? [])]); }
  discardStaged(runId: string) { this.staged.delete(runId); return Promise.resolve(); }
  // igual que apply_card_run: solo con la corrida en curso; tarjetas y enlaces de IA se reemplazan juntos; si falla, no cambia nada
  applyRun(runId: string) {
    if (this.failApply) return Promise.reject(new Error("db_apply"));
    const run = this.runs.find((r) => r.id === runId);
    if (!run || run.status !== "running") return Promise.reject(new Error("corrida_no_activa"));
    // igual que el SQL: una tarjeta editada por el dueño NO se pisa, salvo que esté entre las elegidas a propósito (scope)
    const items = [...(this.staged.get(runId)?.values() ?? [])].filter((it) => {
      const cur = this.cards.get(it.section_id);
      return !cur?.edited_at || (run.scope?.includes(it.section_id) ?? false);
    });
    for (const it of items) this.cards.set(it.section_id, { ...it.card, updated_at: this.now(), edited_at: null, purpose_ai: null });
    const ids = items.map((i) => i.section_id);
    this.aiLinks = [...this.aiLinks.filter((l) => !ids.includes(l.from_section)), ...items.flatMap((i) => i.links)];
    this.staged.delete(runId);
    return Promise.resolve();
  }
  replaceCodeLinks(_w: string, rows: LinkRow[]) { this.codeLinks = rows; return Promise.resolve(); }
  recentCardRuns(_w: string, since: string) { return Promise.resolve(this.runs.filter((r) => Date.parse(r.started_at) >= Date.parse(since)).slice().reverse()); }
  createCardRun(row: { widget_id: string; user_id: string; force: boolean; version: string; scope?: string[] | null; scope_group?: "public" | "internal" | null }) {
    const r: CardRun = { id: "run" + (this.runs.length + 1), ...row, scope: row.scope ?? null, scope_group: row.scope_group ?? null, status: "running", total: 0, done: 0, degraded: 0, steps: 0, calls: 0, tokens_in: 0, tokens_out: 0, effort: null, error: null, started_at: this.now(), updated_at: this.now() };
    this.runs.push(r); return Promise.resolve({ ...r });
  }
  getCardRun(uid: string, id: string) { const r = this.runs.find((x) => x.id === id && x.user_id === uid); return Promise.resolve(r ? { ...r } : null); }
  updateCardRun(id: string, patch: Record<string, unknown>) { Object.assign(this.runs.find((r) => r.id === id)!, patch); return Promise.resolve(); }
  editCard(_w: string, sectionId: string, purpose: string) {
    const c = this.cards.get(sectionId); if (!c) return Promise.resolve(false);
    c.purpose_ai = c.edited_at && c.purpose_ai != null ? c.purpose_ai : c.purpose; c.purpose = purpose; c.edited_at = this.now();
    return Promise.resolve(true);
  }
  unEditCard(_w: string, sectionId: string) {
    const c = this.cards.get(sectionId); if (!c || !c.edited_at || c.purpose_ai == null) return Promise.resolve(null);
    const o = c.purpose_ai; c.purpose = o; c.purpose_ai = null; c.edited_at = null; return Promise.resolve(o);
  }
  addUsage(_u: string, i: number, o: number) { this.usage.in += i; this.usage.out += o; this.usage.writes++; return Promise.resolve(); }
  async stepAll(runId: string, max = 50) {
    let last: Record<string, unknown> = {};
    for (let i = 0; i < max; i++) { const r = await stepCards(this, "u1", { id: "w1" }, runId); last = r.body; if (r.body.status !== "running") break; }
    return last;
  }
}

// IA falsa: lee el prompt (líneas numeradas) y devuelve una tarjeta por cada "### [n]" que haya que describir. Cita un botón REAL de la sección.
function fakeAI(o: {
  related?: (n: number, total: number) => string; skip?: number[]; inventado?: number[]; fuente?: string;
  fail?: (call: number, a: AiArgs) => Error | null; tIn?: number;
} = {}) {
  const calls: AiArgs[] = [];
  aiCfg.call = (a: AiArgs) => {
    calls.push(a);
    const err = o.fail?.(calls.length, a);
    if (err) return Promise.reject(err);
    const [cat, desc] = a.input.split("SECCIONES A DESCRIBIR");
    const total = (cat.match(/^\[\d+\]/gm) ?? []).length;
    const text = desc.split(/^### \[/m).slice(1).map((blk) => {
      const n = Number(blk.match(/^(\d+)\]/)![1]);
      if (o.skip?.includes(n)) return "";
      const lines = blk.split("\n").slice(1).filter((l) => /^\d+\| /.test(l));
      const boton = lines.map((l) => l.match(/^\d+\| Botón: (.+)$/)?.[1]).find(Boolean);
      const cita = o.inventado?.includes(n) ? " Incluye el botón «Botón que no existe»." : boton ? ` Incluye el botón «${boton}».` : "";
      return `#${n}\nSIRVE: Sirve para la sección ${n}.${cita}\nFUENTE: ${o.fuente ?? `1-${Math.min(2, lines.length)}`}\nBUSCAR: sinónimo ${n}; modo noche; forma coloquial\nRELACIONADAS: ${o.related ? o.related(n, total) : "ninguna"}`;
    }).filter(Boolean).join("\n\n");
    return Promise.resolve({ text, tIn: o.tIn ?? 1000, tOut: 300 });
  };
  return calls;
}
const withEnv = async (k: string, v: string | undefined, fn: () => Promise<void>) => {
  const old = Deno.env.get(k);
  if (v === undefined) Deno.env.delete(k); else Deno.env.set(k, v);
  try { await fn(); } finally { if (old === undefined) Deno.env.delete(k); else Deno.env.set(k, old); }
};

// ---------- enlaces por código ----------
Deno.test("enlaces por código con las secciones REALES: el menú lleva a sus pantallas (por nombre completo, de pantalla o del último tramo)", async () => {
  const secs = await realSections();
  const links = deriveLinks(secs);
  const t = (id: string) => titleOf(secs.find((x) => x.id === id)!);
  const desde = (menu: string) => links.filter((l) => t(l.from_section) === menu && l.kind === "menu").map((l) => l.label + "→" + t(l.to_section));
  const lateral = desde("Menú (sidebar)");
  for (const par of ["Proyectos→Proyectos", "Automatizaciones→Aún no tienes automatizaciones", "Analíticas→Aún no hay datos", "Registros→Registros",
    "Despliegues→Despliegues", "Notificaciones→Notificaciones", "Configuración→Configuración", "Soporte→Soporte"]) ok(lateral.includes(par), "falta el enlace " + par + " en " + lateral.join(" | "));
  ok(links.length >= 15 && links.length <= 40, "cantidad razonable de enlaces: " + links.length);
  const ids = new Set(secs.map((s) => s.id));
  ok(links.every((l) => ids.has(l.from_section) && ids.has(l.to_section)), "todos apuntan a secciones que existen");
  ok(links.every((l) => l.from_section !== l.to_section), "ninguno a sí mismo");
  ok(links.every((l) => l.source === "code" && ["menu", "button"].includes(l.kind)), "origen y tipo");
  eq(new Set(links.map((l) => `${l.from_section}|${l.to_section}|${l.kind}|${l.label}`)).size, links.length, "sin repetidos");
  ok(!links.some((l) => /^(cerrar sesi|plan free|0 \/)/i.test(l.label)), "ítems sin destino (Cerrar sesión, contadores) no generan enlace");
  // cada enlace sabe en QUÉ LÍNEA del texto de origen nace (para poder mostrarlo como enlace azul en esa línea)
  for (const l of links) {
    const from = secs.find((x) => x.id === l.from_section)!;
    const linea = rawLines(from.text)[(l.line ?? 0) - 1] ?? "";
    ok(l.line && linea.replace(/^(Botón|Campo|Selector|Opción|Enlace):\s*/, "").trim() === l.label, `línea ${l.line} de «${titleOf(from)}» = «${linea}», no «${l.label}»`);
  }
  const conf = links.find((l) => t(l.from_section) === "Menú (sidebar)" && l.label === "Configuración")!;
  eq(rawLines(secs.find((x) => x.id === conf.from_section)!.text)[conf.line! - 1], "Configuración", "el ítem Configuración del menú lateral está en la línea " + conf.line);
});

Deno.test("enlaces por código: el nombre de la pantalla gana al último tramo, lo ambiguo no se enlaza y lo genérico se ignora", () => {
  const menu = mk("m", "Menú (principal)", "menu", "Ajustes\nInicio\nCancelar\nCerrar\nVer", "https://x.com/", 0);
  const a = mk("a", "Ajustes", "screen", "x".repeat(50), "https://x.com/", 1);
  const b = mk("b", "Inicio › Bienvenida", "screen", "y".repeat(50), "https://x.com/", 2);
  const c = mk("c", "Otra cosa › Inicio", "screen", "z".repeat(50), "https://x.com/", 3);
  const d = mk("d", "Ajustes › Cuenta", "screen", "w".repeat(50), "https://x.com/", 4);
  const links = deriveLinks([menu, a, b, c, d]);
  const to = (label: string) => links.filter((l) => l.label === label).map((l) => l.to_section);
  eq(to("Ajustes").join(), "a", "'Ajustes' → la pantalla que se llama exactamente así (no 'Ajustes › Cuenta')");
  eq(to("Inicio").join(), "b", "'Inicio' → la pantalla cuyo NOMBRE es Inicio (primer tramo), no la que lo tiene al final");
  ok(!to("Cancelar").length && !to("Cerrar").length, "botones genéricos no se enlazan");
  // dos pantallas con el mismo rango y tipo: ambiguo → ninguno
  const e1 = mk("e1", "Panel", "screen", "p".repeat(50), "https://x.com/", 5), e2 = mk("e2", "Panel", "screen", "q".repeat(50), "https://x.com/", 6);
  const amb = deriveLinks([mk("m2", "Menú (x)", "menu", "Panel", "https://x.com/", 0), e1, e2]);
  eq(amb.length, 0, "ambiguo (dos pantallas iguales): no se enlaza");
  // una pantalla gana a una página del mismo nombre
  const f1 = mk("f1", "Panel", "info", "p".repeat(50), "https://x.com/", 5), f2 = mk("f2", "Panel", "screen", "q".repeat(50), "https://x.com/", 6);
  eq(deriveLinks([mk("m3", "Menú (x)", "menu", "Panel", "https://x.com/", 0), f1, f2])[0].to_section, "f2", "desempata por tipo: pantalla antes que página");
  // botón de una sección que lleva a otra
  const bt = deriveLinks([mk("g1", "Inicio", "screen", "Botón: Ajustes\nBotón: Guardar", "https://x.com/", 0), mk("g2", "Ajustes", "screen", "x".repeat(50), "https://x.com/", 1)]);
  eq(bt.length, 1, "un botón cuyo nombre es otra sección lleva a ella"); eq(bt[0].kind, "button", "tipo botón");
  eq(norm("¡Configuración!"), "configuracion", "norm quita tildes, mayúsculas y signos finales");
});

// ---------- qué falta, tandas y catálogo ----------
Deno.test("pendientes: sin tarjeta, texto cambiado, otra versión; y qué rehace cada tipo de corrida (elegidas, todas, o las que faltan)", () => {
  const a = mk("a", "A"), b = mk("b", "B"), c = mk("c", "C"), d = mk("d", "D");
  const metas: CardMeta[] = [
    { section_id: "a", section_hash: a.content_hash, version: CARDS_VERSION, updated_at: "2026-11-13T10:00:00Z" },
    { section_id: "b", section_hash: "OTRA", version: CARDS_VERSION, updated_at: "2026-11-13T10:00:00Z" },
    { section_id: "c", section_hash: c.content_hash, version: "c0", updated_at: "2026-11-13T10:00:00Z" },
  ];
  const ids = (x: CardSection[]) => x.map((s) => s.id).join();
  eq(ids(pendingSections([a, b, c, d], metas, { version: CARDS_VERSION })), "b,c,d", "cambiada, vieja y sin tarjeta; la fresca no");
  eq(ids(runTargets([a, b, c, d], metas, { force: false, version: CARDS_VERSION })), "b,c,d", "corrida normal: lo que falta o está viejo");
  eq(ids(runTargets([a, b, c, d], metas, { force: true, version: CARDS_VERSION })), "a,b,c,d", "forzar: todas, aunque estén al día");
  eq(ids(runTargets([a, b, c, d], metas, { force: false, version: CARDS_VERSION, scope: ["a", "d", "zzz"] })), "a,d", "elegidas: solo esas (aunque 'a' esté al día y 'b' esté vieja); un id que no existe se ignora");
  eq(ids(runTargets([a, b, c, d], metas, { force: true, version: CARDS_VERSION, scope: ["c"] })), "c", "si hay elegidas, mandan sobre 'todas'");
  eq(ids(runTargets([a, b], metas, { force: false, version: CARDS_VERSION, scope: [] })), "b", "una lista vacía no cuenta como elección");
  eq(ids(pendingSections([a], metas, { version: "c2" })), "a", "otra versión del generador: todas pendientes");
});

Deno.test("tandas: NUNCA se corta una sección; una más grande que el límite va sola y entera; todo se reparte exactamente una vez", async () => {
  const gigante = mk("big", "Gigante", "legal", "G".repeat(BATCH_MAX_CHARS + 5000), "https://x.com/", 3);
  const chicas = Array.from({ length: 20 }, (_, i) => mk("c" + i, "Chica " + i, "info", "c".repeat(600), "https://x.com/", i + 10));
  const todas = [...chicas.slice(0, 3), gigante, ...chicas.slice(3)];
  const tandas = makeBatches(todas);
  const ids = tandas.flat().map((s) => s.id);
  eq(ids.length, todas.length, "ninguna se pierde"); eq(new Set(ids).size, ids.length, "ninguna se repite");
  const t = tandas.find((x) => x.some((s) => s.id === "big"))!;
  eq(t.length, 1, "la gigante va sola"); eq(t[0].text.length, BATCH_MAX_CHARS + 5000, "y entera, sin recortar");
  ok(tandas.every((x) => x.length <= BATCH_MAX_SECTIONS), "ninguna tanda pasa del máximo de secciones");
  ok(tandas.filter((x) => x.length > 1).every((x) => x.reduce((n, s) => n + s.text.length, 0) <= BATCH_MAX_CHARS), "las tandas de varias respetan el máximo de caracteres");
  const reales = await realSections();
  const tr = makeBatches(reales);
  eq(tr.flat().reduce((n, s) => n + s.text.length, 0), reales.reduce((n, s) => n + s.text.length, 0), "con las secciones reales: se reparten TODOS los caracteres");
});

Deno.test("catálogo: numeración estable por (documento, posición), con todas las secciones; el insumo lleva el texto COMPLETO de lo que se describe", async () => {
  const reales = await realSections();
  const cat = buildCatalog([...reales].reverse());
  eq(cat.idOf.size, reales.length, "todas numeradas");
  eq(cat.text.split("\n").length, reales.length, "una línea por sección");
  eq(buildCatalog(reales).text, cat.text, "el orden de entrada no cambia la numeración");
  const larga = reales.reduce((m, s) => (s.text.length > m.text.length ? s : m));
  const inp = buildCardsInput([larga], cat);
  ok(inp.includes(numberLines(larga.text)), "el texto completo de la sección más larga (" + larga.text.length + " caracteres), con sus líneas numeradas, está en el insumo");
  ok(inp.includes("CATÁLOGO DE SECCIONES") && inp.includes("SECCIONES A DESCRIBIR"), "las dos partes");
});

// ---------- formato de la IA ----------
Deno.test("parseCards: tolera markdown, ### y SIRVE en varias líneas; la FUENTE se valida contra las líneas que EXISTEN; relacionadas con línea", () => {
  const txt = [
    "Acá van las tarjetas:", "### [12] Configuración", "**SIRVE:** Pantalla de preferencias.", "Permite elegir «Oscuro».", "FUENTE: 2, 4-5, 40, 6-3",
    "BUSCAR: modo noche; Tema Oscuro, apariencia.", "RELACIONADAS: [3], 7 (línea 2), [9], 7",
    "", "#13", "- SIRVE: Otra cosa.", "- FUENTE: 0, 99", "- BUSCAR: uno; uno; dos", "- RELACIONADAS: ninguna", "", "#99", "SIRVE: no pedida", "RELACIONADAS: 1", "#14", "BUSCAR: sin sirve",
  ].join("\n");
  const r = parseCards(txt, new Map([[12, 6], [13, 3], [14, 3]]));
  eq(r.size, 2, "solo las pedidas y con 'SIRVE' (la 99 no estaba pedida; la 14 no tiene SIRVE)");
  const c12 = r.get(12)!;
  eq(c12.purpose, "Pantalla de preferencias. Permite elegir «Oscuro».", "SIRVE de varias líneas, sin markdown");
  eq(c12.keywords.join("|"), "modo noche|tema oscuro|apariencia", "sinónimos en minúscula, sin puntos finales");
  eq(c12.evidence, "2, 4-5", "fuente: 40 no existe (la sección tiene 6 líneas) y 6-3 es un rango inválido");
  eq(JSON.stringify(c12.related), JSON.stringify([{ n: 3 }, { n: 7, line: 2 }, { n: 9 }]), "relacionadas con corchetes, con línea, sin repetir");
  eq(r.get(13)!.keywords.join("|"), "uno|dos", "sinónimos sin repetir"); eq(r.get(13)!.related.length, 0, "'ninguna'"); eq(r.get(13)!.evidence, "", "fuente inválida: vacía");
  eq(parseCards("sin formato ninguno", new Map([[1, 2]])).size, 0, "texto sin formato: no se inventa nada");
  eq(parseEvidence("1, 1, 2-3, 3", 5), "1-3", "forma canónica: sin repetidos y con las seguidas unidas"); eq(parseEvidence("5, 1, 3", 5), "1, 3, 5", "ordenadas"); eq(parseEvidence("", 5), "", "vacío");
});

Deno.test("relacionadas: solo existen, nunca la propia, sin repetir y con tope; todo lo demás se descarta", () => {
  const secs = Array.from({ length: 12 }, (_, i) => mk("s" + i, "Sec " + i, "screen", "a\nb\nc", "https://x.com/", i));
  const cat = buildCatalog(secs);
  const own = cat.numOf.get("s0")!;
  const rel = [own, 999, 2, 2, 3, 4, 5, 6, 7, 8, 0, -1].map((n) => ({ n }));
  const l = validateRelated(secs[0], rel, cat.idOf, cat.numOf);
  eq(l.length, MAX_RELATED, "tope de relacionadas");
  ok(!l.some((x) => x.to_section === "s0"), "nunca la propia"); ok(l.every((x) => cat.idOf.has(cat.numOf.get(x.to_section)!)), "solo existentes");
  ok(l.every((x) => x.kind === "related" && x.source === "ai" && x.label === ""), "tipo y origen");
  eq(validateRelated(secs[0], [{ n: 999 }, { n: 1000 }], cat.idOf, cat.numOf).length, 0, "números inventados: nada");
  const conLinea = validateRelated(secs[0], [{ n: 2, line: 3 }, { n: 3, line: 4 }, { n: 4, line: 0 }, { n: 5 }], cat.idOf, cat.numOf);
  eq(conLinea.map((x) => x.line ?? "-").join(","), "3,-,-,-", "la línea 3 existe (la sección tiene 3); la 4 y la 0 no; sin línea = null");
});

Deno.test("líneas numeradas: el prompt lleva el número de cada línea (sin alterar el texto) y el origen real se calcula bien", async () => {
  eq(numberLines("a\nb\nc"), "1| a\n2| b\n3| c", "numeración desde 1");
  eq(rawLines("a\n\nb").length, 3, "las líneas vacías cuentan, así el número coincide con el texto guardado");
  const reales = await realSections(); const cat = buildCatalog(reales);
  const larga = reales.reduce((m, s) => (s.text.split("\n").length > m.text.split("\n").length ? s : m));
  const inp = buildCardsInput([larga], cat); const n = larga.text.split("\n").length;
  ok(inp.includes(`${n}| ${larga.text.split("\n")[n - 1]}`), "la última línea (" + n + ") está numerada en el insumo");
  ok(!inp.includes(larga.text), "el texto va numerado, no pegado crudo");
  ok(CARDS_INSTRUCTIONS.includes("NO es parte del texto") && CARDS_INSTRUCTIONS.includes("FUENTE:") && CARDS_INSTRUCTIONS.includes('"7 (línea 3)"'), "las instrucciones explican la numeración, la fuente y la línea del enlace");
  const vis = { document_url: "https://walkychat.app/", anchor: "lp-precios", is_hidden: false, kind: "info" };
  eq(sourceLink(vis).url, "https://walkychat.app/#lp-precios", "visible con ancla: lleva directo"); eq(sourceLink(vis).exact, true, "exacto");
  eq(sourceLink({ ...vis, is_hidden: true }).url, "https://walkychat.app/", "pantalla de la app: la página donde vive"); eq(sourceLink({ ...vis, is_hidden: true }).exact, false, "no exacto");
  eq(sourceLink({ ...vis, kind: "ui" }).exact, false, "una ventana no se abre con un ancla"); eq(sourceLink({ ...vis, anchor: null }).exact, false, "sin ancla");
  eq(sourceLink({ document_url: "https://x.com/p#viejo", anchor: "nuevo", is_hidden: false, kind: "info" }).url, "https://x.com/p#nuevo", "reemplaza un ancla vieja de la dirección");
});

Deno.test("citas: una tarjeta solo puede nombrar botones y campos que EXISTEN en su sección; si inventa uno, no se acepta", async () => {
  const sec = mk("a", "Soporte", "ui", "Describe el problema o tu consulta…\nBotón: Enviar mensaje\nBotón: Cancelar");
  eq(ungroundedQuotes("Incluye el botón «Enviar mensaje» y «Cancelar».", sec).length, 0, "nombres reales: ok");
  eq(ungroundedQuotes('Escribí en "Describe el problema o tu consulta" y tocá “enviar mensaje”.', sec).length, 0, "con otras comillas, sin tildes ni mayúsculas, y con el título: ok");
  eq(ungroundedQuotes("Incluye «Borrar todo» y «Enviar mensaje».", sec).join(), "Borrar todo", "un nombre inventado se detecta");
  eq(ungroundedQuotes("Sin comillas no hay nada que comprobar.", sec).length, 0, "sin citas: nada");
  const st = new Mem(); st.secs = (await realSections()).slice(0, 6); fakeAI({ inventado: [2] });
  const r = await startCards(st, "u1", { id: "w1" }); const fin = await st.stepAll(String(r.body.run_id));
  eq(fin.degraded, 1, "la tarjeta con la cita inventada se degrada"); const c = [...st.cards.values()].filter((x) => x.source === "code");
  eq(c.length, 1, "queda una de código en su lugar"); ok(!c[0].purpose.includes("Botón que no existe"), "y la invención no se guardó");
  eq([...st.cards.values()].filter((x) => x.source === "ai").length, 5, "las otras 5 son de IA");
});

Deno.test("fuente y línea del enlace de IA: se guardan solo si existen en la sección", async () => {
  const st = new Mem(); st.secs = (await realSections()).slice(0, 4);
  fakeAI({ fuente: "1-2, 500", related: (n, total) => `${(n % total) + 1} (línea 1), ${((n + 1) % total) + 1} (línea 999)` });
  const r = await startCards(st, "u1", { id: "w1" }); await st.stepAll(String(r.body.run_id));
  const tarjetas = [...st.cards.values()];
  ok(tarjetas.every((c) => c.evidence === "1-2" || c.evidence === "1"), "la fuente 500 (que no existe) se descartó: " + tarjetas.map((c) => c.evidence).join("|"));
  ok(st.aiLinks.some((l) => l.line === 1), "una línea válida se guarda"); ok(st.aiLinks.some((l) => l.line == null), "una línea que no existe se guarda como 'sin línea'");
  ok(st.aiLinks.every((l) => l.line == null || (l.line >= 1 && l.line <= rawLines(st.secs.find((s) => s.id === l.from_section)!.text).length)), "ninguna línea fuera de rango");
});

Deno.test("tarjeta de respaldo (código): describe tipo, título y elementos con sus nombres, y no inventa", () => {
  const c = codeCard(mk("a", "Configuración", "screen", "Controla tu cuenta\nBotón: Eliminar cuenta\nBotón: Cerrar sesión\nCampo: Nombre"), "es");
  eq(c.source, "code", "origen"); eq(c.keywords, "", "sin sinónimos");
  ok(c.purpose.startsWith("Pantalla de la app «Configuración».") && c.purpose.includes("Eliminar cuenta, Cerrar sesión, Nombre"), c.purpose);
  ok(codeCard(mk("m", "Menú (x)", "menu", "Proyectos\nSoporte"), "es").purpose.includes("Ofrece: Proyectos, Soporte"), "menú: a dónde lleva");
  eq(aiCard(mk("a", "A"), { purpose: "p", keywords: ["a", "b"], related: [], evidence: "1" }, "es").keywords, "a; b", "sinónimos unidos");
});

// ---------- generación ----------
Deno.test("generación completa: tarjetas para TODAS las secciones, por tandas, con progreso real y sin recortar nada", async () => {
  const st = new Mem(); st.secs = await realSections();
  const calls = fakeAI({ related: (n, total) => `${n}, ${(n % total) + 1}, 999` });
  const r = await startCards(st, "u1", { id: "w1" });
  eq(r.status, 200, "200"); eq(r.body.total, st.secs.length, "total = todas"); eq(r.body.status, "running", "en curso");
  eq(st.codeLinks.length, 0, "los enlaces por código se recalculan al terminar (no al empezar): hasta entonces no cambia nada");
  const runId = String(r.body.run_id);
  const progreso: number[] = [];
  let ult: Record<string, unknown> = {};
  for (let i = 0; i < 30; i++) { ult = (await stepCards(st, "u1", { id: "w1" }, runId)).body; progreso.push(Number(ult.done)); if (ult.status !== "running") break; }
  eq(ult.status, "done", "terminó"); eq(ult.done, st.secs.length, "hechas todas"); eq(ult.pending, 0, "ninguna pendiente");
  ok(progreso.every((x, i) => i === 0 || x > progreso[i - 1]), "el progreso sube en cada paso: " + progreso.join(","));
  eq(calls.length, Math.ceil(st.secs.length / BATCH_MAX_SECTIONS) <= calls.length ? calls.length : -1, "una llamada por tanda");
  eq(st.cards.size, st.secs.length, "una tarjeta por sección");
  ok([...st.cards.values()].every((c) => c.source === "ai" && c.purpose && c.keywords.includes("modo noche") && c.version === CARDS_VERSION), "tarjetas de IA completas");
  ok(st.aiLinks.every((l) => l.source === "ai" && l.kind === "related" && l.from_section !== l.to_section && st.secs.some((s) => s.id === l.to_section)), "enlaces de IA válidos");
  ok(!st.aiLinks.some((l) => l.label !== ""), "sin enlaces inventados");
  ok(st.codeLinks.length >= 15, "los enlaces por código se arman al terminar: " + st.codeLinks.length);
  ok(st.usage.in > 0 && st.usage.writes === calls.length, "el consumo se registra en cada paso");
  const largo = st.secs.reduce((m, s) => (s.text.length > m.text.length ? s : m));
  ok(calls.some((c) => c.input.includes(numberLines(largo.text))), "la sección más larga llegó ENTERA a la IA (con sus líneas numeradas)");
  const run = st.runs[0]; ok(run.tokens_in === calls.length * 1000 && run.status === "done" && run.steps === calls.length, "la corrida lleva sus cuentas");
});

Deno.test("incremental: si solo cambió una sección, solo esa se vuelve a pedir; sin cambios no hay ni corrida ni IA", async () => {
  const st = new Mem(); st.secs = await realSections(); fakeAI();
  const r1 = await startCards(st, "u1", { id: "w1" }); await st.stepAll(String(r1.body.run_id));
  const calls = fakeAI();
  const sin = await startCards(st, "u1", { id: "w1" });
  eq(sin.body.up_to_date, true, "al día"); eq(calls.length, 0, "sin llamadas"); eq(st.runs.length, 1, "no crea una corrida inútil");
  eq(sin.body.fresh, st.secs.length, "cobertura: todas frescas");
  st.secs[10] = { ...st.secs[10], text: st.secs[10].text + " (texto nuevo)", content_hash: "NUEVO" };
  const r2 = await startCards(st, "u1", { id: "w1" });
  eq(r2.body.total, 1, "una sola pendiente"); await st.stepAll(String(r2.body.run_id));
  eq(calls.length, 1, "una sola llamada");
  const inp = calls[0].input;
  eq((inp.split("SECCIONES A DESCRIBIR")[1].match(/^### \[/gm) ?? []).length, 1, "solo esa sección se describe");
  eq((inp.split("SECCIONES A DESCRIBIR")[0].match(/^\[\d+\]/gm) ?? []).length, st.secs.length, "pero el catálogo trae TODAS (para poder relacionarla)");
  eq(st.cards.get(st.secs[10].id)!.section_hash, "NUEVO", "la tarjeta quedó hecha sobre el texto nuevo");
});

Deno.test("forzar: regenera todas aunque estén al día; después, sin forzar, ya no hay nada", async () => {
  const st = new Mem(); st.secs = (await realSections()).slice(0, 12); fakeAI();
  const r1 = await startCards(st, "u1", { id: "w1" }); await st.stepAll(String(r1.body.run_id));
  const calls = fakeAI();
  const r2 = await startCards(st, "u1", { id: "w1" }, { force: true });
  eq(r2.body.total, 12, "forzar: todas"); const fin = await st.stepAll(String(r2.body.run_id));
  eq(fin.status, "done", "terminó"); eq(calls.length, 2, "12 secciones = 2 tandas");
  eq((await startCards(st, "u1", { id: "w1" })).body.up_to_date, true, "después, al día");
});

Deno.test("si la IA no devuelve la tarjeta de una sección, se arma una por código (con aviso) y los números inventados se ignoran", async () => {
  const st = new Mem(); st.secs = (await realSections()).slice(0, 5); const faltante = 3;
  fakeAI({ skip: [faltante] });
  const r = await startCards(st, "u1", { id: "w1" }); const fin = await st.stepAll(String(r.body.run_id));
  eq(fin.degraded, 1, "una degradada"); const c = [...st.cards.values()].filter((x) => x.source === "code");
  eq(c.length, 1, "una tarjeta de código"); ok(c[0].purpose.length > 10 && c[0].keywords === "", "con texto útil");
  eq(st.cards.size, 5, "igual hay tarjeta para todas");
});

Deno.test("si la IA falla a mitad: la corrida queda en error, NO queda nada a medias (las tarjetas de antes siguen igual) y al reintentar se empieza completa", async () => {
  const st = new Mem(); st.secs = (await realSections()).slice(0, 20);
  fakeAI(); const base = await startCards(st, "u1", { id: "w1" }); await st.stepAll(String(base.body.run_id));
  const antes = JSON.stringify([...st.cards.entries()]), linksAntes = JSON.stringify(st.aiLinks);
  fakeAI({ fail: (call) => (call === 2 ? new Error("openai_429:rate_limit") : null) });
  const r = await startCards(st, "u1", { id: "w1" }, { force: true }); const id = String(r.body.run_id);
  eq((await stepCards(st, "u1", { id: "w1" }, id)).status, 200, "primer paso bien");
  eq(st.staged.get(id)?.size, 8, "lo del primer paso está guardado APARTE");
  eq(JSON.stringify([...st.cards.entries()]), antes, "mientras corre, las tarjetas de antes no cambian");
  const mal = await stepCards(st, "u1", { id: "w1" }, id);
  eq(mal.status, 502, "segundo paso: error de IA"); eq(mal.body.error, "ia_no_disponible", "error claro");
  eq(st.runs[1].status, "error", "la corrida queda en error"); eq(st.staged.has(id), false, "lo guardado aparte se tiró");
  eq(JSON.stringify([...st.cards.entries()]), antes, "tarjetas EXACTAMENTE como antes del intento"); eq(JSON.stringify(st.aiLinks), linksAntes, "enlaces de IA también");
  st.tick += 1000;
  const calls = fakeAI();
  const r2 = await startCards(st, "u1", { id: "w1" }, { force: true });
  eq(r2.body.total, 20, "al reintentar: se empieza completa"); const fin = await st.stepAll(String(r2.body.run_id));
  eq(fin.status, "done", "terminó"); eq(calls.length, 3, "20 secciones = 3 tandas");
});

Deno.test("esfuerzo: se pide 'medium'; si el modelo no lo acepta (400) se repite con el de siempre y queda registrado; otros errores no se reintentan", async () => {
  await withEnv("OPENAI_CARDS_EFFORT", undefined, async () => {
    const st = new Mem(); st.secs = (await realSections()).slice(0, 3);
    const calls = fakeAI({ fail: (_c, a) => (a.effort ? new Error("openai_400:invalid_value") : null) });
    const r = await startCards(st, "u1", { id: "w1" }); const fin = await st.stepAll(String(r.body.run_id));
    eq(fin.status, "done", "terminó igual"); eq(calls.length, 2, "dos llamadas: la rechazada y la repetida");
    eq(calls[0].effort, "medium", "primero pide medium"); eq(calls[1].effort, undefined, "después, sin esfuerzo (el de siempre)");
    eq(fin.effort, "default", "queda registrado que se usó el de siempre");
    const st2 = new Mem(); st2.secs = (await realSections()).slice(0, 3);
    const calls2 = fakeAI({ fail: () => new Error("openai_500:server_error") });
    const r2 = await startCards(st2, "u1", { id: "w1" }); const m = await stepCards(st2, "u1", { id: "w1" }, String(r2.body.run_id));
    eq(m.status, 502, "un 500 no se maquilla"); eq(calls2.length, 1, "y no se reintenta con otro esfuerzo");
  });
  await withEnv("OPENAI_CARDS_EFFORT", "high", async () => {
    const st = new Mem(); st.secs = (await realSections()).slice(0, 2); const calls = fakeAI();
    const r = await startCards(st, "u1", { id: "w1" }); const fin = await st.stepAll(String(r.body.run_id));
    eq(calls[0].effort, "high", "se puede subir con la variable de entorno"); eq(fin.effort, "high", "y queda registrado");
  });
});

Deno.test("respuesta cortada por el tope de salida: se repite con la mitad de la tanda y no se pierde nada", async () => {
  const st = new Mem(); st.secs = (await realSections()).slice(0, 8);
  const calls = fakeAI({ fail: (call) => (call === 1 ? new Error("ia_respuesta_incompleta") : null) });
  const r = await startCards(st, "u1", { id: "w1" }); const id = String(r.body.run_id);
  const p = (await stepCards(st, "u1", { id: "w1" }, id)).body;
  eq(calls.length, 2, "dos llamadas en el mismo paso");
  eq((calls[1].input.split("SECCIONES A DESCRIBIR")[1].match(/^### \[/gm) ?? []).length, 4, "la segunda trae la mitad (4 de 8)");
  eq(p.done, 4, "se hicieron 4"); eq(p.status, "running", "sigue"); const fin = await st.stepAll(id);
  eq(fin.status, "done", "las otras 4 en el paso siguiente"); eq(st.cards.size, 8, "ninguna se perdió");
});

// ---------- límites y estados ----------
Deno.test("límites: una corrida a la vez (se retoma), la abandonada se cancela, tope diario, secciones y widget", async () => {
  const st = new Mem(); st.secs = (await realSections()).slice(0, 10); fakeAI();
  const r1 = await startCards(st, "u1", { id: "w1" }, {}, st.tick);
  const r2 = await startCards(st, "u1", { id: "w1" }, {}, st.tick);
  eq(r2.body.resumed, true, "la segunda vez retoma la misma"); eq(r2.body.run_id, r1.body.run_id, "mismo id"); eq(st.runs.length, 1, "sin corrida nueva");
  const futuro = Date.parse(st.runs[0].updated_at) + (RUN_STALE_MIN + 1) * 60_000;
  const r3 = await startCards(st, "u1", { id: "w1" }, {}, futuro);
  eq(r3.body.resumed, false, "una abandonada ya no se retoma"); eq(st.runs[0].status, "cancelled", "se marca cancelada"); eq(st.runs.length, 2, "y empieza otra");
  const lleno = new Mem(); lleno.secs = st.secs;
  for (let i = 0; i < CARDS_ATTEMPTS_DAILY; i++) lleno.runs.push({ id: "x" + i, widget_id: "w1", user_id: "u1", status: "done", force: false, version: "c1", total: 1, done: 1, degraded: 0, steps: 1, calls: 1, tokens_in: 0, tokens_out: 0, effort: null, error: null, started_at: new Date(lleno.tick).toISOString(), updated_at: new Date(lleno.tick).toISOString() });
  eq((await startCards(lleno, "u1", { id: "w1" }, {}, lleno.tick + 1000)).status, 429, "tope diario");
  eq((await startCards(new Mem(), "u1", { id: "w1" })).body.error, "sin_secciones", "sin secciones: 409");
  eq((await startCards(st, "otro", { id: "w1" })).status, 404, "otro usuario: 404");
  eq((await stepCards(st, "otro", { id: "w1" }, "run1")).status, 404, "paso de otro usuario: 404");
  eq((await stepCards(st, "u1", { id: "w1" }, "no-existe")).status, 404, "corrida inexistente: 404");
});

Deno.test("resguardo contra bucles: si los pasos superan lo razonable, la corrida termina en error", async () => {
  const st = new Mem(); st.secs = (await realSections()).slice(0, 3); fakeAI();
  const r = await startCards(st, "u1", { id: "w1" }); const id = String(r.body.run_id);
  st.runs[0].steps = st.runs[0].total + 5;
  const p = await stepCards(st, "u1", { id: "w1" }, id);
  eq(p.body.status, "error", "error"); eq(p.body.error, "demasiados_pasos", "motivo");
});

Deno.test("estado para el panel: cobertura (frescas, viejas, faltantes) y la última corrida; cancelar no deja nada", async () => {
  const st = new Mem(); st.secs = (await realSections()).slice(0, 10); fakeAI();
  const antes = (await cardsStatus(st, "u1", { id: "w1" })).body;
  eq(antes.missing, 10, "al principio faltan todas"); ok(!("run" in antes), "sin corrida todavía");
  const r = await startCards(st, "u1", { id: "w1" }); const id = String(r.body.run_id); await stepCards(st, "u1", { id: "w1" }, id);
  const mid = (await cardsStatus(st, "u1", { id: "w1" })).body as Record<string, unknown> & { run: Record<string, unknown> };
  eq(mid.fresh, 0, "a mitad de la corrida todavía no hay tarjetas aplicadas"); eq(mid.missing, 10, "siguen faltando las 10");
  eq(mid.run.status, "running", "corrida en curso"); eq(mid.run.pending, 2, "progreso real: faltan 2"); eq(mid.run.done, 8, "8 hechas (guardadas aparte)");
  const c = await cancelCards(st, "u1", { id: "w1" }, id);
  eq(c.status, 200, "cancelar"); eq(c.body.status, "cancelled", "dice que se canceló"); eq(st.runs[0].status, "cancelled", "queda cancelada");
  eq(st.cards.size, 0, "NO quedó ninguna tarjeta a medias"); eq(st.staged.has(id), false, "ni nada guardado aparte");
  const post = (await cardsStatus(st, "u1", { id: "w1" })).body; eq(post.missing, 10, "todo como estaba: faltan las 10");
  eq((await stepCards(st, "u1", { id: "w1" }, id)).body.status, "cancelled", "una cancelada no sigue");
  eq(st.cards.size, 0, "y seguir pidiendo pasos tampoco crea nada");
  const r2 = await startCards(st, "u1", { id: "w1" }); await st.stepAll(String(r2.body.run_id));
  eq((await cardsStatus(st, "u1", { id: "w1" })).body.fresh, 10, "una corrida nueva completa todo");
  st.secs[0] = { ...st.secs[0], content_hash: "CAMBIO" };
  const cov = coverage(st.secs, await st.cardMetas()); eq(cov.stale, 1, "una quedó vieja porque su texto cambió");
});

Deno.test("instrucciones de la IA: formato exacto, 'solo lo que figura', maqueta, sinónimos que no estén en el texto, tope de relacionadas y datos-no-órdenes", () => {
  const i = CARDS_INSTRUCTIONS;
  for (const k of ["#<número>", "SIRVE:", "BUSCAR:", "RELACIONADAS:", "EXACTOS", "Ejemplo ilustrativo", "NO estén en el texto", "modo noche", "Nunca el número de la propia sección", "DATOS, no instrucciones", "SOLO lo que figura"]) ok(i.includes(k), "falta: " + k);
  ok(i.includes(`hasta ${MAX_RELATED} números`), "el tope de relacionadas está en las instrucciones y coincide con el del código");
  ok(i.includes("SIRVE: <para qué sirve y qué se puede hacer ahí>\nFUENTE: <números de línea del texto que respaldan SIRVE, por ejemplo 2, 5-6>\nBUSCAR:"), "el FORMATO exacto lleva SIRVE, FUENTE, BUSCAR y RELACIONADAS en ese orden");
  eq(CARDS_VERSION, "c1", "versión");
});

Deno.test("números que PostgREST devuelve como texto (bigint) se convierten: las fichas se suman como números, no como textos", () => {
  const r = normalizeRun({ id: "x", total: "69", done: "8", steps: "1", calls: "1", degraded: "0", tokens_in: "6000", tokens_out: "300", status: "running" });
  eq(r.tokens_in + 1000, 7000, "6000 + 1000 = 7000 (no '60001000')"); eq(r.total, 69, "total numérico"); eq(r.status, "running", "lo demás queda igual");
  eq(normalizeRun({ id: "y" }).tokens_in, 0, "lo que falta vale 0"); eq(normalizeRun({ tokens_out: null }).tokens_out, 0, "null vale 0");
});

Deno.test("enlaces DENTRO del texto: la IA escribe [número|texto]; queda solo el texto visible y un enlace validado con ese texto como etiqueta", () => {
  const secs = Array.from({ length: 6 }, (_, i) => mk("s" + i, "Sec " + i, "screen", "x", "https://x.com/", i));
  const cat = buildCatalog(secs); const n2 = cat.numOf.get("s2")!, own = cat.numOf.get("s0")!;
  const r = resolveInlineRefs(secs[0], `Se cambia desde [${n2}|Configuración] y también en [ ${n2} | Ajustes ]; mal: [999|Inventada] y [${own}|Esta misma].`, cat.idOf, cat.numOf);
  eq(r.text, "Se cambia desde Configuración y también en Ajustes; mal: Inventada y Esta misma.", "el texto queda limpio: sin números ni corchetes");
  eq(r.links.length, 2, "solo los 2 válidos (el 999 y la propia no enlazan)");
  eq(r.links.map((l) => l.label).join("|"), "Configuración|Ajustes", "la etiqueta es el texto visible, para que el panel lo marque en azul");
  ok(r.links.every((l) => l.to_section === "s2" && l.kind === "related" && l.source === "ai" && l.from_section === "s0" && l.line === null), "destino, tipo, origen y sin línea");
  eq(resolveInlineRefs(secs[0], `[${n2}|Configuración] y [${n2}|Configuración]`, cat.idOf, cat.numOf).links.length, 1, "la misma mención repetida no duplica el enlace");
  eq(resolveInlineRefs(secs[0], "Sin menciones.", cat.idOf, cat.numOf).text, "Sin menciones.", "sin menciones no cambia nada");
  const muchas = Array.from({ length: 30 }, (_, i) => `[${n2}|Texto ${i}]`).join(" ");
  const rm = resolveInlineRefs(secs[0], muchas, cat.idOf, cat.numOf);
  eq(rm.links.length, MAX_INLINE_LINKS, "resguardo contra basura"); ok(!/[\[\]|]/.test(rm.text), "ningún resto de marcas");
});

Deno.test("generación con menciones: la tarjeta guardada es texto limpio y los enlaces quedan con su etiqueta; conviven con las relacionadas y las citas validadas", async () => {
  const st = new Mem(); st.secs = (await realSections()).slice(0, 10);
  aiCfg.call = (a: AiArgs) => {
    const nums = [...a.input.split("SECCIONES A DESCRIBIR")[1].matchAll(/^### \[(\d+)\]/gm)].map((m) => Number(m[1]));
    return Promise.resolve({ text: nums.map((n) => `#${n}\nSIRVE: Sección ${n}. Ver [${(n % 10) + 1}|la siguiente] y [999|algo inventado].\nFUENTE: 1\nBUSCAR: uno; dos\nRELACIONADAS: ${(n % 10) + 2}`).join("\n\n"), tIn: 10, tOut: 10 });
  };
  const r = await startCards(st, "u1", { id: "w1" }); await st.stepAll(String(r.body.run_id));
  const c = [...st.cards.values()];
  ok(c.every((x) => !/[\[\]|]/.test(x.purpose) && x.purpose.includes("la siguiente") && x.purpose.includes("algo inventado")), "texto guardado limpio");
  const enTexto = st.aiLinks.filter((l) => l.label === "la siguiente");
  eq(enTexto.length, 10, "un enlace por tarjeta, con su etiqueta"); ok(enTexto.every((l) => l.from_section !== l.to_section && l.line === null), "ninguno a sí mismo y sin línea");
  ok(!st.aiLinks.some((l) => l.label === "algo inventado"), "la mención inventada no genera enlace");
  ok(st.aiLinks.some((l) => l.label === ""), "las relacionadas de siempre siguen guardándose");
  ok(c.every((x) => x.source === "ai" && x.evidence === "1"), "la fuente también se guarda");
});

Deno.test("instrucciones: explican cómo mencionar otra sección dentro del texto", () => {
  ok(CARDS_INSTRUCTIONS.includes("[número|texto visible]") && CARDS_INSTRUCTIONS.includes('"se cambia desde [12|Configuración]"'), "formato de la mención con ejemplo");
  ok(CARDS_INSTRUCTIONS.includes("Solo secciones del CATÁLOGO, y nunca la propia"), "restricciones");
});

Deno.test("estado para el panel: fecha de la última generación (la más reciente; ignora tarjetas de secciones borradas; null si no hay)", async () => {
  const st = new Mem(); st.secs = (await realSections()).slice(0, 3); fakeAI();
  const sin = (await cardsStatus(st, "u1", { id: "w1" })).body;
  eq(sin.last_generated_at, null, "sin tarjetas: null");
  const [a, b] = st.secs;
  const metas: CardMeta[] = [
    { section_id: a.id, section_hash: a.content_hash, version: CARDS_VERSION, updated_at: "2026-11-13T10:00:00Z" },
    { section_id: b.id, section_hash: b.content_hash, version: CARDS_VERSION, updated_at: "2026-11-13T12:30:00Z" },
    { section_id: "borrada", section_hash: "x", version: CARDS_VERSION, updated_at: "2026-11-14T09:00:00Z" },
    { section_id: a.id + "-x", section_hash: "x", version: CARDS_VERSION, updated_at: "no-es-fecha" },
  ];
  eq(lastGeneratedAt(st.secs, metas), "2026-11-13T12:30:00Z", "la más reciente de las secciones que existen; la de una sección borrada no cuenta");
  eq(lastGeneratedAt(st.secs, []), null, "sin metas: null");
  const r = await startCards(st, "u1", { id: "w1" }); await stepCards(st, "u1", { id: "w1" }, String(r.body.run_id));
  const st2 = (await cardsStatus(st, "u1", { id: "w1" })).body;
  ok(typeof st2.last_generated_at === "string" && !Number.isNaN(Date.parse(String(st2.last_generated_at))), "después de generar, trae una fecha válida");
  ok("fresh" in st2 && "stale" in st2 && "missing" in st2 && "sections" in st2, "la cobertura sigue igual");
});

// ---------- todo o nada ----------
async function conBase(n = 12) {
  const st = new Mem(); st.secs = (await realSections()).slice(0, n);
  fakeAI({ related: (k, total) => `${(k % total) + 1}` });
  const r = await startCards(st, "u1", { id: "w1" }); await st.stepAll(String(r.body.run_id));
  return { st, snap: () => JSON.stringify([[...st.cards.entries()], st.aiLinks]) };
}

Deno.test("cancelar a mitad de una regeneración: vuelve EXACTAMENTE a como estaba (tarjetas, enlaces y fechas), y solo se corta lo que hacía", async () => {
  const { st, snap } = await conBase(12); const antes = snap();
  const calls = fakeAI({ related: () => "ninguna" });
  const r = await startCards(st, "u1", { id: "w1" }, { force: true }); const id = String(r.body.run_id);
  await stepCards(st, "u1", { id: "w1" }, id);
  eq(calls.length, 1, "una tanda hecha"); eq(snap(), antes, "con la primera tanda hecha, nada de lo anterior cambió");
  eq((await cancelCards(st, "u1", { id: "w1" }, id)).body.status, "cancelled", "cancelada");
  eq(snap(), antes, "después de cancelar: idéntico, hasta las fechas de generación"); eq(st.staged.has(id), false, "nada guardado aparte");
  await stepCards(st, "u1", { id: "w1" }, id); eq(calls.length, 1, "una cancelada no vuelve a llamar a la IA"); eq(snap(), antes, "y no cambia nada");
});

Deno.test("las tarjetas nuevas reemplazan a las viejas TODAS JUNTAS recién al terminar la última tanda", async () => {
  const { st } = await conBase(12);
  const fechas = () => JSON.stringify([...st.cards.values()].map((c) => c.updated_at));
  const antes = fechas();
  fakeAI({ related: () => "ninguna" });
  const r = await startCards(st, "u1", { id: "w1" }, { force: true }); const id = String(r.body.run_id);
  const p1 = (await stepCards(st, "u1", { id: "w1" }, id)).body;
  eq(p1.status, "running", "queda una tanda"); eq(fechas(), antes, "con una tanda hecha todavía no se tocó ninguna");
  ok(st.aiLinks.length > 0, "los enlaces de IA de antes siguen");
  const p2 = (await stepCards(st, "u1", { id: "w1" }, id)).body;
  eq(p2.status, "done", "terminó"); ok(fechas() !== antes && [...st.cards.values()].every((c, i) => c.updated_at !== JSON.parse(antes)[i]), "al terminar, las 12 se reemplazaron");
  eq(st.aiLinks.length, 0, "y los enlaces de IA quedaron los nuevos (la IA ahora no relacionó ninguno)");
  eq(st.staged.has(id), false, "lo guardado aparte se aplicó y se borró");
});

Deno.test("si guardar todo junto falla: la corrida queda en error y todo sigue como estaba", async () => {
  const { st, snap } = await conBase(10); const antes = snap();
  fakeAI(); const r = await startCards(st, "u1", { id: "w1" }, { force: true }); const id = String(r.body.run_id);
  st.failApply = true;
  const fin = await st.stepAll(id);
  eq(fin.status, "error", "error"); eq(fin.error, "no_se_pudo_guardar", "motivo claro");
  eq(snap(), antes, "las tarjetas y los enlaces de antes quedaron intactos"); eq(st.staged.has(id), false, "y no quedó nada guardado aparte");
});

Deno.test("cancelar mientras la IA está pensando: no se guarda ni se aplica nada", async () => {
  const { st, snap } = await conBase(10); const antes = snap();
  fakeAI({ fail: () => { st.runs[1].status = "cancelled"; return null; } });
  const r = await startCards(st, "u1", { id: "w1" }, { force: true }); const id = String(r.body.run_id);
  const p = (await stepCards(st, "u1", { id: "w1" }, id)).body;
  eq(p.status, "cancelled", "el paso termina diciendo que está cancelada"); eq(st.staged.has(id), false, "lo que la IA acababa de devolver se tiró");
  eq(snap(), antes, "todo como estaba");
});

Deno.test("regenerar solo algunas: se rehacen esas, las demás no se tocan, y lo que no existe se ignora", async () => {
  const { st } = await conBase(12);
  const fechas = () => new Map([...st.cards.entries()].map(([k, v]) => [k, v.updated_at]));
  const antes = fechas();
  const calls = fakeAI({ related: () => "ninguna" });
  const elegidas = [st.secs[2].id, st.secs[7].id, "no-existe", st.secs[2].id];
  const r = await startCards(st, "u1", { id: "w1" }, { sectionIds: elegidas });
  eq(r.body.total, 2, "2 elegidas (la repetida y la que no existe no cuentan)"); eq(r.body.selected, 2, "el resumen dice cuántas eligió"); eq(r.body.force, false, "no es 'todas'");
  const fin = await st.stepAll(String(r.body.run_id));
  eq(fin.status, "done", "terminó"); eq(calls.length, 1, "una sola llamada");
  const desc = calls[0].input.split("SECCIONES A DESCRIBIR")[1]; eq((desc.match(/^### \[/gm) ?? []).length, 2, "solo esas 2 se describen");
  const ahora = fechas();
  for (const sec of st.secs) {
    const cambio = ahora.get(sec.id) !== antes.get(sec.id);
    eq(cambio, sec.id === st.secs[2].id || sec.id === st.secs[7].id, "solo se rehicieron las elegidas: " + sec.id);
  }
});

Deno.test("regenerar algunas: aunque todo esté al día igual corre; sin ninguna válida es un pedido vacío; y no toca lo que estaba viejo pero no se eligió", async () => {
  const { st } = await conBase(10); fakeAI();
  const r = await startCards(st, "u1", { id: "w1" }, { sectionIds: [st.secs[0].id] });
  eq(r.body.up_to_date, undefined, "no dice 'al día': se pidió expresamente"); eq(r.body.total, 1, "una");
  await st.stepAll(String(r.body.run_id));
  const vacio = await startCards(st, "u1", { id: "w1" }, { sectionIds: ["x", "y"] }); eq(vacio.status, 400, "ninguna existe: 400"); eq(vacio.body.error, "sin_seleccion", "motivo");
  eq((await startCards(st, "u1", { id: "w1" }, { sectionIds: [] })).body.error, "sin_seleccion", "una lista vacía también");
  st.secs[5] = { ...st.secs[5], content_hash: "VIEJA" };
  const calls = fakeAI();
  const r2 = await startCards(st, "u1", { id: "w1" }, { sectionIds: [st.secs[1].id] }); await st.stepAll(String(r2.body.run_id));
  eq(calls.length, 1, "una llamada"); eq(st.cards.get(st.secs[5].id)!.section_hash !== "VIEJA", true, "la vieja que no se eligió sigue vieja (no se rehízo)");
  const cov = coverage(st.secs, await st.cardMetas()); eq(cov.stale, 1, "sigue figurando como desactualizada");
});

Deno.test("al empezar otra corrida se limpia lo que dejó guardado aparte una corrida abandonada, cancelada o con error", async () => {
  const st = new Mem(); st.secs = (await realSections()).slice(0, 10); fakeAI();
  const r1 = await startCards(st, "u1", { id: "w1" }, {}, st.tick); await stepCards(st, "u1", { id: "w1" }, String(r1.body.run_id));
  ok(st.staged.get("run1")!.size === 8, "hay 8 guardadas aparte");
  const futuro = Date.parse(st.runs[0].updated_at) + (RUN_STALE_MIN + 1) * 60_000;
  const r2 = await startCards(st, "u1", { id: "w1" }, {}, futuro);
  eq(r2.body.resumed, false, "empieza otra"); eq(st.staged.has("run1"), false, "lo de la abandonada se tiró"); eq(st.cards.size, 0, "y no se aplicó nada");
  st.staged.set("run1", new Map([["s1", { section_id: "s1", widget_id: "w1", user_id: "u1", card: codeCard(st.secs[0], "es"), links: [] }]]));
  await cancelCards(st, "u1", { id: "w1" }, String(r2.body.run_id));
  await startCards(st, "u1", { id: "w1" }, {}, futuro + 1);
  eq(st.staged.has("run1"), false, "lo huérfano de una corrida ya cancelada también se limpia");
});

Deno.test("la corrida usada para aplicar tiene que estar en curso (como la función de la base)", async () => {
  const st = new Mem(); st.secs = (await realSections()).slice(0, 3); fakeAI();
  const r = await startCards(st, "u1", { id: "w1" }); await st.stepAll(String(r.body.run_id));
  let err = ""; try { await st.applyRun(String(r.body.run_id)); } catch (e) { err = (e as Error).message; }
  eq(err, "corrida_no_activa", "una corrida ya terminada no se puede volver a aplicar");
});

// ---------- grupos (público / interno), tarjetas editadas ----------
const oculto = (x: CardSection): CardSection => ({ ...x, is_hidden: true });
function mixto() {
  // 2 públicas (página + legal), 4 internas (pantalla, pasos, ventana, bloque oculto)
  const secs = [
    mk("p1", "Precios", "info", "Planes y precios del producto con detalle suficiente.", "https://x.com/", 0),
    mk("p2", "Privacidad", "legal", "Texto legal sobre datos personales con detalle suficiente.", "https://x.com/", 1),
    mk("i1", "Configuración", "screen", "Pantalla de configuración con varias opciones disponibles.", "https://x.com/app", 0),
    mk("i2", "Crear proyecto", "steps", "Paso 1: elegí un nombre. Paso 2: conectá la cuenta.", "https://x.com/app", 1),
    mk("i3", "Soporte", "ui", "Ventana de soporte con un campo para escribir el mensaje.", "https://x.com/app", 2),
    oculto(mk("i4", "Vista oculta", "info", "Bloque oculto de la app con texto de ejemplo suficiente.", "https://x.com/app", 3)),
  ];
  const st = new Mem(); st.secs = secs;
  return { st, secs };
}
const tarjetas = (st: Mem) => [...st.cards.keys()].sort().join(",");

Deno.test("grupos: lo de la app es 'internal'; páginas visibles y textos legales son 'public' (mismo criterio que la Memoria)", () => {
  eq(groupOf({ kind: "screen", is_hidden: false }), "internal", "pantalla");
  eq(groupOf({ kind: "steps", is_hidden: false }), "internal", "pasos");
  eq(groupOf({ kind: "ui", is_hidden: false }), "internal", "ventana");
  eq(groupOf({ kind: "menu", is_hidden: false }), "internal", "menú");
  eq(groupOf({ kind: "info", is_hidden: true }), "internal", "bloque oculto");
  eq(groupOf({ kind: "faq", is_hidden: true }), "internal", "preguntas ocultas");
  eq(groupOf({ kind: "info", is_hidden: false }), "public", "página visible");
  eq(groupOf({ kind: "faq", is_hidden: false }), "public", "preguntas visibles");
  eq(groupOf({ kind: "legal", is_hidden: false }), "public", "legal");
  eq(groupOf({ kind: "legal", is_hidden: true }), "public", "legal oculto sigue siendo del sitio");
});

Deno.test("grupos: solo se trabaja con las secciones del grupo pedido; el otro grupo no se toca", async () => {
  const { st } = mixto(); const calls = fakeAI({ related: () => "ninguna" });
  const r = await startCards(st, "u1", { id: "w1" }, { group: "public" });
  eq(r.body.total, 2, "2 públicas"); eq(r.body.group, "public", "el resumen dice el grupo");
  const fin = await st.stepAll(String(r.body.run_id)); eq(fin.status, "done", "terminó"); eq(fin.group, "public", "el grupo se mantiene");
  eq(tarjetas(st), "p1,p2", "solo hay tarjetas de las públicas");
  const desc = calls[0].input.split("SECCIONES A DESCRIBIR")[1]; eq((desc.match(/^### \[/gm) ?? []).length, 2, "solo 2 se describen");
  // el catálogo sigue numerado con TODAS (las relacionadas pueden apuntar a cualquier sección)
  ok(calls[0].input.split("SECCIONES A DESCRIBIR")[0].split("\n").filter((l) => /^\[\d+\]/.test(l)).length === 6, "catálogo completo");
  const r2 = await startCards(st, "u1", { id: "w1" }, { group: "internal" });
  eq(r2.body.total, 4, "4 internas"); await st.stepAll(String(r2.body.run_id));
  eq(tarjetas(st), "i1,i2,i3,i4,p1,p2", "ahora hay de las dos");
});

Deno.test("grupos: si el grupo ya está al día no hace nada aunque el otro grupo esté pendiente; 'todas' respeta el grupo", async () => {
  const { st } = mixto(); fakeAI({ related: () => "ninguna" });
  await st.stepAll(String((await startCards(st, "u1", { id: "w1" }, { group: "public" })).body.run_id));
  const runs = st.runs.length;
  const r = await startCards(st, "u1", { id: "w1" }, { group: "public" });
  eq(r.body.up_to_date, true, "público al día"); eq(st.runs.length, runs, "no se crea corrida"); eq(r.body.status, "done", "estado");
  const todas = await startCards(st, "u1", { id: "w1" }, { force: true, group: "public" });
  eq(todas.body.total, 2, "regenerar todas del grupo: solo las 2 públicas"); eq(todas.body.force, true, "es force");
  await st.stepAll(String(todas.body.run_id));
  eq(tarjetas(st), "p1,p2", "el grupo interno sigue sin tarjetas");
  const sin = await startCards(st, "u1", { id: "w1" }, { group: "internal" }); eq(sin.body.total, 4, "el interno sigue pendiente completo");
});

Deno.test("grupos: elegir secciones a mano manda sobre el grupo", () => {
  const { secs } = mixto();
  eq(runTargets(secs, [], { force: false, version: CARDS_VERSION, scope: ["i1"], scope_group: "public" }).map((x) => x.id).join(), "i1", "scope gana");
  eq(runTargets(secs, [], { force: false, version: CARDS_VERSION, scope_group: "internal" }).map((x) => x.id).join(), "i1,i2,i3,i4", "solo internas");
});

Deno.test("estado: cobertura total y por grupo, con 'editadas' y la última generación de cada grupo", async () => {
  const { st } = mixto(); fakeAI({ related: () => "ninguna" });
  await st.stepAll(String((await startCards(st, "u1", { id: "w1" }, { group: "public" })).body.run_id));
  st.cards.get("p2")!.edited_at = st.now();
  const e = await cardsStatus(st, "u1", { id: "w1" });
  const g = e.body.groups as Record<string, Record<string, unknown>>;
  eq(g.public.sections, 2, "públicas"); eq(g.public.fresh, 2, "editada cuenta como al día"); eq(g.public.edited, 1, "1 editada");
  eq(g.internal.sections, 4, "internas"); eq(g.internal.missing, 4, "faltan todas las internas"); eq(g.internal.last_generated_at, null, "sin generación interna");
  ok(typeof g.public.last_generated_at === "string", "hay fecha pública");
  eq(e.body.fresh, 2, "total al día"); eq(e.body.missing, 4, "total faltan"); eq(e.body.edited, 1, "total editadas");
  const d = coverageByGroup(st.secs, await st.cardMetas()); eq(d.internal.sections + d.public.sections, st.secs.length, "los grupos cubren todo");
});

Deno.test("editar: se guarda el texto del dueño, el original queda aparte y editar de nuevo no pisa ese original", async () => {
  const { st } = mixto(); fakeAI({ related: () => "ninguna" });
  await st.stepAll(String((await startCards(st, "u1", { id: "w1" })).body.run_id));
  const original = st.cards.get("p1")!.purpose;
  const r = await editCardText(st, "u1", { id: "w1" }, "p1", "  Mi texto \n\n\n\n con  espacios  "); eq(r.status, 200, "guardó");
  eq(st.cards.get("p1")!.purpose, "Mi texto\n\ncon espacios", "texto limpio"); ok(st.cards.get("p1")!.edited_at, "marca de edición"); eq(st.cards.get("p1")!.purpose_ai, original, "el original quedó");
  await editCardText(st, "u1", { id: "w1" }, "p1", "Mi segundo texto");
  eq(st.cards.get("p1")!.purpose_ai, original, "editar de nuevo conserva el PRIMER original");
  const u = await unEditCardText(st, "u1", { id: "w1" }, "p1"); eq(u.status, 200, "volvió"); eq(u.body.purpose, original, "devuelve el original");
  eq(st.cards.get("p1")!.purpose, original, "texto original de vuelta"); eq(st.cards.get("p1")!.edited_at, null, "sin marca");
  eq((await unEditCardText(st, "u1", { id: "w1" }, "p1")).body.error, "sin_edicion", "sin edición no hay nada que deshacer");
});

Deno.test("editar: pedidos inválidos (vacío, demasiado largo, sin tarjeta, otro usuario) no cambian nada", async () => {
  const { st } = mixto(); fakeAI({ related: () => "ninguna" });
  await st.stepAll(String((await startCards(st, "u1", { id: "w1" })).body.run_id));
  const antes = JSON.stringify([...st.cards.entries()]);
  eq((await editCardText(st, "u1", { id: "w1" }, "p1", "   ")).body.error, "texto_invalido", "vacío");
  eq((await editCardText(st, "u1", { id: "w1" }, "p1", 123)).body.error, "texto_invalido", "no es texto");
  eq((await editCardText(st, "u1", { id: "w1" }, "p1", "x".repeat(MAX_EDIT_CHARS + 1))).status, 400, "demasiado largo");
  eq((await editCardText(st, "u1", { id: "w1" }, "no-existe", "hola")).body.error, "sin_tarjeta", "sección sin tarjeta");
  eq((await editCardText(st, "otro", { id: "w1" }, "p1", "hola")).status, 404, "otro usuario");
  eq((await unEditCardText(st, "otro", { id: "w1" }, "p1")).status, 404, "otro usuario al deshacer");
  eq(JSON.stringify([...st.cards.entries()]), antes, "nada cambió");
  eq((await editCardText(st, "u1", { id: "w1" }, "p1", "x".repeat(MAX_EDIT_CHARS))).status, 200, "justo en el límite sirve");
});

Deno.test("editadas: 'Regenerar todas' y 'Actualizar' NO las pisan; elegirlas a propósito sí las rehace y borra la marca", async () => {
  const { st } = mixto(); const calls = fakeAI({ related: () => "ninguna" });
  await st.stepAll(String((await startCards(st, "u1", { id: "w1" })).body.run_id));
  await editCardText(st, "u1", { id: "w1" }, "p1", "Texto del dueño"); await editCardText(st, "u1", { id: "w1" }, "i1", "Otro texto del dueño");
  const todas = await startCards(st, "u1", { id: "w1" }, { force: true });
  eq(todas.body.total, 4, "6 menos las 2 editadas"); const n0 = calls.length;
  const fin = await st.stepAll(String(todas.body.run_id)); eq(fin.status, "done", "terminó");
  ok(calls.length > n0, "la IA trabajó");
  const desc = calls.slice(n0).map((c) => c.input.split("SECCIONES A DESCRIBIR")[1]).join("\n");
  eq((desc.match(/^### \[/gm) ?? []).length, 4, "la IA describió solo 4 (las editadas no se mandan)");
  eq(st.cards.get("p1")!.purpose, "Texto del dueño", "p1 intacta"); eq(st.cards.get("i1")!.purpose, "Otro texto del dueño", "i1 intacta");
  // aunque el texto de la sección cambie, la editada no se vuelve a hacer sola ni cuenta como pendiente
  st.secs[0] = { ...st.secs[0], text: st.secs[0].text + " Cambió.", content_hash: "nuevo" };
  const act = await startCards(st, "u1", { id: "w1" }); eq(act.body.up_to_date, true, "Actualizar: nada pendiente (la editada se respeta)");
  const elegida = await startCards(st, "u1", { id: "w1" }, { sectionIds: ["p1"] }); eq(elegida.body.total, 1, "elegida a propósito");
  await st.stepAll(String(elegida.body.run_id));
  ok(st.cards.get("p1")!.purpose !== "Texto del dueño", "se rehízo"); eq(st.cards.get("p1")!.edited_at, null, "sin marca de edición"); eq(st.cards.get("p1")!.purpose_ai, null, "sin original guardado");
  eq(st.cards.get("i1")!.purpose, "Otro texto del dueño", "la otra editada sigue igual");
});

Deno.test("editadas: si el dueño edita mientras corre una regeneración (con varias tandas), lo editado gana al aplicar", async () => {
  const { st } = mixto(); fakeAI({ related: () => "ninguna" });
  for (let i = 0; i < 10; i++) st.secs.push(mk("x" + i, "Extra " + i, "screen", "Pantalla extra número " + i + " con texto suficiente para describir.", "https://x.com/z", i));
  await st.stepAll(String((await startCards(st, "u1", { id: "w1" })).body.run_id));
  const r = await startCards(st, "u1", { id: "w1" }, { force: true }); const id = String(r.body.run_id);
  const paso = await stepCards(st, "u1", { id: "w1" }, id);
  eq(paso.body.status, "running", "quedan tandas: la corrida sigue en curso");
  ok((st.staged.get(id)?.has("p1")) ?? false, "p1 ya está guardada aparte (nueva) esperando el final");
  await editCardText(st, "u1", { id: "w1" }, "p1", "Lo escribió el dueño en medio");
  const fin = await st.stepAll(id); eq(fin.status, "done", "terminó");
  eq(st.cards.get("p1")!.purpose, "Lo escribió el dueño en medio", "el texto del dueño se conserva");
  ok(st.cards.get("p1")!.edited_at, "y sigue marcada como editada");
});

Deno.test("las acciones de grupo no cambian lo anterior: sin 'group' trabaja con todo, como antes", async () => {
  const { st } = mixto(); fakeAI({ related: () => "ninguna" });
  const r = await startCards(st, "u1", { id: "w1" }); eq(r.body.total, 6, "todo"); eq(r.body.group, null, "sin grupo");
  const e = normalizeRun({ id: "r", widget_id: "w1", user_id: "u1", status: "running", scope_group: "otra-cosa" }); eq(e.scope_group, null, "un grupo desconocido se ignora");
  eq(normalizeRun({ id: "r", scope_group: "public" }).scope_group, "public", "un grupo válido se conserva");
});

Deno.test("elegir secciones a mano no guarda grupo en la corrida (aunque se mande), y una tarjeta que desaparece justo al editar da 'sin_tarjeta'", async () => {
  const { st } = mixto(); fakeAI({ related: () => "ninguna" });
  await st.stepAll(String((await startCards(st, "u1", { id: "w1" })).body.run_id));
  const r = await startCards(st, "u1", { id: "w1" }, { sectionIds: ["p1"], group: "internal" });
  eq(r.body.total, 1, "solo la elegida"); eq(r.body.group, null, "el resumen no trae grupo");
  eq(st.runs[st.runs.length - 1].scope_group, null, "la corrida guardada tampoco");
  const antes = JSON.stringify([...st.cards.entries()]);
  st.editCard = () => Promise.resolve(false); // la tarjeta desapareció entre mirar y guardar
  const e = await editCardText(st, "u1", { id: "w1" }, "p1", "hola"); eq(e.status, 404, "404"); eq(e.body.error, "sin_tarjeta", "motivo");
  eq(JSON.stringify([...st.cards.entries()]), antes, "no cambió nada");
});
