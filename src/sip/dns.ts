/**
 * Locating SIP servers with DNS (Module 11): RFC 3263 §4 on top of the
 * SRV ordering of RFC 2782. Given a SIP or SIPS URI, a DNS zone, and the
 * transports the client supports, it lists every lookup the client makes and
 * the ordered list of (address, port, transport) to try. Then it plays the
 * attempts against servers that are up or down (RFC 3263 §4.3).
 * Used by the DNS resolver step-through and tests/dns.test.ts.
 */

export type Transport = 'UDP' | 'TCP' | 'TLS';
export type NaptrService = 'SIPS+D2T' | 'SIP+D2T' | 'SIP+D2U' | 'SIPS+D2U';

export interface Naptr { order: number; pref: number; service: NaptrService; replacement: string }
export interface Srv { priority: number; weight: number; port: number; target: string }

export interface Zone {
  naptr: Record<string, Naptr[]>;
  srv: Record<string, Srv[]>;
  a: Record<string, string[]>;
  /** TTL in seconds shown in the answers. */
  ttl?: number;
}

/* ------------------------------------------------------------------ */
/* RFC 2782: order the SRV records                                     */
/* ------------------------------------------------------------------ */

export interface WeightDraw {
  priority: number;
  /** The records still to order at this priority, with their running sums. */
  pool: { srv: Srv; sum: number }[];
  /** The random number, from 0 to the total weight. */
  r: number;
  picked: Srv;
}

/**
 * Orders SRV records as RFC 2782 says: lowest priority first; inside one
 * priority, a weighted random draw (weight-0 records first in the running
 * sum, so they win only when the draw is 0). `random` returns [0, 1).
 */
export function srvOrder(records: Srv[], random: () => number = Math.random): { order: Srv[]; draws: WeightDraw[] } {
  const order: Srv[] = [];
  const draws: WeightDraw[] = [];
  const priorities = [...new Set(records.map(r => r.priority))].sort((a, b) => a - b);
  for (const priority of priorities) {
    let left = records.filter(r => r.priority === priority);
    left = [...left.filter(r => r.weight === 0), ...left.filter(r => r.weight > 0)];
    while (left.length) {
      let sum = 0;
      const pool = left.map(srv => ({ srv, sum: (sum += srv.weight) }));
      const r = Math.min(sum, Math.floor(random() * (sum + 1)));
      const picked = pool.find(p => p.sum >= r)!.srv;
      draws.push({ priority, pool, r, picked });
      order.push(picked);
      left = left.filter(x => x !== picked);
    }
  }
  return { order, draws };
}

/* ------------------------------------------------------------------ */
/* RFC 3263 §4.1 and §4.2: transport, port, and addresses              */
/* ------------------------------------------------------------------ */

export interface ParsedTarget {
  secure: boolean;
  host: string;
  port?: number;
  transport?: Transport;
  numeric: boolean;
}

export function parseTarget(uri: string): ParsedTarget {
  const m = /^(sips?):(?:[^@]*@)?(\[[^\]]+\]|[^:;?>]+)(?::(\d+))?([^?>]*)/i.exec(uri.trim());
  if (!m) throw new Error(`Not a SIP URI: ${uri}`);
  const secure = m[1]!.toLowerCase() === 'sips';
  const params = m[4] ?? '';
  const maddr = /;maddr=([^;]+)/i.exec(params)?.[1];
  const host = (maddr ?? m[2]!).toLowerCase();
  const tp = /;transport=([a-z]+)/i.exec(params)?.[1]?.toLowerCase();
  const transport: Transport | undefined = tp === 'udp' ? 'UDP' : tp === 'tcp' ? (secure ? 'TLS' : 'TCP') : tp === 'tls' ? 'TLS' : undefined;
  return { secure, host, port: m[3] ? Number(m[3]) : undefined, transport, numeric: /^(\d{1,3}(\.\d{1,3}){3}|\[.*\])$/.test(host) };
}

