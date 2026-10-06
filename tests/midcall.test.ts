import { describe, expect, it } from 'vitest';
import { prepareFlow, type FlowData } from '../src/sip/flow.ts';
import { lintFlow } from '../src/sip/lint-flow.ts';
import { lintDiagram } from '../src/sip/lint-diagram.ts';
import { glossaryTerms, loadQuotes } from '../src/lib/data.ts';
import { allReinvites, applyReinvite, buildReinvite, DEFAULT_REINVITE, REINVITE_QUOTES, reinviteKey } from '../src/sip/reinvite.ts';
import { allTransfers, applyTransfer, buildTransfer, DEFAULT_TRANSFER, TRANSFER_QUOTES, transferKey } from '../src/sip/transfer.ts';
import { GENERATORS } from '../src/sip/generators.ts';

const terms = glossaryTerms();
const quoteIds = new Set(loadQuotes().map(q => q.id));

/** Every distinct problem, once, with the first combination that has it. */
async function problems<O>(all: O[], build: (o: O) => FlowData, key: (o: O) => string, quotes: readonly string[]): Promise<string[]> {
  const seen = new Map<string, string>();
  for (const o of all) {
    const flow = await prepareFlow(build(o));
    const issues = [...lintFlow(flow), ...lintDiagram(flow, terms)].filter(i => i.severity === 'error' || i.rule === 'caption-passive');
    for (const i of issues) {
      const k = `[${i.rule}] ${i.message}`.replace(/\d+/g, 'N');
      if (!seen.has(k)) seen.set(k, `${key(o)} step ${i.step + 1}: [${i.rule}] ${i.message}`);
    }
    for (const s of flow.steps) if (s.rfc && !quotes.includes(s.rfc)) seen.set(s.rfc, `${key(o)}: quote ${s.rfc} is not in the quote list`);
  }
  for (const id of quotes) if (!quoteIds.has(id)) seen.set(id, `unknown quote id ${id}`);
  return [...seen.values()];
}

describe('the re-INVITE generator', () => {
  it('every combination passes the protocol and diagram checks', async () => {
    expect(await problems(allReinvites(), buildReinvite, reinviteKey, REINVITE_QUOTES)).toEqual([]);
  });
});


describe('the transfer generator', () => {
  it('every combination passes the protocol and diagram checks', async () => {
    expect(await problems(allTransfers(), buildTransfer, transferKey, TRANSFER_QUOTES)).toEqual([]);
  });
});


const labels = (f: FlowData) => f.steps.map(s => `${s.from}>${s.to} ${s.label}`);

