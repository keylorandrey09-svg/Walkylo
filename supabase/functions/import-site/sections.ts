// supabase/functions/import-site/sections.ts
// Extrae SECCIONES con estructura de una página HTML (sin ejecutar JavaScript).
// Aditivo: no reemplaza a extractPage() de lib.ts.
import { type HTMLElement, type Node, parse, TextNode } from "npm:node-html-parser@6.1.13";

export type SectionKind = "info" | "steps" | "menu" | "screen" | "faq" | "legal" | "ui";
export type Section = {
  position: number;
  heading_path: string;
  kind: SectionKind;
  is_hidden: boolean;
  text: string;
  anchor: string | null;   // id más cercano (sirve para enlaces #ancla en secciones visibles)
  id_path: string;         // ids de los ancestros: solo para buscar ("view-crear create-form-area")
};
export type Sectioned = {
  title: string;
  sections: Section[];
  stats: Record<string, number>;
  warnings: string[];
};

export const MAX_SECTION_CHARS = 1500;   // objetivo por sección
export const MAX_STEPS_CHARS = 3500;     // los pasos se mantienen juntos hasta acá
export const HARD_SECTION_CHARS = 3900;  // la tabla acepta hasta 4000
export const MERGE_BELOW = 300;          // secciones más chicas se unen con la siguiente
export const MAX_SECTIONS_PER_PAGE = 300;
export const MAX_TOTAL_CHARS = 200_000;
const MAX_DEPTH = 120;
const MAX_NODES = 60_000;
const MAX_LINE = 600;

const SKIP = new Set([
  "script", "style", "noscript", "svg", "template", "iframe", "canvas", "head", "object", "embed",
  "link", "meta", "title", "path",
]);
const BLOCK = new Set([
  "address", "article", "aside", "blockquote", "body", "details", "dialog", "dd", "div", "dl", "dt",
  "fieldset", "figcaption", "figure", "footer", "form", "header", "hgroup", "hr", "li", "main", "nav",
  "ol", "p", "pre", "section", "table", "thead", "tbody", "tfoot", "tr", "ul", "br", "option",
]);
const SKIP_LINK = /^(saltar|skip|ir al contenido|ir a contenido)/i;
const OVERLAY_RE = /(^|[-_ ])(modal|overlay|drawer|dialog|popup|popover|lightbox|toast|snackbar)([-_ ]|$)/i;
const VIEW_RE = /(^|[-_ ])(view|screen|page|panel|pane|tab)([-_ ]|$)/i;
const STATE_RE = /^(active|show|shown|open|opened|current|selected|hidden|visible|is-.+)$/i;
const LEGAL_RE = /(privacid|privacy|t[eé]rminos|terms|cookies|reembols|refund|eliminaci[oó]n de datos|data deletion|aviso legal|legal|gdpr)/i;
const STEP_RE = /(^|[-_])(step|paso|etapa)[-_]?\d+$/i;
const MENUISH_RE = /(drawer|menu|nav)/i;
const MIN_UNIT_TEXT = 80;
const FAQ_RE = /(preguntas|faq|frequently|dudas|perguntas)/i;

type LineKind = "text" | "link" | "btn" | "item" | "field";
type Line = { text: string; lk: LineKind };
type Ev =
  | { t: "line"; text: string; lk: LineKind; hidden: boolean }
  | { t: "head"; level: number; text: string; anchor: string | null; hidden: boolean }
  | { t: "open"; kind: SectionKind; title: string; explicit: boolean; anchor: string | null; hidden: boolean; ids: string }
  | { t: "close" };

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const tagOf = (e: HTMLElement) => (e.tagName ?? "").toLowerCase();
const isEl = (n: Node): n is HTMLElement => n.nodeType === 1;
const isTx = (n: Node): n is TextNode => n.nodeType === 3;

const WRAP = new Set(["div", "section", "article", "main", "form", "details", "fieldset"]);

