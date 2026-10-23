import { describe, expect, it } from 'vitest';
import { glossaryTerms, loadFlow } from '../src/lib/data.ts';
import { prepareFlow } from '../src/sip/flow.ts';
import { lintDiagram } from '../src/sip/lint-diagram.ts';
import { lintFlow } from '../src/sip/lint-flow.ts';
import { getHeader, getHeaders } from '../src/sip/parse.ts';
import { inDialogTarget, parseVia, responseTarget, trapezoidCall, trapezoidOptions, viaList, type LaterRequest, type Party } from '../src/sip/routing.ts';

describe('responses follow Via (RFC 3261 §18.2.2, RFC 3581 §4)', () => {
  it('uses received and rport when both are present', () => {
    const v = parseVia('SIP/2.0/UDP 192.168.1.20:5060;branch=z9hG4bK74bf9;received=192.0.2.10;rport=40112')!;
    expect(v).toMatchObject({ host: '192.168.1.20', port: 5060, received: '192.0.2.10', rport: '40112' });
    expect(responseTarget(v)).toEqual({ host: '192.0.2.10', port: 40112, rule: 'received + rport' });
  });

  it('uses received with the sent-by port, then sent-by, and port 5060 by default', () => {
    expect(responseTarget(parseVia('SIP/2.0/UDP pc33.atlanta.example;branch=z9hG4bK1;received=192.0.2.10')!))
      .toEqual({ host: '192.0.2.10', port: 5060, rule: 'received' });
    expect(responseTarget(parseVia('SIP/2.0/UDP 198.51.100.10:5070;branch=z9hG4bK2')!))
      .toEqual({ host: '198.51.100.10', port: 5070, rule: 'sent-by' });
  });

  it('reads an rport with no value, and keeps TCP responses on the connection', () => {
    expect(parseVia('SIP/2.0/UDP 10.0.0.5:5060;rport;branch=z9hG4bK3')!.rport).toBe('');
    expect(responseTarget(parseVia('SIP/2.0/TCP 10.0.0.5:5060;branch=z9hG4bK4;received=192.0.2.7')!).rule).toBe('connection');
  });
});

describe('requests inside a dialog (RFC 3261 §12.2.1.1)', () => {
  it('sends to the remote target, with the route set as Route, when the first route is loose', () => {
    expect(inDialogTarget(['sip:p1.example;lr', 'sip:p2.example;lr'], 'sip:bob@192.0.2.4'))
      .toEqual({ requestUri: 'sip:bob@192.0.2.4', route: ['sip:p1.example;lr', 'sip:p2.example;lr'], strict: false });
    expect(inDialogTarget([], 'sip:bob@192.0.2.4')).toEqual({ requestUri: 'sip:bob@192.0.2.4', route: [], strict: false });
  });

  it('builds the strict-routing example of §12.2.1.1', () => {
    expect(inDialogTarget(['sip:proxy1', 'sip:proxy2', 'sip:proxy3;lr', 'sip:proxy4'], 'sip:user@remoteua')).toEqual({
      requestUri: 'sip:proxy1', route: ['sip:proxy2', 'sip:proxy3;lr', 'sip:proxy4', 'sip:user@remoteua'], strict: true,
    });
  });
});

