/**
 * Social preview images (Open Graph, 1200 × 630), made at build time with
 * satori (layout → SVG) and resvg (SVG → PNG). Dark console palette: it
 * stands out in light social feeds. Runs in Node only.
 */
import fs from 'node:fs';
import path from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const C = { bg: '#0E1013', panel: '#15181d', line: '#2a3039', text: '#ECE7DC', dim: '#BEB8AC', muted: '#8a929d', sip: '#FFB000', rtp: '#3FD0C9', sdp: '#E3D6B8' };

const font = (pkg: string, file: string) => fs.readFileSync(path.join(process.cwd(), 'node_modules', pkg, 'files', file));
let fonts: { name: string; data: Buffer; weight: 400 | 500 | 800; style: 'normal' }[] | undefined;
const loadFonts = () => (fonts ??= [
  { name: 'Bricolage', data: font('@fontsource/bricolage-grotesque', 'bricolage-grotesque-latin-800-normal.woff'), weight: 800, style: 'normal' },
  { name: 'Bricolage', data: font('@fontsource/bricolage-grotesque', 'bricolage-grotesque-latin-400-normal.woff'), weight: 400, style: 'normal' },
  { name: 'Martian', data: font('@fontsource/martian-mono', 'martian-mono-latin-400-normal.woff'), weight: 400, style: 'normal' },
  { name: 'Martian', data: font('@fontsource/martian-mono', 'martian-mono-latin-500-normal.woff'), weight: 500, style: 'normal' },
]);

const svgUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

/** The brand mark (BrandMark.astro) with fixed colours. */
const BRAND = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect x="1" y="1" width="26" height="26" rx="6" fill="#1b1f26" stroke="${C.line}"/><line x1="8" y1="6" x2="8" y2="22" stroke="${C.muted}" stroke-width="1.2" stroke-dasharray="2 2"/><line x1="20" y1="6" x2="20" y2="22" stroke="${C.muted}" stroke-width="1.2" stroke-dasharray="2 2"/><path d="M9 9.5H18.5" stroke="${C.sip}" stroke-width="2"/><path d="M16.5 7.8l2.3 1.7-2.3 1.7" fill="none" stroke="${C.sip}" stroke-width="1.6"/><path d="M19 14.5H9.5" stroke="${C.sip}" stroke-width="2"/><path d="M11.5 12.8l-2.3 1.7 2.3 1.7" fill="none" stroke="${C.sip}" stroke-width="1.6"/><path d="M9 19.5H19" stroke="${C.rtp}" stroke-width="2" stroke-dasharray="2.5 1.8"/></svg>`);

/** A small call ladder: two lanes, SIP arrows in amber, RTP dashed in cyan. */
function ladder(): string {
  const W = 300, H = 420, L = 40, R = 260;
  const arrow = (y: number, toRight: boolean, colour: string, dash = '') => {
    const [x1, x2] = toRight ? [L + 6, R - 6] : [R - 6, L + 6];
    const head = toRight ? `M${x2 - 12} ${y - 7}L${x2} ${y}L${x2 - 12} ${y + 7}` : `M${x2 + 12} ${y - 7}L${x2} ${y}L${x2 + 12} ${y + 7}`;
    return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${colour}" stroke-width="4" ${dash ? `stroke-dasharray="${dash}"` : ''}/><path d="${head}" fill="none" stroke="${colour}" stroke-width="3.5"/>`;
  };
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <line x1="${L}" y1="20" x2="${L}" y2="${H - 10}" stroke="${C.muted}" stroke-width="2" stroke-dasharray="5 6"/>
    <line x1="${R}" y1="20" x2="${R}" y2="${H - 10}" stroke="${C.muted}" stroke-width="2" stroke-dasharray="5 6"/>
    <rect x="${L - 34}" y="0" width="68" height="30" rx="6" fill="${C.panel}" stroke="${C.line}"/>
    <rect x="${R - 34}" y="0" width="68" height="30" rx="6" fill="${C.panel}" stroke="${C.line}"/>
    ${arrow(78, true, C.sip)}${arrow(140, false, C.sip)}${arrow(202, false, C.sip)}${arrow(264, true, C.sip)}
    ${arrow(330, true, C.rtp, '12 9')}${arrow(372, false, C.rtp, '12 9')}
  </svg>`);
}
const LADDER = ladder();

type El = { type: string; props: Record<string, unknown> };
const el = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): El => ({ type, props: { style, children, ...extra } });

export interface OgInput {
  /** Small line above the title, e.g. "Module 16 · Part 5 · Media" */
  eyebrow: string;
  title: string;
  subtitle: string;
  /** Host shown at the bottom, e.g. "sip.nanthakumar.com" */
  host: string;
}

const titleSize = (t: string) => (t.length <= 18 ? 92 : t.length <= 30 ? 76 : t.length <= 44 ? 62 : 54);

export async function ogImage(o: OgInput): Promise<Buffer> {
  const tree = el('div', { width: OG_WIDTH, height: OG_HEIGHT, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '64px 72px', background: C.bg, color: C.text, fontFamily: 'Bricolage' }, [
    el('div', { display: 'flex', alignItems: 'center', gap: 18 }, [
      el('img', { width: 56, height: 56 }, undefined, { src: BRAND, width: 56, height: 56 }),
      el('div', { display: 'flex', fontSize: 38, fontWeight: 800, letterSpacing: -1 }, [el('span', { color: C.text }, 'SIP '), el('span', { color: C.sip }, 'Mastery')]),
    ]),
    el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 48 }, [
      el('div', { display: 'flex', flexDirection: 'column', width: 760 }, [
        el('div', { fontFamily: 'Martian', fontWeight: 500, fontSize: 22, letterSpacing: 2, color: C.sip, textTransform: 'uppercase', marginBottom: 22 }, o.eyebrow),
        el('div', { fontSize: titleSize(o.title), fontWeight: 800, lineHeight: 1.02, letterSpacing: -2, color: C.text }, o.title),
        el('div', { fontSize: 27, fontWeight: 400, lineHeight: 1.4, color: C.dim, marginTop: 26, lineClamp: 3 }, o.subtitle),
      ]),
      el('img', { width: 240, height: 336 }, undefined, { src: LADDER, width: 240, height: 336 }),
    ]),
    el('div', { display: 'flex', justifyContent: 'space-between', fontFamily: 'Martian', fontSize: 20, color: C.muted, borderTop: `1px solid ${C.line}`, paddingTop: 22 }, [
      el('span', {}, 'A free, interactive SIP course'),
      el('span', { color: C.dim }, o.host),
    ]),
  ]);
  const svg = await satori(tree as never, { width: OG_WIDTH, height: OG_HEIGHT, fonts: loadFonts() });
  return new Resvg(svg, { fitTo: { mode: 'width', value: OG_WIDTH } }).render().asPng();
}

/** A square PNG of an SVG file (for the Apple touch icon and the 512 px icon). */
export function svgToPng(svg: string, size: number, background?: string): Buffer {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size }, background }).render().asPng();
}
