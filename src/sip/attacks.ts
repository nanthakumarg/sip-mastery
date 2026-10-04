/**
 * Attack surface model (Module 14): the classic attacks on a SIP service, and
 * the defences that close each one. An attack is open unless one of its
 * `closedBy` sets is fully switched on; an attack with `needs` is open only
 * while one of the attacks it needs is open (a stolen password needs a way to
 * steal it). The diagram is src/diagrams/AttackMap.tsx.
 */

export type DefenceId = 'tls' | 'srtp' | 'strong' | 'block' | 'uniform' | 'auth' | 'hide' | 'rate' | 'trust' | 'mtls';

export interface Defence {
  id: DefenceId;
  label: string;
  /** Where it acts on the map: a node or a link id. */
  at: string;
  detail: string;
}

export const DEFENCES: Defence[] = [
  { id: 'tls', label: 'TLS for SIP', at: 'access', detail: 'Phones register and call over TLS, and check the server certificate.' },
  { id: 'srtp', label: 'SRTP for media', at: 'media', detail: 'RTP is encrypted. With SDES, the keys travel in the SDP, so they need TLS too.' },
  { id: 'strong', label: 'Strong passwords', at: 'registrar', detail: 'Long random SIP passwords, never the extension number or 1234.' },
  { id: 'block', label: 'Block after failed logins', at: 'sbc', detail: 'The SBC blocks a source address after a few failed challenges.' },
  { id: 'uniform', label: 'Same answer for unknown users', at: 'registrar', detail: 'A REGISTER for a user who does not exist gets a 401, like any other.' },
  { id: 'auth', label: 'Challenge every outgoing call', at: 'proxyA', detail: 'Proxy A sends 407 to any INVITE to the outside without valid credentials.' },
  { id: 'hide', label: 'Topology hiding', at: 'sbc', detail: 'The SBC replaces inside addresses in Via, Record-Route, Contact, and SDP.' },
  { id: 'rate', label: 'Rate limits', at: 'sbc', detail: 'The SBC limits requests per second from each source, and in total.' },
  { id: 'trust', label: 'PAI only from trusted peers', at: 'proxyA', detail: 'Proxy A removes P-Asserted-Identity from requests that come from outside the trust domain.' },
  { id: 'mtls', label: 'Mutual TLS on the trunk', at: 'trunk', detail: 'Proxy A and the carrier each check the other\'s certificate.' },
];

export interface Attack {
  id: string;
  name: string;
  /** What the attacker does. */
  how: string;
  /** What it costs the victim. */
  impact: string;
  /** Points on the map, by node or link id. */
  path: string[];
  closedBy: DefenceId[][];
  needs?: string[];
  rfc: string;
}

