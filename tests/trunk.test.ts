import { describe, expect, it } from 'vitest';
import { prepareFlow, type FlowData } from '../src/sip/flow.ts';
import { lintFlow } from '../src/sip/lint-flow.ts';
import { lintDiagram } from '../src/sip/lint-diagram.ts';
import { glossaryTerms, loadQuotes } from '../src/lib/data.ts';
import { allTrunks, buildTrunk, DEFAULT_TRUNK, TRUNK_QUOTES, trunkKey, type TrunkOptions } from '../src/sip/trunk.ts';
import { normalise, PLANS } from '../src/sip/numbers.ts';

const terms = glossaryTerms();
const quoteIds = new Set(loadQuotes().map(q => q.id));
const labels = (f: FlowData) => f.steps.map(s => `${s.from}>${s.to} ${s.label}`);
const build = (o: Partial<TrunkOptions>) => buildTrunk({ ...DEFAULT_TRUNK, ...o });
const msg = (f: FlowData, label: string, n = 0) => f.steps.filter(s => s.label === label)[n]!.message ?? f.steps.filter(s => s.label === label)[n]!.detail!;

describe('the trunk generator', () => {
  it('every combination passes the protocol and diagram checks', async () => {
    const seen = new Map<string, string>();
    for (const o of allTrunks()) {
      const flow = await prepareFlow(buildTrunk(o));
      for (const i of [...lintFlow(flow), ...lintDiagram(flow, terms)].filter(i => i.severity === 'error' || i.rule === 'caption-passive')) {
        const k = `[${i.rule}] ${i.message}`.replace(/\d+/g, 'N');
        if (!seen.has(k)) seen.set(k, `${trunkKey(o)} step ${i.step + 1}: [${i.rule}] ${i.message}`);
      }
      for (const s of flow.steps) if (s.rfc && !(TRUNK_QUOTES as readonly string[]).includes(s.rfc)) seen.set(s.rfc, `${trunkKey(o)}: quote ${s.rfc} is not in the quote list`);
    }
    for (const id of TRUNK_QUOTES) if (!quoteIds.has(id)) seen.set(id, `unknown quote id ${id}`);
    expect([...seen.values()]).toEqual([]);
  });

  it('a registered trunk registers with a 401 and challenges the INVITE with 407; an IP trunk gets OPTIONS', () => {
    expect(labels(build({})).slice(0, 8)).toEqual([
      'pbx>sbc REGISTER', 'sbc>pbx 401 Unauthorized', 'pbx>sbc REGISTER (credentials)', 'sbc>pbx 200 OK',
      'pbx>sbc INVITE', 'sbc>pbx 407 Proxy Authentication Required', 'pbx>sbc ACK', 'pbx>sbc INVITE (credentials)',
    ]);
    expect(labels(build({ trunk: 'ip' })).slice(0, 3)).toEqual(['sbc>pbx OPTIONS', 'pbx>sbc 200 OK', 'pbx>sbc INVITE']);
  });

  it('the SBC is a B2BUA: each side has its own Call-ID', () => {
    const f = build({ trunk: 'ip' });
    const cid = (m: string) => /Call-ID: (\S+)/.exec(m)![1];
    expect(cid(msg(f, 'INVITE', 0))).not.toBe(cid(msg(f, 'INVITE', 1)));
  });

  it('the SBC adds +1 to a national number; a local number gets 484 with cause 28 and never reaches the PSTN', () => {
    expect(msg(build({ number: 'national' }), 'INVITE', 1)).toMatch(/^INVITE sip:\+14045550199@198\.51\.100\.80;user=phone/);
    const local = build({ number: 'local', trunk: 'ip' });
    expect(local.lanes.map(l => l.id)).toEqual(['pbx', 'sbc', 'gw']);
    expect(msg(local, '484 Address Incomplete', 1)).toMatch(/Reason: Q\.850;cause=28/);
  });

  it('maps each Q.850 cause to its SIP code (RFC 3398) and carries it in Reason (RFC 6432)', () => {
    const cases: [TrunkOptions['outcome'], string, number][] = [['busy', '486 Busy Here', 17], ['no-answer', '480 Temporarily Unavailable', 19], ['unallocated', '404 Not Found', 1], ['congestion', '503 Service Unavailable', 34]];
    for (const [outcome, status, cause] of cases) {
      const f = build({ trunk: 'ip', outcome });
      expect(f.steps.some(s => s.label === `ISUP REL (cause ${cause})`)).toBe(true);
      expect(msg(f, status, 1)).toMatch(new RegExp(`Reason: Q\\.850;cause=${cause};`));
    }
    expect(msg(build({ trunk: 'ip' }), 'BYE', 0)).toMatch(/Reason: Q\.850;cause=16;/);
  });

  it('early media: 183 with SDP and in-band audio; without it, 180 and a local ringback tone', () => {
    expect(labels(build({ trunk: 'ip' }))).toContain('gw>pbx RTP (ringback tone)');
    const f = build({ trunk: 'ip', earlyMedia: false });
    expect(labels(f)).toContain('gw>sbc 180 Ringing');
    expect(f.steps.some(s => s.kind === 'media' && s.label.startsWith('RTP (ringback'))).toBe(false);
  });

  it('caller ID: Privacy: id gives presentation restricted; an anonymous From alone does not', () => {
    expect(msg(build({ trunk: 'ip', callerId: 'withheld' }), 'ISUP IAM')).toMatch(/presentation restricted/);
    const fromOnly = build({ trunk: 'ip', callerId: 'from-only' });
    expect(msg(fromOnly, 'ISUP IAM')).toMatch(/presentation allowed/);
    expect(fromOnly.steps.find(s => s.label === 'ISUP IAM')!.warn).toBeTruthy();
  });

  it('a forwarded call keeps Carol\'s number only with Diversion or History-Info', () => {
    const div = build({ trunk: 'ip', redirect: 'diversion' });
    expect(msg(div, 'INVITE', 1)).toMatch(/P-Asserted-Identity: <sip:\+12025550123@/);
    expect(msg(div, 'ISUP IAM')).toMatch(/Original called number: 4045550101/);
    const lost = build({ trunk: 'ip', redirect: 'lost' });
    expect(msg(lost, 'INVITE', 1)).toMatch(/P-Asserted-Identity: <sip:\+14045550100@/);
    expect(msg(lost, 'ISUP IAM')).not.toMatch(/Original called number/);
  });
});

