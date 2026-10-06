import { describe, expect, it } from 'vitest';
import { prepareFlow, type FlowData } from '../src/sip/flow.ts';
import { lintFlow } from '../src/sip/lint-flow.ts';
import { lintDiagram } from '../src/sip/lint-diagram.ts';
import { glossaryTerms, loadQuotes } from '../src/lib/data.ts';
import { allImsRegs, allVoltes, buildImsReg, buildVolte, IMS_LINKS, IMS_NODES, IMS_PATHS, IMSREG_QUOTES, VOLTE_QUOTES, type ImsRegOptions, type VolteOptions } from '../src/sip/ims.ts';

const terms = glossaryTerms();
const quoteIds = new Set(loadQuotes().map(q => q.id));
const labels = (f: FlowData) => f.steps.map(s => `${s.from}>${s.to} ${s.label}`);
const statusAt = (f: FlowData, lane: string, upTo: number) => f.steps.slice(0, upTo + 1).reduce<string | undefined>((v, s) => s.status?.[lane] ?? v, undefined);

async function problems(flows: FlowData[], quotes: readonly string[]) {
  const out: string[] = [];
  for (const f0 of flows) {
    const f = await prepareFlow(f0);
    for (const i of [...lintFlow(f), ...lintDiagram(f, terms)]) if (i.severity === 'error' || i.rule === 'caption-passive') out.push(`${f.id} step ${i.step + 1}: [${i.rule}] ${i.message}`);
    for (const s of f.steps) if (s.rfc && !quotes.includes(s.rfc)) out.push(`${f.id}: ${s.rfc} not in the quote list`);
  }
  for (const id of quotes) if (!quoteIds.has(id)) out.push(`unknown quote ${id}`);
  return out;
}

describe('IMS registration', () => {
  const extra: ImsRegOptions[] = [{ auth: 'aka', regEvent: true, ignoreServiceRoute: true }];
  it('every combination passes the checks', async () => {
    expect(await problems([...allImsRegs(), ...extra].map(buildImsReg), IMSREG_QUOTES)).toEqual([]);
  });

  it('AKA: 401 with AKAv1-MD5 and keys at the S-CSCF; the P-CSCF strips CK and IK and adds Security-Server', () => {
    const f = buildImsReg({ auth: 'aka', regEvent: false });
    const at = (from: string, label: string) => f.steps.find(s => s.from === from && s.label === label)!.message!;
    expect(at('scscf', '401 Unauthorized')).toMatch(/algorithm=AKAv1-MD5.*ik=".*ck="/);
    expect(at('pcscf', '401 Unauthorized')).not.toMatch(/ik=|ck=/);
    expect(at('pcscf', '401 Unauthorized')).toMatch(/Security-Server: ipsec-3gpp/);
    expect(at('ue', 'REGISTER (credentials)')).toMatch(/^Via: SIP\/2\.0\/UDP 10\.45\.0\.7:5062/m);
    expect(at('ue', 'REGISTER (credentials)')).toMatch(/Security-Verify:/);
    expect(at('scscf', '200 OK')).toMatch(/Service-Route: <sip:orig@scscf/);
    expect(statusAt(f, 'ue', f.steps.length - 1)).toBe('Registered');
  });

  it('the Diameter queries: UAR/UAA for each REGISTER, MAR/MAA, then SAR/SAA', () => {
    const d = buildImsReg({ auth: 'aka', regEvent: false }).steps.filter(s => s.label.startsWith('Diameter')).map(s => s.label.slice(9));
    expect(d).toEqual(['UAR', 'UAA', 'MAR', 'MAA', 'UAR', 'UAA', 'SAR', 'SAA']);
  });

  it('resync sends AUTS and gets a second challenge; MD5 gets 403', () => {
    const r = buildImsReg({ auth: 'resync', regEvent: false });
    expect(r.steps.filter(s => s.label === '401 Unauthorized' && s.to === 'ue')).toHaveLength(2);
    expect(r.steps.find(s => s.message?.includes('auts='))).toBeTruthy();
    expect(labels(buildImsReg({ auth: 'md5', regEvent: false })).at(-1)).toBe('pcscf>ue 403 Forbidden');
  });

  it('the reg-event SUBSCRIBE follows the Service-Route and skips the I-CSCF', () => {
    const f = buildImsReg({ auth: 'aka', regEvent: true });
    const i = f.steps.findIndex(s => s.label === 'SUBSCRIBE');
    expect(labels(f).slice(i, i + 2)).toEqual(['ue>pcscf SUBSCRIBE', 'pcscf>scscf SUBSCRIBE']);
    expect(f.steps[i]!.message).toMatch(/Route: <sip:pcscf[^\n]*\nRoute: <sip:orig@scscf/);
    expect(labels(buildImsReg({ auth: 'aka', regEvent: true, ignoreServiceRoute: true })).at(-1)).toBe('pcscf>ue 400 Bad Request');
  });
});

describe('VoLTE call', () => {
  const extra: VolteOptions[] = [{ codec: 'evs', preconditions: true, stall: true }];
  it('every combination passes the checks', async () => {
    expect(await problems([...allVoltes(), ...extra].map(buildVolte), VOLTE_QUOTES)).toEqual([]);
  });

  it('UE B rings only after the UPDATE reports UE A\'s QoS', () => {
    const f = buildVolte({ codec: 'evs', preconditions: true });
    const l = labels(f);
    const upd = l.indexOf('core>ueB UPDATE'), ring = l.indexOf('ueB>core 180 Ringing');
    expect(upd).toBeGreaterThan(0);
    expect(ring).toBeGreaterThan(upd);
    expect(statusAt(f, 'ueB', upd - 1)).toBe('Local QoS');
    expect(statusAt(f, 'ueB', upd)).toBe('Both QoS');
    expect(f.steps[0]!.message).toMatch(/a=curr:qos local none\na=curr:qos remote none\na=des:qos mandatory local sendrecv/);
  });

  it('with no UPDATE, UE B never rings and the call is cancelled', () => {
    const l = labels(buildVolte({ codec: 'evs', preconditions: true, stall: true }));
    expect(l).not.toContain('ueB>core 180 Ringing');
    expect(l).toContain('ueA>core CANCEL');
  });

  it('EVS when both have it, AMR-WB otherwise', () => {
    expect(buildVolte({ codec: 'evs', preconditions: true }).steps.at(-1)!.label).toBe('RTP (EVS)');
    expect(buildVolte({ codec: 'amr-wb', preconditions: true }).steps.at(-1)!.label).toBe('RTP (AMR-WB)');
  });
});

describe('the IMS core map', () => {
  it('every link and path names known functions, and paths follow links', () => {
    const ids = new Set(IMS_NODES.map(n => n.id));
    const links = new Set(IMS_LINKS.map(([a, b]) => [a, b].sort().join('|')));
    for (const [a, b] of IMS_LINKS) expect(ids.has(a) && ids.has(b)).toBe(true);
    for (const p of Object.values(IMS_PATHS)) p.hops.slice(1).forEach((h, k) => expect(links.has([p.hops[k]!, h].sort().join('|')), `${p.hops[k]}-${h}`).toBe(true));
  });
});
