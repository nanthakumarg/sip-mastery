import { describe, expect, it } from 'vitest';
import {
  canonicalAor, DEFAULT_POLICY, lookup, parseContact, parseContactHeader, processRegister, runRegistrar, sameUri,
  type Binding, type RegisterRequest,
} from '../src/sip/registrar.ts';
import { DEFAULT_CLOCK, expiryClock, portsAt, stateAt } from '../src/sip/expiry.ts';
import { lintFlow } from '../src/sip/lint-flow.ts';
import { prepareFlow } from '../src/sip/flow.ts';
import { listFlowIds, loadFlow, loadFlowData } from '../src/lib/data.ts';

const DESK = 'sip:bob@203.0.113.20:5060';
const MOBILE = 'sip:bob@198.51.100.77:41270;transport=tcp';
const req = (r: Partial<RegisterRequest>): RegisterRequest => ({
  at: 0, requestUri: 'sip:biloxi.example', aor: 'sip:bob@biloxi.example', callId: 'c1', cseq: 1,
  contacts: [{ uri: DESK, params: {} }], expires: 3600, path: [], supported: [], ...r,
});

describe('parsing Contact values', () => {
  it('keeps quoted parameters with < > and commas inside', () => {
    const [c] = parseContactHeader('<sip:bob@192.0.2.2;transport=tcp>;reg-id=1;+sip.instance="<urn:uuid:00000000-0000-1000-8000-000A95A0E128>";expires=600');
    expect(c).toEqual({ uri: 'sip:bob@192.0.2.2;transport=tcp', params: { 'reg-id': '1', '+sip.instance': '<urn:uuid:00000000-0000-1000-8000-000A95A0E128>', expires: '600' } });
    expect(parseContactHeader('<sip:a@x>;q=1.0, "B, C" <sip:b@y>;q=0.5').map(x => x.uri)).toEqual(['sip:a@x', 'sip:b@y']);
    expect(parseContact(' * ').star).toBe(true);
  });

  it('compares the AOR without URI parameters, and the host without case', () => {
    expect(canonicalAor('sip:bob@BILOXI.example;user=phone')).toBe('sip:bob@biloxi.example');
    expect(canonicalAor('sip:Bob@biloxi.example')).not.toBe(canonicalAor('sip:bob@biloxi.example'));
    expect(sameUri('sip:bob@H.example;transport=tcp;lr', 'sip:bob@h.example;lr;transport=TCP')).toBe(true);
  });
});

describe('processing REGISTER (RFC 3261 §10.3)', () => {
  it('adds a binding and lists every binding with the time left', () => {
    const a = processRegister([], req({}));
    expect(a.status).toBe(200);
    const b = processRegister(a.bindings, req({ at: 120, callId: 'c2', contacts: [{ uri: MOBILE, params: { q: '0.5', expires: '600' } }] }));
    expect(b.contacts).toEqual([`<${DESK}>;expires=3480`, `<${MOBILE}>;q=0.5;expires=600`]);
  });

  it('takes the expires parameter first, then Expires, then the default', () => {
    const r = processRegister([], req({ expires: 900, contacts: [{ uri: DESK, params: { expires: '1200' } }, { uri: MOBILE, params: {} }] }));
    expect(r.contacts).toEqual([`<${DESK}>;expires=1200`, `<${MOBILE}>;expires=900`]);
    expect(processRegister([], req({ expires: undefined })).contacts).toEqual([`<${DESK}>;expires=${DEFAULT_POLICY.defaultExpires}`]);
  });

  it('refreshes with a higher CSeq on the same Call-ID, and refuses an old CSeq', () => {
    const a = processRegister([], req({}));
    const b = processRegister(a.bindings, req({ at: 1800, cseq: 2 }));
    expect(b.actions).toEqual([expect.objectContaining({ kind: 'refreshed', granted: 3600 })]);
    expect(b.bindings[0]!.expiresAt).toBe(5400);
    expect(processRegister(b.bindings, req({ at: 1900, cseq: 2 })).status).toBe(500);
    // A different Call-ID (a reboot) may update the binding with any CSeq.
    expect(processRegister(b.bindings, req({ at: 1900, callId: 'c9', cseq: 1 })).status).toBe(200);
  });

  it('answers a query without changing anything', () => {
    const a = processRegister([], req({}));
    const q = processRegister(a.bindings, req({ at: 600, cseq: 2, contacts: undefined }));
    expect(q.bindings).toEqual(a.bindings);
    expect(q.contacts).toEqual([`<${DESK}>;expires=3000`]);
  });

  it('removes one binding with expires 0, and all with Contact: * and Expires: 0', () => {
    let s = processRegister([], req({})).bindings;
    s = processRegister(s, req({ callId: 'm', contacts: [{ uri: MOBILE, params: {} }] })).bindings;
    const one = processRegister(s, req({ cseq: 2, contacts: [{ uri: DESK, params: { expires: '0' } }] }));
    expect(one.bindings.map(b => b.contact)).toEqual([MOBILE]);
    const all = processRegister(s, req({ cseq: 2, contacts: [{ star: true, uri: '*', params: {} }], expires: 0 }));
    expect(all.status).toBe(200);
    expect(all.bindings).toEqual([]);
    expect(all.contacts).toEqual([]);
  });

  it('rejects Contact: * without Expires: 0 with 400, and keeps every binding', () => {
    const s = processRegister([], req({})).bindings;
    for (const expires of [undefined, 3600]) {
      const r = processRegister(s, req({ cseq: 2, contacts: [{ star: true, uri: '*', params: {} }], expires }));
      expect(r.status).toBe(400);
      expect(r.bindings).toEqual(s);
    }
  });

  it('answers 423 with Min-Expires only for 0 < expires < min (and < 1 hour), and shortens long requests', () => {
    const p = { ...DEFAULT_POLICY, minExpires: 300, maxExpires: 600 };
    expect(processRegister([], req({ expires: 60 }), p)).toMatchObject({ status: 423, minExpires: 300, bindings: [] });
    expect(processRegister([], req({ expires: 300 }), p).status).toBe(200);
    const long = processRegister([], req({ expires: 3600 }), p);
    expect(long.contacts).toEqual([`<${DESK}>;expires=600`]);
    expect(long.rule).toBe('rfc3261-10.3-shorter');
    // A minimum above one hour can never reject a request of one hour or more.
    expect(processRegister([], req({ expires: 3600 }), { ...DEFAULT_POLICY, minExpires: 7200 }).status).toBe(200);
  });

  it('answers 404 when the AOR is not in the domain of the Request-URI', () => {
    expect(processRegister([], req({ aor: 'sip:bob@atlanta.example' })).status).toBe(404);
  });

  it('lets bindings expire', () => {
    const s = processRegister([], req({ expires: 600 })).bindings;
    const r = processRegister(s, req({ at: 601, cseq: 2, contacts: undefined }));
    expect(r.contacts).toEqual([]);
    expect(r.actions).toEqual([{ kind: 'expired', contact: DESK }]);
  });
});

