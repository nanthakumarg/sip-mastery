/**
 * Builds the props for diagram islands from the data files (build time only).
 */
import type { ClientQuote, ClientRef, ClientRefEntry, FlowBundle } from '../diagrams/types.ts';
import { toClientFlow } from '../diagrams/client-flow.ts';
import { loadFlow, loadHeaderRef, loadQuotes, rfcUrl, type RefEntry } from './data.ts';

const toRef = (e: RefEntry): ClientRefEntry => ({
  summary: e.summary,
  who: e.who,
  ...(e.rfc ? { url: rfcUrl(e.rfc, e.section), label: `RFC ${e.rfc}${e.section ? ` §${e.section}` : ''}` } : {}),
});

/** Header explanations for the inspector. */
export function clientRefData(): ClientRef {
  const ref = loadHeaderRef();
  return {
    headers: Object.fromEntries(Object.entries(ref.headers).map(([k, v]) => [k, toRef(v)])),
    request: toRef(ref.startLines.request),
    response: toRef(ref.startLines.response),
    sdp: Object.fromEntries(Object.entries(ref.sdp).map(([k, v]) => [k, toRef(v)])),
  };
}

export async function flowBundle(...ids: string[]): Promise<FlowBundle[]> {
  const clientRef = clientRefData();
  const allQuotes = loadQuotes();
  return Promise.all(ids.map(async id => {
    const f = await loadFlow(id);
    const flow = toClientFlow(f);
    const quotes: Record<string, ClientQuote> = {};
    for (const s of f.steps) {
      const q = s.rfc ? allQuotes.find(x => x.id === s.rfc) : undefined;
      if (q) quotes[q.id] = { ...q, url: rfcUrl(q.rfc, q.section) };
    }
    return { flow, quotes, refData: clientRef };
  }));
}

/** Quotes by id, with links, for islands that show RFC text outside a flow. */
export function quoteMap(ids: string[]): Record<string, ClientQuote> {
  const all = loadQuotes();
  return Object.fromEntries(ids.map(id => {
    const q = all.find(x => x.id === id);
    if (!q) throw new Error(`Unknown RFC quote id "${id}" (add it to src/content/rfc-quotes.yaml)`);
    return [id, { ...q, url: rfcUrl(q.rfc, q.section) }];
  }));
}
