import { describe, expect, it } from 'vitest';
import { allCalls, applyChange, buildCall, CALL_QUOTES, callKey, DEFAULT_CALL, type CallOptions } from '../src/sip/callflow.ts';
import { prepareFlow } from '../src/sip/flow.ts';
import { lintFlow } from '../src/sip/lint-flow.ts';
import { lintDiagram } from '../src/sip/lint-diagram.ts';
import { glossaryTerms, loadQuotes } from '../src/lib/data.ts';

const terms = glossaryTerms();
const quoteIds = new Set(loadQuotes().map(q => q.id));
const call = (change: Partial<CallOptions>) => buildCall({ ...DEFAULT_CALL, ...change });
const labels = (change: Partial<CallOptions>) => call(change).steps.map(s => `${s.from}>${s.to} ${s.label}${s.lost ? ' ✕' : ''}`);

describe('the call flow generator', () => {
  const combos = allCalls();

  it('covers several hundred valid combinations', () => {
    expect(combos.length).toBeGreaterThan(300);
  });

  it('every combination passes the protocol checks and the diagram language checks', async () => {
    const bad: string[] = [];
    for (const o of combos) {
      const flow = await prepareFlow(buildCall(o));
      const issues = [...lintFlow(flow), ...lintDiagram(flow, terms)].filter(i => i.severity === 'error' || i.rule === 'caption-passive');
      for (const i of issues) bad.push(`${callKey(o)} step ${i.step + 1}: [${i.rule}] ${i.message}`);
      for (const s of flow.steps) if (s.rfc && !(CALL_QUOTES as readonly string[]).includes(s.rfc)) bad.push(`${callKey(o)}: quote ${s.rfc} is not in CALL_QUOTES`);
    }
    // One line per distinct problem, with the first combination that has it.
    const seen = new Map<string, string>();
    for (const l of bad) { const k = l.replace(/^\S+ step \d+: /, '').replace(/\d+/g, 'N'); if (!seen.has(k)) seen.set(k, l); }
    expect([...seen.values()]).toEqual([]);
  });

  it('only uses quote ids that exist', () => {
    expect(CALL_QUOTES.filter(id => !quoteIds.has(id))).toEqual([]);
  });
});

