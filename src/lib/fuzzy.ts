// Accent- and case-insensitive matching for the launcher and app lists.

export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Scores how well `query` matches `text` (higher is better), or returns null.
 * Prefix > word start > substring > in-order letters.
 */
export function score(query: string, text: string, extra = ""): number | null {
  const q = fold(query.trim());
  if (!q) return 0;
  const t = fold(text);
  if (t.startsWith(q)) return 1000 - t.length;
  const words = t.split(/[\s/._()-]+/);
  if (words.some((w) => w.startsWith(q))) return 800 - t.length;
  const at = t.indexOf(q);
  if (at >= 0) return 600 - at;
  if (extra && fold(extra).split(/\s+/).some((k) => k.startsWith(q))) return 400;
  let i = 0;
  for (const ch of t) if (ch === q[i]) i++;
  return i === q.length && q.length >= 2 ? 200 - t.length : null;
}