describe('Path, SIP Outbound, and GRUU', () => {
  const inst = '<urn:uuid:5f3c0a2e-6b1d-4c8e-9a47-2d61b0e8c3f5>';
  const ob = { ...DEFAULT_POLICY, outbound: true, gruu: true };
  const reg = (uri: string, r: Partial<RegisterRequest> = {}) => req({ supported: ['path', 'outbound', 'gruu'], contacts: [{ uri, params: { '+sip.instance': inst, 'reg-id': '1' } }], ...r });

  it('stores the Path with the binding and puts it in Route for a lookup (RFC 3327)', () => {
    const r = processRegister([], req({ path: ['<sip:edge.biloxi.example;lr>'], supported: ['path'] }), { ...DEFAULT_POLICY, serviceRoute: ['<sip:orig@proxy.biloxi.example;lr>'] });
    expect(r.path).toEqual(['<sip:edge.biloxi.example;lr>']);
    expect(r.serviceRoute).toEqual(['<sip:orig@proxy.biloxi.example;lr>']);
    expect(lookup(r.bindings, 'sip:bob@biloxi.example', 10)).toEqual([{ contact: DESK, q: 1, route: ['<sip:edge.biloxi.example;lr>'] }]);
  });

  it('without an instance ID, a new address is a second binding', () => {
    const a = processRegister([], req({ contacts: [{ uri: MOBILE, params: {} }] }));
    const b = processRegister(a.bindings, req({ at: 240, cseq: 2, contacts: [{ uri: 'sip:bob@198.51.100.200:50122;transport=tcp', params: {} }] }));
    expect(b.bindings).toHaveLength(2);
  });

  it('with the same instance ID and reg-id, the new Contact replaces the old (RFC 5626 §6)', () => {
    const a = processRegister([], reg(MOBILE), ob);
    expect(a.require).toEqual(['outbound']);
    const b = processRegister(a.bindings, reg('sip:bob@198.51.100.200:50122;transport=tcp', { at: 240, cseq: 2 }), ob);
    expect(b.bindings).toHaveLength(1);
    expect(b.actions[0]).toMatchObject({ kind: 'replaced', was: MOBILE });
    // Without outbound support, the registrar ignores reg-id: two bindings.
    expect(processRegister(a.bindings, reg('sip:bob@198.51.100.200:50122;transport=tcp', { at: 240, cseq: 2 })).bindings).toHaveLength(2);
  });

  it('rejects two non-zero Contacts with reg-id (RFC 5626 §6)', () => {
    const two = req({ supported: ['outbound'], contacts: [{ uri: DESK, params: { '+sip.instance': inst, 'reg-id': '1' } }, { uri: MOBILE, params: { '+sip.instance': inst, 'reg-id': '2' } }] });
    expect(processRegister([], two, ob).status).toBe(400);
  });

  it('returns a public GRUU built from the AOR and a new temporary GRUU on each refresh (RFC 5627)', () => {
    const a = processRegister([], reg(MOBILE), ob);
    expect(a.contacts[0]).toContain('pub-gruu="sip:bob@biloxi.example;gr=urn:uuid:5f3c0a2e-6b1d-4c8e-9a47-2d61b0e8c3f5"');
    const b = processRegister(a.bindings, reg(MOBILE, { at: 300, cseq: 2 }), ob);
    expect(b.bindings[0]!.pubGruu).toBe(a.bindings[0]!.pubGruu);
    expect(b.bindings[0]!.tempGruu).not.toBe(a.bindings[0]!.tempGruu);
    expect(lookup(b.bindings, 'sip:bob@biloxi.example;gr=urn:uuid:5f3c0a2e-6b1d-4c8e-9a47-2d61b0e8c3f5', 400).map(t => t.contact)).toEqual([MOBILE]);
  });
});

