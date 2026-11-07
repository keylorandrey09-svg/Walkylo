// supabase/functions/verify-site/verify.ts
// Verificación de un sitio: ¿carga, se puede leer y es del dueño? Los pasos se guardan a medida que ocurren.
import { parse } from "npm:node-html-parser@6.1.13";
import { assertPublicUrl, cfg, extractPage, normHost, parseRobots, robotsAllowed, safeFetch } from "./lib.ts";

export const LIMIT_HOUR = 5;      // PROVISIONAL
export const LIMIT_DAY = 20;      // PROVISIONAL
export const WAIT_BASE_S = 30;    // espera creciente tras fallos seguidos: 30, 60, 120… (máx. 10 min)
export const WAIT_MAX_S = 600;
export const STALE_MIN = 3;

export type StepStatus = "pending" | "running" | "ok" | "warn" | "fail";
export type Step = { id: string; label: string; status: StepStatus; message: string; ms?: number };
export type Verification = {
  id: string; widget_id: string; user_id: string; url: string; host: string; method: string | null;
  status: "running" | "verified" | "failed"; steps: Step[]; preview: Record<string, unknown> | null;
  error: string | null; created_at: string; updated_at: string; finished_at: string | null;
};
export type WidgetInfo = {
  id: string; site_url: string | null; verify_token: string; verified_host: string | null; verified_at: string | null;
};
export interface VStore {
  widgetInfo(userId: string): Promise<WidgetInfo | null>;
  recent(widgetId: string, sinceISO: string): Promise<Verification[]>; // más nuevas primero
  create(row: Omit<Verification, "id" | "created_at" | "updated_at" | "finished_at" | "error">): Promise<Verification>;
  update(id: string, patch: Record<string, unknown>): Promise<void>;
  markVerified(widgetId: string, host: string): Promise<void>;
  latest(widgetId: string): Promise<Verification | null>;
}
export type Out = { status: number; body: Record<string, unknown> };
const out = (status: number, body: Record<string, unknown>): Out => ({ status, body });

export const STEP_DEFS = [
  { id: "publica", label: "Comprobando que la dirección es pública" },
  { id: "abre", label: "Abriendo tu sitio" },
  { id: "legible", label: "Revisando que se pueda leer" },
  { id: "codigo", label: "Buscando el código de Walkylet" },
  { id: "listo", label: "Confirmando que el sitio es tuyo" },
];

export const hostOf = (u: string | null | undefined): string => {
  try { return normHost(new URL(u ?? "").hostname); } catch { return ""; }
};
// El sitio del widget está verificado si su dirección actual es del mismo dominio que se verificó.
export const isVerified = (w: { site_url: string | null; verified_host: string | null; verified_at: string | null }) =>
  !!w.verified_host && !!w.verified_at && hostOf(w.site_url) === w.verified_host;

class Fail extends Error { constructor(public code: string) { super(code); } }

export function pub(v: Verification) {
  return {
    id: v.id, status: v.status, method: v.method, url: v.url, host: v.host, steps: v.steps, preview: v.preview,
    error: v.error, created_at: v.created_at, finished_at: v.finished_at,
  };
}

function msgPublica(code: string): string {
  const m: Record<string, string> = {
    ip_privada: "La dirección apunta a una red interna. Usá la dirección pública de tu sitio.",
    host_local: "Esa dirección es local. Usá la dirección pública de tu sitio.",
    host_sin_dominio: "Falta el dominio completo (por ejemplo, tusitio.com).",
    dns_sin_resultado: "No encontramos esa dirección. Revisá que esté bien escrita.",
    puerto_no_permitido: "Usá la dirección sin un puerto especial.",
    credenciales_en_url: "La dirección no puede incluir usuario ni contraseña.",
    protocolo_no_permitido: "La dirección tiene que empezar con https://",
    url_invalida: "La dirección no es válida.",
  };
  return m[code] ?? "Esa dirección no se puede usar.";
}
function msgAbre(code: string): string {
  if (code === "tiempo_agotado") return "Tu sitio tardó más de 10 s en responder.";
  if (code === "fuera_del_dominio") return "Tu dirección redirige a otro dominio. Usá la dirección final de tu sitio.";
  if (code === "demasiadas_redirecciones") return "Tu dirección redirige demasiadas veces.";
  if (code === "ip_privada") return "Tu dirección redirige a una red interna.";
  return "No pudimos abrir tu sitio.";
}

