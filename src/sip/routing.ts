/**
 * Routing (Module 10): where requests and responses go next.
 *  - Responses follow Via (RFC 3261 §18.2.2, RFC 3581 §4).
 *  - Requests inside a dialog follow the route set (RFC 3261 §12.2.1.1).
 *  - Proxies add and remove Via, Record-Route, and Route (RFC 3261 §16.4, §16.6, §16.7).
 * Used by the routing visualiser, the Via stack, and the checks in lint-flow.ts.
 */
import type { FlowData, FlowStep, Lane } from './flow.ts';
import { getHeaders, headerParam, type SipMessage } from './parse.ts';

/* ------------------------------------------------------------------ */
/* Via                                                                 */
/* ------------------------------------------------------------------ */

export interface ViaValue {
  transport: string;
  host: string;
  port?: number;
  branch?: string;
  received?: string;
  /** undefined: no rport; '': rport with no value (the sender asks for it); else the port. */
  rport?: string;
  raw: string;
}

export function parseVia(raw: string): ViaValue | undefined {
  const m = /^SIP\s*\/\s*2\.0\s*\/\s*(\S+)\s+([^;\s]+)(.*)$/i.exec(raw.trim());
  if (!m) return undefined;
  const sentBy = m[2]!;
  const hp = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(sentBy);
  const params = m[3] ?? '';
  const rport = /;\s*rport\s*(?:=\s*(\d+))?(?=;|$)/i.exec(params);
  return {
    transport: m[1]!.toUpperCase(),
    host: hp?.[1] ?? sentBy,
    port: hp?.[2] ? Number(hp[2]) : undefined,
    branch: headerParam(params, 'branch'),
    received: headerParam(params, 'received'),
    rport: rport ? rport[1] ?? '' : undefined,
    raw: raw.trim(),
  };
}

/** Every Via value of a message, top first (rows and comma-separated values). */
export function viaList(msg: SipMessage): ViaValue[] {
  return getHeaders(msg, 'Via').flatMap(h => h.value.split(',')).map(parseVia).filter((v): v is ViaValue => !!v);
}

export interface ResponseTarget {
  host: string;
  port: number;
  /** Which rule chose the address. */
  rule: 'connection' | 'received + rport' | 'received' | 'sent-by';
}

/**
 * Where a server sends a response, from the top Via (RFC 3261 §18.2.2, RFC 3581 §4).
 * For TCP and TLS the response uses the connection the request came on.
 */
export function responseTarget(via: ViaValue): ResponseTarget {
  const port = via.port ?? (via.transport === 'TLS' ? 5061 : 5060);
  if (via.transport !== 'UDP') return { host: via.received ?? via.host, port, rule: 'connection' };
  if (via.received && via.rport) return { host: via.received, port: Number(via.rport), rule: 'received + rport' };
  if (via.received) return { host: via.received, port, rule: 'received' };
  return { host: via.host, port, rule: 'sent-by' };
}

/* ------------------------------------------------------------------ */
/* Route set                                                           */
/* ------------------------------------------------------------------ */

/** True if the URI has the lr parameter: the element is a loose router (RFC 3261 §19.1.1). */
export const isLoose = (uri: string) => /;\s*lr(?=[;?>\s]|=|$)/i.test(uri);

/** URI parameters that RFC 3261 §19.1.1 (Table 1) does not allow in a Request-URI. */
const NOT_IN_REQUEST_URI = ['method'];

export interface InDialogTarget {
  requestUri: string;
  route: string[];
  /** The first element of the route set is a strict router. */
  strict: boolean;
}