// ¿tiene texto visible? Búsqueda iterativa que corta en el primer texto (sin recursión).
function hasText(root: HTMLElement, budget = 400): boolean {
  const stack: Node[] = [...root.childNodes];
  while (stack.length && budget-- > 0) {
    const n = stack.pop()!;
    if (isTx(n)) { if (n.text.trim()) return true; continue; }
    if (isEl(n) && !SKIP.has(tagOf(n))) stack.push(...n.childNodes);
  }
  return false;
}
// largo aproximado del texto, con tope (iterativo)
function textLen(root: HTMLElement, cap = 200, budget = 2000): number {
  let len = 0;
  const stack: Node[] = [...root.childNodes];
  while (stack.length && budget-- > 0 && len < cap) {
    const n = stack.pop()!;
    if (isTx(n)) { len += n.text.trim().length; continue; }
    if (isEl(n) && !SKIP.has(tagOf(n))) stack.push(...n.childNodes);
  }
  return len;
}

function isHiddenAttr(el: HTMLElement): boolean {
  const a = el.attributes;
  if ("hidden" in a || a["aria-hidden"] === "true") return true;
  if (tagOf(el) === "dialog" && !("open" in a)) return true;
  const st = a["style"];
  return !!st && /(display\s*:\s*none|visibility\s*:\s*hidden)/i.test(st);
}

function classTokens(el: HTMLElement): string[] {
  const c = el.attributes["class"];
  return c ? c.split(/\s+/).filter(Boolean) : [];
}

function isOverlay(el: HTMLElement): boolean {
  const t = tagOf(el);
  if (t === "body" || t === "html" || t === "main" || t === "article") return false;
  const a = el.attributes;
  const role = (a["role"] ?? "").toLowerCase();
  if (role === "dialog" || role === "alertdialog" || a["aria-modal"] === "true") return true;
  return OVERLAY_RE.test(`${a["id"] ?? ""} ${a["class"] ?? ""}`);
}

function isRegion(el: HTMLElement): boolean {
  const t = tagOf(el);
  if (t === "nav" || t === "aside" || t === "header" || t === "footer") return true;
  const role = (el.attributes["role"] ?? "").toLowerCase();
  return role === "navigation" || role === "banner" || role === "contentinfo" || role === "complementary";
}

function isInteractiveEl(el: HTMLElement): boolean {
  const a = el.attributes;
  const role = (a["role"] ?? "").toLowerCase();
  return "onclick" in a || "data-view" in a || role === "tab" || role === "menuitem" || role === "button";
}

class Walker {
  ev: Ev[] = [];
  buf = "";
  bufI = 0;
  pre = "";
  iDepth = 0;
  hidden = false;
  nodes = 0;
  ovDepth = 0;
  nearestId = "";
  ids: string[] = [];
  idp() { return this.ids.join(" ").slice(0, 200); }
  decorative = 0;
  flat = 0;
  skipHead = "";
  asLines = false;
  warnings = new Set<string>();
  labels = new Map<string, string>();

  constructor(root: HTMLElement) {
    for (const l of root.querySelectorAll("label[for]")) {
      const f = l.attributes["for"];
      if (f) this.labels.set(f, clean(this.inline(l)));
    }
  }

  // ----- texto en línea (sin saltos de bloque) -----
  inline(n: Node, d = 0): string {
    if (d > MAX_DEPTH) return "";
    if (isTx(n)) return n.text;
    if (!isEl(n)) return "";
    const t = tagOf(n);
    if (SKIP.has(t)) return "";
    if (t === "img") return n.attributes["alt"] ? ` ${n.attributes["alt"]} ` : "";
    let s = "";
    for (const c of n.childNodes) s += this.inline(c, d + 1);
    return BLOCK.has(t) ? ` ${s} ` : s;
  }

  add(text: string) {
    if (!text) return;
    const t = text.replace(/\s+/g, " ");
    if (!t.trim()) {
      if (this.buf && !this.buf.endsWith(" ")) this.buf += " ";
      return;
    }
    this.buf += t;
    if (this.iDepth > 0) this.bufI += t.trim().length;
  }

