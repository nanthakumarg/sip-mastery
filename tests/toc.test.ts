import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { tocEntries } from '../src/lib/toc.ts';

describe('table of contents', () => {
  it('splits the section number off the title, and keeps only h2 and h3', () => {
    expect(tocEntries([
      { depth: 1, slug: 'title', text: 'Routing' },
      { depth: 2, slug: '104-record-route-staying-in-the-path', text: '10.4 Record-Route: staying in the path' },
      { depth: 3, slug: 'the-request-line', text: 'The request line' },
      { depth: 4, slug: 'deep', text: 'Too deep' },
      { depth: 2, slug: 'common-mistakes', text: 'Common mistakes' },
    ])).toEqual([
      { slug: '104-record-route-staying-in-the-path', depth: 2, num: '10.4', title: 'Record-Route: staying in the path' },
      { slug: 'the-request-line', depth: 3, num: undefined, title: 'The request line' },
      { slug: 'common-mistakes', depth: 2, num: undefined, title: 'Common mistakes' },
    ]);
  });

  it('does not take a number that is part of the title', () => {
    expect(tocEntries([{ depth: 2, slug: 'x', text: '3PCC and 100rel' }])[0]).toMatchObject({ num: undefined, title: '3PCC and 100rel' });
  });

  it('every module has at least three sections to list', () => {
    const dir = path.join(process.cwd(), 'src', 'content', 'modules');
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.mdx'))) {
      const h2 = fs.readFileSync(path.join(dir, f), 'utf8').match(/^## /gm) ?? [];
      expect(h2.length, f).toBeGreaterThanOrEqual(3);
    }
  });
});