/** The Request-URI and Route of a request inside a dialog (RFC 3261 §12.2.1.1). */
export function inDialogTarget(routeSet: string[], remoteTarget: string): InDialogTarget {
  if (!routeSet.length) return { requestUri: remoteTarget, route: [], strict: false };
  if (isLoose(routeSet[0]!)) return { requestUri: remoteTarget, route: [...routeSet], strict: false };
  let first = routeSet[0]!.replace(/\?.*$/, '');
  for (const p of NOT_IN_REQUEST_URI) first = first.replace(new RegExp(`;\\s*${p}=[^;]*`, 'ig'), '');
  return { requestUri: first, route: [...routeSet.slice(1), remoteTarget], strict: true };
}

/* ------------------------------------------------------------------ */
/* Routing visualiser: one call across the SIP trapezoid               */
/* ------------------------------------------------------------------ */

export type LaterRequest = 'ack' | 'bye' | 'reinvite';

export interface TrapezoidOptions {
  /** Proxy A adds Record-Route. */
  rrA: boolean;
  /** Proxy B adds Record-Route. */
  rrB: boolean;
  /** The request inside the dialog to follow after the call is set up. */
  later: LaterRequest;
}

export interface TrapezoidCall {
  flow: FlowData;
  /** Indexes of the steps of each part. */
  parts: { invite: number[]; ok: number[]; ack: number[]; later: number[] };
  routeSets: { alice: string[]; bob: string[] };
}

type NodeId = 'alice' | 'proxyA' | 'proxyB' | 'bob';

interface Node {
  label: string;
  addr: string;
  /** Proxies: the host name in Record-Route and Route. */
  host?: string;
  /** Proxies: the domain this proxy serves. */
  domain?: string;
  contact?: string;
}

const NODES: Record<NodeId, Node> = {
  alice: { label: 'Alice', addr: '192.0.2.10', contact: 'sip:alice@192.0.2.10:5060' },
  proxyA: { label: 'Proxy A', addr: '198.51.100.10', host: 'proxy.atlanta.example', domain: 'atlanta.example' },
  proxyB: { label: 'Proxy B', addr: '203.0.113.10', host: 'proxy.biloxi.example', domain: 'biloxi.example' },
  bob: { label: 'Bob', addr: '203.0.113.20', contact: 'sip:bob@203.0.113.20:5060' },
};

export const TRAPEZOID_LANES: Lane[] = [
  { id: 'alice', label: 'Alice', kind: 'ua', sub: NODES.alice.addr },
  { id: 'proxyA', label: 'Proxy A', kind: 'proxy', sub: NODES.proxyA.host },
  { id: 'proxyB', label: 'Proxy B', kind: 'proxy', sub: NODES.proxyB.host },
  { id: 'bob', label: 'Bob', kind: 'ua', sub: NODES.bob.addr },
];

const hostOf = (uri: string) => /^sips?:(?:[^@;>]*@)?(\[[^\]]+\]|[^:;>?]+)/i.exec(uri)?.[1] ?? '';

/** DNS and the location service, in one table: the element a URI leads to. */
function resolve(uri: string): NodeId {
  const h = hostOf(uri);
  for (const [id, n] of Object.entries(NODES) as [NodeId, Node][]) {
    if (h === n.addr || h === n.host || h === n.domain) return id;
  }
  throw new Error(`No element for ${uri}`);
}

const nameOf = (uri: string) => NODES[resolve(uri)].label;

interface Req {
  method: string;
  ruri: string;
  via: string[];
  route: string[];
  rr: string[];
  mf: number;
  from: string;
  to: string;
  callId: string;
  cseq: string;
  contact?: string;
  sdp?: string;
}

interface Res {
  status: string;
  via: string[];
  rr: string[];
  from: string;
  to: string;
  callId: string;
  cseq: string;
  contact?: string;
  sdp?: string;
}

const sdp = (user: 'alice' | 'bob', version: number, dir?: string) => {
  const ip = NODES[user].addr;
  const id = user === 'alice' ? 2890844526 : 2808844564;
  return [
    'v=0', `o=${user} ${id} ${version} IN IP4 ${ip}`, 's=-', `c=IN IP4 ${ip}`, 't=0 0',
    `m=audio ${user === 'alice' ? 49170 : 3456} RTP/AVP 0`, 'a=rtpmap:0 PCMU/8000', ...(dir ? [`a=${dir}`] : []),
  ].join('\n');
};