  flush(forced?: LineKind) {
    const t = clean(this.buf.replace(/[•●]{3,}/g, ""));
    const pre = this.pre;
    this.buf = "";
    this.pre = "";
    const bufI = this.bufI;
    this.bufI = 0;
    if (!t || /^[•·●*\-–—_.|:\s]+$/.test(t)) return;
    const lk: LineKind = forced ?? (bufI > 0 && bufI >= t.length * 0.8 ? "link" : "text");
    this.ev.push({ t: "line", text: (pre + t).slice(0, MAX_LINE), lk, hidden: this.hidden });
  }

  push(text: string, lk: LineKind) {
    this.flush();
    const t = clean(text);
    if (t) this.ev.push({ t: "line", text: t.slice(0, MAX_LINE), lk, hidden: this.hidden });
  }

  collect(fn: () => void): Ev[] {
    this.flush();
    const saved = this.ev;
    this.ev = [];
    fn();
    this.flush();
    const out = this.ev;
    this.ev = saved;
    return out;
  }

  // ----- recorrido -----
  walkChildren(el: HTMLElement, depth: number) {
    const { units, flow } = this.findUnits(el);
    let flowDone = false;
    for (const c of el.childNodes) {
      if (isEl(c) && flow.includes(c)) {
        if (!flowDone) { flowDone = true; this.walkFlow(el, flow, depth + 1); }
      } else if (isEl(c) && units.has(c)) this.walkUnit(c, depth + 1, "screen");
      else this.walk(c, depth + 1);
    }
  }

  // Asistente de varios pasos (step-1, step-2...): un solo bloque "pasos".
  walkFlow(parent: HTMLElement, steps: HTMLElement[], depth: number) {
    this.flush();
    const prev = this.hidden;
    this.ev.push({ t: "open", kind: "steps", title: "", explicit: false, anchor: parent.attributes["id"] || this.nearestId || null, hidden: this.hidden, ids: this.idp() });
    this.flat++;
    steps.forEach((m, i) => {
      const hid = this.hidden;
      if (isHiddenAttr(m)) this.hidden = true;
      const h = this.firstHeading(m);
      this.push(`Paso ${i + 1}${h ? `: ${h}` : ""}`, "text");
      this.skipHead = h;
      this.asLines = true;
      this.walkChildren(m, depth + 1);
      this.flush();
      this.asLines = false;
      this.skipHead = "";
      this.hidden = hid;
    });
    this.flat--;
    this.flush();
    this.ev.push({ t: "close" });
    this.hidden = prev;
  }

  // Hijos repetidos con id (vistas, pestañas, pasos): cada uno es una unidad.
  findUnits(el: HTMLElement): { units: Set<HTMLElement>; flow: HTMLElement[] } {
    const units = new Set<HTMLElement>();
    let flow: HTMLElement[] = [];
    if (this.flat > 0) return { units, flow };
    const kids = el.childNodes.filter(isEl).filter((c) => ["div", "section", "article"].includes(tagOf(c)) && c.attributes["id"]);
    if (kids.length < 2) return { units, flow };
    const steps = kids.filter((k) => STEP_RE.test(k.attributes["id"] ?? ""));
    if (steps.length >= 2) flow = steps;
    const groups = new Map<string, HTMLElement[]>();
    for (const k of kids) {
      if (flow.includes(k)) continue;
      const key = tagOf(k) + "." + classTokens(k).filter((t) => !STATE_RE.test(t)).sort().join(".");
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(k);
    }
    for (const g of groups.values()) {
      const big = g.filter((k) => textLen(k, MIN_UNIT_TEXT + 1) > MIN_UNIT_TEXT);
      if (big.length < 2) continue;   // el grupo debe tener al menos 2 pantallas con contenido
      const viewish = this.hidden || g.every((k) => VIEW_RE.test(k.attributes["class"] ?? "") || "data-view" in k.attributes || k.attributes["role"] === "tabpanel");
      if (!viewish) continue;
      // si el grupo califica, entran todas sus pantallas (también las de poco texto, como "Notificaciones")
      for (const k of g) if (textLen(k, 21) > 20) units.add(k);
    }
    return { units, flow };
  }

