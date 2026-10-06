/**
 * Builds the site search index (served as /search.json): one record for each
 * module, each `##` section of a module, and each glossary term, header, SDP
 * line, response code, and RFC. Pure: the caller passes in the loaded data
 * and a function that makes base-aware links.
 */
import type { CodeEntry, GlossaryEntry, HeaderRef } from './data.ts';
import { rfcUrl } from './rfc-ref.ts';
import type { SearchDoc } from './search.ts';

export interface IndexModule {
  id: string;
  module: number;
  title: string;
  summary: string;
  objectives: string[];
  /** The raw MDX body */
  body: string;
  /** Rendered headings (Astro `render(entry).headings`), for the section anchors */
  headings?: { depth: number; slug: string; text: string }[];
}

export interface IndexRfc {
  n: number;
  short: string;
  summary: string;
  modules: number[];
  title?: string;
}

export interface IndexInput {
  modules: IndexModule[];
  glossary: GlossaryEntry[];
  headers: HeaderRef;
  codes: CodeEntry[];
  rfcs: IndexRfc[];
  link: (path: string) => string;
}

const ws = (s: string) => s.replace(/\s+/g, ' ').trim();

/** MDX source to plain text: components go, the words a reader sees stay. */
export function mdxToText(src: string): string {
  let s = src.replace(/^---\n[\s\S]*?\n---\n/, '');
  s = s.replace(/^(import|export)\s.*$/gm, '');
  // Code fences: keep the code (commands and filters are worth finding), drop the fence lines
  s = s.replace(/^```.*$/gm, '');
  // <Term t="x" /> shows x; <Mistake title="t"> and <Note title="t"> show their title
  s = s.replace(/<Term\s+t="([^"]*)"\s*\/>/g, '$1');
  s = s.replace(/<[A-Z][A-Za-z]*\b[^>]*?\btitle="([^"]*)"[^>]*>/g, ' $1. ');
  // Every other tag goes, its inner text stays
  s = s.replace(/<\/?[A-Za-z][^>]*>/g, ' ');
  s = s.replace(/\{[^{}]*\}/g, ' ');
  // Markdown
  s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
  s = s.replace(/^\s*\|?[\s:|-]*-{3,}[\s:|-]*$/gm, '');
  s = s.replace(/^#{1,6}\s+/gm, '');
  s = s.replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '');
  s = s.replace(/\*\*|__|`/g, '');
  s = s.replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|[.,;:)]|$)/g, '$1$2');
  s = s.replace(/\s*\|\s*/g, ' · ');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return ws(s.replace(/(^|\s)·(\s·)+/g, '$1·').replace(/^· | ·$/gm, ''));
}

/** Split an MDX body at its `## ` headings. Text before the first one is the intro. */
export function splitSections(body: string): { title: string; raw: string }[] {
  const out: { title: string; raw: string }[] = [];
  let cur: { title: string; raw: string } = { title: '', raw: '' };
  let fence = false;
  for (const line of body.split('\n')) {
    if (line.startsWith('```')) fence = !fence;
    const m = !fence && /^## (.+)$/.exec(line);
    if (m) {
      out.push(cur);
      cur = { title: m[1]!.trim(), raw: '' };
    } else cur.raw += line + '\n';
  }
  out.push(cur);
  return out;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function buildIndex(input: IndexInput): SearchDoc[] {
  const { link } = input;
  const docs: SearchDoc[] = [];
  const mods = [...input.modules].sort((a, b) => a.module - b.module);
  const byNum = new Map(mods.map(m => [m.module, m]));
  const modUrl = (m: IndexModule) => link(`modules/${m.id}/`);
  const modLabel = (m: IndexModule) => `Module ${pad2(m.module)} · ${m.title}`;

  // Where each glossary term is first explained: the first section that uses <Term t="…">
  const firstUse = new Map<string, string>();

  for (const m of mods) {
    docs.push({ k: 'module', t: m.title, s: `Module ${pad2(m.module)}`, x: ws(`${m.summary} ${m.objectives.join(' ')}`), u: modUrl(m), m: m.module });
    const h2 = (m.headings ?? []).filter(h => h.depth === 2);
    splitSections(m.body).forEach((sec, i) => {
      const slug = i > 0 ? h2[i - 1]?.slug : undefined;
      const u = slug ? `${modUrl(m)}#${slug}` : modUrl(m);
      for (const t of sec.raw.matchAll(/<Term\s+t="([^"]+)"/g)) {
        const key = t[1]!.toLowerCase();
        if (!firstUse.has(key)) firstUse.set(key, u);
      }
      const text = mdxToText(sec.raw);
      if (i === 0 && !text) return;
      docs.push({ k: 'section', t: i === 0 ? m.title : sec.title, s: modLabel(m), x: text, u, m: m.module });
    });
  }

  for (const g of input.glossary) {
    const names = [g.term, ...(g.aliases ?? [])];
    const u = names.map(n => firstUse.get(n.toLowerCase())).find(Boolean);
    docs.push({ k: 'term', t: g.term, s: 'Glossary', x: g.definition, u, a: g.aliases?.join(' ') });
  }

  const hdrMod = byNum.get(7);
  const sdpMod = byNum.get(15);
  for (const [name, h] of Object.entries(input.headers.headers)) {
    docs.push({ k: 'header', t: name, s: h.rfc ? `SIP header · RFC ${h.rfc}${h.section ? ` §${h.section}` : ''}` : 'SIP header', x: ws(`${h.summary} ${h.who ?? ''}`), u: hdrMod ? modUrl(hdrMod) : undefined, r: h.rfc ? rfcUrl(h.rfc, h.section) : undefined, m: 7 });
  }
  for (const [name, h] of Object.entries(input.headers.sdp)) {
    docs.push({ k: 'header', t: `${name}=`, s: 'SDP line', x: h.summary, u: sdpMod ? modUrl(sdpMod) : undefined, r: h.rfc ? rfcUrl(h.rfc, h.section) : undefined, m: 15 });
  }

  const codeMod = byNum.get(6);
  for (const c of input.codes) {
    docs.push({ k: 'code', t: `${c.code} ${c.phrase}`, s: `Response code · RFC ${c.rfc}${c.section ? ` §${c.section}` : ''}`, x: ws(`${c.meaning} ${c.causes.join('. ')}.`), u: codeMod ? modUrl(codeMod) : undefined, r: rfcUrl(c.rfc, c.section), m: 6 });
  }

  for (const r of input.rfcs) {
    const used = r.modules.filter(n => byNum.has(n));
    docs.push({ k: 'rfc', t: `RFC ${r.n} ${r.short}`, s: used.length ? `Modules ${used.join(', ')}` : 'RFC', x: ws(`${r.title ?? ''}. ${r.summary}`), u: rfcUrl(r.n), a: `rfc${r.n}` });
  }
  return docs;
}
