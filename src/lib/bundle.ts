/**
 * Builds the props for diagram islands from the data files (build time only).
 */
import type { ClientFlow, ClientQuote, ClientRef, ClientRefEntry, FlowBundle } from '../diagrams/types.ts';
import { loadFlow, loadHeaderRef, loadQuotes, rfcUrl, type RefEntry } from './data.ts';

const toRef = (e: RefEntry): ClientRefEntry => ({
  summary: e.summary,
  who: e.who,
  ...(e.rfc ? { url: rfcUrl(e.rfc, e.section), label: `RFC ${e.rfc}${e.section ? ` §${e.section}` : ''}` } : {}),
});

export async function flowBundle(...ids: string[]): Promise<FlowBundle[]> {
  const ref = loadHeaderRef();
  const clientRef: ClientRef = {
    headers: Object.fromEntries(Object.entries(ref.headers).map(([k, v]) => [k, toRef(v)])),
    request: toRef(ref.startLines.request),
    response: toRef(ref.startLines.response),
    sdp: Object.fromEntries(Object.entries(ref.sdp).map(([k, v]) => [k, toRef(v)])),
  };
  const allQuotes = loadQuotes();
  return Promise.all(ids.map(async id => {
    const f = await loadFlow(id);
    const flow: ClientFlow = {
      id: f.id, title: f.title, summary: f.summary, broken: f.broken, lanes: f.lanes,
      phases: f.phases, map: f.map,
      steps: f.steps.map(s => ({
        index: s.index, kind: s.kind, from: s.from, to: s.to, proto: s.proto, label: s.label,
        caption: s.caption, warn: s.warn, lost: s.lost, rfc: s.rfc, wire: s.wire, status: s.status, detail: s.detail,
      })),
    };
    const quotes: Record<string, ClientQuote> = {};
    for (const s of f.steps) {
      const q = s.rfc ? allQuotes.find(x => x.id === s.rfc) : undefined;
      if (q) quotes[q.id] = { ...q, url: rfcUrl(q.rfc, q.section) };
    }
    return { flow, quotes, refData: clientRef };
  }));
}
