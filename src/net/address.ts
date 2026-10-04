/**
 * Classifies an IPv4 or IPv6 address: private, public, shared (CGNAT),
 * loopback, link-local, or documentation. Used by the address classifier.
 */

export type AddressKind = 'private' | 'public' | 'cgnat' | 'loopback' | 'link-local' | 'documentation' | 'ula' | 'invalid';

export interface Classification {
  kind: AddressKind;
  version: 4 | 6 | 0;
  range?: string;
  rfc?: number;
  label: string;
  reachable: string;
}

const RANGES4: { cidr: string; kind: AddressKind; rfc: number }[] = [
  { cidr: '10.0.0.0/8', kind: 'private', rfc: 1918 },
  { cidr: '172.16.0.0/12', kind: 'private', rfc: 1918 },
  { cidr: '192.168.0.0/16', kind: 'private', rfc: 1918 },
  { cidr: '100.64.0.0/10', kind: 'cgnat', rfc: 6598 },
  { cidr: '127.0.0.0/8', kind: 'loopback', rfc: 1122 },
  { cidr: '169.254.0.0/16', kind: 'link-local', rfc: 3927 },
  { cidr: '192.0.2.0/24', kind: 'documentation', rfc: 5737 },
  { cidr: '198.51.100.0/24', kind: 'documentation', rfc: 5737 },
  { cidr: '203.0.113.0/24', kind: 'documentation', rfc: 5737 },
];

const LABEL: Record<AddressKind, [string, string]> = {
  private: ['Private address', 'Not reachable from the Internet. If it appears in a Contact header or in SDP that leaves the network, calls break.'],
  public: ['Public address', 'Reachable from the Internet (if no firewall blocks it).'],
  cgnat: ['Shared address (carrier-grade NAT)', 'Used inside a provider network. Like a private address, it is not reachable from the Internet.'],
  loopback: ['Loopback', 'The device itself. Never valid in a SIP message sent to another device.'],
  'link-local': ['Link-local', 'Only valid on the local link. Often a sign that the device did not get an address from DHCP.'],
  documentation: ['Documentation address', 'Reserved for examples, like the ones in this course. Treat it as a public address in the examples.'],
  ula: ['Unique local address (IPv6)', 'The IPv6 equivalent of a private address. Not reachable from the Internet.'],
  invalid: ['Not an IP address', 'Check the format: four numbers from 0 to 255 for IPv4, or hexadecimal groups for IPv6.'],
};

export function parseIPv4(s: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s.trim());
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some(x => x > 255)) return null;
  return ((o[0]! << 24) >>> 0) + (o[1]! << 16) + (o[2]! << 8) + o[3]!;
}

function inCidr(addr: number, cidr: string): boolean {
  const [base, bits] = cidr.split('/');
  const b = parseIPv4(base!)!;
  const n = Number(bits);
  const mask = n === 0 ? 0 : (~0 << (32 - n)) >>> 0;
  return ((addr & mask) >>> 0) === ((b & mask) >>> 0);
}

/** Expands an IPv6 address to 8 groups, or returns null. */
export function parseIPv6(s: string): number[] | null {
  const t = s.trim().toLowerCase();
  if (!/^[0-9a-f:]+$/.test(t) || (t.match(/::/g) ?? []).length > 1) return null;
  const [head, tail] = t.split('::');
  const h = head ? head.split(':') : [];
  const tl = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  const fill = tail !== undefined ? 8 - h.length - tl.length : 0;
  if (fill < 0 || (tail === undefined && h.length !== 8)) return null;
  const groups = [...h, ...Array(fill).fill('0'), ...tl];
  if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map(g => parseInt(g, 16));
}

export function classify(input: string): Classification {
  const v4 = parseIPv4(input);
  if (v4 !== null) {
    const hit = RANGES4.find(r => inCidr(v4, r.cidr));
    const kind = hit?.kind ?? 'public';
    return { kind, version: 4, range: hit?.cidr, rfc: hit?.rfc, label: LABEL[kind][0], reachable: LABEL[kind][1] };
  }
  const v6 = parseIPv6(input);
  if (v6) {
    let kind: AddressKind = 'public', range: string | undefined, rfc: number | undefined;
    if (v6.every((g, i) => (i < 7 ? g === 0 : g === 1))) { kind = 'loopback'; range = '::1/128'; rfc = 4291; }
    else if ((v6[0]! & 0xffc0) === 0xfe80) { kind = 'link-local'; range = 'fe80::/10'; rfc = 4291; }
    else if ((v6[0]! & 0xfe00) === 0xfc00) { kind = 'ula'; range = 'fc00::/7'; rfc = 4193; }
    else if (v6[0] === 0x2001 && v6[1] === 0x0db8) { kind = 'documentation'; range = '2001:db8::/32'; rfc = 3849; }
    return { kind, version: 6, range, rfc, label: LABEL[kind][0], reachable: LABEL[kind][1] };
  }
  return { kind: 'invalid', version: 0, label: LABEL.invalid[0], reachable: LABEL.invalid[1] };
}
