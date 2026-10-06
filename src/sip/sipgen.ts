/**
 * Building blocks for the call flow generators (Modules 21 and 22): the
 * course's network, SIP messages written as data, and a writer that turns
 * them into flow steps with fresh branch IDs. Pure TypeScript, no DOM.
 */
import type { FlowStep, Lane } from './flow.ts';

export interface Node {
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

// The network: the same addresses as the rest of the course.
export const ALICE: Node = { id: 'alice', label: 'Alice', kind: 'ua', ip: '192.0.2.10', contact: 'sip:alice@192.0.2.10:5060', tag: '9fxced76sl', br: '74b' };
export const PROXY_A: Node = { id: 'proxyA', label: 'Proxy A', kind: 'proxy', ip: '198.51.100.10', uri: 'sip:proxy.atlanta.example;lr', br: 'pa' };
export const PROXY_B: Node = { id: 'proxyB', label: 'Proxy B', kind: 'proxy', ip: '203.0.113.10', uri: 'sip:proxy.biloxi.example;lr', br: 'pb' };
export const BOB: Node = { id: 'bob', label: 'Bob', kind: 'ua', ip: '203.0.113.20', contact: 'sip:bob@203.0.113.20:5060', tag: '314159', br: 'b0' };
export const CAROL: Node = { id: 'carol', label: 'Carol', kind: 'ua', ip: '198.51.100.30', contact: 'sip:carol@198.51.100.30:5060', tag: '5f35a3', br: 'c0' };

export const CALL_ID = '3848276298220188511@192.0.2.10';

const PT: Record<number, string> = { 0: 'PCMU/8000', 8: 'PCMA/8000', 9: 'G722/8000', 96: 'H264/90000' };

export interface SdpSpec {
  user: string;
  /** Session ID; the version starts here and goes up by one with each change. */
  id: number;
  version?: number;
  ip: string;
  port: number;
  pts: number[];
  dir?: 'sendrecv' | 'sendonly' | 'recvonly' | 'inactive';
  /** A video stream: its port (0 rejects it). */
  video?: number;
  /** The address in c= when it differs from the one in o= (the phone moved). */
  cIp?: string;
}

export function sdp(s: SdpSpec): string {
  const v = s.version ?? s.id;
  const lines = ['v=0', `o=${s.user} ${s.id} ${v} IN IP4 ${s.ip}`, 's=-', `c=IN IP4 ${s.cIp ?? s.ip}`, 't=0 0',
    `m=audio ${s.port} RTP/AVP ${s.pts.join(' ')}`, ...s.pts.map(pt => `a=rtpmap:${pt} ${PT[pt]}`)];
  if (s.dir && s.dir !== 'sendrecv') lines.push(`a=${s.dir}`);
  if (s.video !== undefined) lines.push(`m=video ${s.video} RTP/AVP 96`, `a=rtpmap:96 ${PT[96]}`);
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Messages

export interface Msg {
  line: string;
  via: string[];
  maxForwards?: number;
  route?: string[];
  recordRoute?: string[];
  from: string;
  to: string;
  /** Default: CALL_ID, the call between Alice and Bob. */
  callId?: string;
  cseq: string;
  contact?: string;
  extra?: string[];
  sdp?: string;
  /** A body other than SDP, e.g. message/sipfrag in a NOTIFY. */
  body?: { type: string; text: string };
}

export function text(m: Msg): string {
  const h = [m.line, ...m.via.map(v => `Via: ${v}`)];
  if (m.maxForwards !== undefined) h.push(`Max-Forwards: ${m.maxForwards}`);
  for (const r of m.route ?? []) h.push(`Route: <${r}>`);
  for (const r of m.recordRoute ?? []) h.push(`Record-Route: <${r}>`);
  h.push(`From: ${m.from}`, `To: ${m.to}`, `Call-ID: ${m.callId ?? CALL_ID}`, `CSeq: ${m.cseq}`);
  if (m.contact) h.push(`Contact: <${m.contact}>`);
  h.push(...(m.extra ?? []));
  const body = m.sdp ? { type: 'application/sdp', text: m.sdp } : m.body;
  if (body) h.push(`Content-Type: ${body.type}`);
  h.push('Content-Length: {auto}');
  return h.join('\n') + '\n' + (body ? '\n' + body.text : '');
}

export const ruriOf = (m: Msg) => m.line.split(' ')[1]!;
export const methodOf = (m: Msg) => m.line.split(' ')[0]!;
export const withTag = (to: string, tag: string) => (/;tag=/.test(to) ? to : `${to};tag=${tag}`);

/** A request as it travels on one hop. */
export interface Hop { from: Node; to: Node; msg: Msg }

/** Writes flow steps. Each node numbers its own branch IDs. */
export class FlowWriter {
  steps: FlowStep[] = [];
  /** Proxies add Record-Route to initial requests. */
  recordRoute = false;
  private count = new Map<string, number>();

  branch(n: Node): string {
    const k = (this.count.get(n.id) ?? 0) + 1;
    this.count.set(n.id, k);
    const seed = [...n.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 0xfff;
    return `z9hG4bK${n.br}${(0x1000 + seed + k * 0x2d3).toString(16)}`;
  }

  via(n: Node): string {
    return `SIP/2.0/UDP ${n.ip}:5060;branch=${this.branch(n)}`;
  }

  msg(from: Node, to: Node, label: string, caption: string, m: Msg, more: Partial<FlowStep> = {}): void {
    this.steps.push({ from: from.id, to: to.id, label, caption, message: text(m), ...more });
  }

  media(from: Node, to: Node, label: string, caption: string, more: Partial<FlowStep> = {}): void {
    this.steps.push({ kind: 'media', from: from.id, to: to.id, proto: 'rtp', label, caption, ...more });
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
      recordRoute: how.initial && this.recordRoute ? [p.uri!, ...(prev.recordRoute ?? [])] : prev.recordRoute,
      // Proxy A consumes the credentials for its own realm (RFC 3261 §22.3).
      extra: p.id === 'proxyA' ? prev.extra?.filter(h => !h.startsWith('Proxy-Authorization')) : prev.extra,
    };
  }

  /** A response on one hop: the Via headers of the request on that hop (RFC 3261 §8.2.6.2, §16.7). */
  response(h: Hop, status: string, more: Partial<Msg> & { tag?: string }): Msg {
    const { tag, ...rest } = more;
    return {
      line: `SIP/2.0 ${status}`, via: h.msg.via, from: h.msg.from, to: tag ? withTag(h.msg.to, tag) : h.msg.to,
      callId: h.msg.callId, cseq: h.msg.cseq, ...rest,
    };
  }

  /** The ACK for a non-2xx final response: same hop, same branch (RFC 3261 §17.1.1.3). */
  ackNon2xx(h: Hop, toTag: string): Msg {
    return {
      line: `ACK ${ruriOf(h.msg)} SIP/2.0`, via: [h.msg.via[0]!], maxForwards: 70, route: h.msg.route,
      from: h.msg.from, to: withTag(h.msg.to, toTag), callId: h.msg.callId, cseq: `${h.msg.cseq.split(' ')[0]} ACK`,
    };
  }

  /** A CANCEL on one hop: Request-URI, Route, and branch of the INVITE on that hop (RFC 3261 §9.1). */
  cancel(h: Hop): Msg {
    return {
      line: `CANCEL ${ruriOf(h.msg)} SIP/2.0`, via: [h.msg.via[0]!], maxForwards: 70, route: h.msg.route,
      from: h.msg.from, to: h.msg.to, callId: h.msg.callId, cseq: `${h.msg.cseq.split(' ')[0]} CANCEL`,
    };
  }
}

// ---------------------------------------------------------------------------
// Dialogs between two user agents, with no proxy in the path (Module 22)

export interface Party {
  node: Node;
  /** Display name and AOR, for From and To. */
  name: string;
  aor: string;
  /** Tag in this dialog. */
  tag: string;
  /** Last CSeq number this party sent in this dialog. */
  seq: number;
  /** The party's current SDP; `version` goes up with each change. */
  media: SdpSpec;
}

/** Methods whose requests carry Contact (RFC 3261 §8.1.1.8, RFC 3311, RFC 3515, RFC 6665). */
const WITH_CONTACT = new Set(['INVITE', 'UPDATE', 'REFER', 'SUBSCRIBE', 'NOTIFY']);

export class Dialog {
  readonly w: FlowWriter;
  readonly callId: string;
  readonly caller: Party;
  readonly callee: Party;
  /** False until the 2xx to the INVITE: requests before it are out of the dialog. */
  established = false;

  constructor(w: FlowWriter, callId: string, caller: Party, callee: Party) {
    this.w = w;
    this.callId = callId;
    this.caller = caller;
    this.callee = callee;
  }

  other(p: Party): Party { return p === this.caller ? this.callee : this.caller; }
  nameAddr(p: Party, tagged = true): string { return `${p.name} <${p.aor}>${tagged ? `;tag=${p.tag}` : ''}`; }

  /** A request from `from`: the initial INVITE before the dialog exists, an in-dialog request after. */
  request(from: Party, method: string, more: Partial<Msg> = {}): Msg {
    const to = this.other(from);
    const ruri = this.established ? to.node.contact! : to.aor;
    return {
      line: `${method} ${ruri} SIP/2.0`, via: [this.w.via(from.node)], maxForwards: 70,
      from: this.nameAddr(from), to: this.nameAddr(to, this.established), callId: this.callId,
      cseq: `${method === 'ACK' ? from.seq : ++from.seq} ${method}`,
      contact: WITH_CONTACT.has(method) ? from.node.contact : undefined, ...more,
    };
  }

  /** The ACK for a 2xx: a new transaction, with the CSeq number of its INVITE (RFC 3261 §13.2.2.4). */
  ack(from: Party, inviteSeq: number, more: Partial<Msg> = {}): Msg {
    const m = this.request(from, 'ACK', more);
    return { ...m, line: `ACK ${this.other(from).node.contact} SIP/2.0`, to: this.nameAddr(this.other(from)), cseq: `${inviteSeq} ACK` };
  }

  hop(from: Party, msg: Msg): Hop { return { from: from.node, to: this.other(from).node, msg }; }
}

/** Advances a party's SDP to its next version, with the changes given. */
export function nextMedia(p: Party, change: Partial<SdpSpec>): SdpSpec {
  p.media = { ...p.media, ...change, version: (p.media.version ?? p.media.id) + 1 };
  return p.media;
}
