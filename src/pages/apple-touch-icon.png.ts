/** The Apple touch icon (180 px): the favicon on the page background, since iOS fills transparency with black. */
import fs from 'node:fs';
import path from 'node:path';
import { svgToPng } from '../lib/og.ts';

export function GET() {
  const svg = fs.readFileSync(path.join(process.cwd(), 'public', 'favicon.svg'), 'utf8');
  return new Response(new Uint8Array(svgToPng(svg, 180, '#0E1013')), { headers: { 'Content-Type': 'image/png' } });
}
