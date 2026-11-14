// supabase/functions/import-site/changes.ts
// Qué cambió en una página entre una lectura y la siguiente. SIN IA: se compara el texto guardado con el nuevo,
// sección por sección y línea por línea, así lo que se muestra es exacto (nada inventado ni resumido).
export const MAX_DIFF_SECTIONS = 30;   // secciones que se detallan por página
export const MAX_DIFF_LINES = 8;       // líneas agregadas y quitadas que se muestran por sección
export const MAX_DIFF_LINE_CHARS = 200;

export type OldSection = { position: number; heading_path: string; text: string; content_hash: string };
export type NewSection = { heading_path: string; text: string; content_hash: string };
export type SectionDiff = { title: string; change: "new" | "changed" | "removed"; added?: string[]; removed?: string[] };
export type ChangeRow = {
  job_id: string; widget_id: string; user_id: string; url: string; title: string | null;
  change: "new" | "changed"; sections: SectionDiff[];
};

const cut = (t: string, n: number) => (t.length <= n ? t : t.slice(0, n - 1).trimEnd() + "…");
const linesOf = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean);

// líneas de b que no están en a (se cuentan repeticiones: si estaba una vez y ahora dos, sobra una)
function lineDiff(a: string[], b: string[]): string[] {
  const left = new Map<string, number>();
  for (const l of a) left.set(l, (left.get(l) ?? 0) + 1);
  const res: string[] = [];
  for (const l of b) {
    const c = left.get(l) ?? 0;
    if (c > 0) left.set(l, c - 1); else res.push(l);
  }
  return res;
}

function show(lines: string[]): string[] {
  const shown = lines.slice(0, MAX_DIFF_LINES).map((l) => cut(l, MAX_DIFF_LINE_CHARS));
  if (lines.length > MAX_DIFF_LINES) shown.push(`… y ${lines.length - MAX_DIFF_LINES} más`);
  return shown;
}

// Dos secciones con el mismo título se emparejan por orden de aparición.
function keys(list: { heading_path: string }[]): string[] {
  const seen = new Map<string, number>();
  return list.map((s) => {
    const n = (seen.get(s.heading_path) ?? 0) + 1;
    seen.set(s.heading_path, n);
    return `${s.heading_path}\u0000${n}`;
  });
}

export function diffSections(old: OldSection[], neu: NewSection[]): SectionDiff[] {
  const ok = keys(old), nk = keys(neu);
  const oldBy = new Map(old.map((s, i) => [ok[i], s] as const));
  const matched = new Set<string>();
  const res: SectionDiff[] = [];
  neu.forEach((s, i) => {
    const title = s.heading_path || "(sin título)";
    const o = oldBy.get(nk[i]);
    if (!o) { res.push({ title, change: "new" }); return; }
    matched.add(nk[i]);
    if (o.content_hash === s.content_hash) return;
    const ol = linesOf(o.text), nl = linesOf(s.text);
    res.push({ title, change: "changed", added: show(lineDiff(ol, nl)), removed: show(lineDiff(nl, ol)) });
  });
  old.forEach((o, i) => { if (!matched.has(ok[i])) res.push({ title: o.heading_path || "(sin título)", change: "removed" }); });
  return res.slice(0, MAX_DIFF_SECTIONS);
}