describe('the flows it builds (RFC 3665)', () => {
  it('a direct call is INVITE, 180, 200, ACK, media, BYE, 200', () => {
    expect(labels({ path: 'direct' })).toEqual([
      'alice>bob INVITE', 'bob>alice 180 Ringing', 'bob>alice 200 OK', 'alice>bob ACK',
      'alice>bob RTP audio (PCMU)', 'alice>bob BYE', 'bob>alice 200 OK (BYE)',
    ]);
  });

  it('Record-Route keeps the proxies in the path of the ACK and the BYE', () => {
    const via = (rr: boolean) => labels({ recordRoute: rr }).filter(l => / (ACK|BYE)$/.test(l));
    expect(via(true)).toEqual(['alice>proxyA ACK', 'proxyA>proxyB ACK', 'proxyB>bob ACK', 'alice>proxyA BYE', 'proxyA>proxyB BYE', 'proxyB>bob BYE']);
    expect(via(false)).toEqual(['alice>bob ACK', 'alice>bob BYE']);
  });

  it('a failure response is ACKed on every hop (RFC 3665 §3.9)', () => {
    expect(labels({ outcome: 'busy' }).slice(-6)).toEqual([
      'bob>proxyB 486 Busy Here', 'proxyB>bob ACK', 'proxyB>proxyA 486 Busy Here', 'proxyA>proxyB ACK', 'proxyA>alice 486 Busy Here', 'alice>proxyA ACK',
    ]);
  });

  it('CANCEL goes hop by hop, then 487 and ACK on each hop (RFC 3665 §3.8)', () => {
    const l = labels({ outcome: 'cancel' });
    expect(l.filter(x => / (CANCEL|200 OK \(CANCEL\))$/.test(x))).toEqual([
      'alice>proxyA CANCEL', 'proxyA>alice 200 OK (CANCEL)', 'proxyA>proxyB CANCEL', 'proxyB>proxyA 200 OK (CANCEL)', 'proxyB>bob CANCEL', 'bob>proxyB 200 OK (CANCEL)',
    ]);
    expect(l.at(-1)).toBe('alice>proxyA ACK');
  });

  it('the 407 retry has CSeq 2 and new credentials; Proxy A removes them', async () => {
    const f = await prepareFlow(call({ auth: true }));
    const invites = f.steps.filter(s => s.label.startsWith('INVITE'));
    expect(invites.map(s => s.wire!.match(/CSeq: (\d+)/)![1])).toEqual(['1', '2', '2', '2']);
    expect(invites[1]!.wire).toMatch(/Proxy-Authorization: Digest .*response="[0-9a-f]{32}"/);
    expect(invites[2]!.wire).not.toMatch(/Proxy-Authorization/);
    expect(f.credentials).toBeDefined();
  });

  it('no response: Proxy B retransmits the INVITE, then sends 408 after Timer B', () => {
    const l = labels({ path: 'proxy', outcome: 'no-response' });
    expect(l.filter(x => x.endsWith('✕'))).toEqual(['proxyB>bob INVITE ✕', 'proxyB>bob INVITE (retransmission) ✕', 'proxyB>bob INVITE (retransmission) ✕']);
    expect(l.slice(-2)).toEqual(['proxyB>alice 408 Request Timeout', 'alice>proxyB ACK']);
  });

  it('a lost 200 OK or ACK: Bob\'s phone retransmits the 200 OK (RFC 3261 §13.3.1.4)', () => {
    expect(labels({ path: 'direct', lose: 'ok' }).slice(2, 5)).toEqual(['bob>alice 200 OK ✕', 'bob>alice 200 OK (retransmission)', 'alice>bob ACK']);
    expect(labels({ path: 'direct', lose: 'ack' }).slice(3, 6)).toEqual(['alice>bob ACK ✕', 'bob>alice 200 OK (retransmission)', 'alice>bob ACK (retransmission)']);
  });

  it('late offer: the INVITE has no SDP, the 200 OK has the offer, the ACK the answer', async () => {
    const f = await prepareFlow(call({ path: 'direct', lateOffer: true }));
    const body = (label: string) => f.steps.find(s => s.label === label)!.parsed!.body;
    expect(body('INVITE (no SDP)')).toBe('');
    expect(body('200 OK (offer)')).toMatch(/m=audio 3456 RTP\/AVP 0 8/);
    expect(body('ACK (answer)')).toMatch(/m=audio 49170 RTP\/AVP 0\r\n/);
  });

  it('redirect: a 302, its ACK, then a new INVITE with CSeq 2 to the Contact', async () => {
    const f = await prepareFlow(call({ path: 'redirect' }));
    const i = f.steps.find(s => s.label === 'INVITE (new target)')!;
    expect(f.steps.slice(0, 3).map(s => s.label)).toEqual(['INVITE', '302 Moved Temporarily', 'ACK']);
    expect(i.parsed!.requestUri).toBe('sip:bob@203.0.113.20:5060');
    expect(i.wire).toMatch(/CSeq: 2 INVITE/);
  });

  it('parallel forking rings both phones and cancels the Mobile after the Desk phone answers', () => {
    const l = labels({ path: 'fork-parallel' });
    expect(l.slice(2, 4)).toEqual(['proxyB>desk INVITE', 'proxyB>mobile INVITE']);
    expect(l.indexOf('proxyB>mobile CANCEL')).toBeGreaterThan(l.indexOf('proxyB>alice 200 OK'));
    expect(l).not.toContain('proxyB>alice 487 Request Terminated');
  });

  it('sequential forking cancels the Desk phone before it tries the Mobile', () => {
    const l = labels({ path: 'fork-sequential' });
    expect(l.indexOf('proxyB>desk CANCEL')).toBeLessThan(l.indexOf('proxyB>mobile INVITE'));
    expect(l).toContain('mobile>proxyB 200 OK');
  });
});

describe('option conflicts', () => {
  it('the option that changed wins, and the other moves', () => {
    const a = applyChange({ ...DEFAULT_CALL, path: 'direct' }, { auth: true });
    expect([a.options.path, a.options.auth]).toEqual(['two-proxies', true]);
    const b = applyChange({ ...DEFAULT_CALL, auth: true }, { path: 'direct' });
    expect([b.options.path, b.options.auth, b.notes.length]).toEqual(['direct', false, 1]);
    const c = applyChange({ ...DEFAULT_CALL, lateOffer: true }, { earlyMedia: true });
    expect([c.options.earlyMedia, c.options.lateOffer]).toEqual([true, false]);
    const d = applyChange({ ...DEFAULT_CALL, outcome: 'busy' }, { lose: 'ack' });
    expect(d.options.outcome).toBe('answer');
  });

  it('a valid combination needs no change', () => {
    expect(applyChange(DEFAULT_CALL, {}).notes).toEqual([]);
  });
});

describe('the late-offer-ack rule', async () => {
  const { loadFlow } = await import('../src/lib/data.ts');
  it('flags an ACK without the answer to an offer in the 200 OK', async () => {
    expect(lintFlow(await loadFlow('late-offer-ack-empty')).map(i => i.rule)).toEqual(['late-offer-ack']);
    expect(lintFlow(await loadFlow('sdp-late-offer'))).toEqual([]);
  });
});
