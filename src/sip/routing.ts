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

export type LaterRequest = 'ack' | 'reinvite' | 'bye' | 'cancel' | 'refresh';
export type Party = 'alice' | 'bob';

export const LATER_REQUESTS: LaterRequest[] = ['ack', 'reinvite', 'bye', 'cancel', 'refresh'];

/** Only the caller sends the ACK for the first 2xx and the CANCEL. */
export const callerOnly = (later: LaterRequest) => later === 'ack' || later === 'cancel';

export interface TrapezoidOptions {
  /** Proxy A adds Record-Route. */
  rrA: boolean;
  /** Proxy B adds Record-Route. */
  rrB: boolean;
  /** Proxy A's Record-Route URI has lr. Default true; false makes it a strict router. */
  lrA?: boolean;
  /** Proxy B's Record-Route URI has lr. Default true. */
  lrB?: boolean;
  /** The request to follow after the call is set up (or, for CANCEL, while Bob's phone rings). */
  later: LaterRequest;
  /** Who sends the re-INVITE or BYE; for a target refresh, who moves. Default Alice. */
  by?: Party;
}

export interface TrapezoidCall {
  flow: FlowData;
  /**
   * Indexes of the steps of each part. `answer` is the 200 OK, or the 180 Ringing
   * before a CANCEL. `focus` holds the request hops of the later request to show.
   */
  parts: { invite: number[]; answer: number[]; ack: number[]; later: number[]; focus: number[] };
  /** Name of the focus request, such as "BYE from Bob". */
  focusTitle: string;
  /** What the focus request follows, such as "Bob's route set". */
  focusRule: string;
  routeSets: { alice: string[]; bob: string[] };
}

/** Every distinct combination of the visualiser's controls. */
export function trapezoidOptions(): TrapezoidOptions[] {
  const out: TrapezoidOptions[] = [];
  for (const rrA of [false, true]) for (const rrB of [false, true]) {
    for (const lrA of rrA ? [true, false] : [true]) for (const lrB of rrB ? [true, false] : [true]) {
      for (const later of LATER_REQUESTS) {
        for (const by of callerOnly(later) ? ['alice' as const] : (['alice', 'bob'] as const)) out.push({ rrA, rrB, lrA, lrB, later, by });
      }
    }
  }
  return out;
}

type NodeId = 'alice' | 'proxyA' | 'proxyB' | 'bob';

interface Node {
  label: string;
  addr: string;
  /** UAs: the address after a move to another network (target refresh). */
  moved?: string;
  /** Proxies: the host name in Record-Route and Route. */
  host?: string;
  /** Proxies: the domain this proxy serves. */
  domain?: string;
  contact?: string;
}

const NODES: Record<NodeId, Node> = {
  alice: { label: 'Alice', addr: '192.0.2.10', moved: '192.0.2.11', contact: 'sip:alice@192.0.2.10:5060' },
  proxyA: { label: 'Proxy A', addr: '198.51.100.10', host: 'proxy.atlanta.example', domain: 'atlanta.example' },
  proxyB: { label: 'Proxy B', addr: '203.0.113.10', host: 'proxy.biloxi.example', domain: 'biloxi.example' },
  bob: { label: 'Bob', addr: '203.0.113.20', moved: '203.0.113.21', contact: 'sip:bob@203.0.113.20:5060' },
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
    if (h === n.addr || h === n.moved || h === n.host || h === n.domain) return id;
  }
  throw new Error(`No element for ${uri}`);
}

const nameOf = (uri: string) => NODES[resolve(uri)].label;

/** True if the URI names a proxy itself: a strict-routed request carries it in the Request-URI. */
const isProxyUri = (uri: string) => hostOf(uri) === NODES.proxyA.host || hostOf(uri) === NODES.proxyB.host;

/**
 * The next hop of a request (RFC 3261 §8.1.2, §16.6 item 7): the Request-URI when it
 * names a strict router, else the first Route, else the Request-URI.
 */
const nextHop = (r: { ruri: string; route: string[] }) => resolve(!isProxyUri(r.ruri) && r.route[0] ? r.route[0] : r.ruri);

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