describe('lookup', () => {
  it('orders the targets by q, highest first (RFC 3261 §16.6)', () => {
    const b = (contact: string, q?: number): Binding => ({ aor: 'sip:bob@biloxi.example', contact, ...(q !== undefined ? { q } : {}), expiresAt: 100, callId: contact, cseq: 1, path: [] });
    expect(lookup([b('a', 0.5), b('b'), b('c', 0.7)], 'sip:bob@biloxi.example', 0).map(t => t.contact)).toEqual(['b', 'c', 'a']);
    expect(lookup([b('a')], 'sip:bob@biloxi.example', 100)).toEqual([]);
  });
});

describe('registration flows', () => {
  const ids = listFlowIds().filter(id => loadFlowData(id).registrar);

  it('every flow with a registrar agrees with the model', async () => {
    expect(ids.length).toBeGreaterThanOrEqual(10);
    for (const id of ids) {
      const flow = await loadFlow(id);
      const issues = lintFlow(flow).filter(i => i.rule === 'registrar-model');
      expect(issues, id).toEqual([]);
      const snaps = runRegistrar(flow.steps.map(s => ({ ...s, message: s.parsed })), flow.registrar!.lane, { ...DEFAULT_POLICY, ...flow.registrar });
      expect(snaps.some(s => s.result), id).toBe(true);
    }
  });

  it('catches a 200 OK that lists the wrong expiry, and a Contact: * without Expires: 0', async () => {
    const data = structuredClone(loadFlowData('register-lifecycle'));
    data.steps[5]!.message = data.steps[5]!.message!.replace('expires=3000', 'expires=3600');
    expect(lintFlow(await prepareFlow(data)).map(i => i.rule)).toContain('registrar-model');
    const star = lintFlow(await loadFlow('register-star-no-expires')).map(i => i.rule);
    expect(star).toContain('register-star');
  });

  it('flags a refresh that comes after the granted expiry', async () => {
    const late = lintFlow(await loadFlow('register-refresh-late'));
    expect(late.filter(i => i.rule === 'register-refresh').map(i => i.step)).toEqual([5]);
    expect(lintFlow(await loadFlow('register-refresh-granted'))).toEqual([]);
  });
});

describe('expiry clock', () => {
  it('a 1-hour registration with a 60 s NAT timeout and no keepalives is reachable for one minute in 30', () => {
    const c = expiryClock({ ...DEFAULT_CLOCK, asked: 3600, natTimeout: 60, keepalive: 0 });
    expect(c.registers).toEqual([0, 1800]);
    expect(stateAt(c, 30)).toBe('ok');
    expect(stateAt(c, 61)).toBe('nat-closed');
    expect(c.firstFailure).toMatchObject({ from: 60, state: 'nat-closed' });
    expect(c.reachable).toBeCloseTo(120 / 3600);
  });

  it('keepalives inside the NAT timeout keep the phone reachable all hour', () => {
    const c = expiryClock({ ...DEFAULT_CLOCK, natTimeout: 60, keepalive: 25 });
    expect(c.mappings).toHaveLength(1);
    expect(c.reachable).toBe(1);
  });

  it('a keepalive after the mapping closed opens a new port that the registrar does not know', () => {
    const c = expiryClock({ ...DEFAULT_CLOCK, natTimeout: 60, keepalive: 90 });
    expect(stateAt(c, 100)).toBe('new-port');
    const p = portsAt(c, 100);
    expect(p.known).not.toBe(p.open);
  });

  it('refreshing from the asked expiry leaves the binding expired between refreshes', () => {
    const c = expiryClock({ ...DEFAULT_CLOCK, asked: 3600, maxExpires: 600, refresh: 'asked', natTimeout: 300, keepalive: 25 });
    expect(c.granted).toBe(600);
    expect(stateAt(c, 900)).toBe('expired');
    expect(c.reachable).toBeCloseTo(1200 / 3600);
    expect(expiryClock({ ...DEFAULT_CLOCK, asked: 3600, maxExpires: 600, refresh: 'granted', natTimeout: 300, keepalive: 25 }).reachable).toBe(1);
  });
});
