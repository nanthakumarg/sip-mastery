import { describe, expect, it } from 'vitest';
import { prepareFlow, toWire, type FlowData } from '../src/sip/flow.ts';
import { lintFlow } from '../src/sip/lint-flow.ts';
import { lintDiagram } from '../src/sip/lint-diagram.ts';
import { glossaryTerms, loadQuotes } from '../src/lib/data.ts';
import { b2buaCall, PAIRS, proxyCall } from '../src/sip/elements.ts';
import { allBalances, BALANCE_QUOTES, buildBalance, type BalanceOptions } from '../src/sip/balance.ts';
import { applySbc, DEFAULT_SBC, runSbc } from '../src/sip/sbc.ts';
import { parseMessage } from '../src/sip/parse.ts';
import { inspect } from '../src/diagrams/diff.ts';

const terms = glossaryTerms();
const quoteIds = new Set(loadQuotes().map(q => q.id));
const errors = async (f: FlowData) => {
  const p = await prepareFlow(f);
  return [...lintFlow(p), ...lintDiagram(p, terms)].filter(i => i.severity === 'error' || i.rule === 'caption-passive').map(i => `${f.id} step ${i.step + 1}: [${i.rule}] ${i.message}`);
};
const header = (wire: string, name: string) => parseMessage(toWire(wire)).headers.filter(h => h.name === name).map(h => h.value);
const labels = (f: FlowData) => f.steps.map(s => `${s.from}>${s.to} ${s.label}`);

describe('proxy vs B2BUA', () => {
  it('both calls pass the checks', async () => {
    expect([...(await errors(proxyCall())), ...(await errors(b2buaCall()))]).toEqual([]);
  });

  it('each pair is the same message, in and out of the element', () => {
    for (const f of [proxyCall(), b2buaCall()]) for (const [a, b] of Object.values(PAIRS)) {
      expect(f.steps[b]!.label).toBe(f.steps[a]!.label);
      expect(f.steps[a]!.to).toBe('mid');
      expect(f.steps[b]!.from).toBe('mid');
    }
  });

  it('a proxy keeps Call-ID, tags, Contact, and the body; a B2BUA changes them all', () => {
    const [a, b] = PAIRS.invite;
    const p = proxyCall(), u = b2buaCall();
    for (const h of ['Call-ID', 'From', 'Contact', 'CSeq']) {
      expect(header(p.steps[b]!.message!, h)).toEqual(header(p.steps[a]!.message!, h));
      expect(header(u.steps[b]!.message!, h)).not.toEqual(header(u.steps[a]!.message!, h));
    }
    const diff = inspect(toWire(p.steps[b]!.message!), toWire(p.steps[a]!.message!))!;
    expect(diff.lines.filter(l => l.zone === 'body' && l.state !== 'same')).toEqual([]);
    expect(diff.lines.filter(l => l.state === 'added').map(l => l.name)).toEqual(expect.arrayContaining(['Via', 'Record-Route']));
  });
});

describe('the SBC explorer', () => {
  it('with every function off, the SBC copies Call-ID, the private SDP, and G.722', () => {
    const r = runSbc(DEFAULT_SBC);
    expect(r.outside).toMatch(/Call-ID: 5f0c1e9a@10\.1\.1\.20/);
    expect(r.outside).toMatch(/c=IN IP4 10\.1\.1\.20/);
    expect(r.checks.filter(c => !c.ok).map(c => c.what)).toEqual(['Number format', 'Codec', 'Media address', 'Internal names', 'Transport']);
  });

  it('with every function on, the INVITE is clean and the call works', () => {
    const r = runSbc({ hide: true, normalise: true, media: true, transcode: true, security: true, cac: true, busy: false });
    expect(r.outside).toMatch(/^INVITE sip:\+14045550199@sip\.carrier\.example;user=phone/);
    expect(r.outside).toMatch(/Via: SIP\/2\.0\/TLS/);
    expect(r.outside).toMatch(/m=audio 40000 RTP\/SAVP 8 0 101/);
    expect(r.outside).not.toMatch(/10\.1\.1\.|corp\.internal|User-Agent/);
    expect(r.checks.every(c => c.ok)).toBe(true);
    expect(r.attacks.every(a => a.blocked)).toBe(true);
    expect(r.carrier).toMatch(/call works/);
  });

  it('transcoding and SRTP turn on media anchoring; turning anchoring off turns them off', () => {
    expect(applySbc(DEFAULT_SBC, { transcode: true }).options.media).toBe(true);
    const off = applySbc({ ...DEFAULT_SBC, media: true, transcode: true, security: true }, { media: false }).options;
    expect([off.transcode, off.security]).toEqual([false, false]);
  });

  it('call admission control rejects the 31st call with 503 before the carrier sees it', () => {
    const r = runSbc({ ...DEFAULT_SBC, cac: true, busy: true });
    expect(r.outside).toBeUndefined();
    expect(r.reject).toMatch(/^SIP\/2\.0 503 Service Unavailable/);
  });
});

describe('the load balancer generator', () => {
  const all: BalanceOptions[] = [...allBalances(), { probe: true, failure: 'decline', failoverAll: true }];
  it('every combination passes the checks', async () => {
    const out: string[] = [];
    for (const o of all) {
      const f = buildBalance(o);
      out.push(...await errors(f));
      for (const s of f.steps) if (s.rfc && !(BALANCE_QUOTES as readonly string[]).includes(s.rfc)) out.push(`${f.id}: ${s.rfc} not in the quote list`);
    }
    for (const id of BALANCE_QUOTES) if (!quoteIds.has(id)) out.push(`unknown quote ${id}`);
    expect(out).toEqual([]);
  });

  it('with health checks, a dead PBX A gets no INVITE; without them, the call waits for Timer B', () => {
    expect(labels(buildBalance({ probe: true, failure: 'down' })).filter(l => l.startsWith('lb>pbxA'))).toEqual(['lb>pbxA OPTIONS']);
    const f = buildBalance({ probe: false, failure: 'down' });
    expect(f.steps.find(s => s.label === 'INVITE' && s.to === 'pbxB')!.at).toBe(32);
  });

  it('fails over after 503, not after 603', () => {
    expect(labels(buildBalance({ probe: true, failure: 'overload' }))).toContain('lb>pbxB INVITE');
    const decline = buildBalance({ probe: true, failure: 'decline' });
    expect(labels(decline)).not.toContain('lb>pbxB INVITE');
    expect(labels(decline)).toContain('lb>alice 603 Decline');
    expect(labels(buildBalance({ probe: true, failure: 'decline', failoverAll: true }))).toContain('lb>pbxB INVITE');
  });
});
