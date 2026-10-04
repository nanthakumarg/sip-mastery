/**
 * Method cards (Module 5): loads src/content/methods.yaml and turns each
 * card's ladder into a flow, so it is drawn by the same Ladder and checked
 * by the same diagram-language rules as every other flow.
 */
import type { FlowData, LaneKind } from '../sip/flow.ts';
import { readContent } from './data.ts';

type Lane = { label: string; kind: LaneKind; sub?: string };

export interface MethodCard {
  method: string;
  group: 'core' | 'ext';
  rfc: number;
  section: string;
  purpose: string;
  dialog: string;
  body: string;
  note: string;
  quote: string;
  ladder: [string, string, string, string][];
}

export function loadMethods(): { lanes: Record<string, Lane>; methods: MethodCard[] } {
  const data = readContent('methods.yaml') as { lanes: Record<string, Lane>; methods: MethodCard[] };
  return { lanes: data.lanes, methods: data.methods.map(m => ({ ...m, section: String(m.section) })) };
}

export function methodFlow(card: MethodCard, lanes: Record<string, Lane>): FlowData {
  const used = new Set(card.ladder.flatMap(([from, to]) => [from, to]));
  return {
    id: `method-${card.method.toLowerCase()}`,
    title: card.method,
    summary: card.purpose,
    lanes: Object.entries(lanes).filter(([id]) => used.has(id)).map(([id, l]) => ({ id, ...l })),
    steps: card.ladder.map(([from, to, label, caption]) => ({ from, to, label, caption, kind: 'msg' as const })),
  };
}
