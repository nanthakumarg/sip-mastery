/**
 * RTP for Module 16: the header (RFC 3550 §5.1) bit by bit, telephone-event
 * payloads (RFC 4733 §2.3), codec numbers, bandwidth per layer, and a
 * fixed jitter buffer with the RFC 3550 jitter estimate. Pure TypeScript,
 * so it runs in the browser and in tests. The diagrams are
 * src/diagrams/RtpHeader.tsx, JitterBuffer.tsx, and BandwidthCalc.tsx.
 */

// ---------------------------------------------------------------------------
// Header

export interface RtpHeader {
  version: number;
  padding: number;
  marker: boolean;
  pt: number;
  seq: number;
  ts: number;
  ssrc: number;
  csrc: number[];
  /** Header extension: profile-defined 16 bits, and 32-bit words. */
  ext?: { profile: number; words: number[] };
}

export interface RtpField {
  /** Short key, such as "V" or "seq". */
  key: string;
  name: string;
  /** Bit offset from the start of the packet, and length in bits. */
  bit: number;
  bits: number;
  value: number;
  /** Displayed value, such as "0 (PCMU)". */
  shown: string;
  explain: string;
  /** Quote id. */
  rule: string;
  part: 'header' | 'csrc' | 'ext' | 'payload' | 'padding';
}

export interface Decoded {
  ok: boolean;
  header?: RtpHeader;
  fields: RtpField[];
  issues: string[];
  payloadOffset: number;
  payloadLength: number;
  /** A telephone-event payload, when the payload type is mapped to telephone-event. */
  event?: TelephoneEvent;
}

export interface TelephoneEvent { event: number; end: boolean; volume: number; duration: number }

/** Static payload types (RFC 3551) and the dynamic ones this course uses. */
export const PT_NAMES: Record<number, string> = {
  0: 'PCMU', 3: 'GSM', 4: 'G723', 8: 'PCMA', 9: 'G722', 13: 'CN', 18: 'G729', 26: 'JPEG', 31: 'H261', 34: 'H263',
};

export const EVENT_NAMES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#', 'A', 'B', 'C', 'D', 'flash'];

const u32 = (n: number) => n >>> 0;

/** Builds the bytes of an RTP packet. */
export function encodeRtp(h: RtpHeader, payload: Uint8Array = new Uint8Array()): Uint8Array {
  const extLen = h.ext ? 4 + h.ext.words.length * 4 : 0;
  const len = 12 + h.csrc.length * 4 + extLen + payload.length + h.padding;
  const b = new Uint8Array(len);
  const dv = new DataView(b.buffer);
  b[0] = (h.version << 6) | (h.padding ? 0x20 : 0) | (h.ext ? 0x10 : 0) | (h.csrc.length & 0x0f);
  b[1] = (h.marker ? 0x80 : 0) | (h.pt & 0x7f);
  dv.setUint16(2, h.seq & 0xffff);
  dv.setUint32(4, u32(h.ts));
  dv.setUint32(8, u32(h.ssrc));
  let o = 12;
  for (const c of h.csrc) { dv.setUint32(o, u32(c)); o += 4; }
  if (h.ext) {
    dv.setUint16(o, h.ext.profile); dv.setUint16(o + 2, h.ext.words.length); o += 4;
    for (const w of h.ext.words) { dv.setUint32(o, u32(w)); o += 4; }
  }
  b.set(payload, o);
  o += payload.length;
  if (h.padding) b[len - 1] = h.padding;
  return b;
}

/** The 4-byte telephone-event payload (RFC 4733 §2.3). */
export function encodeEvent(e: TelephoneEvent): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = e.event;
  b[1] = (e.end ? 0x80 : 0) | (e.volume & 0x3f);
  new DataView(b.buffer).setUint16(2, e.duration);
  return b;
}

/**
 * Reads hex in the usual forms: "80 00 1a 2b", "80001a2b", "0x80, 0x00",
 * or a Wireshark hex dump with offsets and an ASCII column.
 */
