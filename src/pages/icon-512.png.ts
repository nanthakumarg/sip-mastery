/** A 512 px PNG of the favicon, for platforms that ignore SVG icons. */
import fs from 'node:fs';
import path from 'node:path';
import { svgToPng } from '../lib/og.ts';

export function GET() {
  const svg = fs.readFileSync(path.join(process.cwd(), 'public', 'favicon.svg'), 'utf8');
  return new Response(new Uint8Array(svgToPng(svg, 512)), { headers: { 'Content-Type': 'image/png' } });
}
