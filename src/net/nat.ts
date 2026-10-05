/**
 * NAT for Module 20: a NAT router with the mapping and filtering behaviours
 * of RFC 4787, a small Internet of hosts, NAT routers and TURN relays, and a
 * call between two phones behind NAT with the usual fixes turned on or off.
 * The diagrams are src/diagrams/NatSimulator.tsx and src/diagrams/IceChecker.tsx;
 * ICE itself is in src/net/ice.ts.
 */
import { classify } from './address.ts';

export interface Addr { ip: string; port: number }
export const fmt = (a: Addr) => `${a.ip}:${a.port}`;
export const sameAddr = (a: Addr, b: Addr) => a.ip === b.ip && a.port === b.port;

/** RFC 4787 §4.1 and §5: what a mapping or a filter depends on, besides the internal address and port. */
export type Dependence = 'independent' | 'address' | 'address-port';
export interface NatBehaviour { mapping: Dependence; filtering: Dependence }

export type NatKind = 'none' | 'full-cone' | 'restricted' | 'port-restricted' | 'symmetric';

/** The old STUN names (RFC 3489) and the RFC 4787 behaviours they stand for. */
export const NAT_KINDS: Record<NatKind, { label: string; short: string; behaviour?: NatBehaviour }> = {
  'none': { label: 'No NAT', short: 'Public address' },
  'full-cone': { label: 'Full cone', short: 'EIM · EIF', behaviour: { mapping: 'independent', filtering: 'independent' } },
  'restricted': { label: 'Restricted cone', short: 'EIM · ADF', behaviour: { mapping: 'independent', filtering: 'address' } },
  'port-restricted': { label: 'Port-restricted cone', short: 'EIM · APDF', behaviour: { mapping: 'independent', filtering: 'address-port' } },
  'symmetric': { label: 'Symmetric', short: 'APDM · APDF', behaviour: { mapping: 'address-port', filtering: 'address-port' } },
};

interface Binding { internal: Addr; key: string; external: Addr; sentTo: Set<string> }

/** The result of a packet arriving at the public side of a NAT. */
export interface Inbound { to?: Addr; reason?: string }

/** A NAT router (RFC 4787): one public address, and a table of mappings that outgoing packets create. */
export class Nat {
  private table: Binding[] = [];
  private next: number;
  readonly behaviour: NatBehaviour;
  readonly publicIp: string;
  constructor(behaviour: NatBehaviour, publicIp: string, firstPort = 40112) {
    this.behaviour = behaviour;
    this.publicIp = publicIp;
    this.next = firstPort;
  }

  private key(dst: Addr, d: Dependence) {
    return d === 'independent' ? '*' : d === 'address' ? dst.ip : fmt(dst);
  }

  /** An outgoing packet from `src` to `dst`: returns the public source address after translation. */
  out(src: Addr, dst: Addr): Addr {
    const k = this.key(dst, this.behaviour.mapping);
    let b = this.table.find(x => sameAddr(x.internal, src) && x.key === k);
    if (!b) {
      b = { internal: src, key: k, external: { ip: this.publicIp, port: this.next }, sentTo: new Set() };
      this.next += 2;
      this.table.push(b);
    }
    b.sentTo.add(fmt(dst));
    return b.external;
  }

  /** An incoming packet from `from` to the public address `to`: the internal address, or why it was dropped. */
  in(from: Addr, to: Addr): Inbound {
    const b = this.table.find(x => sameAddr(x.external, to));
    if (!b) return { reason: `No mapping for port ${to.port}: the NAT router drops it` };
    const f = this.behaviour.filtering;
    const sent = [...b.sentTo];
    const ok = f === 'independent' || (f === 'address' ? sent.some(s => s.split(':')[0] === from.ip) : b.sentTo.has(fmt(from)));
    if (!ok) {
      return { reason: f === 'address'
        ? `Filtered: nothing was sent from this mapping to ${from.ip} yet`
        : `Filtered: nothing was sent from this mapping to ${fmt(from)} yet` };
    }
    return { to: b.internal };
  }

  get mappings(): readonly { internal: Addr; external: Addr }[] {
    return this.table;
  }
}

export const isPrivate = (ip: string) => ['private', 'cgnat'].includes(classify(ip).kind);

/** One host in the simulated Internet: a phone or a server. A phone behind NAT has a private address. */
export interface Host { id: string; label: string; ip: string; nat?: Nat }

