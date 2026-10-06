/**
 * The site search index, served once as a static file. The SiteSearch island
 * loads it the first time a reader opens search.
 */
import { getCollection, render } from 'astro:content';
import { loadCodes, loadGlossary, loadHeaderRef, readContent } from '../lib/data.ts';
import { buildIndex, type IndexRfc } from '../lib/search-index.ts';
import { url } from '../lib/url.ts';

export async function GET() {
  const entries = await getCollection('modules');
  const modules = await Promise.all(entries.map(async e => ({
    id: e.id,
    module: e.data.module,
    title: e.data.title,
    summary: e.data.summary,
    objectives: e.data.objectives,
    body: e.body ?? '',
    headings: (await render(e)).headings,
  })));
  const titles = readContent('rfc-index.json') as Record<string, { title: string }>;
  const rfcs = ((readContent('rfcs.yaml') as { rfcs: IndexRfc[] }).rfcs).map(r => ({ ...r, title: titles[r.n]?.title }));
  const docs = buildIndex({ modules, glossary: loadGlossary(), headers: loadHeaderRef(), codes: loadCodes(), rfcs, link: url });
  return new Response(JSON.stringify(docs), { headers: { 'Content-Type': 'application/json' } });
}