const SRV_NAME: Record<Transport, string> = { UDP: '_sip._udp', TCP: '_sip._tcp', TLS: '_sips._tcp' };
const SERVICE_TRANSPORT: Partial<Record<NaptrService, Transport>> = { 'SIP+D2U': 'UDP', 'SIP+D2T': 'TCP', 'SIPS+D2T': 'TLS' };
export const DEFAULT_PORT: Record<Transport, number> = { UDP: 5060, TCP: 5060, TLS: 5061 };

export interface Lookup {
  qname: string;
  qtype: 'NAPTR' | 'SRV' | 'A';
  /** The answer, one record per line, in zone-file form. Empty: no records. */
  answer: string[];
  /** Why the client makes this lookup, or what it takes from the answer. */
  note: string;
  rfc?: string;
}

export interface Candidate {
  ip: string;
  port: number;
  transport: Transport;
  /** The SRV target the address came from. */
  host?: string;
  priority?: number;
  weight?: number;
}

export interface Resolution {
  target: ParsedTarget;
  transport: Transport;
  /** One sentence: which rule chose the transport. */
  transportRule: string;
  transportRfc: string;
  lookups: Lookup[];
  candidates: Candidate[];
  /** The weighted draws, when SRV records were used. */
  draws: WeightDraw[];
}

export interface ResolveOptions {
  /** The transports the client supports, in its order of preference. */
  supports: Transport[];
  random?: () => number;
}

