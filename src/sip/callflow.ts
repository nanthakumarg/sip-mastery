/**
 * Call flow generator (Module 21). It builds a complete call flow from a few
 * choices: the path (direct, proxies, a redirect, forking), what Bob does,
 * and "what if" options (Record-Route, a 407 challenge, late offer, early
 * media, a lost packet, who hangs up). The flows follow RFC 3665 and RFC 3261.
 * Every combination passes lint-flow.ts and lint-diagram.ts (tests/callflow.test.ts).
 */
import type { FlowData, FlowStep, Lane } from './flow.ts';

export const PATHS = {
  direct: 'Direct',
  proxy: 'One proxy',
  'two-proxies': 'Two proxies',
  redirect: 'Redirect server',
  'fork-parallel': 'Forking: parallel',
  'fork-sequential': 'Forking: sequential',
} as const;
export type CallPath = keyof typeof PATHS;

export const OUTCOMES = {
  answer: 'Answers (200)',
  busy: 'Busy (486)',
  unavailable: 'No answer (480)',
  'no-response': 'No response (408)',
  decline: 'Declines (603)',
  'not-found': 'Not found (404)',
  cancel: 'Alice hangs up (CANCEL)',
} as const;
export type Outcome = keyof typeof OUTCOMES;

export const LOSSES = { none: 'Nothing', invite: 'The INVITE', ok: 'The 200 OK', ack: 'The ACK' } as const;
export type Loss = keyof typeof LOSSES;

export interface CallOptions {
  path: CallPath;
  outcome: Outcome;
  /** The proxies add Record-Route and stay in the path of the dialog. */
  recordRoute: boolean;
  /** Proxy A challenges the first INVITE with 407. */
  auth: boolean;
  /** The INVITE has no SDP: the offer is in the 200 OK and the answer in the ACK. */
  lateOffer: boolean;
  /** Bob sends 183 Session Progress with SDP, and early media, before the final response. */
  earlyMedia: boolean;
  /** One packet is lost on the way, and the timers recover it. */
  lose: Loss;
  hangup: 'alice' | 'bob';
}

export const DEFAULT_CALL: CallOptions = {
  path: 'two-proxies', outcome: 'answer', recordRoute: true, auth: false, lateOffer: false, earlyMedia: false, lose: 'none', hangup: 'alice',
};

const RINGS: Outcome[] = ['answer', 'unavailable', 'decline', 'cancel'];
const NEEDS_PROXY: Outcome[] = ['no-response', 'not-found'];
const isFork = (p: CallPath) => p === 'fork-parallel' || p === 'fork-sequential';
const hasProxy = (p: CallPath) => p !== 'direct' && p !== 'redirect';

/**
 * Applies one change and resolves the conflicts it causes: the option that
 * changed wins, and the other option moves to the nearest valid value.
 * Returns the new options and one note for each option that moved.
 */
export function applyChange(o: CallOptions, change: Partial<CallOptions>): { options: CallOptions; notes: string[] } {
  const n: CallOptions = { ...o, ...change };
  const notes: string[] = [];
  const changed = (k: keyof CallOptions) => k in change;
  const set = <K extends keyof CallOptions>(k: K, v: CallOptions[K], note: string) => {
    if (n[k] !== v) { n[k] = v; notes.push(note); }
  };
  for (let pass = 0; pass < 3; pass++) {
    if (n.auth && n.path !== 'two-proxies') {
      if (changed('auth')) set('path', 'two-proxies', 'Path: two proxies. Proxy A sends the 407.');
      else set('auth', false, '407 challenge: off. Only Proxy A sends it.');
    }
    if (NEEDS_PROXY.includes(n.outcome) && n.path !== 'proxy' && n.path !== 'two-proxies') {
      if (changed('outcome')) set('path', 'proxy', `Path: one proxy. Proxy B sends the ${n.outcome === 'not-found' ? '404' : '408'}.`);
      else set('outcome', 'answer', 'Bob: answers. That response comes from Proxy B.');
    }
    if (isFork(n.path) && n.outcome !== 'answer' && n.outcome !== 'cancel') {
      if (changed('outcome')) set('path', 'proxy', 'Path: one proxy. The forking examples show an answer or a CANCEL.');
      else set('outcome', 'answer', 'Bob: answers. The forking examples show an answer or a CANCEL.');
    }
    if (n.earlyMedia && n.lateOffer) {
      if (changed('earlyMedia')) set('lateOffer', false, 'Late offer: off. A 183 without 100rel cannot carry the offer (Module 22).');
      else set('earlyMedia', false, 'Early media: off. A 183 without 100rel cannot carry the offer (Module 22).');
    }
    if (n.earlyMedia && (!RINGS.includes(n.outcome) || isFork(n.path))) {
      if (changed('earlyMedia')) {
        if (isFork(n.path)) set('path', 'two-proxies', 'Path: two proxies. Forked early media is beyond this example.');
        set('outcome', RINGS.includes(n.outcome) ? n.outcome : 'answer', 'Bob: answers. Early media needs a phone that rings.');
      } else set('earlyMedia', false, 'Early media: off. It needs one phone that rings.');
    }
    if (n.lose !== 'none' && (n.outcome !== 'answer' || isFork(n.path))) {
      if (changed('lose')) {
        if (isFork(n.path)) set('path', 'two-proxies', 'Path: two proxies. The lost packet example has one callee.');
        set('outcome', 'answer', 'Bob: answers. The lost packet is part of an answered call.');
      } else set('lose', 'none', 'Lost packet: none. It is part of an answered call with one callee.');
    }
  }
  return { options: n, notes };
}

/** Options that have no effect in this combination (shown disabled), with the reason. */
export function inactive(o: CallOptions): Partial<Record<'recordRoute' | 'hangup', string>> {
  return {
    ...(hasProxy(o.path) ? {} : { recordRoute: 'There is no proxy on this path.' }),
    ...(o.outcome === 'answer' ? {} : { hangup: 'Only an answered call has a BYE.' }),
  };
}