describe('the flows they build', () => {
  it('hold: a=sendonly with the next o= version, answered a=recvonly', async () => {
    const f = await prepareFlow(buildReinvite(DEFAULT_REINVITE));
    const hold = f.steps.find(s => s.label === 'INVITE (hold)')!;
    expect(hold.parsed!.body).toMatch(/o=alice 2890844526 2890844527 .*\r\n[\s\S]*a=sendonly/);
    expect(f.steps.find(s => s.label === '200 OK (recvonly)')!.parsed!.body).toMatch(/a=recvonly/);
  });

  it('a rejected codec gets 488 and an ACK; a rejected video stream gets port 0', () => {
    expect(labels(buildReinvite({ ...DEFAULT_REINVITE, change: 'codec', result: 'reject' })).slice(4, 7))
      .toEqual(['alice>bob INVITE (G.722)', 'bob>alice 488 Not Acceptable Here', 'alice>bob ACK']);
    expect(buildReinvite({ ...DEFAULT_REINVITE, change: 'video', result: 'reject' }).steps[5]!.message).toMatch(/m=video 0 /);
  });

  it('glare: two 491s, then Bob (not the Call-ID owner) retries first', () => {
    const l = labels(buildReinvite({ ...DEFAULT_REINVITE, result: 'glare' }));
    expect(l.filter(x => x.includes('491'))).toEqual(['bob>alice 491 Request Pending', 'alice>bob 491 Request Pending']);
    expect(l.indexOf('bob>alice INVITE (no change)', 6)).toBeLessThan(l.lastIndexOf('alice>bob INVITE (hold)'));
  });

  it('an UPDATE refresh has no SDP and no ACK', () => {
    const f = buildReinvite({ ...DEFAULT_REINVITE, change: 'refresh', method: 'update' });
    const up = f.steps.find(s => s.label === 'UPDATE (refresh)')!;
    expect(up.message).toMatch(/Session-Expires: 1800;refresher=uac/);
    expect(up.message).not.toMatch(/application\/sdp/);
    expect(labels(f).filter(x => x.endsWith('ACK'))).toHaveLength(1);
  });

  it('blind transfer: REFER, 202, NOTIFY 100, INVITE to Carol, NOTIFY 200, BYE', () => {
    const l = labels(buildTransfer(DEFAULT_TRANSFER)).filter(x => / (REFER|202 Accepted|NOTIFY \(\d{3}\))$/.test(x) || x === 'bob>carol INVITE' || x === 'alice>bob BYE');
    expect(l).toEqual(['alice>bob REFER', 'bob>alice 202 Accepted', 'bob>alice NOTIFY (100)', 'bob>carol INVITE', 'bob>alice NOTIFY (200)', 'alice>bob BYE']);
  });

  it('a failed blind transfer: the last NOTIFY carries the 486, and Alice takes Bob back', () => {
    const f = buildTransfer({ ...DEFAULT_TRANSFER, target: 'busy' });
    expect(f.steps.find(s => s.label === 'NOTIFY (486)')!.message).toMatch(/Subscription-State: terminated;reason=noresource[\s\S]*\n\nSIP\/2.0 486 Busy Here/);
    expect(labels(f)).toContain('alice>bob INVITE (resume)');
  });

  it('hanging up after the 202: the NOTIFY gets 481, and Alice never learns the result', () => {
    const l = labels(buildTransfer({ ...DEFAULT_TRANSFER, target: 'busy', hangup: 'after-202' }));
    expect(l).toContain('alice>bob 481 Call/Transaction Does Not Exist');
    expect(l.filter(x => x.includes('NOTIFY'))).toEqual(['bob>alice NOTIFY (100)']);
  });

  it('attended transfer: Replaces names Carol\'s dialog from her side, and Carol ends it with BYE', async () => {
    const f = await prepareFlow(buildTransfer({ ...DEFAULT_TRANSFER, type: 'attended' }));
    expect(f.steps.find(s => s.label === 'INVITE (Replaces)')!.wire).toMatch(/Replaces: c7d2e19a5b@192.0.2.10;to-tag=5f35a3;from-tag=b81ac3e2/);
    expect(labels(f)).toContain('carol>alice BYE');
    expect(lintFlow(f)).toEqual([]);
  });

  it('attended needs hold; turning hold off switches to blind', () => {
    expect(applyTransfer({ ...DEFAULT_TRANSFER, type: 'attended' }, { hold: false }).options.type).toBe('blind');
    expect(applyReinvite(DEFAULT_REINVITE, { result: 'reject' }).options.change).toBe('codec');
  });

  it('call forwarding: busy, then a new branch to the voicemail server', () => {
    const l = labels(GENERATORS.call.build({ ...GENERATORS.call.defaults, path: 'proxy', forward: 'busy' }));
    expect(l.slice(3, 6)).toEqual(['bob>proxyB 486 Busy Here', 'proxyB>bob ACK', 'proxyB>vm INVITE']);
    expect(l).not.toContain('proxyB>alice 486 Busy Here');
  });
});

describe('the replaces-match and prack-rack rules', async () => {
  const { loadFlow } = await import('../src/lib/data.ts');
  const rules = async (id: string) => lintFlow(await loadFlow(id)).map(i => i.rule);
  it('flags swapped tags in Replaces, and passes call pickup', async () => {
    expect(await rules('transfer-replaces-swapped')).toEqual(['replaces-match']);
    expect(await rules('call-pickup')).toEqual([]);
  });
  it('flags a PRACK whose RAck names the wrong response', async () => {
    expect(new Set(await rules('prack-wrong-rack'))).toEqual(new Set(['prack-rack']));
    expect(await rules('prack-reliable-180')).toEqual([]);
  });
});

import { allEvents, buildEvents, EVENTS_QUOTES, eventsKey } from '../src/sip/events.ts';

