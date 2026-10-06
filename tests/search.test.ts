import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { loadCodes, loadGlossary, loadHeaderRef } from '../src/lib/data.ts';
import { buildIndex, mdxToText, splitSections, type IndexModule, type IndexRfc } from '../src/lib/search-index.ts';
import { normalise, search, snippet, tokenize } from '../src/lib/search.ts';

const DIR = path.join(process.cwd(), 'src', 'content', 'modules');
const modules: IndexModule[] = fs.readdirSync(DIR).filter(f => f.endsWith('.mdx')).map(f => {
  const src = fs.readFileSync(path.join(DIR, f), 'utf8');
  const [, fm, body] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(src)!;
  const d = YAML.parse(fm!);
  return { id: f.replace(/\.mdx$/, ''), module: d.module, title: d.title, summary: d.summary, objectives: d.objectives, body: body! };
});
const rfcs = (YAML.parse(fs.readFileSync(path.join(process.cwd(), 'src', 'content', 'rfcs.yaml'), 'utf8')) as { rfcs: IndexRfc[] }).rfcs;
const docs = buildIndex({ modules, glossary: loadGlossary(), headers: loadHeaderRef(), codes: loadCodes(), rfcs, link: p => `/${p}` });
const top = (q: string) => search(docs, q)[0]!.doc;

describe('MDX to text', () => {
  it('drops components and markdown, keeps the words a reader sees', () => {
    const t = mdxToText('A <Term t="nonce" /> and **bold** `code`.\n\n<RfcQuote id="x" />\n\n<Mistake title="Wrong port">\n  Text.\n</Mistake>\n\n| a | b |\n|---|---|\n| 1 | 2 |');
    expect(t).toContain('A nonce and bold code.');
    expect(t).toContain('Wrong port.');
    expect(t).not.toMatch(/[<>*`]|RfcQuote|---/);
    expect(t).toContain('a · b');
  });

  it('keeps the code in fences, so filters can be found', () => {
    expect(mdxToText('```bash\ntshark -Y "sip.Method == \\"INVITE\\""\n```')).toContain('tshark -Y');
  });

  it('splits a module at its ## headings, not at ## inside code', () => {
    for (const m of modules) {
      const h2 = m.body.split('\n```').filter((_, i) => i % 2 === 0).join('\n').match(/^## /gm)?.length ?? 0;
      expect(splitSections(m.body).length, m.id).toBe(h2 + 1);
    }
  });
});

describe('the index', () => {
  it('has every module, its sections, and the reference data', () => {
    expect(docs.filter(d => d.k === 'module')).toHaveLength(modules.length);
    expect(docs.filter(d => d.k === 'code').length).toBe(loadCodes().length);
    expect(docs.filter(d => d.k === 'term').length).toBe(loadGlossary().length);
    expect(docs.filter(d => d.k === 'section').length).toBeGreaterThan(modules.length * 4);
  });

  it('links a glossary term to the first section that uses it', () => {
    const sngrep = docs.find(d => d.k === 'term' && d.t === 'sngrep')!;
    expect(sngrep.u).toMatch(/^\/modules\/30-/);
  });
});

describe('ranking', () => {
  it('puts the exact record first for short lookups', () => {
    expect(top('486')).toMatchObject({ k: 'code', t: '486 Busy Here' });
    expect(top('Via')).toMatchObject({ k: 'header', t: 'Via' });
    expect(top('Record-Route')).toMatchObject({ k: 'header', t: 'Record-Route' });
    expect(top('rfc 3261').t).toMatch(/^RFC 3261 /);
    expect(top('rfc3261').t).toMatch(/^RFC 3261 /);
  });

  it('finds the troubleshooting tools in Module 30', () => {
    expect(top('sngrep').u).toMatch(/^\/modules\/30-/);
    expect(search(docs, 'tshark display filter').slice(0, 3).some(h => h.doc.m === 30)).toBe(true);
  });

  it('needs every word of the query', () => {
    const hits = search(docs, 'jitter buffer', 100);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      const all = normalise(`${h.doc.t} ${h.doc.a ?? ''} ${h.doc.x}`);
      expect(all).toMatch(/\bjitter/);
      expect(all).toMatch(/\bbuffer/);
    }
    expect(search(docs, 'jitter zzzqqq')).toEqual([]);
  });

  it('ignores case, accents, and punctuation around words', () => {
    expect(tokenize('  Via: (Échec) ')).toEqual(['via', 'echec']);
    expect(normalise('Échec')).toHaveLength(5);
  });
});

describe('snippets', () => {
  it('marks every match in a window around the first one', () => {
    const text = `${'word '.repeat(60)}the jitter buffer holds packets; a jitter of 20 ms ${'tail '.repeat(60)}`;
    const segs = snippet(text, 'jitter', 120);
    expect(segs[0]!.t).toBe('… ');
    expect(segs.filter(s => s.mark).map(s => s.t)).toEqual(['jitter', 'jitter']);
    expect(segs.map(s => s.t).join('').length).toBeLessThan(140);
  });

  it('starts at the beginning when only the title matched', () => {
    expect(snippet('Short text.', 'nothing')).toEqual([{ t: 'Short text.' }]);
  });
});