  firstHeading(el: HTMLElement): string {
    const h = el.querySelector("h1,h2,h3");
    return h ? clean(this.inline(h)) : "";
  }

  // titled=false: contenedor que solo envuelve (portada, app, bloque oculto); su primer título no lo nombra
  walkUnit(el: HTMLElement, depth: number, kind: SectionKind, titled = true) {
    this.flush();
    const prev = this.hidden;
    const prevId = this.nearestId;
    if (el.attributes["id"]) { this.nearestId = el.attributes["id"]; this.ids.push(el.attributes["id"]); }
    if (isHiddenAttr(el)) this.hidden = true;
    const title = titled ? (this.firstHeading(el) || clean(el.attributes["aria-label"] ?? "")) : "";
    this.ev.push({ t: "open", kind, title, explicit: false, anchor: el.attributes["id"] || null, hidden: this.hidden, ids: this.idp() });
    this.walkChildren(el, depth);
    this.flush();
    this.ev.push({ t: "close" });
    this.hidden = prev;
    this.nearestId = prevId;
    if (el.attributes["id"]) this.ids.pop();
  }

  regionTitle(el: HTMLElement): string {
    const a = el.attributes;
    return clean(a["aria-label"] ?? "") || a["id"] || tagOf(el);
  }

  emitRegion(el: HTMLElement, sub: Ev[], overlay: boolean) {
    const lines = sub.filter((e): e is Extract<Ev, { t: "line" }> => e.t === "line");
    if (!lines.length) return;
    const heads = sub.filter((e) => e.t === "head").length;
    const items = lines.filter((l) => l.lk === "link" || l.lk === "btn" || l.lk === "item").length;
    const named = MENUISH_RE.test(`${el.attributes["id"] ?? ""} ${el.attributes["class"] ?? ""} ${el.attributes["aria-label"] ?? ""}`);
    const isMenu = lines.length >= 2 && items / lines.length >= 0.6 && heads <= 1 && (!overlay || named);
    const t = tagOf(el);
    const anchor = el.attributes["id"] || null;
    if (isMenu) {
      this.ev.push({ t: "open", kind: "menu", title: `Menú (${this.regionTitle(el)})`, explicit: true, anchor, hidden: this.hidden, ids: this.idp() + (anchor ? " " + anchor : "") });
      this.ev.push(...lines.map((l) => ({ ...l })));
      this.ev.push({ t: "close" });
      return;
    }
    const kind: SectionKind = overlay ? "ui" : "info";
    const fallback = overlay
      ? clean(el.attributes["aria-label"] ?? "")
      : heads > 0 ? "" : t === "footer" ? "Pie de página" : t === "header" ? "Encabezado" : clean(el.attributes["aria-label"] ?? "");
    this.ev.push({ t: "open", kind, title: fallback, explicit: false, anchor, hidden: this.hidden, ids: this.idp() + (anchor ? " " + anchor : "") });
    this.ev.push(...sub);
    this.ev.push({ t: "close" });
  }