export function resolve(uri: string, zone: Zone, o: ResolveOptions): Resolution {
  const t = parseTarget(uri);
  const ttl = zone.ttl ?? 3600;
  const lookups: Lookup[] = [];
  const fqdn = (n: string) => (n.endsWith('.') ? n : `${n}.`);
  const askA = (name: string, note: string, rfc?: string) => {
    const ips = zone.a[name] ?? [];
    lookups.push({ qname: name, qtype: 'A', answer: ips.map(ip => `${fqdn(name)}  ${ttl}  IN  A  ${ip}`), note, rfc });
    return ips;
  };
  const askSrv = (name: string, note: string, rfc?: string) => {
    const recs = zone.srv[name] ?? [];
    lookups.push({ qname: name, qtype: 'SRV', answer: recs.map(r => `${fqdn(name)}  ${ttl}  IN  SRV  ${r.priority} ${r.weight} ${r.port} ${fqdn(r.target)}`), note, rfc });
    return recs;
  };
  const supported = (x: Transport) => o.supports.includes(x) && (!t.secure || x === 'TLS');

  // §4.1: the transport.
  let transport: Transport;
  let transportRule: string;
  let transportRfc = 'rfc3263-4.1-numeric';
  let srvName: string | undefined;
  let srvRecords: Srv[] | undefined;
  const fallback: Transport = t.secure ? 'TLS' : 'UDP';
  if (t.transport) {
    transport = t.transport;
    transportRule = `The URI says transport=${t.transport === 'TLS' && t.secure ? 'tcp on a SIPS URI, so TLS' : t.transport.toLowerCase()}.`;
    transportRfc = 'rfc3263-4.1-transport-param';
  } else if (t.numeric) {
    transport = fallback;
    transportRule = `The host is an IP address, so the client uses ${fallback} and makes no DNS lookup.`;
  } else if (t.port) {
    transport = fallback;
    transportRule = `The URI has a port, so the client skips NAPTR and SRV and uses ${fallback}.`;
  } else {
    const naptr = (zone.naptr[t.host] ?? []).slice().sort((a, b) => a.order - b.order || a.pref - b.pref);
    const usable = naptr.filter(n => { const x = SERVICE_TRANSPORT[n.service]; return !!x && supported(x); });
    lookups.push({
      qname: t.host, qtype: 'NAPTR',
      answer: naptr.map(n => `${fqdn(t.host)}  ${ttl}  IN  NAPTR  ${n.order} ${n.pref} "s" "${n.service}" "" ${fqdn(n.replacement)}`),
      note: naptr.length
        ? usable.length
          ? `The client keeps the services it supports${t.secure ? ' (only SIPS for a SIPS URI)' : ''}, and takes the lowest order: ${usable[0]!.service}.`
          : 'No record names a transport that the client supports.'
        : 'No NAPTR records. The client tries an SRV query for each transport it supports.',
      rfc: naptr.length ? (t.secure ? 'rfc3263-4.1-sips-discard' : 'rfc3263-4.1-naptr') : 'rfc3263-4.1-no-naptr',
    });
    if (naptr.length && !usable.length) {
      transport = fallback;
      transportRule = 'NAPTR lists no service that the client supports, so it cannot reach this domain.';
      transportRfc = t.secure ? 'rfc3263-4.1-sips-discard' : 'rfc3263-4.1-naptr';
      return { target: t, transport, transportRule, transportRfc, lookups, candidates: [], draws: [] };
    } else if (usable.length) {
      transport = SERVICE_TRANSPORT[usable[0]!.service]!;
      srvName = usable[0]!.replacement;
      transportRule = `NAPTR: ${usable[0]!.service} has the lowest order among the services the client supports, so ${transport}.`;
      transportRfc = 'rfc3263-4.1-naptr';
    } else {
      let found: Transport | undefined;
      for (const x of o.supports.filter(supported)) {
        const name = `${SRV_NAME[x]}.${t.host}`;
        const recs = askSrv(name, (zone.srv[name] ?? []).length ? `${x} is available: the client uses it.` : `No records: the domain offers no ${x}.`, 'rfc3263-4.1-no-naptr');
        if (recs.length) { found = x; srvName = name; srvRecords = recs; break; }
      }
      transport = found ?? fallback;
      transportRule = found
        ? `No NAPTR records; the SRV query for ${found} found servers.`
        : `No NAPTR or SRV records, so ${fallback}, the default for a ${t.secure ? 'SIPS' : 'SIP'} URI.`;
      transportRfc = found ? 'rfc3263-4.1-no-naptr' : 'rfc3263-4.1-no-srv';
    }
  }

  // §4.2: port and addresses.
  const candidates: Candidate[] = [];
  if (!o.supports.includes(transport)) {
    return { target: t, transport, transportRule: `${transportRule} The client does not support ${transport}.`, transportRfc, lookups, candidates, draws: [] };
  }
  let draws: WeightDraw[] = [];
  if (t.numeric) {
    candidates.push({ ip: t.host, port: t.port ?? DEFAULT_PORT[transport], transport });
  } else if (t.port) {
    const ips = askA(t.host, `An A lookup of the domain itself, at the port from the URI. Priorities, weights, and backup servers in SRV are never seen.`, 'rfc3263-4.2-port');
    for (const ip of ips) candidates.push({ ip, port: t.port, transport });
  } else {
    if (!srvName) {
      srvName = `${SRV_NAME[transport]}.${t.host}`;
    }
    const recs = srvRecords ?? askSrv(srvName, (zone.srv[srvName] ?? []).length
      ? 'The client sorts the servers by priority, then picks among equal priorities by weight.'
      : 'No SRV records. The client looks up the A record of the domain, at the default port.', 'rfc2782-priority');
    if (recs.length && !(recs.length === 1 && recs[0]!.target === '.')) {
      const sorted = srvOrder(recs, o.random);
      draws = sorted.draws;
      for (const r of sorted.order) {
        const ips = askA(r.target, `Address of ${r.target}: priority ${r.priority}, weight ${r.weight}, port ${r.port}.`);
        for (const ip of ips) candidates.push({ ip, port: r.port, transport, host: r.target, priority: r.priority, weight: r.weight });
      }
    } else if (!recs.length) {
      const ips = askA(t.host, `The A record of the domain, at the default port for ${transport}: ${DEFAULT_PORT[transport]}.`, 'rfc3263-4.2-no-srv');
      for (const ip of ips) candidates.push({ ip, port: DEFAULT_PORT[transport], transport });
    }
  }
  return { target: t, transport, transportRule, transportRfc, lookups, candidates, draws };
}

