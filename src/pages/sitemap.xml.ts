/** sitemap.xml: the home page and every module, as absolute URLs. */
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { url } from '../lib/url.ts';

export const GET: APIRoute = async ({ site }) => {
  const abs = (p: string) => new URL(url(p), site).href;
  const modules = (await getCollection('modules')).sort((a, b) => a.data.module - b.data.module);
  const urls = [abs(''), ...modules.map(m => abs(`modules/${m.id}/`))];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
};
