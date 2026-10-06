/**
 * Turns a prepared flow into the serializable flow that islands receive.
 * Used at build time (src/lib/bundle.ts) and in the browser (the call flow builder).
 */
import type { PreparedFlow } from '../sip/flow.ts';
import type { ClientFlow } from './types.ts';

export function toClientFlow(f: PreparedFlow): ClientFlow {
  return {
    id: f.id, title: f.title, summary: f.summary, broken: f.broken, lanes: f.lanes,
    phases: f.phases, map: f.map, registrar: f.registrar,
    steps: f.steps.map(s => ({
      index: s.index, kind: s.kind, from: s.from, to: s.to, proto: s.proto, label: s.label,
      caption: s.caption, warn: s.warn, lost: s.lost, oneway: s.oneway, rfc: s.rfc, wire: s.wire, status: s.status, detail: s.detail, at: s.at,
    })),
  };
}