const sdp = (user: Party, version: number, dir?: string, ip = NODES[user].addr) => {
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
const other = (p: Party): Party => (p === 'alice' ? 'bob' : 'alice');

/**
 * Builds one call across Proxy A and Proxy B, then a request inside the dialog
 * (or a CANCEL before the answer). Each proxy follows RFC 3261 §16: it repairs a
 * strict-routed Request-URI, removes its own Route entry, replaces a Request-URI
 * in its domain with the Contact from the location service, decrements
 * Max-Forwards, adds Record-Route if it wants to, rewrites the request for a
 * strict router next, and adds its Via. Responses go back along the Via headers;
 * each proxy removes its own.
 */
export function trapezoidCall(o: TrapezoidOptions): TrapezoidCall {
  const steps: FlowStep[] = [];
  let n = 0;
  const branch = (who: NodeId) => `z9hG4bK${who === 'alice' ? 'a' : who === 'bob' ? 'b' : who === 'proxyA' ? 'pa' : 'pb'}${(++n).toString(36)}${n * 7 % 10}f`;
  const via = (who: NodeId, addr = NODES[who].addr) => `SIP/2.0/UDP ${addr}:5060;branch=${branch(who)}`;
  const rrOn: Partial<Record<NodeId, boolean>> = { proxyA: o.rrA, proxyB: o.rrB };
  const lrOn: Partial<Record<NodeId, boolean>> = { proxyA: o.lrA ?? true, proxyB: o.lrB ?? true };
  const by: Party = callerOnly(o.later) ? 'alice' : o.by ?? 'alice';
  const push = (from: NodeId, to: NodeId, label: string, caption: string, message: string, rfc?: string) => {
    steps.push({ from, to, label, caption, message, ...(rfc ? { rfc } : {}) });
    return steps.length - 1;
  };

  type Hop = { from: NodeId; to: NodeId; req: Req; index: number };

  /** Sends a request from a UA, then lets each proxy forward it until it reaches a UA. Returns the hops. */
  function send(from: NodeId, req: Req, label: string, firstCaption: string, rfc?: string): Hop[] {
    const hops: Hop[] = [];
    let at: NodeId = from;
    let cur = req;
    let caption = firstCaption;
    let ref = rfc;
    for (;;) {
      const next = nextHop(cur);
      const index = push(at, next, label, caption, renderReq(cur), ref);
      hops.push({ from: at, to: next, req: cur, index });
      if (next === 'alice' || next === 'bob') return hops;
      // Proxy processing (RFC 3261 §16.4, §16.5, §16.6).
      const p = NODES[next];
      const copy: Req = { ...cur, via: [...cur.via], route: [...cur.route], rr: [...cur.rr], mf: cur.mf - 1 };
      const said: string[] = [];
      ref = undefined;
      if (hostOf(copy.ruri) === p.host && copy.route.length) {
        copy.ruri = copy.route.pop()!;
        said.push('repairs the strict-routed Request-URI');
        ref = 'rfc3261-16.4-strict';
      }
      if (copy.route[0] && resolve(copy.route[0]) === next) { copy.route.shift(); said.push('removes its Route entry'); }
      if (hostOf(copy.ruri) === p.domain) {
        copy.ruri = NODES[resolve(copy.ruri) === 'proxyA' ? 'alice' : 'bob'].contact!;
        said.push('finds the Contact in the location service');
      }
      const creates = req.method === 'INVITE' && !/;tag=/.test(req.to);
      if (creates && rrOn[next]) {
        copy.rr.unshift(`sip:${p.host}${lrOn[next] ? ';lr' : ''}`);
        said.push(lrOn[next] ? 'adds Record-Route' : 'adds Record-Route without lr');
        ref = lrOn[next] ? 'rfc3261-16.6-record-route' : 'rfc3261-16.6-lr';
      }
      if (copy.route[0] && !isLoose(copy.route[0])) {
        // Item 6 of §16.6: format the request the way a strict router expects it.
        const strict = copy.route.shift()!;
        copy.route.push(copy.ruri);
        copy.ruri = strict;
        said.push('rewrites the request for the strict router');
        ref = 'rfc3261-16.6-strict-next';
      }
      copy.via.unshift(via(next));
      said.push('adds its Via');
      const target = isProxyUri(copy.ruri) && copy.route.length ? `${nameOf(copy.ruri)}, the strict router in the Request-URI`
        : copy.route[0] ? `${nameOf(copy.route[0])}, the first Route` : nameOf(copy.ruri);
      const list = said.length > 1 ? `${said.slice(0, -1).join(', ')} and ${said.at(-1)}` : said[0]!;
      caption = `${p.label} ${list}. It sends the ${label} to ${target}.`;
      at = next;
      cur = copy;
    }
  }

  /** Sends a response back along the Via headers of the request hops. */
  function answer(hops: Hop[], make: (req: Req) => Res, label: string, firstCaption: string, rfc?: string) {
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
  const aliceRoute = bobRoute.slice().reverse();
  const toTagged = `${bobUri};tag=8c41d2`;
  const okRR = bobRoute.length ? ' and the Record-Route headers' : '';

  /** The dialog state of each side (RFC 3261 §12.1). */
  const side = {
    alice: { tagged: invite.from, routeSet: aliceRoute, target: NODES.bob.contact!, contact: NODES.alice.contact!, addr: NODES.alice.addr, seq: 1, version: 2890844526 },
    bob: { tagged: toTagged, routeSet: bobRoute, target: NODES.alice.contact!, contact: NODES.bob.contact!, addr: NODES.bob.addr, seq: 4710, version: 2808844564 },
  };

  /** One sentence on the route set of a request inside the dialog, and the quote that explains it. */
  function routeCaption(from: Party, what: string): [string, string] {
    const s = side[from];
    const name = NODES[from].label, peer = NODES[other(from)].label;
    const What = `${what[0]!.toUpperCase()}${what.slice(1)}`;
    if (!s.routeSet.length) return [`${name}'s route set is empty, so ${what} goes straight to ${peer}'s Contact.`, 'rfc3261-12.2.1.1-empty'];
    if (!isLoose(s.routeSet[0]!)) {
      const first = nameOf(s.routeSet[0]!);
      return [`${first}'s URI has no lr, so ${what} is strict-routed: ${first}'s URI is the Request-URI.`, 'rfc3261-12.2.1.1-strict'];
    }
    return from === 'bob'
      ? [`${What} follows Bob's route set, Record-Route in order: ${listNames(s.routeSet)}, then ${peer}.`, 'rfc3261-12.1.1-route-set']
      : [`${What} follows Alice's route set: ${listNames(s.routeSet)}, then ${peer}.`, 'rfc3261-12.2.1.1-loose'];
  }

  /** A request inside the dialog: to the remote target, along the sender's route set (RFC 3261 §12.2.1.1). */
  function inDialog(from: Party, method: string, caption: string, rfc: string, more: Partial<Req> = {}) {
    const s = side[from];
    const t = inDialogTarget(s.routeSet, s.target);
    const seq = method === 'ACK' ? s.seq : ++s.seq;
    return send(from, {
      method, ruri: t.requestUri, via: [via(from, s.addr)], route: t.route, rr: [], mf: 70,
      from: s.tagged, to: side[other(from)].tagged, callId, cseq: `${seq} ${method}`, ...more,
    }, method, caption, rfc);
  }

  /** A re-INVITE, its 200 OK, and the ACK. With `moveTo`, the sender moves to that address first (a target refresh). */
  function reInvite(from: Party, intro: string, moveTo?: string) {
    const s = side[from], peer = side[other(from)];
    if (moveTo) { s.addr = moveTo; s.contact = `sip:${from}@${moveTo}:5060`; }
    const [route, rfc] = routeCaption(from, 'the re-INVITE');
    const hops = inDialog(from, 'INVITE', `${intro} ${route}`, moveTo ? 'rfc3261-12.2-target-refresh' : rfc,
      { contact: s.contact, sdp: sdp(from, ++s.version, moveTo ? undefined : 'sendonly', s.addr) });
    if (moveTo) peer.target = s.contact;
    const peerSdp = sdp(other(from), ++peer.version, moveTo ? undefined : 'recvonly', peer.addr);
    const back = answer(hops, r => ({
      status: '200 OK', via: r.via, rr: [], from: r.from, to: r.to, callId, cseq: r.cseq, contact: peer.contact, sdp: peerSdp,
    }), '200 OK', moveTo
      ? `${NODES[other(from)].label} accepts, and takes ${s.contact} as the new remote target.`
      : `${NODES[other(from)].label} accepts the hold. The 200 OK follows the Via headers of the re-INVITE.`);
    const ack = inDialog(from, 'ACK', `${NODES[from].label} ACKs the 200 OK along the same route set.`, rfc);
    return { hops, all: [...hops.map(h => h.index), ...back, ...ack.map(h => h.index)] };
  }

  /** A BYE and its 200 OK. `caption` replaces the sentence on the route set. */
  function bye(from: Party, intro: string, caption?: [string, string]) {
    const [route, rfc] = caption ?? routeCaption(from, 'the BYE');
    const hops = inDialog(from, 'BYE', `${intro} ${route}`, rfc);
    const back = answer(hops, r => ({ status: '200 OK', via: r.via, rr: [], from: r.from, to: r.to, callId, cseq: r.cseq }), '200 OK',
      `${NODES[other(from)].label} ends the call. The 200 OK follows the Via headers of the BYE.`);
    return { hops, all: [...hops.map(h => h.index), ...back] };
  }

  const name = NODES[by].label, peerName = NODES[other(by)].label;
  let answerSteps: number[];
  let ack: number[] = [];
  let later: number[];
  let focus: number[];
  let focusTitle: string;
  let focusRule: string;

  if (o.later === 'cancel') {
    // 2. Bob's phone rings: the 180 makes an early dialog with the same route set (RFC 3261 §12.1).
    answerSteps = answer(inviteHops, r => ({
      status: '180 Ringing', via: r.via, rr: bobRoute, from: r.from, to: toTagged, callId, cseq: r.cseq, contact: NODES.bob.contact,
    }), '180 Ringing', `Bob's phone rings. The 180 has a To tag and copies the Via${bobRoute.length ? ' and Record-Route' : ''} headers, so Alice has an early dialog.`);
    // 3. The CANCEL retraces the INVITE, hop by hop (RFC 3261 §9.1); each hop answers it and ends its INVITE with 487.
    later = [];
    focus = [];
    inviteHops.forEach((h, j) => {
      const from = NODES[h.from].label;
      const caption = j === 0
        ? 'Alice hangs up before Bob answers. Her CANCEL copies the Request-URI, Route, and branch of her INVITE, not the route set.'
        : `${from} sends its own CANCEL on its own hop, with the Request-URI, Route, and branch of its INVITE.`;
      const i = push(h.from, h.to, 'CANCEL', caption, renderReq({
        method: 'CANCEL', ruri: h.req.ruri, via: [h.req.via[0]!], route: h.req.route, rr: [], mf: 70,
        from: h.req.from, to: h.req.to, callId, cseq: '1 CANCEL',
      }), j === 0 ? 'rfc3261-9.1-cancel-route' : undefined);
      focus.push(i);
      later.push(i, push(h.to, h.from, '200 OK (CANCEL)', h.to === 'bob' ? "Bob's phone stops ringing and answers the CANCEL."
        : `${NODES[h.to].label} answers the CANCEL itself. A CANCEL travels hop by hop.`, renderRes({
        status: '200 OK', via: [h.req.via[0]!], rr: [], from: h.req.from, to: toTagged, callId, cseq: '1 CANCEL',
      }), j === 0 ? 'rfc3261-9-hop-by-hop' : undefined));
    });
    for (let j = inviteHops.length - 1; j >= 0; j--) {
      const h = inviteHops[j]!;
      const last = j === inviteHops.length - 1;
      later.push(push(h.to, h.from, '487 Request Terminated', last ? "Bob's phone ends the INVITE transaction with 487."
        : `${NODES[h.to].label} removes its own Via and forwards the 487.`, renderRes({
        status: '487 Request Terminated', via: h.req.via, rr: [], from: h.req.from, to: toTagged, callId, cseq: '1 INVITE',
      }), last ? 'rfc3261-9.2-487' : undefined));
      later.push(push(h.from, h.to, 'ACK', j === 0 ? "Alice's phone confirms the 487. The ACK reuses the INVITE branch."
        : `${NODES[h.from].label} confirms the 487 on its own hop, with the branch of its INVITE.`, renderReq({
        method: 'ACK', ruri: h.req.ruri, via: [h.req.via[0]!], route: h.req.route, rr: [], mf: 70,
        from: h.req.from, to: toTagged, callId, cseq: '1 ACK',
      }), last ? 'rfc3261-17.1.1.3-ack-via' : undefined));
    }
    focusTitle = 'CANCEL from Alice';
    focusRule = "the INVITE's hops";
  } else {
    // 2. Bob answers. The 200 OK goes back along the Via headers.
    answerSteps = answer(inviteHops, r => ({
      status: '200 OK', via: r.via, rr: bobRoute, from: r.from, to: toTagged, callId, cseq: r.cseq, contact: NODES.bob.contact, sdp: sdp('bob', 2808844564),
    }), '200 OK', `Bob answers. The 200 OK copies the Via headers${okRR} of the INVITE.`);

    // 3. The ACK, built from Alice's dialog state (RFC 3261 §12.2.1.1, §13.2.2.4).
    const [route, rfc] = routeCaption('alice', 'the ACK');
    ack = inDialog('alice', 'ACK', route, rfc).map(h => h.index);
    later = ack;
    focus = ack;
    focusTitle = 'ACK';
    focusRule = "Alice's route set";

    // 4. The later request.
    if (o.later === 'bye') {
      const b = bye(by, `${name} hangs up.`);
      later = b.all;
      focus = b.hops.map(h => h.index);
      focusTitle = `BYE from ${name}`;
      focusRule = `${name}'s route set`;
    } else if (o.later === 'reinvite') {
      const r = reInvite(by, `${name} puts ${peerName} on hold.`);
      later = r.all;
      focus = r.hops.map(h => h.index);
      focusTitle = `re-INVITE from ${name}`;
      focusRule = `${name}'s route set`;
    } else if (o.later === 'refresh') {
      const moveTo = NODES[by].moved!;
      const r = reInvite(by, `${name}'s phone moves to ${moveTo}, and its re-INVITE carries the new Contact.`, moveTo);
      const set = side[other(by)].routeSet;
      const b = bye(other(by), `${peerName} hangs up.`, [set.length
        ? `The BYE goes to ${name}'s new Contact, along the same route set: ${listNames(set)}.`
        : `The BYE goes straight to ${name}'s new Contact: the route set is still empty.`, 'rfc3261-12.2-route-set-fixed']);
      later = [...r.all, ...b.all];
      focus = b.hops.map(h => h.index);
      focusTitle = `BYE after ${name} moves`;
      focusRule = `${peerName}'s route set, to the new Contact`;
    }
  }

  const on = (b: boolean) => (b ? 'on' : 'off');
  const lr = (id: NodeId) => (rrOn[id] ? (lrOn[id] ? '' : '-strict') : '');
  return {
    flow: {
      id: `trapezoid-${on(o.rrA)}${lr('proxyA')}-${on(o.rrB)}${lr('proxyB')}-${o.later}-${by}`,
      title: `Record-Route: Proxy A ${on(o.rrA)}, Proxy B ${on(o.rrB)}`,
      lanes: TRAPEZOID_LANES,
      steps,
    },
    parts: { invite: inviteHops.map(h => h.index), answer: answerSteps, ack, later, focus },
    focusTitle,
    focusRule,
    routeSets: { alice: aliceRoute, bob: bobRoute },
  };
}
