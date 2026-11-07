// supabase/functions/import-site/lib.ts
// Reglas de seguridad y lectura de sitios (probadas con servidor local de pruebas).
import { HTMLElement, parse, TextNode } from "npm:node-html-parser@6.1.13";

export const UA = "WalkyletBot/0.1";
export const MAX_REDIRECTS = 3;
export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_PAGE_BYTES = 500_000;
export const MAX_TEXT_CHARS = 60_000;

// Solo para pruebas locales: en producción nadie lo cambia.
export const cfg: { allowLocal: boolean; resolve?: (host: string) => Promise<string[]> } = {
  allowLocal: false,
};

export const normHost = (h: string) => h.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");

// ---------- Direcciones privadas ----------
export function isPrivateIPv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0) ||
    (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

export function isPrivateIPv6(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === "::" || s === "::1") return true;
  if (s.startsWith("::ffff:")) {
    const v4 = s.slice(7);
    return v4.includes(".") ? isPrivateIPv4(v4) : true;
  }
  return /^(fc|fd|fe[89ab]|ff)/.test(s);
}

async function dohResolve(host: string): Promise<string[]> {
  const out: string[] = [];
  for (const type of ["A", "AAAA"]) {
    try {
      const r = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
        { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(5000) },
      );
      const j = await r.json();
      for (const a of j.Answer ?? []) if (a.type === 1 || a.type === 28) out.push(String(a.data));
    } catch { /* sin respuesta */ }
  }
  return out;
}

const dnsCache = new Map<string, string[]>();
export async function resolveHost(host: string): Promise<string[]> {
  if (cfg.resolve) return cfg.resolve(host);
  const hit = dnsCache.get(host);
  if (hit) return hit;
  const out: string[] = [];
  for (const type of ["A", "AAAA"] as const) {
    try {
      // deno-lint-ignore no-explicit-any
      const r = await (Deno as any).resolveDns(host, type);
      out.push(...r);
    } catch { /* se prueba el respaldo */ }
  }
  const ips = out.length ? out : await dohResolve(host);
  dnsCache.set(host, ips);
  return ips;
}

export async function assertPublicUrl(u: string): Promise<URL> {
  let x: URL;
  try { x = new URL(u); } catch { throw new Error("url_invalida"); }
  if (x.protocol !== "http:" && x.protocol !== "https:") throw new Error("protocolo_no_permitido");
  if (x.username || x.password) throw new Error("credenciales_en_url");
  if (x.port && x.port !== "80" && x.port !== "443" && !cfg.allowLocal) throw new Error("puerto_no_permitido");
  const host = x.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new Error("host_vacio");
  const isV6 = host.startsWith("[");
  const bare = isV6 ? host.slice(1, -1) : host;
  if (cfg.allowLocal && bare === "127.0.0.1") return x;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(bare)) {
    if (isPrivateIPv4(bare)) throw new Error("ip_privada");
    return x;
  }
  if (isV6) {
    if (isPrivateIPv6(bare)) throw new Error("ip_privada");
    return x;
  }
  if (host === "localhost" || /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(host)) {
    throw new Error("host_local");
  }
  if (!host.includes(".")) throw new Error("host_sin_dominio");
  const ips = await resolveHost(host);
  if (!ips.length) throw new Error("dns_sin_resultado");
  for (const ip of ips) {
    if (ip.includes(":") ? isPrivateIPv6(ip) : isPrivateIPv4(ip)) throw new Error("ip_privada");
  }
  return x;
}

// ---------- Descarga segura ----------
export type FetchResult = {
  status: number; finalUrl: string; text: string; truncated: boolean; bytes: number; contentType: string;
};

async function readCapped(res: Response, max: number) {
  const reader = res.body?.getReader();
  if (!reader) return { text: "", truncated: false, bytes: 0 };
  const chunks: Uint8Array[] = [];
  let total = 0, truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.length > max) {
      chunks.push(value.slice(0, max - total));
      total = max; truncated = true;
      try { await reader.cancel(); } catch { /* nada */ }
      break;
    }
    chunks.push(value); total += value.length;
  }
  const buf = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.length; }
  let text = new TextDecoder("utf-8").decode(buf);
  if (truncated) text = text.replace(/<[^>]*$/, ""); // quita una etiqueta cortada al final
  return { text, truncated, bytes: total };
}

export async function safeFetch(
  url: string,
  o: { baseHost: string; maxBytes: number; accept?: string },
): Promise<FetchResult> {
  let cur = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let pre: URL;
    try { pre = new URL(cur); } catch { throw new Error("url_invalida"); }
    // primero el dominio (así no se consulta el DNS de un sitio ajeno), después la seguridad
    if (normHost(pre.hostname) !== o.baseHost) throw new Error("fuera_del_dominio");
    const u = await assertPublicUrl(cur);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(u.toString(), {
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "user-agent": UA, accept: o.accept ?? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5" },
      });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        try { await res.body?.cancel(); } catch { /* nada */ }
        cur = new URL(loc, u).toString();
        continue;
      }
      const ct = (res.headers.get("content-type") ?? "").toLowerCase();
      const r = await readCapped(res, o.maxBytes);
      return { status: res.status, finalUrl: u.toString(), ...r, contentType: ct };
    } catch (e) {
      if ((e as Error).name === "AbortError") throw new Error("tiempo_agotado");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("demasiadas_redirecciones");
}

// ---------- URLs ----------
const SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|ico|avif|zip|gz|rar|7z|mp4|mp3|wav|mov|css|js|mjs|json|xml|txt|woff2?|ttf|otf|eot|docx?|xlsx?|pptx?|csv|apk|exe|dmg)$/i;