  walk(n: Node, depth: number) {
    if (depth > MAX_DEPTH) { this.warnings.add("profundidad_maxima"); return; }
    if (++this.nodes > MAX_NODES) { this.warnings.add("nodos_maximos"); return; }
    if (isTx(n)) { this.add(n.text); return; }
    if (!isEl(n)) return;
    const el = n;
    const tag = tagOf(el);
    if (!tag || SKIP.has(tag)) return;
    const a = el.attributes;
    const prevHidden = this.hidden;
    const hattr = isHiddenAttr(el);
    if (a["aria-hidden"] === "true" && !("hidden" in a) && !/display\s*:\s*none/i.test(a["style"] ?? "") && !isOverlay(el) && !isRegion(el)) {
      this.decorative++;
      return;
    }
    if (hattr) this.hidden = true;
    try {
      // un bloque oculto abre su propio ámbito de títulos
      if (hattr && !prevHidden && this.flat === 0 && WRAP.has(tag) && hasText(el) && !isOverlay(el) && !isRegion(el)) {
        this.hidden = prevHidden;
        this.walkUnit(el, depth + 1, "info", false);
        return;
      }
      if (tag === "a" && SKIP_LINK.test(clean(this.inline(el)))) return;

      // títulos
      if (/^h[1-6]$/.test(tag)) {
        this.flush();
        const text = clean(this.inline(el));
        if (!text) return;
        if (this.skipHead && text === this.skipHead) { this.skipHead = ""; return; }
        if (this.asLines) { this.push(text, "text"); return; }
        this.ev.push({ t: "head", level: Number(tag[1]), text: text.slice(0, 200), anchor: a["id"] || null, hidden: this.hidden });
        return;
      }
      if (tag === "summary") {
        this.flush();
        const text = clean(this.inline(el));
        if (text) this.ev.push({ t: "head", level: 5, text: text.slice(0, 200), anchor: a["id"] || null, hidden: this.hidden });
        return;
      }

      // controles de formulario y botones
      if (tag === "input") {
        const type = (a["type"] ?? "text").toLowerCase();
        if (type === "hidden" || type === "image") return;
        if (type === "submit" || type === "button" || type === "reset") {
          const v = clean(a["value"] ?? a["aria-label"] ?? a["title"] ?? "");
          if (v) this.push(`Botón: ${v}`, "btn");
          return;
        }
        const label = clean(a["aria-label"] ?? "") || this.labels.get(a["id"] ?? "") || clean(a["placeholder"] ?? "") || clean(a["title"] ?? "") || clean(a["name"] ?? "");
        const ph = clean(a["placeholder"] ?? "");
        if (type === "checkbox" || type === "radio") { if (label) this.push(`Opción: ${label}`, "field"); return; }
        if (label) {
          this.flush();
          const last = this.ev[this.ev.length - 1];
          if (last && last.t === "line" && last.text === label) this.ev.pop();
          this.push(`Campo: ${label}${ph && ph !== label ? ` (ej.: ${ph})` : ""}`, "field");
        }
        return;
      }
      if (tag === "textarea") {
        const label = clean(a["aria-label"] ?? "") || this.labels.get(a["id"] ?? "") || clean(a["placeholder"] ?? "") || clean(a["title"] ?? "") || clean(a["name"] ?? "");
        if (label) this.push(`Campo: ${label}`, "field");
        return;
      }
      if (tag === "select") {
        const label = clean(a["aria-label"] ?? "") || this.labels.get(a["id"] ?? "") || clean(a["title"] ?? "") || clean(a["name"] ?? "");
        const opts = el.querySelectorAll("option").map((o) => clean(o.text)).filter(Boolean);
        const shown = opts.slice(0, 8).join(", ");
        if (label || shown) this.push(`Selector: ${label}${shown ? ` (opciones: ${shown}${opts.length > 8 ? ", …" : ""})` : ""}`, "field");
        return;
      }
      if (tag === "img") {
        const alt = clean(a["alt"] ?? "");
        if (alt && alt.length <= 120) this.push(`Imagen: ${alt}`, "text");
        return;
      }
      if (tag === "button" || (a["role"] ?? "").toLowerCase() === "button") {
        const text = clean(this.inline(el)) || clean(a["aria-label"] ?? "") || clean(a["title"] ?? "");
        if (text && text.length <= 100) { this.push(`Botón: ${text}`, "btn"); return; }
      } else if (isInteractiveEl(el) && !el.childNodes.some((c) => isEl(c) && BLOCK.has(tagOf(c)))) {
        const text = clean(this.inline(el)) || clean(a["aria-label"] ?? "") || clean(a["title"] ?? "");
        if (text && text.length <= 60) { this.push(text, "item"); return; }
      } else if (tag === "a" && a["href"]) {
        const text = clean(this.inline(el));
        if (!text) {
          const lab = clean(a["aria-label"] ?? "") || clean(a["title"] ?? "");
          if (lab) { this.push(`Enlace: ${lab}`, "link"); return; }
        }
      }

      // listas y tablas
      if (tag === "ol" || tag === "ul") {
        this.flush();
        let i = 0;
        for (const c of el.childNodes) {
          if (isEl(c) && tagOf(c) === "li") {
            this.flush();
            this.pre = tag === "ol" ? `${++i}. ` : "- ";
            this.walkChildren(c, depth + 2);
            this.flush();
          } else this.walk(c, depth + 1);
        }
        this.flush();
        return;
      }
      if (tag === "tr") {
        const cells = el.childNodes.filter(isEl).filter((c) => ["td", "th"].includes(tagOf(c))).map((c) => clean(this.inline(c))).filter(Boolean);
        if (cells.length) this.push(cells.join(" | "), "text");
        return;
      }

      // secciones semánticas con id: unidad propia
      if ((tag === "section" || tag === "article") && a["id"] && this.flat === 0 && !isOverlay(el)) {
        this.walkUnit(el, depth + 1, "info");
        return;
      }

      // regiones (menús, laterales, encabezado, pie) y ventanas
      const overlay = this.ovDepth === 0 && isOverlay(el);
      if (isRegion(el) || overlay) {
        if (overlay) this.ovDepth++;
        const sub = this.collect(() => this.walkChildren(el, depth + 1));
        if (overlay) this.ovDepth--;
        this.emitRegion(el, sub, overlay);
        return;
      }

      // genérico
      const isLink = tag === "a" && !!a["href"];
      if (isLink) this.iDepth++;
      const block = BLOCK.has(tag);
      if (block) this.flush();
      if (tag === "br") { this.flush(); return; }
      this.walkChildren(el, depth + 1);
      if (block) this.flush();
      if (isLink) this.iDepth--;
    } finally {
      this.hidden = prevHidden;
    }
  }
}