/** A short id for a combination, e.g. "two-proxies.busy.rr.auth". */
export function callKey(o: CallOptions): string {
  return [o.path, o.outcome, o.recordRoute && hasProxy(o.path) ? 'rr' : '', o.auth ? 'auth' : '', o.lateOffer ? 'late' : '',
    o.earlyMedia ? 'early' : '', o.lose !== 'none' ? `lose-${o.lose}` : '', o.outcome === 'answer' && o.hangup === 'bob' ? 'bob-bye' : '']
    .filter(Boolean).join('.');
}

/** Every valid combination (for the tests). */
export function allCalls(): CallOptions[] {
  const out = new Map<string, CallOptions>();
  for (const path of Object.keys(PATHS) as CallPath[])
    for (const outcome of Object.keys(OUTCOMES) as Outcome[])
      for (const recordRoute of [true, false]) for (const auth of [true, false])
        for (const lateOffer of [true, false]) for (const earlyMedia of [true, false])
          for (const lose of Object.keys(LOSSES) as Loss[]) for (const hangup of ['alice', 'bob'] as const) {
            const o = { path, outcome, recordRoute, auth, lateOffer, earlyMedia, lose, hangup };
            if (applyChange(o, {}).notes.length) continue;
            out.set(callKey(o), o);
          }
  return [...out.values()];
}

/** Every RFC quote id the generator can attach to a step. */
export const CALL_QUOTES = [
  'rfc3261-17.2.1-100', 'rfc3261-16.6-record-route', 'rfc3261-16.6-request-uri', 'rfc3261-16.4-route-pop', 'rfc3261-12-early',
  'rfc3261-12.1.2-route-set', 'rfc3261-13.2.2.4-ack-2xx', 'rfc3261-17.1.1.3-ack-via', 'rfc3261-22.3-challenge-407',
  'rfc3261-22.2-cseq-increment', 'rfc3261-22.3-consume-realm', 'rfc3261-22.1-ack-credentials', 'rfc3261-9.1-wait-provisional',
  'rfc3261-9-hop-by-hop', 'rfc3261-9.2-487', 'rfc3261-15-bye', 'rfc3261-12.2.1.1-target', 'rfc3261-17.1.1.2-timer-a',
  'rfc3261-17.1.1.2-timer-b', 'rfc3261-13.3.1.4-2xx-retransmit', 'rfc3261-13.2.2.4-ack-core',
  'rfc3261-8.1.3.4-3xx', 'rfc3261-21.1.5-183', 'rfc3261-13.2.1-patterns', 'rfc3261-13.2.2.4-ack-answer', 'rfc3261-16.5-empty-480',
  'rfc3261-21.4.24-486', 'rfc3261-21.4.18-480', 'rfc3261-21.6.2-603', 'rfc3261-21.4.5-404', 'rfc3261-16.7-cancel-branches',
  'rfc3261-16.6-parallel-sequential', 'rfc3261-13.2.2.4-forking', 'rfc3261-21.3.3-302',
] as const;
type QuoteId = (typeof CALL_QUOTES)[number];

// ---------------------------------------------------------------------------
// The network: the same addresses as the rest of the course.

interface Node {
  id: string;
  label: string;
  kind: Lane['kind'];
  ip: string;
  /** Proxies: the URI they put in Record-Route and Route. */
  uri?: string;
  /** User agents: Contact URI and dialog tag. */
  contact?: string;
  tag?: string;
  /** Prefix of the branch IDs this node creates. */
  br: string;
}

const ALICE: Node = { id: 'alice', label: 'Alice', kind: 'ua', ip: '192.0.2.10', contact: 'sip:alice@192.0.2.10:5060', tag: '9fxced76sl', br: '74b' };
const PROXY_A: Node = { id: 'proxyA', label: 'Proxy A', kind: 'proxy', ip: '198.51.100.10', uri: 'sip:proxy.atlanta.example;lr', br: 'pa' };
const PROXY_B: Node = { id: 'proxyB', label: 'Proxy B', kind: 'proxy', ip: '203.0.113.10', uri: 'sip:proxy.biloxi.example;lr', br: 'pb' };
const BOB: Node = { id: 'bob', label: 'Bob', kind: 'ua', ip: '203.0.113.20', contact: 'sip:bob@203.0.113.20:5060', tag: '314159', br: 'b0' };
const REDIRECT: Node = { id: 'redirect', label: 'Redirect server', kind: 'server', ip: '203.0.113.30', br: 'rs' };
const DESK: Node = { id: 'desk', label: 'Desk phone', kind: 'ua', ip: '203.0.113.20', contact: 'sip:bob@203.0.113.20:5060', tag: '314159', br: 'd0' };
const MOBILE: Node = { id: 'mobile', label: 'Mobile', kind: 'ua', ip: '203.0.113.40', contact: 'sip:bob@203.0.113.40:5060', tag: 'a73kszlfl', br: 'm0' };

const FROM = `Alice <sip:alice@atlanta.example>;tag=${ALICE.tag}`;
const TO = 'Bob <sip:bob@biloxi.example>';
const AOR = 'sip:bob@biloxi.example';
const CALL_ID = '3848276298220188511@192.0.2.10';
const NONCE = 'f84f1cec41e6cbe5aea9c8e88d359';
const CREDENTIALS = { username: 'alice', password: 'wonderland-2026' };
const PROXY_AUTH = (method: string) =>
  `Proxy-Authorization: Digest username="alice", realm="atlanta.example", nonce="${NONCE}", uri="${AOR}", response="{digest${method === 'INVITE' ? '' : ':INVITE'}}", algorithm=MD5, qop=auth, nc=00000001, cnonce="6a4b1c2d"`;

/** Tags of the responses that a proxy or server creates itself. */
const OWN_TAG: Record<string, string> = { proxyA: '3flal12sf', proxyB: '6e9a1c2b', redirect: '8e3c7a01' };