/** One hop of a packet: its source before and after NAT, its destination before and after NAT. */
export interface Leg { src: Addr; out: Addr; dst: Addr; arrive?: Addr; lost?: string }

export interface Trace {
  legs: Leg[];
  /** The host that received the packet. */
  to?: string;
  arrive?: Addr;
  lost?: string;
  /** The source address that the receiver sees (through a relay: the peer's address at the relay). */
  peer?: Addr;
  /** The TURN relayed address the packet came in through, if any. */
  via?: Addr;
}

interface Allocation { relayed: Addr; server: Addr; client: string; mapped: Addr; perms: Set<string> }

/** A small Internet: hosts, their NAT routers, and the allocations on TURN servers (RFC 8656). */
export class World {
  private hosts = new Map<string, Host>();
  private allocs: Allocation[] = [];
  private nextRelay = 50000;

  add(h: Host) {
    this.hosts.set(h.id, h);
    return this;
  }

  host(id: string): Host {
    const h = this.hosts.get(id);
    if (!h) throw new Error(`No host ${id}`);
    return h;
  }

  /** Sends a UDP packet from a host's port to `dst`, or through its TURN allocation at `relay`. */
  send(hostId: string, port: number, dst: Addr, relay?: Addr): Trace {
    const h = this.host(hostId);
    const src = { ip: h.ip, port };
    if (relay) {
      const a = this.allocs.find(x => sameAddr(x.relayed, relay));
      if (!a) return { legs: [], lost: 'No TURN allocation' };
      const first = this.send(hostId, port, a.server);
      if (first.lost) return first;
      // The TURN server sends the data on from the relayed address (a Send indication or ChannelData, RFC 8656 §3.4).
      a.perms.add(dst.ip);
      return this.route(first.legs, a.relayed, a.relayed, dst);
    }
    return this.route([], src, h.nat ? h.nat.out(src, dst) : src, dst);
  }

  private route(legs: Leg[], src: Addr, out: Addr, dst: Addr): Trace {
    const leg: Leg = { src, out, dst };
    const all = [...legs, leg];
    const lost = (reason: string): Trace => { leg.lost = reason; return { legs: all, lost: reason }; };

    const a = this.allocs.find(x => sameAddr(x.relayed, dst));
    if (a) {
      if (!a.perms.has(out.ip)) return lost(`The TURN server has no permission for ${out.ip}: it drops the packet`);
      // Relayed to the client inside a Data indication, from the server's own address.
      leg.arrive = dst;
      const t = this.route(all, a.server, a.server, a.mapped);
      return { ...t, peer: out, via: a.relayed };
    }
    if (isPrivate(dst.ip)) return lost(`${dst.ip} is a private address: no router on the Internet can deliver it`);
    const h = [...this.hosts.values()].find(x => (x.nat ? x.nat.publicIp : x.ip) === dst.ip);
    if (!h) return lost(`Nothing answers at ${dst.ip}`);
    if (!h.nat) { leg.arrive = dst; return { legs: all, to: h.id, arrive: dst, peer: out }; }
    const r = h.nat.in(out, dst);
    if (!r.to) return lost(r.reason!);
    leg.arrive = r.to;
    return { legs: all, to: h.id, arrive: r.to, peer: out };
  }

  /** A TURN Allocate request from a host's port: the relayed address and the server-reflexive address the server saw. */
  allocate(hostId: string, port: number, server: Addr): { relayed: Addr; mapped: Addr } | undefined {
    const t = this.send(hostId, port, server);
    if (t.lost) return undefined;
    const relayed = { ip: server.ip, port: this.nextRelay };
    this.nextRelay += 2;
    this.allocs.push({ relayed, server, client: hostId, mapped: t.peer!, perms: new Set() });
    return { relayed, mapped: t.peer! };
  }

  /** A TURN CreatePermission (RFC 8656 §9): the relay accepts packets from this IP address. */
  permit(relayed: Addr, ip: string) {
    this.allocs.find(x => sameAddr(x.relayed, relayed))?.perms.add(ip);
  }
}

/** Did a packet reach this host's port (or this relayed address)? */
export const reached = (t: Trace, hostId: string, port: number, via?: Addr) =>
  !t.lost && t.to === hostId && (via ? !!t.via && sameAddr(t.via, via) : !t.via && t.arrive?.port === port);
