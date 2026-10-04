/**
 * Controlled diagram language checks (COURSE_STRUCTURE §5, TECH_DESIGN §6.2).
 * These keep every diagram "80% of the way to ASD-STE100": glossary terms
 * only, short labels, one idea per step, one meaning per colour.
 */
import { PROTOCOLS, type PreparedFlow } from './flow.ts';
import type { LintIssue } from './lint-flow.ts';

export const LIMITS = {
  labelWords: 5,
  captionSentences: 2,
  sentenceWords: 20,
  lanes: 7,
} as const;

const METHODS = new Set([
  'INVITE', 'ACK', 'BYE', 'CANCEL', 'REGISTER', 'OPTIONS', 'PRACK', 'UPDATE', 'INFO',
  'SUBSCRIBE', 'NOTIFY', 'REFER', 'MESSAGE', 'PUBLISH',
]);

const PASSIVE = /\b(is|are|was|were|be|been|being)\s+(\w+ed|sent|built|made|set|kept|lost|found|given|taken|done|known|shown|seen|written|put|read)\b/i;

export const words = (s: string) => s.replace(/`/g, '').trim().split(/\s+/).filter(Boolean);
export const sentences = (s: string) => s.trim().split(/(?<=[.!?])\s+/).filter(Boolean);

/**
 * @param glossary every glossary term and alias, in any case
 */
export function lintDiagram(flow: PreparedFlow, glossary: string[]): LintIssue[] {
  const issues: LintIssue[] = [];
  const add = (rule: string, step: number, message: string, severity: LintIssue['severity'] = 'error') =>
    issues.push({ rule, severity, step, message });
  const terms = glossary.map(t => t.toLowerCase()).sort((a, b) => b.length - a.length);

  if (flow.lanes.length > LIMITS.lanes) add('lane-count', -1, `${flow.lanes.length} lanes; the maximum is ${LIMITS.lanes}`);
  for (const lane of flow.lanes) {
    if (!terms.includes(lane.label.toLowerCase())) add('lane-glossary', -1, `Lane label "${lane.label}" is not a glossary term`);
  }

  const laneIds = new Set(flow.lanes.map(l => l.id));

  if (flow.map) {
    for (const id of laneIds) if (!flow.map.nodes[id]) add('map-nodes', -1, `The map has no position for lane "${id}"`);
  }
  if (flow.phases) {
    let prev = 0;
    for (const p of flow.phases) {
      if (p.from <= prev || p.from > flow.steps.length) add('phases', -1, `Phase "${p.label}" starts at step ${p.from}; phases must start in order, inside the flow`);
      if (words(p.label).length > 3) add('phases', -1, `Phase label "${p.label}" has more than 3 words`);
      prev = p.from;
    }
    if (flow.phases[0]?.from !== 1) add('phases', -1, 'The first phase must start at step 1');
  }
  for (const s of flow.steps) {
    if (!laneIds.has(s.from) || !laneIds.has(s.to)) add('lane-ref', s.index, `Step uses an unknown lane (${s.from} → ${s.to})`);

    const lw = words(s.label);
    if (lw.length > LIMITS.labelWords) add('label-words', s.index, `Label "${s.label}" has ${lw.length} words; the maximum is ${LIMITS.labelWords}`);
    const first = lw[0] ?? '';
    const lower = s.label.toLowerCase();
    const startsOk = METHODS.has(first) || /^\d{3}$/.test(first) || terms.some(t => lower === t || lower.startsWith(t + ' '));
    if (!startsOk) add('label-start', s.index, `Label "${s.label}" must start with a SIP method, a status code, or a glossary term`);

    for (const [lane, text] of Object.entries(s.status ?? {})) {
      if (!laneIds.has(lane)) add('status', s.index, `Status for unknown lane "${lane}"`);
      if (words(text).length > 2) add('status', s.index, `Status "${text}" has more than 2 words`);
    }

    if (!(PROTOCOLS as readonly string[]).includes(s.proto)) add('proto-color', s.index, `Unknown protocol colour "${s.proto}"`);

    for (const [field, text] of [['caption', s.caption], ['warn', s.warn]] as const) {
      if (!text) continue;
      const sents = sentences(text);
      if (sents.length > LIMITS.captionSentences) add('caption-words', s.index, `${field} has ${sents.length} sentences; the maximum is ${LIMITS.captionSentences}`);
      for (const sent of sents) {
        const n = words(sent).length;
        if (n > LIMITS.sentenceWords) add('caption-words', s.index, `${field} sentence has ${n} words; the maximum is ${LIMITS.sentenceWords}: "${sent}"`);
      }
      if (PASSIVE.test(text)) add('caption-passive', s.index, `${field} may use the passive voice: "${text}"`, 'warn');
    }
  }
  return issues;
}