export const ATTACKS: Attack[] = [
  {
    id: 'sniff', name: 'Reading the signaling', path: ['attacker', 'access'], closedBy: [['tls']], rfc: 'rfc3261-26.2.1-tls',
    how: 'Captures SIP on the Wi-Fi, the access network, or a hacked router.',
    impact: 'Learns who calls whom and when, user names, and the digest exchange.',
  },
  {
    id: 'record', name: 'Recording calls', path: ['attacker', 'media'], closedBy: [['srtp', 'tls']], rfc: 'rfc3261-26.1.3-sdp',
    how: 'Captures the RTP packets and plays them back as audio. With SDES, reads the SRTP keys from the SDP.',
    impact: 'Hears every word of the call.',
  },
  {
    id: 'scan', name: 'Listing extensions', path: ['attacker', 'sbc', 'registrar'], closedBy: [['uniform']], rfc: 'rfc3261-26.1-threats',
    how: 'Sends a REGISTER or OPTIONS for 100, 101, 102… and notes which ones get 401 and which 404.',
    impact: 'A list of real user names to attack next.',
  },
  {
    id: 'guess', name: 'Guessing passwords', path: ['attacker', 'sbc', 'registrar'], closedBy: [['strong'], ['block']], rfc: 'rfc3261-26.3.2.1-forge',
    how: 'Answers the 401 challenge again and again, with common passwords, thousands per minute.',
    impact: 'A working password for an extension.',
  },
  {
    id: 'crack', name: 'Cracking a captured digest', path: ['attacker', 'access'], closedBy: [['tls'], ['strong']], rfc: 'rfc3261-26.3.2.1-intercept',
    how: 'Takes a captured REGISTER with its Authorization header and tries passwords offline, as fast as the computer allows.',
    impact: 'A working password, without sending a single request.',
  },
  {
    id: 'hijack', name: 'Registration hijack', path: ['attacker', 'sbc', 'registrar'], closedBy: [], needs: ['guess', 'crack'], rfc: 'rfc3261-26.1.1-hijack',
    how: 'Registers its own Contact with the stolen password, or removes the user\'s bindings.',
    impact: 'Receives the user\'s calls, or makes the user unreachable.',
  },
  {
    id: 'relay', name: 'Calls without a password', path: ['attacker', 'sbc', 'proxyA', 'trunk', 'carrier'], closedBy: [['auth']], rfc: 'rfc3261-26.3.2.2-relay',
    how: 'Sends an INVITE for an expensive international number straight to the proxy, with no credentials.',
    impact: 'Toll fraud: the calls run on the company\'s trunk and bill.',
  },
  {
    id: 'fraud', name: 'Toll fraud with a stolen password', path: ['attacker', 'sbc', 'proxyA', 'trunk', 'carrier'], closedBy: [], needs: ['guess', 'crack'], rfc: 'rfc3261-26.1.1-gateway',
    how: 'Uses a guessed or cracked password to answer the 407, then calls premium-rate numbers all weekend.',
    impact: 'A phone bill of thousands, often found on Monday.',
  },
  {
    id: 'flood', name: 'Flooding', path: ['attacker', 'sbc'], closedBy: [['rate']], rfc: 'rfc3261-26.1.5-internet',
    how: 'Sends thousands of INVITE or REGISTER requests per second, often with forged source addresses.',
    impact: 'Real calls and registrations fail: denial of service.',
  },
  {
    id: 'map', name: 'Mapping the inside network', path: ['proxyA', 'sbc', 'attacker'], closedBy: [['hide']], rfc: 'rfc3323-4.1-reveal',
    how: 'Reads the Via, Record-Route, Contact, and SDP addresses of the responses it gets.',
    impact: 'Inside addresses and server types to aim the next attack at.',
  },
  {
    id: 'pai', name: 'Faking the caller ID', path: ['attacker', 'sbc', 'proxyA', 'alice'], closedBy: [['trust']], rfc: 'rfc3325-5-untrusted',
    how: 'Calls Alice with P-Asserted-Identity set to her bank\'s number.',
    impact: 'Alice\'s phone shows a trusted number, and she believes the caller.',
  },
  {
    id: 'spoof', name: 'Pretending to be the carrier', path: ['attacker', 'trunk', 'proxyA'], closedBy: [['mtls']], rfc: 'rfc5922-7.4-peers',
    how: 'Sends requests from a forged source address of the carrier, so they look like trunk traffic.',
    impact: 'Free calls or fake caller IDs, with the carrier\'s trust.',
  },
];

export type AttackState = { open: boolean; closedBy?: DefenceId[] };

/** Whether each attack is open with these defences on. */
export function attackStates(on: Set<DefenceId>): Record<string, AttackState> {
  const out: Record<string, AttackState> = {};
  const byId = new Map(ATTACKS.map(a => [a.id, a]));
  const state = (a: Attack): AttackState => {
    if (out[a.id]) return out[a.id]!;
    const closer = a.closedBy.find(set => set.every(d => on.has(d)));
    let s: AttackState = closer ? { open: false, closedBy: closer } : { open: true };
    if (s.open && a.needs) {
      const sources = a.needs.map(n => state(byId.get(n)!));
      if (sources.every(x => !x.open)) s = { open: false, closedBy: [...new Set(sources.flatMap(x => x.closedBy ?? []))] };
    }
    return (out[a.id] = s);
  };
  for (const a of ATTACKS) state(a);
  return out;
}

/** The fewest defences that close every attack, found by trying all sets (there are only 1024). */
export function smallestCover(): DefenceId[] {
  const ids = DEFENCES.map(d => d.id);
  let best: DefenceId[] = ids;
  for (let mask = 0; mask < 1 << ids.length; mask++) {
    const set = ids.filter((_, i) => mask & (1 << i));
    if (set.length >= best.length) continue;
    const s = attackStates(new Set(set));
    if (Object.values(s).every(x => !x.open)) best = set;
  }
  return best;
}