function sdp(user: string, id: string, ip: string, port: number, pts: number[]): string {
  const name = (pt: number) => (pt === 0 ? 'PCMU' : 'PCMA');
  return [`v=0`, `o=${user} ${id} ${id} IN IP4 ${ip}`, 's=-', `c=IN IP4 ${ip}`, 't=0 0', `m=audio ${port} RTP/AVP ${pts.join(' ')}`,
    ...pts.map(pt => `a=rtpmap:${pt} ${name(pt)}/8000`)].join('\n') + '\n';
}
const ALICE_SDP = (pts: number[]) => sdp('alice', '2890844526', ALICE.ip, 49170, pts);
const CALLEE_SDP = (n: Node, pts: number[]) => sdp('bob', n.id === 'mobile' ? '1188442277' : '2808844564', n.ip, n.id === 'mobile' ? 7078 : 3456, pts);

// ---------------------------------------------------------------------------
// Messages

interface Msg {
  line: string;
  via: string[];
  maxForwards?: number;
  route?: string[];
  recordRoute?: string[];
  from: string;
  to: string;
  cseq: string;
  contact?: string;
  extra?: string[];
  sdp?: string;
}

function text(m: Msg): string {
  const h = [m.line, ...m.via.map(v => `Via: ${v}`)];
  if (m.maxForwards !== undefined) h.push(`Max-Forwards: ${m.maxForwards}`);
  for (const r of m.route ?? []) h.push(`Route: <${r}>`);
  for (const r of m.recordRoute ?? []) h.push(`Record-Route: <${r}>`);
  h.push(`From: ${m.from}`, `To: ${m.to}`, `Call-ID: ${CALL_ID}`, `CSeq: ${m.cseq}`);
  if (m.contact) h.push(`Contact: <${m.contact}>`);
  h.push(...(m.extra ?? []));
  if (m.sdp) h.push('Content-Type: application/sdp');
  h.push('Content-Length: {auto}');
  return h.join('\n') + '\n' + (m.sdp ? '\n' + m.sdp : '');
}

const ruriOf = (m: Msg) => m.line.split(' ')[1]!;
const methodOf = (m: Msg) => m.line.split(' ')[0]!;
const withTag = (to: string, tag: string) => (/;tag=/.test(to) ? to : `${to};tag=${tag}`);

/** A request as it travels on one hop. */
interface Hop { from: Node; to: Node; msg: Msg }

class Builder {
  steps: FlowStep[] = [];
  readonly o: CallOptions;
  private count = new Map<string, number>();
  constructor(o: CallOptions) { this.o = o; }

