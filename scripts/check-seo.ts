/**
 * Checks the built site (dist/) for search engine and link-preview metadata.
 * Run after `npm run build`: npm run check:seo
 *
 * Every indexable page needs a title (≤ 70 characters), a description
 * (70–160), a canonical URL, Open Graph and Twitter tags, a 1200 × 630 PNG
 * preview that exists, and JSON-LD that parses. The sitemap must list every
 * indexable page, and robots.txt must point to the sitemap.
 */
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.join(process.cwd(), 'dist');
if (!fs.existsSync(DIST)) {
  console.error('dist/ not found: run npm run build first');
  process.exit(1);
}

const errors: string[] = [];
const fail = (where: string, msg: string) => errors.push(`${where}: ${msg}`);

const pages = (function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? (d.name === '_astro' ? [] : walk(p)) : d.name.endsWith('.html') ? [p] : [];
  });
})(DIST);

const attr = (html: string, re: RegExp) => re.exec(html)?.[1]?.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const meta = (html: string, key: string) => attr(html, new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"`));

/** The width and height of a PNG, from its IHDR chunk. */
function pngSize(file: string): [number, number] | undefined {
  const b = fs.readFileSync(file);
  return b.toString('ascii', 1, 4) === 'PNG' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : undefined;
}

const canonicals: string[] = [];
let site = '';
for (const file of pages) {
  const where = path.relative(DIST, file);
  const html = fs.readFileSync(file, 'utf8');
  const noindex = /<meta name="robots" content="noindex"/.test(html);
  const title = attr(html, /<title>([^<]*)<\/title>/);
  const desc = meta(html, 'description');
  if (!title) fail(where, 'no <title>');
  else if (title.length > 70) fail(where, `title is ${title.length} characters (max 70): ${title}`);
  if (!desc) fail(where, 'no meta description');
  else if (desc.length < 70 || desc.length > 160) fail(where, `description is ${desc.length} characters (70–160)`);
  if (noindex) continue;

  const canonical = attr(html, /<link rel="canonical" href="([^"]*)"/);
  if (!canonical) fail(where, 'no canonical URL');
  else {
    canonicals.push(canonical);
    if (where === 'index.html') site = canonical;
  }
  for (const k of ['og:title', 'og:description', 'og:url', 'og:image', 'og:image:alt', 'og:site_name', 'twitter:card', 'twitter:image']) {
    if (!meta(html, k)) fail(where, `no ${k}`);
  }
  if (meta(html, 'og:url') !== canonical) fail(where, 'og:url differs from the canonical URL');
  const image = meta(html, 'og:image');
  if (image) {
    const local = path.join(DIST, new URL(image).pathname);
    const size = fs.existsSync(local) ? pngSize(local) : undefined;
    if (!size) fail(where, `preview image missing or not a PNG: ${image}`);
    else if (size[0] !== 1200 || size[1] !== 630) fail(where, `preview image is ${size.join(' × ')}, not 1200 × 630`);
  }
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (!ld.length) fail(where, 'no JSON-LD');
  for (const m of ld) {
    try { JSON.parse(m[1]!); } catch (e) { fail(where, `JSON-LD does not parse: ${(e as Error).message}`); }
  }
}

const sitemap = fs.existsSync(path.join(DIST, 'sitemap.xml')) ? fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf8') : '';
const listed = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]!));
if (!sitemap) fail('sitemap.xml', 'missing');
for (const c of canonicals) if (!listed.has(c)) fail('sitemap.xml', `does not list ${c}`);
for (const u of listed) if (!canonicals.includes(u)) fail('sitemap.xml', `lists ${u}, which is not an indexable page`);

const robots = fs.existsSync(path.join(DIST, 'robots.txt')) ? fs.readFileSync(path.join(DIST, 'robots.txt'), 'utf8') : '';
if (!robots.includes(`Sitemap: ${new URL('sitemap.xml', site || 'https://invalid/').href}`)) fail('robots.txt', 'missing, or does not point to the sitemap');
for (const icon of ['apple-touch-icon.png', 'icon-512.png']) if (!fs.existsSync(path.join(DIST, icon))) fail(icon, 'missing');

if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`\n${errors.length} SEO problem(s)`);
  process.exit(1);
}
console.log(`SEO check: ${pages.length} pages, ${canonicals.length} indexable, all in the sitemap; previews, JSON-LD, robots.txt, and icons OK`);