describe('the number normaliser', () => {
  const us = PLANS.us, uk = PLANS.uk;
  it('normalises the usual US forms to E.164', () => {
    expect(normalise('9 555 0199', us)).toMatchObject({ kind: 'local', e164: '+14045550199', localTel: 'tel:5550199;phone-context=+1-404' });
    expect(normalise('9 404 555 0199', us)).toMatchObject({ kind: 'national', e164: '+14045550199' });
    expect(normalise('9 1 404 555 0199', us).e164).toBe('+14045550199');
    expect(normalise('9 011 44 20 7946 0123', us)).toMatchObject({ kind: 'international', e164: '+442079460123', isup: { noa: 'international' } });
    expect(normalise('+1 404 555 0199', us)).toMatchObject({ kind: 'e164', isup: { digits: '4045550199', noa: 'national' } });
  });
  it('normalises UK forms, and handles emergency and bad input', () => {
    expect(normalise('9 020 7946 0123', uk).e164).toBe('+442079460123');
    expect(normalise('9 7946 0123', uk).e164).toBe('+442079460123');
    expect(normalise('9 00 1 404 555 0199', uk).e164).toBe('+14045550199');
    expect(normalise('9 999', uk).kind).toBe('emergency');
    expect(normalise('555 0199', us).kind).toBe('invalid');
    expect(normalise('9 0199', us).kind).toBe('invalid');
  });
});
