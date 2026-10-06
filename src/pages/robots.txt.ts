/** robots.txt: everything may be crawled; the sitemap lists the pages. */
import type { APIRoute } from 'astro';
import { url } from '../lib/url.ts';

export const GET: APIRoute = ({ site }) =>
  new Response(`User-agent: *\nAllow: /\n\nSitemap: ${new URL(url('sitemap.xml'), site).href}\n`, { headers: { 'Content-Type': 'text/plain' } });