export function normalizeUrl(u: string, base?: string): { url: string; key: string } | null {
  let x: URL;
  try { x = new URL(u, base); } catch { return null; }
  if (x.protocol !== "http:" && x.protocol !== "https:") return null;
  if (x.username || x.password) return null;
  if (x.search) return null; // se descartan las variantes con parámetros
  x.hash = "";
  if (SKIP_EXT.test(x.pathname)) return null;
  const path = x.pathname.replace(/\/+$/, "") || "/";
  return { url: x.toString(), key: normHost(x.hostname) + path };
}

// ---------- robots.txt y sitemap ----------
export type Rule = { allow: boolean; re: RegExp; len: number };

function patternToRegex(p: string): RegExp {
  const esc = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp("^" + esc.replace(/\\\$$/, "$"));
}

// Criterio prudente: se aplican juntas las reglas de "*" y las de WalkyletBot.
export function parseRobots(txt: string): { rules: Rule[]; sitemaps: string[] } {
  const rules: Rule[] = [], sitemaps: string[] = [];
  let agents: string[] = [], inRules = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    const v = line.slice(i + 1).trim();
    if (k === "sitemap") { if (v) sitemaps.push(v); continue; }
    if (k === "user-agent") {
      if (inRules) { agents = []; inRules = false; }
      agents.push(v.toLowerCase());
      continue;
    }
    if (k === "allow" || k === "disallow") {
      inRules = true;
      const applies = agents.some((a) => a === "*" || a.includes("walkyletbot"));
      if (!applies || !v) continue;
      rules.push({ allow: k === "allow", re: patternToRegex(v), len: v.length });
    }
  }
  return { rules, sitemaps };
}

export function robotsAllowed(rules: Rule[], path: string): boolean {
  let best: Rule | null = null;
  for (const r of rules) {
    if (r.re.test(path) && (!best || r.len > best.len || (r.len === best.len && r.allow))) best = r;
  }
  return best ? best.allow : true;
}

const decodeXml = (s: string) =>
  s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();

export function parseSitemap(xml: string): { isIndex: boolean; locs: string[] } {
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const locs = [...xml.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)].map((m) => decodeXml(m[1])).filter(Boolean);
  return { isIndex, locs };
}

// ---------- Extracción de texto ----------
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

function normalizeText(s: string): string {
  return s.replace(/\r/g, "").split("\n").map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter((l, i, a) => l || (a[i - 1] && true)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function isHidden(el: HTMLElement): boolean {
  const a = el.attributes;
  if ("hidden" in a || a["aria-hidden"] === "true") return true;
  if (el.tagName === "DIALOG" && !("open" in a)) return true;
  const st = a["style"];
  return !!st && /(display\s*:\s*none|visibility\s*:\s*hidden)/i.test(st);
}

export type LinkItem = { text: string; href: string };
export type Extracted = {
  title: string; text: string; hidden_text: string; hidden_removed: number;
  headings: string[]; links: string[]; linkItems: LinkItem[]; posible_js: boolean;
};

export function extractPage(html: string): Extracted {
  const root = parse(html, {
    blockTextElements: { script: true, noscript: true, style: true, pre: true },
  });
  // <pre> llega como HTML crudo: se le quitan las etiquetas y queda como texto (las entidades se decodifican al leerlo)
  for (const pre of root.querySelectorAll("pre")) {
    const raw = pre.innerHTML.replace(/<[^>]+>/g, "");
    pre.replaceWith(new TextNode(raw, pre.parentNode));
  }
  const title = clean(root.querySelector("title")?.text ?? "").slice(0, 300);

  // enlaces: antes de quitar nada (el menú también cuenta para descubrir páginas)
  const links: string[] = [];
  const linkItems: LinkItem[] = [];
  for (const a of root.querySelectorAll("a[href]")) {
    const h = a.getAttribute("href");
    if (h && links.length < 300) {
      links.push(h);
      linkItems.push({ text: clean(a.text).slice(0, 80), href: h });
    }
  }
  const hasForm = !!root.querySelector("form");
  const scriptCount = root.querySelectorAll("script").length;
  const emptyRoot = ["#root", "#app", "#__next"].some((s) => {
    const e = root.querySelector(s);
    return !!e && clean(e.text) === "";
  });

  for (
    const sel of ["script", "style", "noscript", "svg", "template", "iframe", "canvas", "nav", "footer",
      "aside", "form", "header", "[role=banner]"]
  ) root.querySelectorAll(sel).forEach((e) => e.remove());

  for (const a of root.querySelectorAll('a[href^="#"]')) {
    if (/^(saltar|skip|ir al contenido|ir a contenido)/i.test(clean(a.text))) a.remove();
  }

  // lo oculto se guarda aparte (no se descarta)
  const hiddenParts: string[] = [];
  let hiddenCount = 0;
  const walk = (node: HTMLElement) => {
    for (const child of [...node.childNodes]) {
      if (child instanceof HTMLElement) {
        if (isHidden(child)) {
          const t = normalizeText(child.structuredText);
          if (t) hiddenParts.push(t);
          hiddenCount++;
          child.remove();
        } else walk(child);
      }
    }
  };
  walk(root);

  const main = root.querySelector("main, [role=main]");
  const body = root.querySelector("body") ?? root;
  const target = main && clean(main.text).length > 200 ? main : body;
  const text = normalizeText(target.structuredText).slice(0, MAX_TEXT_CHARS);
  const headings = target.querySelectorAll("h1,h2,h3").map((h) => clean(h.text)).filter(Boolean).slice(0, 30);
  const posible_js = text.length < 200 && !hasForm && (emptyRoot || scriptCount >= 3);

  return {
    title, text, hidden_text: hiddenParts.join("\n---\n").slice(0, MAX_TEXT_CHARS),
    hidden_removed: hiddenCount, headings, links, linkItems, posible_js,
  };
}

export async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
