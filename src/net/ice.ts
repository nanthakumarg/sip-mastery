/**
 * ICE (RFC 8445) for Module 20: candidates and their priorities, candidate
 * pairs, and connectivity checks run through the NAT routers of
 * src/net/nat.ts. The diagram is src/diagrams/IceChecker.tsx.
 */
import { fmt, reached, sameAddr, type Addr, type Trace, type World } from './nat.ts';

export type CandidateType = 'host' | 'srflx' | 'prflx' | 'relay';

/** RFC 8445 §5.1.2.2: the recommended type preferences. */
export const TYPE_PREF: Record<CandidateType, number> = { host: 126, prflx: 110, srflx: 100, relay: 0 };

export const TYPE_NAME: Record<CandidateType, string> = {
  host: 'host', srflx: 'server-reflexive', prflx: 'peer-reflexive', relay: 'relayed',
};

/** RFC 8445 §5.1.2.1: priority = 2^24 × type preference + 2^8 × local preference + (256 − component ID). */
export function candidatePriority(type: CandidateType, localPref = 65535, component = 1): number {
  return TYPE_PREF[type] * 2 ** 24 + localPref * 2 ** 8 + (256 - component);
}

/** RFC 8445 §6.1.2.3: G is the controlling agent's candidate, D the controlled agent's. 64 bits, so a BigInt. */
export function pairPriority(g: number, d: number): bigint {
  const G = BigInt(g), D = BigInt(d);
  const min = G < D ? G : D, max = G > D ? G : D;
  return (1n << 32n) * min + 2n * max + (G > D ? 1n : 0n);
}

export interface Candidate {
  foundation: string;
  type: CandidateType;
  addr: Addr;
  /** The address the agent sends from (RFC 8445 §5.1.1): the host address, or the relayed address itself. */
  base: Addr;
  priority: number;
  /** raddr and rport in SDP: the base of a reflexive candidate, the mapped address of a relayed one. */
  related?: Addr;
}

/** The SDP attribute for a candidate (RFC 8839 §5.1), for component 1 (RTP, with rtcp-mux). */
export function candidateLine(c: Candidate): string {
  const rel = c.related ? ` raddr ${c.related.ip} rport ${c.related.port}` : '';
  return `a=candidate:${c.foundation} 1 UDP ${c.priority} ${c.addr.ip} ${c.addr.port} typ ${c.type}${rel}`;
}

export interface IceAgent {
  /** The host id in the World. */
  id: string;
  label: string;
  /** The port the agent uses for media and for its checks. */
  port: number;
  stun?: Addr;
  turn?: Addr;
}

const mk = (foundation: string, type: CandidateType, addr: Addr, base: Addr, related?: Addr): Candidate =>
  ({ foundation, type, addr, base, priority: candidatePriority(type), ...(related ? { related } : {}) });

/** RFC 8445 §5.1.1: host, server-reflexive (STUN Binding), and relayed (TURN Allocate) candidates. */
export function gather(world: World, a: IceAgent): Candidate[] {
  const host = { ip: world.host(a.id).ip, port: a.port };
  const out = [mk('1', 'host', host, host)];
  let mapped: Addr | undefined;
  if (a.stun) {
    const t = world.send(a.id, a.port, a.stun);
    if (!t.lost) mapped = t.peer;
  }
  let relay: { relayed: Addr; mapped: Addr } | undefined;
  if (a.turn) {
    relay = world.allocate(a.id, a.port, a.turn);
    mapped ??= relay?.mapped;
  }
  // A server-reflexive candidate equal to the host candidate is redundant (§5.1.3): there is no NAT.
  if (mapped && !sameAddr(mapped, host)) out.push(mk('2', 'srflx', mapped, host, host));
  if (relay) out.push(mk('3', 'relay', relay.relayed, relay.relayed, relay.mapped));
  return out;
}

export type PairState = 'frozen' | 'failed' | 'succeeded';

export interface Pair {
  local: Candidate;
  remote: Candidate;
  priority: bigint;
  state: PairState;
  /** After a successful check: the local address the peer saw (may be a new peer-reflexive candidate). */
  mapped?: Addr;
}

/**
 * RFC 8445 §6.1.2: pairs every local candidate with every remote one. A
 * reflexive local candidate is replaced by its base, which makes it
 * redundant with the host pair, so it is pruned (§6.1.2.4).
 */
export function checklist(locals: Candidate[], remotes: Candidate[], controlling: boolean): Pair[] {
  const pairs: Pair[] = [];
  for (const l of locals.filter(c => c.type === 'host' || c.type === 'relay')) {
    for (const r of remotes) {
      const priority = controlling ? pairPriority(l.priority, r.priority) : pairPriority(r.priority, l.priority);
      pairs.push({ local: l, remote: r, priority, state: 'frozen' });
    }
  }
  return pairs.sort((a, b) => (b.priority > a.priority ? 1 : b.priority < a.priority ? -1 : 0));
}

export interface CheckEvent {
  by: string;
  kind: 'ordinary' | 'triggered';
  local: Candidate;
  to: Addr;
  ok: boolean;
  /** Why the request or its response did not arrive. */
  reason?: string;
  /** A peer-reflexive candidate learned from this check. */
  learned?: string;
}

export interface Selected {
  pair: Pair;
  /** The controlled agent's side of the same path: its local candidate and the address it sends to. */
  peerLocal: Candidate;
  peerRemote: Addr;
}

export interface IceResult {
  local: Candidate[];
  remote: Candidate[];
  /** The controlling agent's checklist, after the checks. */
  pairs: Pair[];
  events: CheckEvent[];
  selected?: Selected;
}