export function parseHex(text: string): Uint8Array | string {
  const lines = text.split(/\r?\n/).map(l => {
    // A Wireshark dump line: "0000  80 00 ...  ..ascii..". Drop the offset and the ASCII column.
    const m = /^\s*[0-9a-f]{4,8}[:\s]\s*((?:[0-9a-f]{2}\s+){1,16}[0-9a-f]{2}|[0-9a-f]{2})(\s{2,}.*)?$/i.exec(l);
    return m ? m[1]! : l;
  });
  const clean = lines.join(' ').replace(/0x/gi, ' ').replace(/[,:;\s-]+/g, '');
  if (!clean) return 'Paste the bytes of an RTP packet in hex.';
  if (/[^0-9a-f]/i.test(clean)) return 'Only hex digits (0–9, a–f) are allowed.';
  if (clean.length % 2) return 'An odd number of hex digits: each byte is two digits.';
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const toHex = (b: Uint8Array) => [...b].map(x => x.toString(16).padStart(2, '0')).join(' ');

/**
 * Decodes an RTP packet and describes each field. `dynamic` maps dynamic
 * payload types to encoding names, as the SDP would (default: 101 is
 * telephone-event, 111 is opus).
 */
export function decodeRtp(b: Uint8Array, dynamic: Record<number, string> = { 101: 'telephone-event', 111: 'opus', 96: 'dynamic' }): Decoded {
  const fields: RtpField[] = [];
  const issues: string[] = [];
  if (b.length < 12) return { ok: false, fields, issues: [`${b.length} bytes: an RTP header is at least 12 bytes.`], payloadOffset: 0, payloadLength: 0 };
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const version = b[0]! >> 6;
  const p = (b[0]! >> 5) & 1;
  const x = (b[0]! >> 4) & 1;
  const cc = b[0]! & 0x0f;
  const m = b[1]! >> 7;
  const pt = b[1]! & 0x7f;
  const seq = dv.getUint16(2);
  const ts = dv.getUint32(4);
  const ssrc = dv.getUint32(8);
  const name = PT_NAMES[pt] ?? dynamic[pt];
  const add = (f: Omit<RtpField, 'shown'> & { shown?: string }) => fields.push({ shown: String(f.value), ...f });

  add({ key: 'V', name: 'Version', bit: 0, bits: 2, value: version, part: 'header', rule: 'rfc3550-5.1-fields',
    explain: version === 2 ? 'RTP version 2, the only version in use.' : `Version ${version}. RTP is version 2: this is not an RTP packet, or it is not aligned.` });
  add({ key: 'P', name: 'Padding', bit: 2, bits: 1, value: p, part: 'header', rule: 'rfc3550-5.1-fields',
    explain: p ? 'Padding is set: the last byte of the packet says how many padding bytes to ignore. Some encryption needs it.' : 'No padding.' });
  add({ key: 'X', name: 'Extension', bit: 3, bits: 1, value: x, part: 'header', rule: 'rfc3550-5.1-fields',
    explain: x ? 'A header extension follows the fixed header and the CSRC list.' : 'No header extension.' });
  add({ key: 'CC', name: 'CSRC count', bit: 4, bits: 4, value: cc, part: 'header', rule: 'rfc3550-5.1-csrc',
    explain: cc ? `${cc} contributing source${cc > 1 ? 's' : ''} follow the SSRC: a mixer combined ${cc > 1 ? 'these' : 'this'} source${cc > 1 ? 's' : ''}.` : 'No contributing sources: no mixer touched this packet. The usual value.' });
  add({ key: 'M', name: 'Marker', bit: 8, bits: 1, value: m, part: 'header', rule: 'rfc3551-4.1-marker',
    explain: m
      ? name === 'telephone-event' ? 'Marker set: the first packet of a new DTMF event.' : 'Marker set: for audio, the first packet after a silence (a talkspurt). The receiver may adjust its jitter buffer here.'
      : 'Marker not set.' });
  add({ key: 'PT', name: 'Payload type', bit: 9, bits: 7, value: pt, shown: name ? `${pt} (${name})` : String(pt), part: 'header', rule: 'rfc3550-5.1-pt',
    explain: PT_NAMES[pt] ? `Payload type ${pt}: ${PT_NAMES[pt]}, a static number of the RTP/AVP profile.`
      : pt >= 96 ? `Payload type ${pt} is dynamic: only the SDP of this call says what it is${dynamic[pt] ? ` (here, ${dynamic[pt]})` : ''}.`
      : pt >= 72 && pt <= 76 ? `Payload type ${pt} is reserved: these numbers would look like RTCP. This may be an RTCP packet, not RTP.`
      : `Payload type ${pt} is not assigned. Look for its a=rtpmap in the SDP.` });
  add({ key: 'seq', name: 'Sequence number', bit: 16, bits: 16, value: seq, part: 'header', rule: 'rfc3550-5.1-seq',
    explain: 'Goes up by one for each packet. A gap means loss; a step back means reordering. It starts at a random value and wraps at 65535.' });
  add({ key: 'ts', name: 'Timestamp', bit: 32, bits: 32, value: ts, part: 'header', rule: 'rfc3550-5.1-ts',
    explain: `The sampling instant of the first sample, in clock ticks. With an 8000 Hz clock and 20 ms packets, it goes up by 160 each packet. It starts at a random value.` });
  add({ key: 'SSRC', name: 'SSRC', bit: 64, bits: 32, value: ssrc, shown: `0x${ssrc.toString(16).padStart(8, '0')}`, part: 'header', rule: 'rfc3550-5.1-ssrc',
    explain: 'Synchronization source: a random number that names this stream. A new one after a transfer or a new media path is normal.' });
  if (version !== 2) issues.push(`Version is ${version}, not 2.`);
  if (pt >= 72 && pt <= 76) issues.push(`Payload type ${pt} is in the range 72–76, which RTP does not use: is this RTCP?`);

  let o = 12;
  for (let i = 0; i < cc; i++) {
    if (o + 4 > b.length) { issues.push(`CC says ${cc} CSRCs, but the packet ends after ${i}.`); break; }
    const c = dv.getUint32(o);
    add({ key: `csrc${i}`, name: `CSRC ${i + 1}`, bit: o * 8, bits: 32, value: c, shown: `0x${c.toString(16).padStart(8, '0')}`, part: 'csrc', rule: 'rfc3550-5.1-csrc',
      explain: 'The SSRC of one source that the mixer combined into this packet: one talker in a conference.' });
    o += 4;
  }
  if (x && o + 4 <= b.length) {
    const prof = dv.getUint16(o), words = dv.getUint16(o + 2);
    add({ key: 'extprof', name: 'Extension profile', bit: o * 8, bits: 16, value: prof, shown: `0x${prof.toString(16).padStart(4, '0')}`, part: 'ext', rule: 'rfc3550-5.3.1-ext',
      explain: prof === 0xbede ? '0xBEDE: one-byte header extensions (RFC 8285), such as audio level or a stream ID.' : 'Defined by the profile or application that uses it.' });
    add({ key: 'extlen', name: 'Extension length', bit: o * 8 + 16, bits: 16, value: words, part: 'ext', rule: 'rfc3550-5.3.1-ext',
      explain: `${words} 32-bit word${words === 1 ? '' : 's'} of extension data follow.` });
    o += 4;
    if (o + words * 4 > b.length) issues.push('The header extension is longer than the packet.');
    else {
      if (words) add({ key: 'extdata', name: 'Extension data', bit: o * 8, bits: words * 32, value: words * 4, shown: `${words * 4} bytes`, part: 'ext', rule: 'rfc3550-5.3.1-ext', explain: 'Extension data. A receiver that does not understand it skips it.' });
      o += words * 4;
    }
  } else if (x) issues.push('X is set, but the packet ends before the header extension.');

  let padLen = 0;
  if (p && b.length > o) {
    padLen = b[b.length - 1]!;
    if (padLen === 0 || o + padLen > b.length) { issues.push(`The padding count (${padLen}) does not fit the packet.`); padLen = 0; }
  }
  const payloadLength = Math.max(0, b.length - o - padLen);
  let event: TelephoneEvent | undefined;
  if (payloadLength) {
    if (name === 'telephone-event' && payloadLength >= 4) {
      event = { event: b[o]!, end: !!(b[o + 1]! >> 7), volume: b[o + 1]! & 0x3f, duration: dv.getUint16(o + 2) };
      const ev = EVENT_NAMES[event.event] ?? `event ${event.event}`;
      add({ key: 'evt', name: 'Event', bit: o * 8, bits: 8, value: event.event, shown: `${event.event} (${ev})`, part: 'payload', rule: 'rfc4733-2.3.1-event', explain: `The key: ${ev}.` });
      add({ key: 'E', name: 'End', bit: o * 8 + 8, bits: 1, value: event.end ? 1 : 0, part: 'payload', rule: 'rfc4733-2.5.1.2-marks',
        explain: event.end ? 'The end of the event. The final packet is sent three times.' : 'The key is still pressed.' });
      add({ key: 'R', name: 'Reserved', bit: o * 8 + 9, bits: 1, value: (b[o + 1]! >> 6) & 1, part: 'payload', rule: 'rfc4733-2.3.3-r', explain: 'Reserved: always 0.' });
      add({ key: 'vol', name: 'Volume', bit: o * 8 + 10, bits: 6, value: event.volume, shown: `${event.volume} (−${event.volume} dBm0)`, part: 'payload', rule: 'rfc4733-2.3.4-volume', explain: 'The power level of the tone, as −dBm0. DTMF is usually around −10.' });
      add({ key: 'dur', name: 'Duration', bit: o * 8 + 16, bits: 16, value: event.duration, shown: `${event.duration} (${(event.duration / 8).toFixed(0)} ms at 8000 Hz)`, part: 'payload', rule: 'rfc4733-2.3.5-duration',
        explain: 'How long the key has been pressed so far, in timestamp units. It grows in each update; the RTP timestamp stays the same.' });
    } else {
      add({ key: 'payload', name: 'Payload', bit: o * 8, bits: payloadLength * 8, value: payloadLength, shown: `${payloadLength} bytes`, part: 'payload', rule: 'rfc3550-5.1-pt',
        explain: name === 'PCMU' || name === 'PCMA'
          ? `${payloadLength} bytes of G.711: one byte per sample, so ${payloadLength / 8} ms of audio.`
          : name === 'CN' ? 'Comfort noise: the level (and maybe the spectrum) of the background noise, in a few bytes.'
          : `${payloadLength} bytes of ${name ?? 'media'}.` });
    }
  }
  if (padLen) add({ key: 'pad', name: 'Padding', bit: (b.length - padLen) * 8, bits: padLen * 8, value: padLen, shown: `${padLen} bytes`, part: 'padding', rule: 'rfc3550-5.1-fields', explain: 'Padding. The last byte is the count, including itself.' });

  return { ok: issues.length === 0, header: { version, padding: padLen, marker: !!m, pt, seq, ts, ssrc, csrc: [] }, fields, issues, payloadOffset: o, payloadLength, event };
}

// ---------------------------------------------------------------------------
// Codecs and bandwidth

export interface Codec {
  id: string;
  name: string;
  /** Static payload type, or undefined for dynamic. */
  pt?: number;
  /** RTP clock rate. */
  clock: number;
  /** Audio bandwidth, in words. */
  band: string;
  /** Bit rate in kbit/s (a typical one for variable codecs). */
  kbps: number;
  /** Frame length in ms; ptime is a multiple of it. */
  frame: number;
  /** Bytes of payload header per packet (AMR-WB octet-aligned: CMR + one ToC per frame). */
  header: (frames: number) => number;
  note: string;
}

export const CODECS: Codec[] = [
  { id: 'pcmu', name: 'G.711 (PCMU/PCMA)', pt: 0, clock: 8000, band: 'narrowband, 300–3400 Hz', kbps: 64, frame: 10, header: () => 0, note: 'No compression: every phone and gateway has it.' },
  { id: 'g722', name: 'G.722', pt: 9, clock: 8000, band: 'wideband, 50–7000 Hz', kbps: 64, frame: 10, header: () => 0, note: 'HD voice at the G.711 rate. Its RTP clock is 8000, though it samples at 16 kHz.' },
  { id: 'g729', name: 'G.729', pt: 18, clock: 8000, band: 'narrowband', kbps: 8, frame: 10, header: () => 0, note: 'Low rate, older trunks and WANs. Bad for in-band DTMF and fax.' },
  { id: 'opus', name: 'Opus', clock: 48000, band: 'narrowband to fullband', kbps: 32, frame: 20, header: () => 0, note: 'Variable rate (6–510 kbit/s), built for loss. The WebRTC default. Shown at 32 kbit/s.' },
  { id: 'amrwb', name: 'AMR-WB', clock: 16000, band: 'wideband', kbps: 12.65, frame: 20, header: f => 1 + f, note: 'VoLTE HD voice, nine rates from 6.6 to 23.85. Shown at 12.65, octet-aligned.' },
  { id: 'evs', name: 'EVS', clock: 16000, band: 'up to fullband', kbps: 13.2, frame: 20, header: () => 0, note: 'The newer VoLTE codec, 5.9 to 128 kbit/s. Shown at 13.2, compact format.' },
];

export type LinkLayer = 'ip' | 'ethernet' | 'vlan' | 'wire';
export const LINK_BYTES: Record<LinkLayer, number> = { ip: 0, ethernet: 18, vlan: 22, wire: 38 };
export const LINK_LABEL: Record<LinkLayer, string> = {
  ip: 'IP only', ethernet: 'Ethernet', vlan: 'Ethernet + VLAN tag', wire: 'Ethernet on the wire',
};

export interface BandwidthInput { codec: Codec; ptime: number; ipv6: boolean; srtp: boolean; link: LinkLayer }

export interface BandwidthLayer { name: string; bytes: number; kbps: number }

export interface Bandwidth {
  packetsPerSecond: number;
  samplesPerPacket: number;
  /** RTP timestamp step per packet. */
  tsStep: number;
  layers: BandwidthLayer[];
  packetBytes: number;
  /** One direction. */
  kbps: number;
  payloadShare: number;
}

/**
 * Bandwidth of one RTP stream in one direction, layer by layer.
 * Ethernet: 14 header + 4 FCS (+4 VLAN tag; +20 preamble and gap on the wire).
 */
export function bandwidth(i: BandwidthInput): Bandwidth {
  const pps = 1000 / i.ptime;
  const frames = Math.max(1, Math.round(i.ptime / i.codec.frame));
  const payload = Math.round((i.codec.kbps * 1000 * i.ptime) / 1000 / 8) + i.codec.header(frames);
  const layers: BandwidthLayer[] = [
    { name: 'Codec payload', bytes: payload, kbps: 0 },
    { name: 'RTP header', bytes: 12, kbps: 0 },
    ...(i.srtp ? [{ name: 'SRTP auth tag', bytes: 10, kbps: 0 }] : []),
    { name: 'UDP header', bytes: 8, kbps: 0 },
    { name: i.ipv6 ? 'IPv6 header' : 'IPv4 header', bytes: i.ipv6 ? 40 : 20, kbps: 0 },
    ...(i.link === 'ip' ? [] : [{ name: i.link === 'wire' ? 'Ethernet, preamble and gap' : i.link === 'vlan' ? 'Ethernet + VLAN' : 'Ethernet', bytes: LINK_BYTES[i.link], kbps: 0 }]),
  ];
  for (const l of layers) l.kbps = (l.bytes * 8 * pps) / 1000;
  const packetBytes = layers.reduce((a, l) => a + l.bytes, 0);
  return {
    packetsPerSecond: pps,
    samplesPerPacket: (i.codec.clock * i.ptime) / 1000,
    tsStep: (i.codec.clock * i.ptime) / 1000,
    layers,
    packetBytes,
    kbps: (packetBytes * 8 * pps) / 1000,
    payloadShare: payload / packetBytes,
  };
}

// ---------------------------------------------------------------------------
// Jitter buffer

/** A small seeded random generator (mulberry32), so a simulation is the same on every render. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface JitterInput {
  packets: number;
  ptime: number;
  /** One-way network delay without queueing, ms. */
  baseDelay: number;
  /** How far the delay varies: the mean extra delay of the queueing, ms. */
  jitter: number;
  /** Packets lost in the network, percent. */
  loss: number;
  /** Fixed jitter buffer depth, ms. */
  buffer: number;
  seed: number;
}