/* ------------------------------------------------------------------ */
/* RFC 3263 §4.3: try each candidate until one answers                 */
/* ------------------------------------------------------------------ */

export type ServerState = 'up' | '503' | 'refused' | 'silent';

export interface Attempt {
  candidate: Candidate;
  outcome: 'answered' | '503' | 'refused' | 'timeout';
  /** Seconds after the first attempt when this attempt ends. */
  endsAt: number;
  note: string;
}

/** Timer B (INVITE) with T1 = 500 ms: 64 × T1. */
export const TIMER_B = 32;

export function attempts(candidates: Candidate[], state: (ip: string) => ServerState): { attempts: Attempt[]; reached?: Candidate; elapsed: number } {
  const out: Attempt[] = [];
  let t = 0;
  for (const c of candidates) {
    const s = state(c.ip);
    const where = `${c.ip}:${c.port}`;
    if (s === 'up') {
      t += 0.05;
      out.push({ candidate: c, outcome: 'answered', endsAt: t, note: `${where} answers 100 Trying. Retransmissions, the ACK for a non-2xx, and CANCEL now go only here.` });
      return { attempts: out, reached: c, elapsed: t };
    }
    if (s === '503') {
      t += 0.05;
      out.push({ candidate: c, outcome: '503', endsAt: t, note: `${where} answers 503 Service Unavailable. The client tries the next server at once, with a new branch.` });
    } else if (s === 'refused') {
      t += 0.05;
      out.push({ candidate: c, outcome: 'refused', endsAt: t, note: c.transport === 'UDP'
        ? `Nothing listens on ${where}: an ICMP port unreachable comes back. The client moves on at once.`
        : `${where} refuses the TCP connection. The client moves on at once.` });
    } else {
      t += TIMER_B;
      out.push({ candidate: c, outcome: 'timeout', endsAt: t, note: `${where} never answers. The client waits until Timer B fires, ${TIMER_B} seconds, before it moves on.` });
    }
  }
  return { attempts: out, elapsed: t };
}

/* ------------------------------------------------------------------ */
/* The example zone of the course                                      */
/* ------------------------------------------------------------------ */

const srvSet = (port: number): Srv[] => [
  { priority: 10, weight: 60, port, target: 'sip1.biloxi.example' },
  { priority: 10, weight: 40, port, target: 'sip2.biloxi.example' },
  { priority: 20, weight: 0, port, target: 'backup.biloxi.example' },
];

/** biloxi.example: two proxies sharing the load, and a backup in another network. */
export const BILOXI_ZONE: Zone = {
  ttl: 3600,
  naptr: {
    'biloxi.example': [
      { order: 50, pref: 50, service: 'SIPS+D2T', replacement: '_sips._tcp.biloxi.example' },
      { order: 90, pref: 50, service: 'SIP+D2T', replacement: '_sip._tcp.biloxi.example' },
      { order: 100, pref: 50, service: 'SIP+D2U', replacement: '_sip._udp.biloxi.example' },
    ],
  },
  srv: {
    '_sips._tcp.biloxi.example': srvSet(5061),
    '_sip._tcp.biloxi.example': srvSet(5060),
    '_sip._udp.biloxi.example': srvSet(5060),
  },
  a: {
    'biloxi.example': ['203.0.113.11'],
    'sip1.biloxi.example': ['203.0.113.11'],
    'sip2.biloxi.example': ['203.0.113.12'],
    'backup.biloxi.example': ['198.51.100.50'],
  },
};