function renderReq(r: Req): string {
  return [
    `${r.method} ${r.ruri} SIP/2.0`,
    ...r.via.map(v => `Via: ${v}`),
    `Max-Forwards: ${r.mf}`,
    ...r.route.map(u => `Route: <${u}>`),
    ...r.rr.map(u => `Record-Route: <${u}>`),
    `From: ${r.from}`, `To: ${r.to}`, `Call-ID: ${r.callId}`, `CSeq: ${r.cseq}`,
    ...(r.contact ? [`Contact: <${r.contact}>`] : []),
    ...(r.sdp ? ['Content-Type: application/sdp'] : []),
    'Content-Length: {auto}',
    ...(r.sdp ? ['', r.sdp] : []),
  ].join('\n');
}

function renderRes(r: Res): string {
  return [
    `SIP/2.0 ${r.status}`,
    ...r.via.map(v => `Via: ${v}`),
    ...r.rr.map(u => `Record-Route: <${u}>`),
    `From: ${r.from}`, `To: ${r.to}`, `Call-ID: ${r.callId}`, `CSeq: ${r.cseq}`,
    ...(r.contact ? [`Contact: <${r.contact}>`] : []),
    ...(r.sdp ? ['Content-Type: application/sdp'] : []),
    'Content-Length: {auto}',
    ...(r.sdp ? ['', r.sdp] : []),
  ].join('\n');
}

const listNames = (uris: string[]) => uris.map(nameOf).join(', then ');

/**
 * Builds one call across Proxy A and Proxy B, then a request inside the dialog.
 * Each proxy follows RFC 3261 §16: it removes its own Route entry, replaces a
 * Request-URI in its domain with the Contact from the location service,
 * decrements Max-Forwards, adds Record-Route if it wants to, and adds its Via.
 * Responses go back along the Via headers; each proxy removes its own.
 */
