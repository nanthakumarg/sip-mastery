import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** The colour tokens of one theme block in tokens.css. */
function tokens(selector: string): Record<string, string> {
  const css = fs.readFileSync(path.join(process.cwd(), 'src', 'styles', 'tokens.css'), 'utf8');
  const start = css.indexOf(`${selector} {`);
  const block = css.slice(start, css.indexOf('\n}', start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map(m => [m[1]!, m[2]!]));
}

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

const TEXT = ['text', 'dim', 'muted', 'sip', 'sdp', 'rtp', 'rtcp', 'dns', 'net', 'err', 'down'];
const SURFACES = ['bg', 'panel', 'panel-2'];
const dark = tokens(':root');
const light = { ...dark, ...tokens(':root[data-theme="light"]') };

describe('theme colours', () => {
  for (const [name, t] of [['dark', dark], ['light', light]] as const) {
    it(`${name}: every text and protocol colour reads at 4.5:1 or more on every surface`, () => {
      for (const fg of TEXT) for (const bg of SURFACES) {
        expect(contrast(t[fg]!, t[bg]!), `${name} --${fg} on --${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it('the light theme overrides every colour of the dark one', () => {
    const own = tokens(':root[data-theme="light"]');
    for (const k of [...TEXT, ...SURFACES, 'bg-deep', 'line', 'line-2', 'line-3', 'faint', 'faint-2']) expect(own[k], `--${k}`).toBeDefined();
  });
});