  branch(n: Node): string {
    const k = (this.count.get(n.id) ?? 0) + 1;
    this.count.set(n.id, k);
    const seed = [...n.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 0xfff;
    return `z9hG4bK${n.br}${(0x1000 + seed + k * 0x2d3).toString(16)}`;
  }

  via(n: Node): string {
    return `SIP/2.0/UDP ${n.ip}:5060;branch=${this.branch(n)}`;
  }

  msg(from: Node, to: Node, label: string, caption: string, m: Msg, more: Partial<FlowStep> & { rfc?: QuoteId } = {}): void {
    this.steps.push({ from: from.id, to: to.id, label, caption, message: text(m), ...more });
  }

  media(from: Node, to: Node, label: string, caption: string, oneway = false): void {
    this.steps.push({ kind: 'media', from: from.id, to: to.id, proto: 'rtp', label, caption, ...(oneway ? { oneway } : {}) });
  }

  /** A proxy forwards a request (RFC 3261 §16.6). */
  forward(prev: Msg, p: Node, how: { initial: boolean; retarget?: string }): Msg {
    const route = [...(prev.route ?? [])];
    if (route[0] === p.uri) route.shift();
    return {
      ...prev,
      line: how.retarget ? `${methodOf(prev)} ${how.retarget} SIP/2.0` : prev.line,
      via: [this.via(p), ...prev.via],
      maxForwards: prev.maxForwards! - 1,
      route: route.length ? route : undefined,
      recordRoute: how.initial && this.o.recordRoute ? [p.uri!, ...(prev.recordRoute ?? [])] : prev.recordRoute,
      // Proxy A consumes the credentials for its own realm (RFC 3261 §22.3).
      extra: p.id === 'proxyA' ? prev.extra?.filter(h => !h.startsWith('Proxy-Authorization')) : prev.extra,
    };
  }

  /** A response on one hop: the Via headers of the request on that hop (RFC 3261 §8.2.6.2, §16.7). */
  response(h: Hop, status: string, more: Partial<Msg> & { tag?: string }): Msg {
    const { tag, ...rest } = more;
    return {
      line: `SIP/2.0 ${status}`, via: h.msg.via, from: h.msg.from, to: tag ? withTag(h.msg.to, tag) : h.msg.to,
      cseq: h.msg.cseq, ...rest,
    };
  }

  /** The ACK for a non-2xx final response: same hop, same branch (RFC 3261 §17.1.1.3). */
  ackNon2xx(h: Hop, toTag: string): Msg {
    return {
      line: `ACK ${ruriOf(h.msg)} SIP/2.0`, via: [h.msg.via[0]!], maxForwards: 70, route: h.msg.route,
      from: h.msg.from, to: withTag(h.msg.to, toTag), cseq: `${h.msg.cseq.split(' ')[0]} ACK`,
    };
  }

  /** A CANCEL on one hop: Request-URI, Route, and branch of the INVITE on that hop (RFC 3261 §9.1). */
  cancel(h: Hop): Msg {
    return {
      line: `CANCEL ${ruriOf(h.msg)} SIP/2.0`, via: [h.msg.via[0]!], maxForwards: 70, route: h.msg.route,
      from: h.msg.from, to: h.msg.to, cseq: `${h.msg.cseq.split(' ')[0]} CANCEL`,
    };
  }
}

// ---------------------------------------------------------------------------
// Captions

const RR_NOTE = (o: CallOptions) => (o.recordRoute ? ' and a Record-Route' : '');
const STATUS: Record<Exclude<Outcome, 'answer' | 'cancel'>, { status: string; label: string; rfc: QuoteId }> = {
  busy: { status: '486 Busy Here', label: '486 Busy Here', rfc: 'rfc3261-21.4.24-486' },
  unavailable: { status: '480 Temporarily Unavailable', label: '480 Temporarily Unavailable', rfc: 'rfc3261-21.4.18-480' },
  decline: { status: '603 Decline', label: '603 Decline', rfc: 'rfc3261-21.6.2-603' },
  'not-found': { status: '404 Not Found', label: '404 Not Found', rfc: 'rfc3261-21.4.5-404' },
  'no-response': { status: '408 Request Timeout', label: '408 Request Timeout', rfc: 'rfc3261-17.1.1.2-timer-b' },
};

// ---------------------------------------------------------------------------
// Scenarios

/**
 * One INVITE along a chain of nodes: Alice, zero or more proxies, and the
 * callee (Bob, or the Redirect server). Each proxy answers 100 Trying.
 * Returns the INVITE on each hop it reached.
 */
function sendInvite(b: Builder, nodes: Node[], first: Msg, opts: { loseFirst?: boolean; stopAt?: number; lead?: string; noTrying?: boolean } = {}): Hop[] {
  const o = b.o;
  const hops: Hop[] = [];
  const callee = nodes[nodes.length - 1]!;
  const last = opts.stopAt ?? nodes.length - 1;
  const creds = first.extra?.some(x => x.startsWith('Proxy-Authorization'));
  for (let i = 0; i < last; i++) {
    const from = nodes[i]!, to = nodes[i + 1]!;
    const home = from.kind === 'proxy' && to === callee;
    const msg = i === 0 ? first : b.forward(hops[i - 1]!.msg, from, { initial: true, retarget: home ? callee.contact : undefined });
    const h = { from, to, msg };
    hops.push(h);
    if (i === 0) {
      const label = creds ? 'INVITE (credentials)' : o.lateOffer ? 'INVITE (no SDP)' : 'INVITE';
      const lead = opts.lead
        ?? (creds ? 'Alice\'s phone sends the INVITE again, with Proxy-Authorization.'
        : to.id === 'bob' ? 'Alice\'s phone calls Bob directly, at his address.'
        : to.id === 'redirect' ? 'Alice\'s phone sends the INVITE for Bob\'s AOR to the server for biloxi.example.'
        : to.id === 'proxyA' ? 'Alice\'s phone sends the INVITE to Proxy A, its outbound proxy.'
        : 'Alice\'s phone sends the INVITE to Proxy B, the proxy for biloxi.example.');
      if (opts.loseFirst) {
        b.msg(from, to, label, `${lead} The packet never arrives.`, msg, { lost: true });
        b.msg(from, to, 'INVITE (retransmission)', 'No response after 500 ms (Timer A), so Alice\'s phone sends the same INVITE again.', msg, { rfc: 'rfc3261-17.1.1.2-timer-a' });
      } else if (creds) {
        b.msg(from, to, label, `${lead} CSeq is now 2, and the branch is new.`, msg, { rfc: 'rfc3261-22.2-cseq-increment' });
      } else {
        b.msg(from, to, label, `${lead} ${o.lateOffer ? 'It has no SDP: Bob will make the offer.' : 'The SDP offer lists PCMU and PCMA.'}`, msg);
      }
    } else if (home && to.kind === 'ua') {
      b.msg(from, to, 'INVITE', `${from.label} finds Bob's Contact in its location service. It adds its Via${RR_NOTE(o)} and sends the INVITE there.`, msg,
        { rfc: o.recordRoute ? 'rfc3261-16.6-record-route' : 'rfc3261-16.6-request-uri' });
    } else {
      b.msg(from, to, 'INVITE', `${o.auth ? `${from.label} accepts the credentials and removes them. It` : from.label} removes its own Route entry, adds its Via${RR_NOTE(o)}, and forwards the INVITE.`, msg,
        { rfc: o.auth ? 'rfc3261-22.3-consume-realm' : 'rfc3261-16.4-route-pop' });
    }
    if (to.kind === 'proxy' && !opts.noTrying) {
      b.msg(to, from, '100 Trying', i === 0 ? `${to.label} answers 100 Trying, so Alice's phone stops retransmitting the INVITE.` : `${to.label} answers 100 Trying. A 100 Trying travels one hop only.`,
        b.response(h, '100 Trying', {}), i === 0 ? { rfc: 'rfc3261-17.2.1-100' } : {});
    }
  }
  return hops;
}

/** A response from the far end of hops[k] back to Alice. A non-2xx final is ACKed on each hop. */
function sendBack(b: Builder, hops: Hop[], k: number, status: string, label: string, captions: (h: Hop, j: number) => string,
  more: Partial<Msg> & { tag?: string } = {}, rfc?: QuoteId, lose?: 'first-hop'): void {
  const code = Number(status.slice(0, 3));
  const tag = more.tag ?? hops[k]!.to.tag ?? OWN_TAG[hops[k]!.to.id]!;
  for (let j = k; j >= 0; j--) {
    const h = hops[j]!;
    b.msg(h.to, h.from, label, captions(h, j), b.response(h, status, { ...more, tag: code === 100 ? undefined : tag }),
      { ...(j === k && rfc ? { rfc } : {}), ...(lose === 'first-hop' && j === 0 ? { lost: true } : {}) });
    if (code >= 300) {
      b.msg(h.from, h.to, 'ACK', j === 0 ? 'Alice\'s phone confirms the final response. The ACK reuses the INVITE branch.' : `${h.from.label} confirms the ${code} on its own hop, with the branch of its INVITE.`,
        b.ackNon2xx(h, tag), j === k ? { rfc: 'rfc3261-17.1.1.3-ack-via' } : {});
    }
  }
}

const relay = (what: string) => (h: Hop) => `${h.to.label} removes its own Via and forwards the ${what}.`;

/** In-dialog request along the route set, and its 200 OK back (RFC 3261 §12.2.1.1, §16.12). */
function inDialog(b: Builder, chain: Node[], m: Msg, label: string, caption: (from: Node, to: Node, i: number) => string,
  rfc?: QuoteId, lostHop?: number, retry?: boolean): Hop[] {
  const hops: Hop[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const msg = i === 0 ? m : b.forward(hops[i - 1]!.msg, chain[i]!, { initial: false });
    hops.push({ from: chain[i]!, to: chain[i + 1]!, msg });
  }
  hops.forEach((h, i) => b.msg(h.from, h.to, retry ? `${label} (retransmission)` : label, caption(h.from, h.to, i), h.msg,
    { ...(i === 0 && rfc ? { rfc } : {}), ...(lostHop === i ? { lost: true } : {}) }));
  return hops;
}

interface Leg {
  /** Alice, the proxies, and the callee. */
  nodes: Node[];
  cseq: number;
  /** Request-URI of the INVITE (default: Bob's AOR). */
  ruri?: string;
  /** Extra header lines on Alice's INVITE (Route to the outbound proxy, credentials). */
  route?: string[];
  extra?: string[];
}

/** The call with one callee: direct, through one or two proxies, or after a redirect. */
function oneCallee(b: Builder, leg: Leg): void {
  const o = b.o;
  const { nodes } = leg;
  const callee = nodes[nodes.length - 1]!;
  const proxies = nodes.filter(n => n.kind === 'proxy');
  const invite: Msg = {
    line: `INVITE ${leg.ruri ?? AOR} SIP/2.0`, via: [b.via(ALICE)], maxForwards: 70, route: leg.route, from: FROM, to: TO,
    cseq: `${leg.cseq} INVITE`, contact: ALICE.contact, extra: leg.extra, sdp: o.lateOffer ? undefined : ALICE_SDP([0, 8]),
  };

  // Proxy B ends the INVITE itself: Bob is not registered.
  if (o.outcome === 'not-found') {
    const hops = sendInvite(b, nodes, invite, { stopAt: nodes.length - 2 });
    const k = hops.length - 1;
    sendBack(b, hops, k, STATUS['not-found'].status, STATUS['not-found'].label, (h, j) => j === k
      ? 'Proxy B finds no binding for Bob\'s AOR in its location service. It answers 404 and forwards nothing.'
      : relay('404')(h), {}, STATUS['not-found'].rfc);
    return;
  }
  const hops = sendInvite(b, nodes, invite, { loseFirst: o.lose === 'invite' });
  const last = hops[hops.length - 1]!;
  const k = hops.length - 1;

  // Bob's phone is gone: Proxy B retransmits, then gives up with 408.
  if (o.outcome === 'no-response') {
    const sent = b.steps[b.steps.length - 1]!;
    sent.lost = true;
    sent.caption = `${sent.caption.split('. ')[0]}. Bob's phone is off, so nothing arrives.`;
    b.msg(last.from, last.to, 'INVITE (retransmission)', 'No response, so Proxy B sends the INVITE again after 500 ms (Timer A).', last.msg, { lost: true, rfc: 'rfc3261-17.1.1.2-timer-a' });
    b.msg(last.from, last.to, 'INVITE (retransmission)', 'Proxy B doubles the interval each time: 1 s, 2 s, 4 s, and so on.', last.msg, { lost: true });
    const up = hops.slice(0, -1);
    const kk = up.length - 1;
    sendBack(b, up, kk, STATUS['no-response'].status, STATUS['no-response'].label, (h, j) => j === kk
      ? 'After 32 s (Timer B), Proxy B gives up. It answers 408 Request Timeout.' : relay('408')(h), {}, 'rfc3261-17.1.1.2-timer-b');
    return;
  }

  // Bob is busy: the phone rejects the INVITE at once, without ringing.
  const rr = last.msg.recordRoute ? { recordRoute: last.msg.recordRoute } : {};
  if (o.outcome === 'busy') {
    sendBack(b, hops, k, STATUS.busy.status, STATUS.busy.label, (h, j) => j === k
      ? 'Bob is already on another call. His phone rejects the INVITE at once.' : relay('486')(h), {}, STATUS.busy.rfc);
    return;
  }

  // Ringing, or early media.
  const answerSdp = CALLEE_SDP(callee, [0]);
  if (o.earlyMedia) {
    sendBack(b, hops, k, '183 Session Progress', '183 Session Progress', (h, j) => j === k
      ? 'Bob\'s phone answers the offer in a 183, before anybody picks up. The To tag creates an early dialog.'
      : relay('183 and its SDP')(h), { contact: callee.contact, ...rr, sdp: answerSdp }, 'rfc3261-21.1.5-183');
    b.media(callee, ALICE, 'RTP early media', 'Bob\'s side sends a ringback tone or an announcement as RTP. Alice\'s phone plays it and makes no tone of its own.', true);
  } else {
    sendBack(b, hops, k, '180 Ringing', '180 Ringing', (h, j) => j === k
      ? `Bob's phone rings${k === 0 ? ', and Alice\'s phone plays a ringback tone' : ''}. The To tag in the 180 creates an early dialog.`
      : j === 0 ? `${h.to.label} forwards the 180. Alice's phone plays a ringback tone.` : relay('180')(h),
    { contact: callee.contact, ...rr }, 'rfc3261-12-early');
  }

  if (o.outcome === 'unavailable' || o.outcome === 'decline') {
    const s = STATUS[o.outcome];
    sendBack(b, hops, k, s.status, s.label, (h, j) => j !== k ? relay(s.status.slice(0, 3))(h)
      : o.outcome === 'unavailable' ? 'Nobody answers. After its no-answer timer, Bob\'s phone stops ringing and sends 480.'
      : 'Bob presses Reject. A 6xx means: do not try any other phone of Bob\'s.', {}, s.rfc);
    return;
  }

  if (o.outcome === 'cancel') {
    hops.forEach((h, j) => {
      b.msg(h.from, h.to, 'CANCEL', j === 0 ? 'Alice hangs up before Bob answers. The CANCEL copies the Request-URI, Call-ID, From, To, and branch of the INVITE.'
        : `${h.from.label} sends its own CANCEL on its own hop, with the branch of its own INVITE.`, b.cancel(h), j === 0 ? { rfc: 'rfc3261-9.1-wait-provisional' } : {});
      b.msg(h.to, h.from, '200 OK (CANCEL)', h.to === callee ? 'Bob\'s phone stops ringing and answers the CANCEL.' : `${h.to.label} answers the CANCEL itself. A CANCEL travels hop by hop.`,
        b.response({ ...h, msg: b.cancel(h) }, '200 OK', { tag: callee.tag }), j === 0 ? { rfc: 'rfc3261-9-hop-by-hop' } : {});
    });
    sendBack(b, hops, k, '487 Request Terminated', '487 Request Terminated', (h, j) => j === k
      ? 'Bob\'s phone ends the INVITE transaction with 487.' : relay('487')(h), {}, 'rfc3261-9.2-487');
    return;
  }

  // Bob answers.
  const ok = { contact: callee.contact, ...rr, sdp: o.lateOffer ? CALLEE_SDP(callee, [0, 8]) : answerSdp };
  const okLabel = o.lateOffer ? '200 OK (offer)' : '200 OK';
  const answered = o.lateOffer ? 'Bob answers. The INVITE had no SDP, so the 200 OK carries Bob\'s offer.'
    : o.earlyMedia ? 'Bob answers. The 200 OK repeats the SDP of the 183, so the media goes on unchanged.'
    : 'Bob answers. The 200 OK carries the SDP answer: PCMU.';
  const routeSetNote = o.recordRoute && proxies.length ? ' Alice\'s phone reverses the Record-Route list to build the route set.' : '';
  const lostOk = o.lose === 'ok';
  sendBack(b, hops, k, '200 OK', okLabel, (h, j) => {
    if (j === 0 && lostOk) return j === k ? 'Bob answers with a 200 OK, but the packet never arrives.' : `${h.to.label} forwards the 200 OK, but the packet never arrives.`;
    if (j === k) return answered;
    return j === 0 ? `${h.to.label} forwards the 200 OK.${routeSetNote}` : relay('200 OK')(h);
  }, ok, o.lateOffer ? 'rfc3261-13.2.1-patterns' : undefined, lostOk ? 'first-hop' : undefined);
  const resend200 = () => sendBack(b, hops, k, '200 OK', '200 OK (retransmission)', (h, j) => j === k
    ? 'No ACK arrives, so Bob\'s phone sends the 200 OK again after 500 ms.' : relay('200 OK')(h), ok, 'rfc3261-13.3.1.4-2xx-retransmit');
  if (lostOk) resend200();

  // The ACK, end to end: along the route set, or straight to the Contact (RFC 3261 §13.2.2.4).
  const dialogProxies = o.recordRoute ? proxies : [];
  const routeSet = dialogProxies.map(p => p.uri!);
  const ackChain = [ALICE, ...dialogProxies, callee];
  const ack: Msg = {
    line: `ACK ${callee.contact} SIP/2.0`, via: [b.via(ALICE)], maxForwards: 70, route: routeSet.length ? routeSet : undefined,
    from: FROM, to: withTag(TO, callee.tag!), cseq: `${leg.cseq} ACK`,
    extra: o.auth ? [PROXY_AUTH('ACK')] : undefined, sdp: o.lateOffer ? ALICE_SDP([0]) : undefined,
  };
  const ackLabel = o.lateOffer ? 'ACK (answer)' : 'ACK';
  const lostAck = o.lose === 'ack' ? ackChain.length - 2 : undefined;
  const ackHops = inDialog(b, ackChain, ack, ackLabel, (from, _to, i) => {
    const gone = i === lostAck ? ' The packet never arrives.' : '';
    if (i > 0) return `${from.label} removes its own Route entry and forwards the ACK.${gone}`;
    const what = o.lateOffer ? 'Alice\'s phone sends its SDP answer in the ACK.' : 'Alice\'s phone sends the ACK, with a new branch.';
    return `${what} ${gone ? gone.trim() : routeSet.length ? 'The ACK follows the route set.' : 'It goes straight to Bob\'s Contact address.'}`;
  }, o.lateOffer ? 'rfc3261-13.2.2.4-ack-answer' : o.auth ? 'rfc3261-22.1-ack-credentials' : 'rfc3261-13.2.2.4-ack-2xx', lostAck);
  if (o.lose === 'ack') {
    resend200();
    ackHops.forEach((h, i) => b.msg(h.from, h.to, 'ACK (retransmission)', i === 0 ? 'Alice\'s phone sends the same ACK again for each 200 OK retransmission.' : `${h.from.label} forwards the ACK again.`,
      h.msg, i === 0 ? { rfc: 'rfc3261-13.2.2.4-ack-core' } : {}));
  }

  b.media(ALICE, callee, 'RTP audio (PCMU)', proxies.length ? 'Alice and Bob send RTP straight to each other. The proxies never see the media.'
    : 'Alice and Bob send RTP straight to each other, to the addresses in the SDP.');
  bye(b, callee, dialogProxies, leg.cseq + 1);
}

/** One side hangs up: BYE along the route set, and 200 OK back (RFC 3261 §15). */
function bye(b: Builder, callee: Node, dialogProxies: Node[], aliceSeq: number): void {
  const o = b.o;
  const byAlice = o.hangup === 'alice';
  const chain = byAlice ? [ALICE, ...dialogProxies, callee] : [callee, ...[...dialogProxies].reverse(), ALICE];
  const m: Msg = byAlice
    ? { line: `BYE ${callee.contact} SIP/2.0`, via: [b.via(ALICE)], maxForwards: 70, route: dialogProxies.length ? dialogProxies.map(p => p.uri!) : undefined,
      from: FROM, to: withTag(TO, callee.tag!), cseq: `${aliceSeq} BYE` }
    : { line: `BYE ${ALICE.contact} SIP/2.0`, via: [b.via(callee)], maxForwards: 70, route: dialogProxies.length ? [...dialogProxies].reverse().map(p => p.uri!) : undefined,
      from: withTag(`Bob <${AOR}>`, callee.tag!), to: FROM, cseq: '1 BYE' };
  const who = byAlice ? 'Alice' : 'Bob';
  const hops = inDialog(b, chain, m, 'BYE', (from, _to, i) => i === 0
    ? `${who} hangs up. The BYE goes to the remote target${dialogProxies.length ? ', through the route set' : ', straight to the Contact address'}.`
    : `${from.label} removes its own Route entry and forwards the BYE.`, byAlice ? 'rfc3261-15-bye' : 'rfc3261-12.2.1.1-target');
  for (let j = hops.length - 1; j >= 0; j--) {
    const h = hops[j]!;
    b.msg(h.to, h.from, '200 OK (BYE)', j === hops.length - 1 ? `${byAlice ? 'Bob' : 'Alice'}'s phone confirms the BYE. The dialog ends.` : `${h.to.label} forwards the 200 OK.`,
      b.response(h, '200 OK', {}));
  }
}

/** Redirect: 302 from the Redirect server, then a new INVITE straight to the Contact (RFC 3261 §8.1.3.4). */
function redirect(b: Builder): void {
  const o = b.o;
  const first: Msg = {
    line: `INVITE ${AOR} SIP/2.0`, via: [b.via(ALICE)], maxForwards: 70, from: FROM, to: TO, cseq: '1 INVITE',
    contact: ALICE.contact, sdp: o.lateOffer ? undefined : ALICE_SDP([0, 8]),
  };
  const hops = sendInvite(b, [ALICE, REDIRECT], first);
  sendBack(b, hops, 0, '302 Moved Temporarily', '302 Moved Temporarily',
    () => 'The Redirect server finds Bob\'s Contact address. It sends the address back and does not forward the INVITE.',
    { contact: BOB.contact }, 'rfc3261-21.3.3-302');
  const before = b.steps.length;
  oneCallee(b, { nodes: [ALICE, BOB], cseq: 2, ruri: BOB.contact });
  const s = b.steps[before]!;
  s.label = o.lateOffer ? 'INVITE (no SDP)' : 'INVITE (new target)';
  if (o.lose !== 'invite') {
    s.caption = 'Alice\'s phone sends a new INVITE straight to the Contact address. The CSeq is now 2, and the branch is new.';
    s.rfc = 'rfc3261-8.1.3.4-3xx';
  }
}

/** Forking at Proxy B to the Desk phone and the Mobile (RFC 3261 §16.6, §16.7). */
function fork(b: Builder): void {
  const o = b.o;
  const parallel = o.path === 'fork-parallel';
  const invite: Msg = {
    line: `INVITE ${AOR} SIP/2.0`, via: [b.via(ALICE)], maxForwards: 70, from: FROM, to: TO, cseq: '1 INVITE',
    contact: ALICE.contact, sdp: o.lateOffer ? undefined : ALICE_SDP([0, 8]),
  };
  const [up] = sendInvite(b, [ALICE, PROXY_B], invite);
  const leg = (n: Node): Hop => ({ from: PROXY_B, to: n, msg: b.forward(up!.msg, PROXY_B, { initial: true, retarget: n.contact }) });
  const ring = (h: Hop) => {
    const rr = h.msg.recordRoute ? { recordRoute: h.msg.recordRoute } : {};
    const r180 = { contact: h.to.contact, ...rr, tag: h.to.tag };
    b.msg(h.to, PROXY_B, '180 Ringing', `The ${h.to.label} rings. Its own To tag makes its own early dialog with Alice.`, b.response(h, '180 Ringing', r180), { rfc: 'rfc3261-13.2.2.4-forking' });
    b.msg(PROXY_B, ALICE, '180 Ringing', `Proxy B forwards the 180. Alice's phone now has ${h.to.id === 'desk' || !parallel ? 'an early dialog with this phone' : 'two early dialogs, one with each phone'}.`, b.response(up!, '180 Ringing', r180));
  };
  const cancelLeg = (h: Hop, why: string) => {
    b.msg(PROXY_B, h.to, 'CANCEL', why, b.cancel(h), { rfc: parallel ? 'rfc3261-16.7-cancel-branches' : 'rfc3261-9.1-wait-provisional' });
    b.msg(h.to, PROXY_B, '200 OK (CANCEL)', `The ${h.to.label} stops ringing and answers the CANCEL.`, b.response({ ...h, msg: b.cancel(h) }, '200 OK', { tag: h.to.tag }));
    b.msg(h.to, PROXY_B, '487 Request Terminated', `The ${h.to.label} ends its INVITE transaction with 487.`, b.response(h, '487 Request Terminated', { tag: h.to.tag }));
    b.msg(PROXY_B, h.to, 'ACK', 'Proxy B confirms the 487 on this hop. It forwards nothing to Alice yet.', b.ackNon2xx(h, h.to.tag!));
  };

  const desk = leg(DESK);
  b.msg(PROXY_B, DESK, 'INVITE', parallel ? 'Proxy B finds two Contacts for Bob. It forks: first a copy to the Desk phone, with its own branch.'
    : 'Proxy B finds two Contacts for Bob. It tries them one at a time: the Desk phone first.', desk.msg, { rfc: 'rfc3261-16.6-parallel-sequential' });
  let mobile: Hop | undefined;
  if (parallel) {
    mobile = leg(MOBILE);
    b.msg(PROXY_B, MOBILE, 'INVITE', 'At the same time, a second copy goes to the Mobile, with another branch.', mobile.msg);
  }
  ring(desk);
  if (mobile) ring(mobile);

  if (o.outcome === 'cancel') {
    b.msg(ALICE, PROXY_B, 'CANCEL', 'Alice hangs up before anybody answers. Her phone sends one CANCEL, to Proxy B.', b.cancel(up!), { rfc: 'rfc3261-9.1-wait-provisional' });
    b.msg(PROXY_B, ALICE, '200 OK (CANCEL)', 'Proxy B answers the CANCEL itself. Then it cancels each pending branch.', b.response({ ...up!, msg: b.cancel(up!) }, '200 OK', { tag: OWN_TAG.proxyB }), { rfc: 'rfc3261-9-hop-by-hop' });
    cancelLeg(desk, 'Proxy B cancels the branch to the Desk phone.');
    if (mobile) cancelLeg(mobile, 'Proxy B cancels the branch to the Mobile.');
    b.msg(PROXY_B, ALICE, '487 Request Terminated', 'All branches have ended. Proxy B forwards the best final response, the 487, to Alice.', b.response(up!, '487 Request Terminated', { tag: DESK.tag }), { rfc: 'rfc3261-9.2-487' });
    b.msg(ALICE, PROXY_B, 'ACK', 'Alice\'s phone confirms the 487. The call never started.', b.ackNon2xx(up!, DESK.tag!));
    return;
  }

  let callee = DESK;
  if (!parallel) {
    cancelLeg(desk, 'Nobody answers the Desk phone within the ring time of Proxy B. Proxy B cancels that branch.');
    mobile = leg(MOBILE);
    b.msg(PROXY_B, MOBILE, 'INVITE', 'Proxy B tries the next Contact: the Mobile, with a new branch.', mobile.msg);
    ring(mobile);
    callee = MOBILE;
  }
  const answered = parallel ? desk : mobile!;
  const rr = answered.msg.recordRoute ? { recordRoute: answered.msg.recordRoute } : {};
  const okSdp = o.lateOffer ? CALLEE_SDP(callee, [0, 8]) : CALLEE_SDP(callee, [0]);
  const ok = { contact: callee.contact, ...rr, sdp: okSdp, tag: callee.tag };
  b.msg(callee, PROXY_B, o.lateOffer ? '200 OK (offer)' : '200 OK', `Bob answers on the ${callee.label}. ${o.lateOffer ? 'The 200 OK carries its SDP offer.' : 'The 200 OK carries its SDP answer.'}`, b.response(answered, '200 OK', ok));
  b.msg(PROXY_B, ALICE, o.lateOffer ? '200 OK (offer)' : '200 OK', `Proxy B forwards the 200 OK. Its To tag selects the dialog with the ${callee.label}.`, b.response(up!, '200 OK', ok));
  if (parallel) cancelLeg(mobile!, 'Proxy B cancels the branch that is still ringing: the Mobile.');

  const dialogProxies = o.recordRoute ? [PROXY_B] : [];
  const ack: Msg = {
    line: `ACK ${callee.contact} SIP/2.0`, via: [b.via(ALICE)], maxForwards: 70, route: o.recordRoute ? [PROXY_B.uri!] : undefined,
    from: FROM, to: withTag(TO, callee.tag!), cseq: '1 ACK', sdp: o.lateOffer ? ALICE_SDP([0]) : undefined,
  };
  inDialog(b, [ALICE, ...dialogProxies, callee], ack, o.lateOffer ? 'ACK (answer)' : 'ACK', (from, _to, i) => i === 0
    ? `Alice's phone sends the ACK to the ${callee.label}${o.recordRoute ? ', through Proxy B' : ', straight to its Contact'}. The other early dialog ends.`
    : `${from.label} removes its own Route entry and forwards the ACK.`, 'rfc3261-13.2.2.4-ack-2xx');
  b.media(ALICE, callee, 'RTP audio (PCMU)', `Alice and Bob talk, on the ${callee.label}. The RTP goes straight between the two phones.`);
  bye(b, callee, dialogProxies, 2);
}

// ---------------------------------------------------------------------------

const TITLE: Record<Outcome, string> = {
  answer: 'Bob answers', busy: 'Bob is busy', unavailable: 'Nobody answers', 'no-response': 'Bob\'s phone does not respond',
  decline: 'Bob declines the call', 'not-found': 'Bob is not registered', cancel: 'Alice hangs up first',
};
const VIA: Record<CallPath, string> = {
  direct: 'directly', proxy: 'through one proxy', 'two-proxies': 'through two proxies', redirect: 'after a redirect',
  'fork-parallel': 'with parallel forking', 'fork-sequential': 'with sequential forking',
};

export function buildCall(options: CallOptions): FlowData {
  const o = applyChange(options, {}).options;
  const b = new Builder(o);
  let lanes: Node[];
  switch (o.path) {
    case 'direct':
      lanes = [ALICE, BOB];
      oneCallee(b, { nodes: lanes, cseq: 1 });
      break;
    case 'proxy':
      lanes = [ALICE, PROXY_B, BOB];
      oneCallee(b, { nodes: lanes, cseq: 1 });
      break;
    case 'two-proxies': {
      lanes = [ALICE, PROXY_A, PROXY_B, BOB];
      const route = [PROXY_A.uri!];
      if (o.auth) {
        const first: Msg = {
          line: `INVITE ${AOR} SIP/2.0`, via: [b.via(ALICE)], maxForwards: 70, route, from: FROM, to: TO, cseq: '1 INVITE',
          contact: ALICE.contact, sdp: o.lateOffer ? undefined : ALICE_SDP([0, 8]),
        };
        // Proxy A challenges at once, so it sends no 100 Trying first.
        const hops = sendInvite(b, [ALICE, PROXY_A], first, { noTrying: true, lead: 'Alice\'s phone sends the INVITE to Proxy A, its outbound proxy, with no credentials.' });
        sendBack(b, hops, 0, '407 Proxy Authentication Required', '407 Proxy Auth Required',
          () => 'Proxy A rejects the INVITE with 407. Proxy-Authenticate carries the realm and a nonce.',
          { extra: [`Proxy-Authenticate: Digest realm="atlanta.example", qop="auth", nonce="${NONCE}", algorithm=MD5`] }, 'rfc3261-22.3-challenge-407');
      }
      oneCallee(b, { nodes: lanes, cseq: o.auth ? 2 : 1, route, extra: o.auth ? [PROXY_AUTH('INVITE')] : undefined });
      break;
    }
    case 'redirect':
      lanes = [ALICE, REDIRECT, BOB];
      redirect(b);
      break;
    default:
      lanes = [ALICE, PROXY_B, DESK, MOBILE];
      fork(b);
  }
  return {
    id: `call-${callKey(o)}`,
    title: `${TITLE[o.outcome]}, ${VIA[o.path]}`,
    lanes: lanes.map(n => ({ id: n.id, label: n.label, kind: n.kind, sub: n.ip })),
    steps: b.steps,
    ...(o.auth ? { credentials: CREDENTIALS } : {}),
  };
}