export function trapezoidCall(o: TrapezoidOptions): TrapezoidCall {
  const steps: FlowStep[] = [];
  let n = 0;
  const branch = (who: NodeId) => `z9hG4bK${who === 'alice' ? 'a' : who === 'bob' ? 'b' : who === 'proxyA' ? 'pa' : 'pb'}${(++n).toString(36)}${n * 7 % 10}f`;
  const via = (who: NodeId) => `SIP/2.0/UDP ${NODES[who].addr}:5060;branch=${branch(who)}`;
  const rrOn: Partial<Record<NodeId, boolean>> = { proxyA: o.rrA, proxyB: o.rrB };
  const push = (from: NodeId, to: NodeId, label: string, caption: string, message: string, rfc?: string) => {
    steps.push({ from, to, label, caption, message, ...(rfc ? { rfc } : {}) });
    return steps.length - 1;
  };

  /** Sends a request from a UA, then lets each proxy forward it until it reaches a UA. Returns the hops. */
  function send(from: NodeId, req: Req, label: string, firstCaption: string, rfc?: string) {
    const hops: { from: NodeId; to: NodeId; req: Req; index: number }[] = [];
    let at: NodeId = from;
    let cur = req;
    let caption = firstCaption;
    let ref = rfc;
    for (;;) {
      const next = resolve(cur.route[0] ?? cur.ruri);
      const index = push(at, next, label, caption, renderReq(cur), ref);
      hops.push({ from: at, to: next, req: cur, index });
      if (next === 'alice' || next === 'bob') return hops;
      // Proxy processing (RFC 3261 §16.4, §16.5, §16.6).
      const p = NODES[next];
      const copy: Req = { ...cur, via: [...cur.via], route: [...cur.route], rr: [...cur.rr], mf: cur.mf - 1 };
      const said: string[] = [];
      if (copy.route[0] && resolve(copy.route[0]) === next) { copy.route.shift(); said.push('removes its Route entry'); }
      if (hostOf(copy.ruri) === p.domain) {
        copy.ruri = NODES[resolve(copy.ruri) === 'proxyA' ? 'alice' : 'bob'].contact!;
        said.push('finds the Contact in the location service');
      }
      const creates = req.method === 'INVITE' && !/;tag=/.test(req.to);
      if (creates && rrOn[next]) { copy.rr.unshift(`sip:${p.host};lr`); said.push('adds Record-Route'); }
      copy.via.unshift(via(next));
      said.push('adds its Via');
      const target = copy.route[0] ? `${nameOf(copy.route[0])}, the first Route` : nameOf(copy.ruri);
      const list = said.length > 1 ? `${said.slice(0, -1).join(', ')} and ${said.at(-1)}` : said[0]!;
      caption = `${p.label} ${list}. It sends the ${label} to ${target}.`;
      ref = creates && rrOn[next] ? 'rfc3261-16.6-record-route' : undefined;
      at = next;
      cur = copy;
    }
  }

  /** Sends a response back along the Via headers of the request hops. */
  function answer(hops: { from: NodeId; to: NodeId; req: Req }[], make: (req: Req) => Res, label: string, firstCaption: string, rfc?: string) {
    const out: number[] = [];
    for (let i = hops.length - 1; i >= 0; i--) {
      const h = hops[i]!;
      const res = make(h.req);
      const last = i === 0;
      const caption = i === hops.length - 1 ? firstCaption
        : last ? `${NODES[h.to].label} removes its Via. One Via is left, ${NODES[h.from].label}'s, so the response goes there.`
          : `${NODES[h.to].label} removes its own Via and sends the ${label} to the next Via: ${NODES[h.from].label}.`;
      out.push(push(h.to, h.from, label, caption, renderRes(res), i === hops.length - 1 ? rfc : i === hops.length - 2 ? 'rfc3261-16.7-via-remove' : undefined));
    }
    return out;
  }

  const aliceUri = 'Alice <sip:alice@atlanta.example>';
  const bobUri = 'Bob <sip:bob@biloxi.example>';
  const callId = '7f3a9c21@192.0.2.10';

  // 1. The INVITE, with Alice's outbound proxy as a pre-loaded Route (RFC 3261 §8.1.1.1).
  const invite: Req = {
    method: 'INVITE', ruri: 'sip:bob@biloxi.example', via: [via('alice')], route: ['sip:proxy.atlanta.example;lr'], rr: [], mf: 70,
    from: `${aliceUri};tag=4f2a7e`, to: bobUri, callId, cseq: '1 INVITE', contact: NODES.alice.contact, sdp: sdp('alice', 2890844526),
  };
  const inviteHops = send('alice', invite, 'INVITE', "Alice sends the INVITE to her outbound proxy, Proxy A. The Route header holds Proxy A's URI.");
  const atBob = inviteHops.at(-1)!.req;
  const bobRoute = atBob.rr.slice();
  const toTagged = `${bobUri};tag=8c41d2`;
  const okRR = bobRoute.length ? ' and the Record-Route headers' : '';
  const ok = answer(inviteHops, r => ({
    status: '200 OK', via: r.via, rr: bobRoute, from: r.from, to: toTagged, callId, cseq: r.cseq, contact: NODES.bob.contact, sdp: sdp('bob', 2808844564),
  }), '200 OK', `Bob answers. The 200 OK copies the Via headers${okRR} of the INVITE.`);
  const aliceRoute = bobRoute.slice().reverse();

  // 2. The ACK, built from Alice's dialog state (RFC 3261 §12.2.1.1, §13.2.2.4).
  const aliceT = inDialogTarget(aliceRoute, NODES.bob.contact!);
  const aliceFirst = aliceRoute.length
    ? `Alice's route set is ${listNames(aliceRoute)}. The ACK goes to ${nameOf(aliceRoute[0]!)}, with Bob's Contact as Request-URI.`
    : "No proxy added Record-Route, so Alice's route set is empty. The ACK goes straight to Bob's Contact.";
  const ackHops = send('alice', {
    method: 'ACK', ruri: aliceT.requestUri, via: [via('alice')], route: aliceT.route, rr: [], mf: 70,
    from: invite.from, to: toTagged, callId, cseq: '1 ACK',
  }, 'ACK', aliceFirst, aliceRoute.length ? 'rfc3261-12.2.1.1-loose' : 'rfc3261-12.2.1.1-empty');
  const ack = ackHops.map(h => h.index);

  // 3. The later request.
  let later = ack;
  if (o.later === 'bye') {
    const hops = send('alice', {
      method: 'BYE', ruri: aliceT.requestUri, via: [via('alice')], route: aliceT.route, rr: [], mf: 70,
      from: invite.from, to: toTagged, callId, cseq: '2 BYE',
    }, 'BYE', aliceRoute.length
      ? `Alice hangs up. The BYE follows her route set: ${listNames(aliceRoute)}, then Bob.`
      : 'Alice hangs up. Her route set is empty, so the BYE goes straight to Bob.', aliceRoute.length ? 'rfc3261-12.2.1.1-loose' : 'rfc3261-12.2.1.1-empty');
    const back = answer(hops, r => ({ status: '200 OK', via: r.via, rr: [], from: r.from, to: r.to, callId, cseq: r.cseq }), '200 OK',
      'Bob ends the call. The 200 OK follows the Via headers of the BYE.');
    later = [...hops.map(h => h.index), ...back];
  } else if (o.later === 'reinvite') {
    const bobT = inDialogTarget(bobRoute, NODES.alice.contact!);
    const from = toTagged;
    const hops = send('bob', {
      method: 'INVITE', ruri: bobT.requestUri, via: [via('bob')], route: bobT.route, rr: [], mf: 70,
      from, to: invite.from, callId, cseq: '4711 INVITE', contact: NODES.bob.contact, sdp: sdp('bob', 2808844565, 'sendonly'),
    }, 'INVITE', bobRoute.length
      ? `Bob puts Alice on hold. His route set is ${listNames(bobRoute)}: Record-Route in order, not reversed.`
      : 'Bob puts Alice on hold. His route set is empty, so the re-INVITE goes straight to Alice.', bobRoute.length ? 'rfc3261-12.1.1-route-set' : 'rfc3261-12.2.1.1-empty');
    const back = answer(hops, r => ({
      status: '200 OK', via: r.via, rr: [], from: r.from, to: r.to, callId, cseq: r.cseq, contact: NODES.alice.contact, sdp: sdp('alice', 2890844527, 'recvonly'),
    }), '200 OK', 'Alice accepts the hold. The 200 OK follows the Via headers of the re-INVITE.');
    const ack2 = send('bob', {
      method: 'ACK', ruri: bobT.requestUri, via: [via('bob')], route: bobT.route, rr: [], mf: 70,
      from, to: invite.from, callId, cseq: '4711 ACK',
    }, 'ACK', 'Bob ACKs the 200 OK along his route set.');
    later = [...hops.map(h => h.index), ...back, ...ack2.map(h => h.index)];
  }

  const on = (b: boolean) => (b ? 'on' : 'off');
  return {
    flow: {
      id: `trapezoid-${on(o.rrA)}-${on(o.rrB)}-${o.later}`,
      title: `Record-Route: Proxy A ${on(o.rrA)}, Proxy B ${on(o.rrB)}`,
      lanes: TRAPEZOID_LANES,
      steps,
    },
    parts: { invite: inviteHops.map(h => h.index), ok, ack, later },
    routeSets: { alice: aliceRoute, bob: bobRoute },
  };
}