describe('routing visualiser: one call across Proxy A and Proxy B', () => {
  it.each(trapezoidOptions())('passes every protocol and diagram check: %o', async o => {
    const call = trapezoidCall(o);
    const flow = await prepareFlow(call.flow);
    expect(flow.steps.every(s => s.parsed)).toBe(true);
    // A Record-Route without lr is the point of the strict examples; nothing else may fail.
    const allowed = o.lrA === false || o.lrB === false ? ['record-route-lr'] : [];
    expect(lintFlow(flow).filter(i => !allowed.includes(i.rule))).toEqual([]);
    expect(lintDiagram(flow, glossaryTerms()).filter(i => i.severity === 'error')).toEqual([]);
  });

  const path = (rrA: boolean, rrB: boolean, later: LaterRequest, by: Party = 'alice') => {
    const c = trapezoidCall({ rrA, rrB, later, by });
    return c.parts.focus.map(i => c.flow.steps[i]!).map(s => `${s.from}>${s.to}`).join(' ');
  };

  it('keeps only the proxies that record-route in the path of later requests', () => {
    expect(path(false, false, 'bye')).toBe('alice>bob');
    expect(path(true, false, 'bye')).toBe('alice>proxyA proxyA>bob');
    expect(path(false, true, 'ack')).toBe('alice>proxyB proxyB>bob');
    expect(path(true, true, 'reinvite', 'bob')).toBe('bob>proxyB proxyB>proxyA proxyA>alice');
    expect(path(true, true, 'reinvite', 'alice')).toBe('alice>proxyA proxyA>proxyB proxyB>bob');
    expect(path(true, true, 'bye', 'bob')).toBe('bob>proxyB proxyB>proxyA proxyA>alice');
    expect(path(false, true, 'bye', 'bob')).toBe('bob>proxyB proxyB>alice');
  });

  it('sends the CANCEL along the INVITE path, whatever the Record-Route', async () => {
    expect(path(false, false, 'cancel')).toBe('alice>proxyA proxyA>proxyB proxyB>bob');
    const c = trapezoidCall({ rrA: false, rrB: false, later: 'cancel' });
    const flow = await prepareFlow(c.flow);
    // Each CANCEL has the Request-URI, Route, and top Via of the INVITE on its hop.
    c.parts.focus.forEach((ci, j) => {
      const cancel = flow.steps[ci]!.parsed!, inv = flow.steps[c.parts.invite[j]!]!.parsed!;
      expect(cancel.requestUri).toBe(inv.requestUri);
      expect(getHeaders(cancel, 'Route').map(h => h.value)).toEqual(getHeaders(inv, 'Route').map(h => h.value));
      expect(viaList(cancel).map(v => v.raw)).toEqual([viaList(inv)[0]!.raw]);
    });
    expect(flow.steps[c.parts.answer[0]!]!.label).toBe('180 Ringing');
    expect(c.parts.ack).toEqual([]);
  });

  it('gives the caller the reversed Record-Route list, and the callee the list in order', async () => {
    const c = trapezoidCall({ rrA: true, rrB: true, later: 'bye' });
    expect(c.routeSets).toEqual({
      alice: ['sip:proxy.atlanta.example;lr', 'sip:proxy.biloxi.example;lr'],
      bob: ['sip:proxy.biloxi.example;lr', 'sip:proxy.atlanta.example;lr'],
    });
    const flow = await prepareFlow(c.flow);
    // The INVITE that reaches Bob: three Vias, Max-Forwards 68, Bob's Contact as Request-URI.
    const atBob = flow.steps[c.parts.invite.at(-1)!]!.parsed!;
    expect(viaList(atBob)).toHaveLength(3);
    expect(getHeader(atBob, 'Max-Forwards')).toBe('68');
    expect(atBob.requestUri).toBe('sip:bob@203.0.113.20:5060');
    // The BYE leaves Proxy A with one Route left, and Proxy B sends it with none.
    const bye = c.parts.focus.map(i => flow.steps[i]!.parsed!);
    expect(bye.map(m => getHeaders(m, 'Route').length)).toEqual([2, 1, 0]);
  });

  it('routes through a strict router, and the strict router repairs the request', async () => {
    const c = trapezoidCall({ rrA: true, rrB: true, lrB: false, later: 'bye' });
    expect(c.routeSets.alice).toEqual(['sip:proxy.atlanta.example;lr', 'sip:proxy.biloxi.example']);
    const flow = await prepareFlow(c.flow);
    const bye = c.parts.focus.map(i => flow.steps[i]!.parsed!);
    const routes = (m: typeof bye[number]) => getHeaders(m, 'Route').map(h => h.value);
    // Alice: loose first route, so Bob's Contact is the Request-URI.
    expect(bye[0]!.requestUri).toBe('sip:bob@203.0.113.20:5060');
    // Proxy A sees no lr on Proxy B: Proxy B's URI goes in the Request-URI, Bob's Contact to the end of Route.
    expect(bye[1]!.requestUri).toBe('sip:proxy.biloxi.example');
    expect(routes(bye[1]!)).toEqual(['<sip:bob@203.0.113.20:5060>']);
    // Proxy B finds itself in the Request-URI and moves the last Route back.
    expect(bye[2]!.requestUri).toBe('sip:bob@203.0.113.20:5060');
    expect(routes(bye[2]!)).toEqual([]);
    expect(path(true, true, 'bye')).toBe('alice>proxyA proxyA>proxyB proxyB>bob');
  });

  it('sends a strict-routed request from the UA when the first route has no lr', async () => {
    const c = trapezoidCall({ rrA: true, rrB: true, lrA: false, lrB: false, later: 'bye' });
    const flow = await prepareFlow(c.flow);
    const bye = c.parts.focus.map(i => flow.steps[i]!.parsed!);
    expect(bye.map(m => m.requestUri)).toEqual(['sip:proxy.atlanta.example', 'sip:proxy.biloxi.example', 'sip:bob@203.0.113.20:5060']);
    expect(c.parts.focus.map(i => `${c.flow.steps[i]!.from}>${c.flow.steps[i]!.to}`).join(' ')).toBe('alice>proxyA proxyA>proxyB proxyB>bob');
  });

  it('sends the BYE to the new Contact after a target refresh, through the same route set', async () => {
    const c = trapezoidCall({ rrA: true, rrB: true, later: 'refresh', by: 'bob' });
    const flow = await prepareFlow(c.flow);
    const bye = flow.steps[c.parts.focus[0]!]!.parsed!;
    expect(bye.method).toBe('BYE');
    expect(bye.requestUri).toBe('sip:bob@203.0.113.21:5060');
    expect(getHeaders(bye, 'Route').map(h => h.value.replace(/[<>]/g, ''))).toEqual(c.routeSets.alice);
    expect(path(true, true, 'refresh', 'bob')).toBe('alice>proxyA proxyA>proxyB proxyB>bob');
  });
});

describe('routing checks in lint-flow', () => {
  it('finds a Record-Route without lr, and accepts the strict-routed BYE that follows', async () => {
    const issues = lintFlow(await loadFlow('rr-missing-lr'));
    expect([...new Set(issues.map(i => i.rule))]).toEqual(['record-route-lr']);
  });

  it('finds a response whose Via headers differ from its request, and a Max-Forwards that does not go down', async () => {
    const c = trapezoidCall({ rrA: false, rrB: false, later: 'ack' });
    const ok = c.parts.answer[1]!;
    c.flow.steps[ok]!.message = c.flow.steps[ok]!.message!.replace(/^Via: .*\n/m, '');
    const fwd = c.parts.invite[1]!;
    c.flow.steps[fwd]!.message = c.flow.steps[fwd]!.message!.replace('Max-Forwards: 69', 'Max-Forwards: 70');
    const rules = lintFlow(await prepareFlow(c.flow)).map(i => i.rule);
    expect(rules).toContain('response-via');
    expect(rules).toContain('max-forwards');
  });
});