export type PacketFate = 'played' | 'late' | 'lost';

export interface SimPacket { seq: number; sent: number; arrival?: number; playout: number; fate: PacketFate }

export interface JitterResult {
  packets: SimPacket[];
  played: number;
  late: number;
  lost: number;
  /** The RFC 3550 interarrival jitter estimate at the end, ms. */
  jitterEstimate: number;
  /** Mouth-to-ear delay from the network and the buffer, ms (the codec and the sound card add more). */
  delay: number;
  /** Largest network delay seen, ms. */
  maxDelay: number;
}

/**
 * Sends `packets` RTP packets every `ptime` ms. Each takes the base delay plus
 * a random queueing delay (exponential, mean `jitter`), and some are lost. A
 * fixed buffer plays packet i at: arrival of the first packet + buffer + i × ptime.
 * A packet that arrives after its playout time is late, and is thrown away.
 */
export function simulateJitter(i: JitterInput): JitterResult {
  const rnd = random(i.seed);
  const sent = Array.from({ length: i.packets }, (_, k) => k * i.ptime);
  const arrivals = sent.map(s => {
    const lost = rnd() * 100 < i.loss;
    const q = i.jitter > 0 ? -Math.log(1 - rnd() * 0.999) * i.jitter : 0;
    return lost ? undefined : s + i.baseDelay + q;
  });
  const first = arrivals.findIndex(a => a !== undefined);
  const start = first < 0 ? 0 : arrivals[first]! - sent[first]! + i.buffer;
  const packets: SimPacket[] = sent.map((s, k) => {
    const a = arrivals[k];
    const playout = s + start;
    return { seq: k, sent: s, arrival: a, playout, fate: a === undefined ? 'lost' : a > playout ? 'late' : 'played' };
  });
  // RFC 3550 §6.4.1, in order of arrival.
  let J = 0, prev: SimPacket | undefined;
  for (const p of packets.filter(x => x.arrival !== undefined).sort((x, y) => x.arrival! - y.arrival!)) {
    if (prev) {
      const D = (p.arrival! - prev.arrival!) - (p.sent - prev.sent);
      J += (Math.abs(D) - J) / 16;
    }
    prev = p;
  }
  const delays = packets.filter(p => p.arrival !== undefined).map(p => p.arrival! - p.sent);
  return {
    packets,
    played: packets.filter(p => p.fate === 'played').length,
    late: packets.filter(p => p.fate === 'late').length,
    lost: packets.filter(p => p.fate === 'lost').length,
    jitterEstimate: J,
    delay: start,
    maxDelay: delays.length ? Math.max(...delays) : 0,
  };
}
