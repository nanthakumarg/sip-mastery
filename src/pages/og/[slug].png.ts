/**
 * Social preview images, one per page: og/home.png and og/<module-id>.png.
 * Made at build time (src/lib/og.ts).
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { ogImage } from '../../lib/og.ts';
import { OUTLINE, pad2 } from '../../lib/outline.ts';

interface Props { eyebrow: string; title: string; subtitle: string }

export const getStaticPaths: GetStaticPaths = async () => {
  const modules = await getCollection('modules');
  return [
    { params: { slug: 'home' }, props: { eyebrow: `${modules.length} modules · free and open`, title: 'Learn SIP by watching it work', subtitle: 'From the first REGISTER to one-way audio behind NAT: interactive call flows, message by message, with the RFC sentence that defines each one.' } },
    ...modules.map(m => ({
      params: { slug: m.id },
      props: { eyebrow: `Module ${pad2(m.data.module)} · ${OUTLINE.find(p => p.n === m.data.part)!.title}`, title: m.data.title, subtitle: m.data.description },
    })),
  ];
};

export const GET: APIRoute = async ({ props, site }) => {
  const { eyebrow, title, subtitle } = props as Props;
  const png = await ogImage({ eyebrow, title, subtitle, host: (site ?? new URL('https://sip.nanthakumar.com')).host });
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
