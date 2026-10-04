/**
 * Loads the course data files (flows, quotes, glossary, header reference).
 * Runs in Node only: in Astro page frontmatter at build time, and in scripts/.
 * Islands receive the prepared data as props; they never import this file.
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { prepareFlow, type FlowData, type PreparedFlow } from '../sip/flow.ts';

const CONTENT = path.join(process.cwd(), 'src', 'content');
const read = (rel: string) => YAML.parse(fs.readFileSync(path.join(CONTENT, rel), 'utf8'));

export interface RfcQuote {
  id: string;
  rfc: number;
  section: string;
  title: string;
  text: string;
}

export interface GlossaryEntry {
  term: string;
  aliases?: string[];
  definition: string;
}

export interface RefEntry {
  summary: string;
  rfc?: number;
  section?: string;
  who?: string;
}

export interface HeaderRef {
  headers: Record<string, RefEntry>;
  startLines: { request: RefEntry; response: RefEntry };
  sdp: Record<string, RefEntry>;
}

export function listFlowIds(): string[] {
  return fs.readdirSync(path.join(CONTENT, 'flows'))
    .filter(f => f.endsWith('.yaml'))
    .map(f => f.replace(/\.yaml$/, ''))
    .sort();
}

export function loadFlowData(id: string): FlowData {
  const data = read(`flows/${id}.yaml`) as FlowData;
  if (data.id !== id) throw new Error(`flows/${id}.yaml has id "${data.id}"; the id must match the file name`);
  return data;
}

const flowCache = new Map<string, Promise<PreparedFlow>>();
export function loadFlow(id: string): Promise<PreparedFlow> {
  if (!flowCache.has(id)) flowCache.set(id, prepareFlow(loadFlowData(id)));
  return flowCache.get(id)!;
}

let quotes: RfcQuote[] | undefined;
export function loadQuotes(): RfcQuote[] {
  quotes ??= (read('rfc-quotes.yaml') as RfcQuote[]).map(q => ({ ...q, section: String(q.section) }));
  return quotes;
}

export function quoteById(id: string): RfcQuote {
  const q = loadQuotes().find(x => x.id === id);
  if (!q) throw new Error(`Unknown RFC quote id "${id}" (add it to src/content/rfc-quotes.yaml)`);
  return q;
}

export function loadGlossary(): GlossaryEntry[] {
  return read('glossary.yaml') as GlossaryEntry[];
}

/** Every glossary term and alias, for the diagram language check. */
export function glossaryTerms(): string[] {
  return loadGlossary().flatMap(g => [g.term, ...(g.aliases ?? [])]);
}

export function loadHeaderRef(): HeaderRef {
  return read('headers.yaml') as HeaderRef;
}

export const rfcUrl = (rfc: number, section?: string) =>
  `https://www.rfc-editor.org/rfc/rfc${rfc}${section ? `#section-${section}` : ''}`;