const attr = (e: { getAttribute(n: string): string | undefined | null } | null | undefined, n: string) => (e?.getAttribute(n) ?? "").trim();

export function previewOf(html: string, pageUrl: string): Record<string, unknown> {
  const root = parse(html);
  const meta = (sel: string) => attr(root.querySelector(sel), "content");
  const title = (meta('meta[property="og:title"]') || root.querySelector("title")?.text?.trim() || "").replace(/\s+/g, " ").slice(0, 120);
  const desc = (meta('meta[property="og:description"]') || meta('meta[name="description"]')).replace(/\s+/g, " ").slice(0, 160);
  const site = meta('meta[property="og:site_name"]').slice(0, 60);
  let icon: string | null = null;
  const link = root.querySelector('link[rel~="icon"]') ?? root.querySelector('link[rel="shortcut icon"]') ?? root.querySelector('link[rel="apple-touch-icon"]');
  const href = attr(link, "href");
  if (href) {
    try {
      const u = new URL(href, pageUrl);
      if (u.protocol === "https:" && hostOf(u.href) === hostOf(pageUrl)) icon = u.href.slice(0, 300); // solo del mismo sitio
    } catch { /* sin ícono */ }
  }
  return { title: title || null, description: desc || null, site_name: site || null, icon };
}

