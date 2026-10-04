/**
 * Builds a real Ethernet II / IPv4 / UDP frame around a SIP message, and
 * describes every field with its byte offset — the way Wireshark shows a
 * packet. Pure TypeScript, so it runs in the browser and in tests.
 */

export type Layer = 'eth' | 'ip' | 'udp' | 'sip';

export interface Field {
  layer: Layer;
  name: string;
  offset: number;
  length: number;
  value: string;
  explain: string;
}

export interface Frame {
  bytes: Uint8Array;
  fields: Field[];
  layers: { layer: Layer; title: string; offset: number; length: number }[];
}

export interface FrameInput {
  srcMac: string;
  dstMac: string;
  srcIp: string;
  dstIp: string;
  srcPort: number;
  dstPort: number;
  ttl?: number;
  id?: number;
  payload: string;
}

const mac = (s: string) => s.split(':').map(h => parseInt(h, 16));
const ip4 = (s: string) => s.split('.').map(Number);
const hex = (n: number, w: number) => '0x' + n.toString(16).padStart(w, '0');

/** Internet checksum (RFC 1071): one's complement of the one's complement sum of 16-bit words. */
export function checksum(bytes: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 2) sum += (bytes[i]! << 8) + (bytes[i + 1] ?? 0);
  while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
  return ~sum & 0xffff;
}

export function buildFrame(f: FrameInput): Frame {
  const payload = new TextEncoder().encode(f.payload);
  const udpLen = 8 + payload.length;
  const ipLen = 20 + udpLen;
  const bytes = new Uint8Array(14 + ipLen);
  const dv = new DataView(bytes.buffer);
  const fields: Field[] = [];
  const add = (layer: Layer, name: string, offset: number, length: number, value: string, explain: string) =>
    fields.push({ layer, name, offset, length, value, explain });

  // Ethernet II
  bytes.set(mac(f.dstMac), 0);
  bytes.set(mac(f.srcMac), 6);
  dv.setUint16(12, 0x0800);
  add('eth', 'Destination MAC', 0, 6, f.dstMac, 'The hardware address of the next hop on this link — usually the router, not the final server.');
  add('eth', 'Source MAC', 6, 6, f.srcMac, "The hardware address of the sender's network card.");
  add('eth', 'EtherType', 12, 2, '0x0800 (IPv4)', 'What is inside the frame: 0x0800 means IPv4, 0x86dd means IPv6.');

  // IPv4
  const ip = 14;
  const ttl = f.ttl ?? 64;
  const id = f.id ?? 0x1c46;
  bytes[ip] = 0x45;
  bytes[ip + 1] = 0;
  dv.setUint16(ip + 2, ipLen);
  dv.setUint16(ip + 4, id);
  dv.setUint16(ip + 6, 0x4000); // Don't Fragment
  bytes[ip + 8] = ttl;
  bytes[ip + 9] = 17; // UDP
  bytes.set(ip4(f.srcIp), ip + 12);
  bytes.set(ip4(f.dstIp), ip + 16);
  const ipSum = checksum(bytes.subarray(ip, ip + 20));
  dv.setUint16(ip + 10, ipSum);
  add('ip', 'Version and header length', ip, 1, '4, 20 bytes', '0x45: IP version 4, and a header of 5 × 4 = 20 bytes.');
  add('ip', 'DSCP / ECN', ip + 1, 1, '0x00', 'Traffic class. Voice networks often mark SIP and RTP here so routers prioritise them (Module 29).');
  add('ip', 'Total length', ip + 2, 2, `${ipLen} bytes`, 'The IP header plus everything inside it.');
  add('ip', 'Identification', ip + 4, 2, hex(id, 4), 'Identifies the fragments of one packet, if the packet must be split.');
  add('ip', 'Flags and fragment offset', ip + 6, 2, "Don't Fragment", 'This packet must not be split. A packet that is too big for a link is dropped instead.');
  add('ip', 'TTL', ip + 8, 1, String(ttl), 'Time to live: each router subtracts 1. At 0 the packet is discarded.');
  add('ip', 'Protocol', ip + 9, 1, '17 (UDP)', 'The transport inside: 17 is UDP, 6 is TCP.');
  add('ip', 'Header checksum', ip + 10, 2, hex(ipSum, 4), 'Protects the IP header. Every router checks it. NAT routers recalculate it after they rewrite an address.');
  add('ip', 'Source address', ip + 12, 4, f.srcIp, 'Where the packet comes from. A NAT router rewrites this field.');
  add('ip', 'Destination address', ip + 16, 4, f.dstIp, 'Where the packet goes.');

  // UDP
  const udp = ip + 20;
  dv.setUint16(udp, f.srcPort);
  dv.setUint16(udp + 2, f.dstPort);
  dv.setUint16(udp + 4, udpLen);
  bytes.set(payload, udp + 8);
  // UDP checksum over the IPv4 pseudo-header, the UDP header, and the data.
  const pseudo = new Uint8Array(12 + udpLen);
  pseudo.set(ip4(f.srcIp), 0);
  pseudo.set(ip4(f.dstIp), 4);
  pseudo[9] = 17;
  new DataView(pseudo.buffer).setUint16(10, udpLen);
  pseudo.set(bytes.subarray(udp, udp + udpLen), 12);
  let udpSum = checksum(pseudo);
  if (udpSum === 0) udpSum = 0xffff;
  dv.setUint16(udp + 6, udpSum);
  add('udp', 'Source port', udp, 2, String(f.srcPort), 'The port the sender used. Behind NAT, the router changes it. Do not assume it is the port the phone listens on.');
  add('udp', 'Destination port', udp + 2, 2, String(f.dstPort), '5060 is the standard SIP port.');
  add('udp', 'Length', udp + 4, 2, `${udpLen} bytes`, 'The UDP header (8 bytes) plus the SIP message.');
  add('udp', 'Checksum', udp + 6, 2, hex(udpSum, 4), 'Protects the UDP header and the data.');

  // SIP: one field per line
  const lines = f.payload.split('\r\n');
  let off = udp + 8;
  lines.forEach((line, i) => {
    const len = new TextEncoder().encode(line).length + (i < lines.length - 1 ? 2 : 0);
    if (len === 0) return;
    const name = line === '' ? 'Empty line' : i === 0 ? 'Request line' : line.split(':')[0]!;
    add('sip', name, off, len, line === '' ? '\\r\\n' : line, line === '' ? 'Ends the headers. Every SIP line ends with CRLF (0d 0a).' : 'Plain text. Every line ends with CRLF: the bytes 0d 0a.');
    off += len;
  });

  return {
    bytes,
    fields,
    layers: [
      { layer: 'eth', title: 'Ethernet II', offset: 0, length: 14 },
      { layer: 'ip', title: 'Internet Protocol version 4', offset: ip, length: 20 },
      { layer: 'udp', title: 'User Datagram Protocol', offset: udp, length: 8 },
      { layer: 'sip', title: 'Session Initiation Protocol', offset: udp + 8, length: payload.length },
    ],
  };
}
