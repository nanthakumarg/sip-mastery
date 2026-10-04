/**
 * Reads the official RFC index (rfc-index.xml from rfc-editor.org) and writes
 * the metadata for every RFC in src/content/rfcs.yaml to
 * src/content/rfc-index.json: title, date, status, and obsoletes/updates links.
 * The JSON is committed, so the build does not need the network.
 *
 *   npm run sync:rfc-index            uses the cached index if it exists
 *   npm run sync:rfc-index -- --fresh downloads the index again
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const CACHE = path.join(process.cwd(), '.cache', 'rfc-index.xml');
const OUT = path.join(process.cwd(), 'src', 'content', 'rfc-index.json');

if (!fs.existsSync(CACHE) || process.argv.includes('--fresh')) {
  const res = await fetch('https://www.rfc-editor.org/rfc-index.xml');
  if (!res.ok) throw new Error(`Cannot download rfc-index.xml: HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, await res.text());
}
const xml = fs.readFileSync(CACHE, 'utf8');

const wanted: number[] = YAML.parse(fs.readFileSync(path.join(process.cwd(), 'src', 'content', 'rfcs.yaml'), 'utf8')).rfcs.map((r: { n: number }) => r.n);

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tag = (block: string, name: string) => decode(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block)?.[1]?.trim() ?? '');
const ids = (block: string, name: string) => {
  const inner = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block)?.[1] ?? '';
  return [...inner.matchAll(/<doc-id>RFC(\d+)<\/doc-id>/g)].map(m => Number(m[1]));
};

const out: Record<number, unknown> = {};
for (const block of xml.split('<rfc-entry>').slice(1)) {
  const n = Number(/<doc-id>RFC(\d+)<\/doc-id>/.exec(block)?.[1]);
  if (!wanted.includes(n)) continue;
  out[n] = {
    title: tag(block, 'title'),
    month: tag(block, 'month'),
    year: Number(tag(block, 'year')),
    status: tag(block, 'current-status'),
    obsoletes: ids(block, 'obsoletes'),
    obsoletedBy: ids(block, 'obsoleted-by'),
    updates: ids(block, 'updates'),
    updatedBy: ids(block, 'updated-by'),
  };
}

const missing = wanted.filter(n => !out[n]);
if (missing.length) throw new Error(`Not in the RFC index: ${missing.join(', ')}`);
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`Wrote ${Object.keys(out).length} RFCs to ${path.relative(process.cwd(), OUT)}`);
