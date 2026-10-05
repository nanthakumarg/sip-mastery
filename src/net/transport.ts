/**
 * Transports for Module 19: how a SIP message of a given size travels over
 * UDP (as IP fragments, retransmitted whole by SIP) and over TCP (as
 * segments, each retransmitted by TCP), and the 1300-byte rule of
 * RFC 3261 §18.1.1. The diagram is src/diagrams/TransportRace.tsx.
 */
import { random } from './rtp.ts';

export interface Fragment { index: number; offset: number; payload: number; packet: number }

/**
 * IP fragments of one UDP datagram that carries `sipBytes` of SIP. IPv4: 20-byte
 * header; IPv6: 40 bytes, plus an 8-byte fragment header when fragmented.
 * Every fragment but the last carries a multiple of 8 bytes.
 */
export function fragmentUdp(sipBytes: number, mtu: number, ipv6 = false): Fragment[] {
  const datagram = sipBytes + 8;
  const ip = ipv6 ? 40 : 20;
  if (datagram + ip <= mtu) return [{ index: 0, offset: 0, payload: datagram, packet: datagram + ip }];
  const fragHeader = ipv6 ? 8 : 0;
  const max = Math.floor((mtu - ip - fragHeader) / 8) * 8;
  const out: Fragment[] = [];
  for (let off = 0, i = 0; off < datagram; off += max, i++) {
    const payload = Math.min(max, datagram - off);
    out.push({ index: i, offset: off, payload, packet: payload + ip + fragHeader });
  }
  return out;
}

/** TCP segments for the same message: MSS = MTU − IP − 20 (TCP). TLS adds about 22 bytes per record. */
export function tcpSegments(sipBytes: number, mtu: number, ipv6 = false, tls = false): number {
  const mss = mtu - (ipv6 ? 40 : 20) - 20;
  return Math.max(1, Math.ceil((sipBytes + (tls ? 22 : 0)) / mss));
}

export interface SizeRule { mustUseCongestionControlled: boolean; reason: string }

/** RFC 3261 §18.1.1: within 200 bytes of the path MTU, or over 1300 bytes when the MTU is unknown. */
export function sizeRule(requestBytes: number, pathMtu?: number): SizeRule {
  if (pathMtu !== undefined && requestBytes > pathMtu - 200) {
    return { mustUseCongestionControlled: true, reason: `${requestBytes} bytes is within 200 bytes of the path MTU (${pathMtu}): send it over TCP.` };
  }
  if (pathMtu === undefined && requestBytes > 1300) {
    return { mustUseCongestionControlled: true, reason: `${requestBytes} bytes is over 1300 and the path MTU is unknown: send it over TCP.` };
  }
  return { mustUseCongestionControlled: false, reason: `${requestBytes} bytes fits in one UDP packet${pathMtu ? ` with room for a larger response` : ''}: UDP is allowed.` };
}

/** INVITE retransmissions over UDP: Timer A doubles from T1 = 0.5 s; Timer B gives up at 64 × T1 = 32 s. */
export const UDP_SENDS = [0, 0.5, 1.5, 3.5, 7.5, 15.5, 31.5];

export interface RaceInput {
  sipBytes: number;
  mtu: number;
  ipv6: boolean;
  /** Packet loss on the path, percent, for each packet. */
  loss: number;
  /** A firewall or NAT that drops IP fragments after the first. */
  dropFragments: boolean;
  /** One-way delay, ms. */
  delay: number;
  seed: number;
}

export interface UdpAttempt { at: number; fragments: boolean[]; ok: boolean }
export interface TcpEvent { what: string; at: number; ok: boolean }

export interface Race {
  fragments: Fragment[];
  udp: { attempts: UdpAttempt[]; delivered: boolean; at?: number };
  tcp: { segments: number; events: TcpEvent[]; delivered: boolean; at: number };
  rule: SizeRule;
}

/** Sends the same message over UDP and over TCP, with the same random losses. */
export function race(i: RaceInput): Race {
  const rnd = random(i.seed);
  const lost = () => rnd() * 100 < i.loss;
  const d = i.delay / 1000;
  const fragments = fragmentUdp(i.sipBytes, i.mtu, i.ipv6);

  // UDP: every fragment of one attempt must arrive; a lost fragment loses the whole datagram.
  const attempts: UdpAttempt[] = [];
  let at: number | undefined;
  for (const t of UDP_SENDS) {
    const f = fragments.map(fr => !(lost() || (i.dropFragments && fr.index > 0)));
    const ok = f.every(Boolean);
    attempts.push({ at: t, fragments: f, ok });
    if (ok) { at = t + d; break; }
  }

  // TCP: a three-way handshake, then segments; TCP resends only the lost segment, after its timeout.
  const rto = Math.max(0.2, 4 * d);
  const events: TcpEvent[] = [];
  let t = 0;
  for (const what of ['SYN', 'SYN-ACK', 'ACK']) {
    while (lost()) { events.push({ what, at: t, ok: false }); t += 1; } // SYN timeout: 1 s (RFC 6298)
    events.push({ what, at: t, ok: true });
    t += d;
  }
  const segments = tcpSegments(i.sipBytes, i.mtu, i.ipv6);
  let last = t;
  for (let s = 0; s < segments; s++) {
    let ts = t;
    while (lost()) { events.push({ what: `segment ${s + 1}`, at: ts, ok: false }); ts += rto; }
    events.push({ what: `segment ${s + 1}`, at: ts, ok: true });
    last = Math.max(last, ts + d);
  }
  return {
    fragments,
    udp: { attempts, delivered: at !== undefined, at },
    tcp: { segments, events, delivered: true, at: last },
    rule: sizeRule(i.sipBytes),
  };
}
