import { describe, expect, it } from 'vitest';
import { loadFlow } from '../src/lib/data.ts';
import { trackDialogs } from '../src/sip/dialog.ts';
import { lintFlow } from '../src/sip/lint-flow.ts';

async function track(id: string, ua: string) {
  const f = await loadFlow(id);
  return trackDialogs(f.steps.map(s => ({ from: s.from, to: s.to, msg: s.parsed })), ua);
}

describe('dialog state (RFC 3261 §12)', () => {
  it('builds both sides of one dialog: swapped tags, reversed route set, separate CSeq spaces', async () => {
    const alice = await track('dialog-call', 'alice');
    const bob = await track('dialog-call', 'bob');
    // Step 5 (180 to Alice): early dialog on Alice's side; Bob's became early at step 4.
    expect(alice[4]!.dialogs[0]).toMatchObject({ state: 'early', role: 'UAC', localTag: '9fxced76sl', remoteTag: '314159', localSeq: 1 });
    expect(bob[3]!.dialogs[0]).toMatchObject({ state: 'early', role: 'UAS', localTag: '314159', remoteTag: '9fxced76sl', remoteSeq: 1 });
    expect(alice[4]!.dialogs[0]!.routeSet).toEqual(['sip:proxy.biloxi.example;lr']);
    // The re-INVITE (step 11) refreshes Alice's remote target and sets her remote CSeq.
    expect(alice[10]!.dialogs[0]).toMatchObject({ remoteTarget: 'sip:bob@203.0.113.21:5060', remoteSeq: 4711, localSeq: 1 });
    expect(alice[10]!.changed[Object.keys(alice[10]!.changed)[0]!]).toEqual(['remoteSeq', 'remoteTarget']);
    // The BYE (step 16) uses CSeq 2; the 200 OK ends both dialogs.
    expect(alice[15]!.dialogs[0]!.localSeq).toBe(2);
    expect(alice.at(-1)!.dialogs[0]!.state).toBe('terminated');
    expect(bob.at(-1)!.dialogs[0]).toMatchObject({ state: 'terminated', localSeq: 4711, remoteSeq: 2 });
  });

  it('gives a forking caller one early dialog per To tag', async () => {
    const alice = await track('fork-one-answers', 'alice');
    const after180s = alice.find(s => s.dialogs.length === 3)!;
    expect(after180s.dialogs.map(d => d.remoteTag)).toEqual(['d7c1', 'm2a8', 's9e3']);
    const end = alice.at(-1)!.dialogs;
    expect(end.map(d => d.state)).toEqual(['confirmed', 'early', 'early']);
    expect(end[1]!.note).toMatch(/64×T1/);
  });

  it('confirms two dialogs when two devices answer, and ends the extra one', async () => {
    const end = (await track('fork-two-answer', 'alice')).at(-1)!.dialogs;
    expect(end.map(d => [d.remoteTag, d.state])).toEqual([['d7c1', 'confirmed'], ['m2a8', 'terminated']]);
    const both = (await track('fork-two-answer', 'alice')).find(s => s.dialogs.every(d => d.state === 'confirmed') && s.dialogs.length === 2)!;
    expect(both.dialogs.map(d => d.note)).toEqual([undefined, undefined]);
  });
});

describe('dialog-target rule', () => {
  it('flags a BYE sent to the first Request-URI', async () => {
    const issues = lintFlow(await loadFlow('bye-wrong-target')).filter(i => i.severity === 'error');
    expect(issues.map(i => [i.rule, i.step + 1])).toEqual([['dialog-target', 9]]);
  });
  it('passes the fixed flow', async () => {
    expect(lintFlow(await loadFlow('bye-right-target')).filter(i => i.severity === 'error')).toEqual([]);
  });
});