export function findCode(html: string, widgetId: string, token: string): "install_code" | "meta_tag" | null {
  const root = parse(html);
  const install = root.querySelectorAll("script[src]").some((s) =>
    /\/w\.js(\?|#|$)/.test(attr(s, "src")) && attr(s, "data-id") === widgetId);
  if (install) return "install_code";
  const meta = root.querySelectorAll('meta[name="walkylet-verify"]').some((m) => attr(m, "content") === token);
  return meta ? "meta_tag" : null;
}

async function run(store: VStore, w: WidgetInfo, v: Verification): Promise<Verification> {
  const steps = v.steps;
  let preview: Record<string, unknown> | null = null, method: string | null = null;
  const save = (extra: Record<string, unknown> = {}) =>
    store.update(v.id, { steps, preview, method, updated_at: new Date().toISOString(), ...extra });
  const begin = async (i: number) => { steps[i] = { ...steps[i], status: "running", message: "" }; await save(); };
  const set = async (i: number, status: StepStatus, message: string, ms?: number) => {
    steps[i] = { ...steps[i], status, message, ms }; await save();
  };
  const fail = async (i: number, message: string, code: string): Promise<never> => { await set(i, "fail", message); throw new Fail(code); };
  let error: string | null = null, status: "verified" | "failed" = "failed";
  try {
    // 1) dirección pública y con HTTPS
    await begin(0);
    let u: URL;
    try { u = await assertPublicUrl(w.site_url!); } catch (e) { return await fail(0, msgPublica((e as Error).message), "direccion_no_permitida"); }
    if (u.protocol !== "https:" && !cfg.allowLocal) return await fail(0, "Tu sitio tiene que usar HTTPS (https://).", "sin_https");
    await set(0, "ok", u.protocol === "https:" ? "Dirección pública con HTTPS." : "Dirección pública.");

    // 2) abrir el sitio
    await begin(1);
    const t0 = performance.now();
    let r;
    try { r = await safeFetch(u.toString(), { baseHost: v.host, maxBytes: 500_000 }); }
    catch (e) { return await fail(1, msgAbre((e as Error).message), (e as Error).message); }
    const ms = Math.round(performance.now() - t0);
    preview = { host: v.host, https: u.protocol === "https:", response_ms: ms, size_kb: Math.round(r.bytes / 1024), status: r.status };
    if (r.status >= 400) return await fail(1, `Tu sitio respondió con el error ${r.status}.`, `http_${r.status}`);
    await set(1, "ok", `Responde en ${(ms / 1000).toFixed(1)} s.`, ms);

    // 3) que se pueda leer
    await begin(2);
    if (r.contentType && !r.contentType.includes("html")) return await fail(2, "Esa dirección no devuelve una página web (HTML).", "no_es_html");
    preview = { ...preview, ...previewOf(r.text, u.toString()) };
    const ex = extractPage(r.text);
    let robotsOk = true;
    try {
      const rb = await safeFetch(u.origin + "/robots.txt", { baseHost: v.host, maxBytes: 100_000, accept: "text/plain,*/*;q=0.5" });
      if (rb.status === 200) robotsOk = robotsAllowed(parseRobots(rb.text).rules, u.pathname || "/");
    } catch { /* sin robots.txt: permitido */ }
    if (!robotsOk) await set(2, "warn", "Tu robots.txt no deja que Walkylet lea esta página: la lectura va a quedar bloqueada hasta que lo permitas.");
    else if (ex.posible_js) await set(2, "warn", "Tu sitio se arma con JavaScript: la lectura puede verse vacía.");
    else await set(2, "ok", `Es una página web legible (${Math.max(1, Math.round(r.bytes / 1024))} KB).`);

    // 4) código de Walkylet
    await begin(3);
    method = findCode(r.text, w.id, w.verify_token);
    if (!method) {
      return await fail(3, "No encontramos el código de Walkylet en esa página. Instalá el widget o agregá la etiqueta de verificación.", "codigo_no_encontrado");
    }
    await set(3, "ok", method === "install_code" ? "Encontramos el código de instalación con tu ID." : "Encontramos la etiqueta de verificación.");

    // 5) listo
    await begin(4);
    await store.markVerified(w.id, v.host);
    await set(4, "ok", "Sitio verificado: se desbloquean la lectura del sitio y el escaneo de tu app.");
    status = "verified";
  } catch (e) {
    if (e instanceof Fail) error = e.code;
    else {
      console.error("verify_error", (e as Error).message);
      error = "error_interno";
      const i = steps.findIndex((s) => s.status === "running");
      if (i >= 0) steps[i] = { ...steps[i], status: "fail", message: "Algo falló de nuestro lado. Probá de nuevo en un momento." };
    }
  }
  const finished = new Date().toISOString();
  await save({ status, error, finished_at: finished });
  return { ...v, steps, preview, method, status, error, finished_at: finished, updated_at: finished };
}

export async function startVerify(store: VStore, uid: string, now = Date.now()): Promise<Out> {
  const w = await store.widgetInfo(uid);
  if (!w) return out(404, { error: "sin_widget" });
  if (!w.site_url) return out(400, { error: "sin_url" });
  const host = hostOf(w.site_url);
  if (!host) return out(400, { error: "url_invalida" });
  if (isVerified(w)) return out(200, { status: "verified", already: true, host });

  const recent = await store.recent(w.id, new Date(now - 86_400_000).toISOString());
  const running = recent.find((x) => x.status === "running" && now - Date.parse(x.updated_at) < STALE_MIN * 60_000);
  if (running) return out(200, { ...pub(running), resumed: true });
  const interrumpidas = new Set<string>();
  for (const x of recent) {
    if (x.status !== "running") continue;
    interrumpidas.add(x.id);
    await store.update(x.id, { status: "failed", error: "interrumpida", finished_at: new Date(now).toISOString() });
  }
  if (recent.length >= LIMIT_DAY) return out(429, { error: "limite_diario" });
  const inHour = recent.filter((x) => now - Date.parse(x.created_at) < 3_600_000);
  if (inHour.length >= LIMIT_HOUR) {
    const oldest = Date.parse(inHour[inHour.length - 1].created_at);
    return out(429, { error: "limite_hora", retry_after_s: Math.max(1, Math.ceil((oldest + 3_600_000 - now) / 1000)) });
  }
  let fails = 0;
  for (const x of recent) {
    if (interrumpidas.has(x.id)) continue;   // una interrumpida por nosotros no cuenta como fallo del dueño
    if (now - Date.parse(x.created_at) > 30 * 60_000 || x.status !== "failed") break;
    fails++;
  }
  if (fails > 0) {
    const wait = Math.min(WAIT_MAX_S, WAIT_BASE_S * 2 ** (fails - 1));
    const elapsed = (now - Date.parse(recent[0].created_at)) / 1000;
    if (elapsed < wait) return out(429, { error: "espera", retry_after_s: Math.ceil(wait - elapsed) });
  }
  const v = await store.create({
    widget_id: w.id, user_id: uid, url: w.site_url, host, method: null, status: "running",
    steps: STEP_DEFS.map((s) => ({ ...s, status: "pending" as StepStatus, message: "" })), preview: null,
  });
  return out(200, pub(await run(store, w, v)));
}

export async function statusVerify(store: VStore, uid: string): Promise<Out> {
  const w = await store.widgetInfo(uid);
  if (!w) return out(404, { error: "sin_widget" });
  const v = await store.latest(w.id);
  const verified = isVerified(w);
  return out(200, { verified, verified_host: verified ? w.verified_host : null, verified_at: verified ? w.verified_at : null, current: v ? pub(v) : null });
}