describe('the event subscription generator', () => {
  it('every combination passes the protocol and diagram checks', async () => {
    expect(await problems(allEvents(), buildEvents, eventsKey, EVENTS_QUOTES)).toEqual([]);
  });
});

describe('event subscriptions (RFC 6665)', () => {
  const ev = (change: Record<string, unknown>) => buildEvents({ package: 'presence', answer: 'active', end: 'unsubscribe', refresh: false, early: false, ...change });

  it('SUBSCRIBE, 200 with Expires, an immediate NOTIFY, a change, and Expires: 0 with a final terminated NOTIFY', () => {
    const f = ev({ package: 'message-summary' });
    expect(labels(f)).toEqual([
      'alice>vm SUBSCRIBE', 'vm>alice 200 OK', 'vm>alice NOTIFY (active)', 'alice>vm 200 OK (NOTIFY)', 'vm>alice NOTIFY (active)', 'alice>vm 200 OK (NOTIFY)',
      'alice>vm SUBSCRIBE (Expires: 0)', 'vm>alice 200 OK', 'vm>alice NOTIFY (terminated)', 'alice>vm 200 OK (NOTIFY)',
    ]);
    expect(f.steps[4]!.message).toMatch(/Messages-Waiting: yes/);
  });

  it('presence: Bob publishes, then changes with SIP-If-Match', () => {
    const msgs = ev({}).steps.filter(s => s.label === 'PUBLISH').map(s => s.message!);
    expect(msgs[0]).not.toMatch(/SIP-If-Match/);
    expect(msgs[1]).toMatch(/SIP-If-Match: dx200xyz/);
  });

  it('pending, then active; a timeout ends with reason=timeout', () => {
    const l = labels(ev({ answer: 'pending', end: 'timeout' }));
    expect(l.filter(x => x.includes('NOTIFY ('))).toEqual(['ps>alice NOTIFY (pending)', 'ps>alice NOTIFY (active)', 'ps>alice NOTIFY (active)', 'ps>alice NOTIFY (terminated)']);
    expect(ev({ end: 'timeout' }).steps.at(-2)!.message).toMatch(/Subscription-State: terminated;reason=timeout/);
  });

  it('an early NOTIFY comes before the 200 OK; a 403 ends everything', () => {
    expect(labels(ev({ package: 'dialog', early: true })).slice(1, 4)).toEqual(['pbx>alice NOTIFY (active)', 'alice>pbx 200 OK (NOTIFY)', 'pbx>alice 200 OK']);
    expect(labels(ev({ package: 'dialog', answer: 'rejected' }))).toEqual(['alice>pbx SUBSCRIBE', 'pbx>alice 403 Forbidden']);
  });
});

describe('the event rules', async () => {
  const { loadFlow } = await import('../src/lib/data.ts');
  const lint = async (f: FlowData) => lintFlow(await prepareFlow(f)).map(i => i.rule);
  it('notify-early flags a 481 to a NOTIFY the subscriber asked for', async () => {
    expect(lintFlow(await loadFlow('notify-early-481')).map(i => i.rule)).toEqual(['notify-early']);
  });
  it('notify-headers and subscribe-expires catch a wrong Event, a missing Expires, and a longer Expires', async () => {
    const f = buildEvents({ package: 'dialog', answer: 'active', end: 'unsubscribe', refresh: false, early: false });
    const bad = structuredClone(f);
    bad.steps[2]!.message = bad.steps[2]!.message!.replace('Event: dialog', 'Event: presence');
    expect(await lint(bad)).toContain('notify-headers');
    const noExp = structuredClone(f);
    noExp.steps[1]!.message = noExp.steps[1]!.message!.replace(/Expires: 3600\n/, '');
    expect(await lint(noExp)).toContain('subscribe-expires');
    const longer = structuredClone(f);
    longer.steps[1]!.message = longer.steps[1]!.message!.replace('Expires: 3600', 'Expires: 7200');
    expect(await lint(longer)).toContain('subscribe-expires');
    const notEnded = structuredClone(f);
    const last = notEnded.steps.findLastIndex(s => s.label.startsWith('NOTIFY'));
    notEnded.steps[last]!.message = notEnded.steps[last]!.message!.replace('Subscription-State: terminated', 'Subscription-State: active;expires=60');
    expect(await lint(notEnded)).toContain('notify-headers');
  });
});
