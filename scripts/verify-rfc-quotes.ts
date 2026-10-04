/**
 * Verifies every quote in src/content/rfc-quotes.yaml word for word against
 * the cited section of the RFC text from rfc-editor.org.
 * RFC text files are cached in .cache/rfc/ (CI caches this folder).
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadQuotes } from '../src/lib/data.ts';

const CACHE = path.join(process.cwd(), '.cache', 'rfc');

async function rfcText(n: number): Promise<string> {
  const file = path.join(CACHE, `rfc${n}.txt`);
  if (!fs.existsSync(file)) {
    const res = await fetch(`https://www.rfc-editor.org/rfc/rfc${n}.txt`);
    if (!res.ok) throw new Error(`Cannot download RFC ${n}: HTTP ${res.status}`);
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(file, await res.text());
  }
  return fs.readFileSync(file, 'utf8');
}

/** Removes form feeds, page headers ("RFC 3261  SIP ...  June 2002") and footers ("[Page 12]"). */
function stripPages(text: string): string[] {
  return text.split('\n').filter(l =>
    !l.includes('\f') && !/^RFC \d+ {2,}.* {2,}\w+ \d{4}\s*$/.test(l) && !/\[Page \d+\]\s*$/.test(l));
}

/** Returns the text of one section: from its heading (number removed) to the next heading at column 0. */
function sectionText(lines: string[], section: string): string | undefined {
  const esc = section.replace(/\./g, '\\.');
  const start = lines.findIndex(l => new RegExp(`^${esc}\\.?\\s+\\S`).test(l));
  if (start === -1) return undefined;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^(\d+(\.\d+)*\.?|Appendix [A-Z]\.?|[A-Z]\.(\d+\.?)*)\s+[A-Z]/.test(lines[i]!)) { end = i; break; }
  }
  // Keep the rest of the heading line: some RFCs (such as RFC 2119) start the text there.
  const heading = lines[start]!.replace(new RegExp(`^${esc}\\.?\\s+`), '');
  return [heading, ...lines.slice(start + 1, end)].join('\n');
}

/** Joins words split at a hyphen or slash across lines, then collapses whitespace. */
const normalise = (s: string) => s.replace(/([-/])\n\s+/g, '$1').replace(/\s+/g, ' ').trim();

let failed = 0;
for (const q of loadQuotes()) {
  try {
    const lines = stripPages(await rfcText(q.rfc));
    const body = sectionText(lines, q.section);
    if (body === undefined) throw new Error(`section ${q.section} not found`);
    if (!normalise(body).includes(normalise(q.text))) throw new Error(`text not found in section ${q.section}`);
    console.log(`✓ ${q.id}`);
  } catch (e) {
    failed++;
    console.log(`✗ ${q.id}: ${(e as Error).message}`);
  }
}
console.log(`\n${failed} quote(s) failed`);
if (failed) process.exit(1);
