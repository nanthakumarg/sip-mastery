/**
 * Site search: ranks the records of /search.json for a query, and cuts a
 * snippet with the matches marked. Pure, shared by the SiteSearch island and
 * the tests. Every word of the query must match the start of a word in the
 * title, the aliases, or the text.
 */

export type SearchKind = 'module' | 'section' | 'term' | 'header' | 'code' | 'rfc';

export interface SearchDoc {
  k: SearchKind;
  /** Title */
  t: string;
  /** Subtitle: where the record lives */
  s: string;
  /** Plain text */
  x: string;
  /** Link: a course page or an RFC. A term that no module uses has none. */
  u?: string;
  /** Second link: the RFC section */
  r?: string;
  /** Aliases and other words that count as title */
  a?: string;
  /** Module number, to break ties */
  m?: number;
}

export interface SearchHit {
  doc: SearchDoc;
  score: number;
}

export const KIND_LABEL: Record<SearchKind, string> = {
  module: 'Module', section: 'Section', term: 'Term', header: 'Header', code: 'Code', rfc: 'RFC',
};

/** Lower case without accents. Keeps the length, so positions map back to the original text. */
export function normalise(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    const l = (c.normalize('NFD')[0] ?? c).toLowerCase();
    out += l.length === 1 ? l : c;
  }
  return out;
}

/** Query words, without the punctuation around them ("Via:" → "via", "(486)" → "486"). */
export function tokenize(q: string): string[] {
  return normalise(q).split(/\s+/)
    .map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
}

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

/** Positions where `tok` starts a word in `hay` (both normalised). */
function wordStarts(hay: string, tok: string, max = Infinity): number[] {
  const out: number[] = [];
  let i = hay.indexOf(tok);
  while (i !== -1 && out.length < max) {
    if (!isWordChar(hay[i - 1])) out.push(i);
    i = hay.indexOf(tok, i + 1);
  }
  return out;
}

const KIND_BONUS: Record<SearchKind, number> = { code: 6, header: 6, term: 5, module: 4, section: 0, rfc: 1 };

interface Prepared { doc: SearchDoc; title: string; alias: string; text: string }
const prepCache = new WeakMap<SearchDoc[], Prepared[]>();
function prepare(docs: SearchDoc[]): Prepared[] {
  let p = prepCache.get(docs);
  if (!p) {
    p = docs.map(doc => ({ doc, title: normalise(doc.t), alias: normalise(doc.a ?? ''), text: normalise(doc.x) }));
    prepCache.set(docs, p);
  }
  return p;
}

export function search(docs: SearchDoc[], query: string, limit = 20): SearchHit[] {
  const toks = tokenize(query);
  if (!toks.length) return [];
  const phrase = toks.join(' ');
  const hits: SearchHit[] = [];
  for (const p of prepare(docs)) {
    let score = 0;
    let ok = true;
    for (const tok of toks) {
      const inTitle = wordStarts(p.title, tok, 1).length > 0;
      const inAlias = !inTitle && wordStarts(p.alias, tok, 1).length > 0;
      const inText = wordStarts(p.text, tok, 6).length;
      if (!inTitle && !inAlias && !inText) { ok = false; break; }
      if (inTitle || inAlias) {
        const exact = new RegExp(`(^|[^\\p{L}\\p{N}])${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(inTitle ? p.title : p.alias);
        score += exact ? 30 : 20;
      }
      score += inText ? 4 + inText * 2 : 0;
    }
    if (!ok) continue;
    const bare = p.title.replace(/^\d+(\.\d+)*\s+/, '');
    if (p.title === phrase || bare === phrase || p.alias.split(' ').includes(phrase)) score += 100;
    else if (p.title.startsWith(phrase) || bare.startsWith(phrase)) score += 50;
    else if (toks.length > 1 && (p.title.includes(phrase) || p.text.includes(phrase))) score += 25;
    score += KIND_BONUS[p.doc.k];
    hits.push({ doc: p.doc, score });
  }
  hits.sort((a, b) => b.score - a.score || (a.doc.m ?? 99) - (b.doc.m ?? 99) || a.doc.t.localeCompare(b.doc.t));
  return hits.slice(0, limit);
}

export interface Segment { t: string; mark?: boolean }

/** About `width` characters of `text` around the first match, with every match marked. */
export function snippet(text: string, query: string, width = 160): Segment[] {
  const toks = tokenize(query);
  const norm = normalise(text);
  const first = Math.min(...toks.map(t => wordStarts(norm, t, 1)[0] ?? Infinity));
  let start = Number.isFinite(first) ? Math.max(0, first - Math.floor(width / 3)) : 0;
  if (start > 0) {
    const sp = text.indexOf(' ', start);
    start = sp !== -1 && sp < first ? sp + 1 : start;
  }
  let end = Math.min(text.length, start + width);
  if (end < text.length) {
    const sp = text.lastIndexOf(' ', end);
    if (sp > start + width / 2) end = sp;
  }
  const ranges: [number, number][] = [];
  for (const t of toks) for (const i of wordStarts(norm.slice(0, end), t)) if (i >= start) ranges.push([i, Math.min(end, i + t.length)]);
  ranges.sort((a, b) => a[0] - b[0]);
  const segs: Segment[] = [];
  if (start > 0) segs.push({ t: '… ' });
  let at = start;
  for (const [a, b] of ranges) {
    if (b <= at) continue;
    const from = Math.max(a, at);
    if (from > at) segs.push({ t: text.slice(at, from) });
    segs.push({ t: text.slice(from, b), mark: true });
    at = b;
  }
  if (at < end) segs.push({ t: text.slice(at, end) });
  if (end < text.length) segs.push({ t: ' …' });
  return segs;
}