interface Side {
  agent: IceAgent;
  locals: Candidate[];
  remotes: Candidate[];
  pairs: Pair[];
  triggered: Pair[];
  /** For each pair that this side answered: where the check came in, and from whom. */
  answered: { local: Candidate; from: Addr; pairOfPeer: Pair }[];
}

const sendOn = (world: World, a: IceAgent, local: Candidate, to: Addr): Trace =>
  world.send(a.id, a.port, to, local.type === 'relay' ? local.addr : undefined);

const arrivedOn = (t: Trace, a: IceAgent, local: Candidate) =>
  reached(t, a.id, a.port, local.type === 'relay' ? local.addr : undefined);

/**
 * Runs ICE between a controlling agent L and a controlled agent R: both
 * gather candidates, exchange them (in SDP), and check their pairs in
 * priority order, with triggered checks (RFC 8445 §7.3.1.4). L nominates
 * the highest-priority pair that works.
 */
export function runIce(world: World, L: IceAgent, R: IceAgent): IceResult {
  const lc = gather(world, L), rc = gather(world, R);
  // Each agent lets its peer's candidates through its TURN allocation (RFC 8445 §5.1.1.2, RFC 8656 §9).
  for (const [mine, theirs] of [[lc, rc], [rc, lc]] as const) {
    for (const c of mine.filter(x => x.type === 'relay')) for (const r of theirs) world.permit(c.addr, r.addr.ip);
  }
  const sides: Side[] = [
    { agent: L, locals: lc, remotes: [...rc], pairs: checklist(lc, rc, true), triggered: [], answered: [] },
    { agent: R, locals: rc, remotes: [...lc], pairs: checklist(rc, lc, false), triggered: [], answered: [] },
  ];
  const events: CheckEvent[] = [];

  const check = (me: Side, peer: Side, pair: Pair, kind: CheckEvent['kind']) => {
    const ev: CheckEvent = { by: me.agent.label, kind, local: pair.local, to: pair.remote.addr, ok: false };
    events.push(ev);
    const req = sendOn(world, me.agent, pair.local, pair.remote.addr);
    const at = peer.locals.find(c => arrivedOn(req, peer.agent, c));
    if (!at) {
      ev.reason = req.lost ?? 'The check went to the wrong place';
      if (pair.state === 'frozen') pair.state = 'failed';
      return;
    }
    const from = req.peer!;
    // The peer learns a peer-reflexive candidate if the source is new (§7.3.1.3), and checks back at once (§7.3.1.4).
    let remote = peer.remotes.find(c => sameAddr(c.addr, from));
    if (!remote) {
      remote = mk('4', 'prflx', from, from);
      peer.remotes.push(remote);
    }
    let back = peer.pairs.find(p => p.local === at && p.remote === remote);
    if (!back) {
      const priority = peer === sides[0] ? pairPriority(at.priority, remote.priority) : pairPriority(remote.priority, at.priority);
      back = { local: at, remote, priority, state: 'frozen' };
      peer.pairs.push(back);
    }
    if (back.state !== 'succeeded' && !peer.triggered.includes(back)) peer.triggered.push(back);
    // The response goes back from where the request arrived, to where it came from.
    const res = sendOn(world, peer.agent, at, from);
    if (!arrivedOn(res, me.agent, pair.local)) {
      ev.reason = `The response was lost: ${res.lost ?? 'it arrived somewhere else'}`;
      if (pair.state === 'frozen') pair.state = 'failed';
      return;
    }
    ev.ok = true;
    pair.state = 'succeeded';
    pair.mapped = from;
    peer.answered.push({ local: at, from, pairOfPeer: pair });
    if (pair.local.type !== 'relay' && !me.locals.some(c => sameAddr(c.addr, from))) {
      ev.learned = `peer-reflexive ${fmt(from)}`;
    }
  };

  const [l, r] = sides as [Side, Side];
  const turn = (me: Side, peer: Side, i: number) => {
    while (me.triggered.length) {
      const p = me.triggered.shift()!;
      if (p.state !== 'succeeded') check(me, peer, p, 'triggered');
    }
    const p = me.pairs[i];
    if (p && p.state !== 'succeeded') check(me, peer, p, 'ordinary');
  };
  // Two rounds: a check that failed because the peer had not yet sent its own is sent again (§6.1.4, retransmission).
  for (let round = 0; round < 2; round++) {
    const n = Math.max(l.pairs.length, r.pairs.length);
    for (let i = 0; i < n; i++) { turn(l, r, i); turn(r, l, i); }
  }
  turn(l, r, -1);
  turn(r, l, -1);

  l.pairs.sort((a, b) => (b.priority > a.priority ? 1 : b.priority < a.priority ? -1 : 0));
  const best = l.pairs.find(p => p.state === 'succeeded');
  let selected: Selected | undefined;
  if (best) {
    const seen = r.answered.find(x => x.pairOfPeer === best)!;
    selected = { pair: best, peerLocal: seen.local, peerRemote: seen.from };
  }
  return { local: lc, remote: rc, pairs: l.pairs, events, selected };
}

/** Sends one media packet on the selected path, from L (forward) or from R. */
export function sendMedia(world: World, s: Selected, L: IceAgent, R: IceAgent, fromL: boolean): Trace {
  return fromL
    ? sendOn(world, L, s.pair.local, s.pair.remote.addr)
    : sendOn(world, R, s.peerLocal, s.peerRemote);
}

export const mediaArrived = (t: Trace, s: Selected, L: IceAgent, R: IceAgent, fromL: boolean) =>
  fromL ? arrivedOn(t, R, s.peerLocal) : arrivedOn(t, L, s.pair.local);