// ---------- armado de secciones ----------
type PathEntry = { level: number; text: string; anchor: string | null };
type Frame = {
  id: number; kind: SectionKind; title: string; explicit: boolean; anchor: string | null; hidden: boolean;
  ctx: string; ids: string; path: PathEntry[]; base: number; lines: Line[];
};
type Raw = { frame: number; kind: SectionKind; path: string[]; hidden: boolean; anchor: string | null; ids: string; lines: Line[] };

function build(events: Ev[]): Raw[] {
  const out: Raw[] = [];
  let nextId = 0;
  const mk = (kind: SectionKind, title: string, explicit: boolean, anchor: string | null, hidden: boolean, parentCtx: string, ids: string): Frame => {
    const ctx = explicit ? title : (title ? (parentCtx && parentCtx !== title && !parentCtx.endsWith(` › ${title}`) ? `${parentCtx} › ${title}` : (parentCtx || title)) : parentCtx);
    const path: PathEntry[] = ctx ? [{ level: 0, text: ctx, anchor }] : [];
    return { id: nextId++, kind, title, explicit, anchor, hidden, ctx, ids, lines: [], path, base: path.length };
  };
  const stack: Frame[] = [mk("info", "", false, null, false, "", "")];
  const top = () => stack[stack.length - 1];
  const fin = (f: Frame) => {
    if (!f.lines.length) return;
    const path = f.path.map((p) => p.text);
    const first = f.lines[0]?.text ?? "";
    const goodFirst = first.length >= 3 && first.length <= 50 && !/^(Botón|Campo|Opción|Selector|Enlace|Imagen|Paso)\b/.test(first) && !/[.:;?!…]$/.test(first);
    if (!path.length && (f.kind === "ui" || f.kind === "screen") && goodFirst) path.push(first);
    else if (!path.length && f.kind === "ui") path.push((f.title || f.anchor || "Ventana").replace(/[-_]+/g, " "));
    const own = f.path.length > f.base ? f.path[f.path.length - 1].anchor : null;
    const anchor = own ?? f.anchor ?? f.path[f.path.length - 1]?.anchor ?? null;
    out.push({ frame: f.id, kind: f.kind, path, hidden: f.hidden, anchor, ids: f.ids, lines: f.lines });
    f.lines = [];
  };
  for (const e of events) {
    const f = top();
    if (e.t === "open") { fin(f); stack.push(mk(e.kind, e.title, e.explicit, e.anchor, e.hidden, f.ctx, e.ids)); }
    else if (e.t === "close") { fin(f); if (stack.length > 1) stack.pop(); }
    else if (e.t === "head") {
      const lastT = f.path.length ? f.path[f.path.length - 1].text : "";
      if (lastT === e.text || lastT.endsWith(` › ${e.text}`)) continue;
      const pending = f.lines.reduce((n, l) => n + l.text.length + 1, 0);
      if (!(pending < 60 && f.path.length === f.base && f.kind !== "menu")) fin(f);
      while (f.path.length && f.path[f.path.length - 1].level >= e.level) f.path.pop();
      f.path.push({ level: e.level, text: e.text, anchor: e.anchor });
      f.base = Math.min(f.base, f.path.length - 1);
      f.hidden = e.hidden;
    } else {
      if (f.lines.length && e.hidden !== f.hidden) fin(f);
      f.hidden = e.hidden;
      const text = f.kind !== "menu" && e.lk === "item" ? `Botón: ${e.text}` : e.text;
      f.lines.push({ text, lk: e.lk });
    }
  }
  while (stack.length) fin(stack.pop()!);
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function inferKind(r: Raw): SectionKind {
  if (r.kind !== "info" && r.kind !== "screen") return r.kind;
  const head = `${r.path[0] ?? ""} ${r.anchor ?? ""}`;
  if (LEGAL_RE.test(head)) return "legal";
  if (r.kind === "screen") return "screen";
  const numbered = r.lines.filter((l) => /^(\d+\.\s|(paso|step|passo)\s*\d+)/i.test(l.text)).length;
  if (numbered >= 2) return "steps";
  if (FAQ_RE.test(r.path.join(" "))) return "faq";
  return "info";
}

function splitLines(lines: Line[], max: number): Line[][] {
  const parts: Line[][] = [];
  let cur: Line[] = [], size = 0;
  for (const l of lines) {
    const len = l.text.length + 1;
    if (cur.length && size + len > max) { parts.push(cur); cur = []; size = 0; }
    cur.push(l);
    size += len;
  }
  if (cur.length) parts.push(cur);
  return parts;
}

export function extractSections(html: string): Sectioned {
  const t0 = Date.now();
  try {
    return extractSectionsUnsafe(html, t0);
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    return {
      title: "", sections: [], stats: { sections: 0, chars: 0, ms: Date.now() - t0 },
      warnings: [/call stack/i.test(m) ? "estructura_demasiado_profunda" : "error_extraccion"],
    };
  }
}

function extractSectionsUnsafe(html: string, t0: number): Sectioned {
  const root = parse(html, { blockTextElements: { script: true, noscript: true, style: true, pre: true } });
  // <pre> llega como HTML crudo: se le quitan las etiquetas y queda como texto
  for (const pre of root.querySelectorAll("pre")) {
    const raw = pre.innerHTML.replace(/<[^>]+>/g, "");
    pre.replaceWith(new TextNode(raw, pre.parentNode));
  }
  return finish(root, t0);
}

function finish(root: HTMLElement, t0: number): Sectioned {
  const title = clean(root.querySelector("title")?.text ?? "").slice(0, 300);
  const body = root.querySelector("body") ?? root;
  const w = new Walker(root);
  for (const c of body.childNodes) {
    if (isEl(c) && WRAP.has(tagOf(c)) && hasText(c) && !isRegion(c) && !isOverlay(c)) w.walkUnit(c, 1, "info", false);
    else w.walk(c, 1);
  }
  w.flush();
  const raws = build(w.ev);

  // tipo, partición y unión
  type Piece = { frame: number; kind: SectionKind; path: string[]; hidden: boolean; anchor: string | null; ids: string; lines: Line[]; leaves?: string[] };
  const pieces: Piece[] = [];
  for (const r of raws) {
    const kind = inferKind(r);
    const max = kind === "steps" ? MAX_STEPS_CHARS : MAX_SECTION_CHARS;
    const total = r.lines.reduce((s, l) => s + l.text.length + 1, 0);
    const parts = total <= max ? [r.lines] : splitLines(r.lines, max);
    for (const p of parts) pieces.push({ frame: r.frame, kind, path: r.path, hidden: r.hidden, anchor: r.anchor, ids: r.ids, lines: p });
  }
  const merged: Piece[] = [];
  const size = (p: Piece) => p.lines.reduce((s, l) => s + l.text.length + 1, 0);
  for (const p of pieces) {
    const prev = merged[merged.length - 1];
    const rootOf = (x: Piece) => (x.path[0] ?? `#f${x.frame}`).split(" › ")[0];
    if (prev && prev.kind === p.kind && prev.hidden === p.hidden && prev.kind !== "steps" && prev.kind !== "menu" && rootOf(prev) === rootOf(p) && size(prev) < MERGE_BELOW && size(prev) + size(p) <= MAX_SECTION_CHARS) {
      const seg = (x: string | undefined) => (x ?? "").split(" › ").pop() ?? "";
      const leaf = seg(p.path[p.path.length - 1]);
      const prevLeaf = seg(prev.path[prev.path.length - 1]);
      const common: string[] = [];
      for (let i = 0; i < Math.min(prev.path.length, p.path.length); i++) { if (prev.path[i] === p.path[i]) common.push(p.path[i]); else break; }
      const base = common.length ? common : prev.path.slice(0, 1);
      const leaves = new Set<string>(prev.leaves ?? []);
      if (!prev.leaves && prevLeaf && !base.includes(prev.path[prev.path.length - 1])) leaves.add(prevLeaf);
      if (leaf && !base.some((b) => b.endsWith(leaf))) leaves.add(leaf);
      const extra = leaf && !prev.path.some((x) => x.endsWith(leaf)) && leaf !== prevLeaf ? [{ text: `${leaf}:`, lk: "text" as LineKind }] : [];
      prev.lines = [...prev.lines, ...extra, ...p.lines];
      prev.path = base;
      prev.leaves = [...leaves];
      prev.hidden = prev.hidden || p.hidden;
    } else merged.push({ ...p, lines: [...p.lines] });
  }

  // duplicados exactos (por ejemplo, el mismo menú en barra lateral y cajón)
  const seen = new Set<string>();
  const sections: Section[] = [];
  let deduped = 0, chars = 0, dropped = 0, droppedUi = 0;
  const byKind: Record<string, number> = {};
  for (const p of merged) {
    const text = p.lines.map((l) => l.text).join("\n").slice(0, HARD_SECTION_CHARS);
    const key = norm(text);
    if (p.kind !== "menu" && p.path.length === 0 && text.length < 200 && p.lines.every((l) => l.lk === "btn" || l.lk === "item")) { droppedUi++; continue; }
    if (seen.has(key)) { deduped++; continue; }
    seen.add(key);
    if (sections.length >= MAX_SECTIONS_PER_PAGE || chars + text.length > MAX_TOTAL_CHARS) { dropped++; continue; }
    chars += text.length;
    byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
    sections.push({
      position: sections.length, heading_path: [...p.path, ...(p.leaves && p.leaves.length ? [p.leaves.join(" / ")] : [])].join(" › ").slice(0, 300), kind: p.kind,
      is_hidden: p.hidden, text, anchor: p.anchor, id_path: p.ids,
    });
  }
  const warnings = [...w.warnings];
  if (dropped) warnings.push("secciones_descartadas_por_tope");
  return {
    title, sections, warnings,
    stats: { sections: sections.length, chars, deduped, dropped, dropped_botones_sueltos: droppedUi, decorativos: w.decorative, nodes: w.nodes, ms: Date.now() - t0, ...Object.fromEntries(Object.entries(byKind).map(([k, v]) => ["k_" + k, v])) },
  };
}
