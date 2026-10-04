/**
 * Runs the protocol checks and the diagram language checks over every flow,
 * and checks that every quote id used by a flow exists.
 * Exit code 1 on any error. Warnings are printed but do not fail the build.
 */
import { glossaryTerms, listFlowIds, loadElements, loadFlow, loadQuotes } from '../src/lib/data.ts';
import { lintDiagram } from '../src/sip/lint-diagram.ts';
import { lintFlow, type LintIssue } from '../src/sip/lint-flow.ts';

const terms = glossaryTerms();
const quoteIds = new Set(loadQuotes().map(q => q.id));
let errors = 0;
let warnings = 0;

const fmt = (i: LintIssue) => `${i.step >= 0 ? `step ${i.step + 1}` : 'flow'}: [${i.rule}] ${i.message}`;

for (const id of listFlowIds()) {
  const flow = await loadFlow(id);
  const protocol = lintFlow(flow);
  const diagram = lintDiagram(flow, terms);
  const out: string[] = [];

  for (const s of flow.steps) {
    if (s.rfc && !quoteIds.has(s.rfc)) { out.push(`  ✗ step ${s.index + 1}: [rfc-ref] unknown quote id "${s.rfc}"`); errors++; }
  }

  const protoErrors = protocol.filter(i => i.severity === 'error');
  if (flow.broken) {
    const expected = new Set(flow.breaks ?? []);
    const actual = new Set(protoErrors.map(i => i.rule));
    for (const r of expected) if (!actual.has(r)) { out.push(`  ✗ broken flow should break [${r}] but does not`); errors++; }
    for (const i of protoErrors) if (!expected.has(i.rule)) { out.push(`  ✗ ${fmt(i)} (not listed in "breaks")`); errors++; }
    if (!flow.breaks?.length) { out.push('  ✗ broken flow has no "breaks" list'); errors++; }
  } else {
    for (const i of protoErrors) { out.push(`  ✗ ${fmt(i)}`); errors++; }
  }
  for (const i of [...protocol, ...diagram]) {
    if (i.severity === 'warn') { out.push(`  ⚠ ${fmt(i)}`); warnings++; }
  }
  for (const i of diagram.filter(d => d.severity === 'error')) { out.push(`  ✗ ${fmt(i)}`); errors++; }

  console.log(`${out.some(l => l.includes('✗')) ? '✗' : '✓'} ${id}${flow.broken ? ` (broken on purpose: ${flow.breaks?.join(', ')})` : ''}`);
  for (const l of out) console.log(l);
}

// Element gallery: every card points at a real flow, real steps, and a real quote.
const flowIds = new Set(listFlowIds());
for (const c of loadElements()) {
  const bad: string[] = [];
  if (!flowIds.has(c.flow)) bad.push(`unknown flow "${c.flow}"`);
  else {
    const f = await loadFlow(c.flow);
    for (const n of [c.in, c.out]) if (!f.steps[n - 1]?.wire) bad.push(`step ${n} of ${c.flow} has no SIP message`);
  }
  if (!quoteIds.has(c.quote)) bad.push(`unknown quote id "${c.quote}"`);
  console.log(`${bad.length ? '✗' : '✓'} element ${c.id}`);
  for (const b of bad) { console.log(`  ✗ ${b}`); errors++; }
}

console.log(`\n${errors} error(s), ${warnings} warning(s)`);
if (errors) process.exit(1);
