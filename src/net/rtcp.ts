/**
 * RTCP for Module 17: compound packets with SR, RR, SDES, and BYE
 * (RFC 3550 §6), field by field; round-trip time from LSR and DLSR
 * (§6.4.1); fraction lost (Appendix A.3); and a simplified E-model
 * (ITU-T G.107) from delay and loss to R-factor and MOS.
 * The diagrams are src/diagrams/RtcpExplorer.tsx, RttTimeline.tsx, and MosCalc.tsx.
 */
import type { BitField } from './bits.ts';

export interface ReportBlock {
  ssrc: number;
  /** Fraction lost since the last report, in 1/256. */
  fractionLost: number;
  cumulativeLost: number;
  extHighestSeq: number;
  /** Interarrival jitter, in timestamp units. */
  jitter: number;
  /** Middle 32 bits of the NTP timestamp of the last SR from this source. */
  lsr: number;
  /** Delay since that SR, in 1/65536 s. */
  dlsr: number;
}

export interface SenderInfo { ntpSec: number; ntpFrac: number; rtpTs: number; packets: number; octets: number }

export type RtcpPacket =
  | { type: 'SR'; ssrc: number; sender: SenderInfo; blocks: ReportBlock[] }
  | { type: 'RR'; ssrc: number; blocks: ReportBlock[] }
  | { type: 'SDES'; ssrc: number; cname: string }
  | { type: 'BYE'; ssrcs: number[]; reason?: string };

export const RTCP_TYPES: Record<number, string> = {
  200: 'SR', 201: 'RR', 202: 'SDES', 203: 'BYE', 204: 'APP', 205: 'RTPFB', 206: 'PSFB', 207: 'XR',
};

export interface RtcpField extends BitField {
  value: number;
  explain: string;
  /** Quote id. */
  rule: string;
}

export interface DecodedRtcp {
  ok: boolean;
  packets: { type: string; offset: number; length: number }[];
  fields: RtcpField[];
  issues: string[];
  /** The SR, RR, SDES, and BYE contents, as read. */
  parsed: RtcpPacket[];
}

const u32 = (n: number) => n >>> 0;
const hex8 = (n: number) => `0x${u32(n).toString(16).padStart(8, '0')}`;

const LABELS: Record<string, string> = {
  len: 'length', ssrc: 'SSRC', ntp: 'NTP timestamp', rtpts: 'RTP timestamp', pkts: 'packet count', octs: 'octet count',
  fl: 'fraction lost', cl: 'cumulative lost', seq: 'highest seq', jit: 'jitter', lsr: 'LSR', dlsr: 'DLSR',
  it: 'item', il: 'len', cn: 'CNAME', why: 'reason', body: 'body',
};
/** Keys carry the packet (and block) number so that they are unique; the cell label drops it. */
function cellLabel(key: string): string {
  const k = key.replace(/^\d+(\.\d+)?/, '');
  return LABELS[k] ?? (/^s\d+$/.test(k) ? 'SSRC' : k);
}

/** Builds a compound RTCP packet. */
export function encodeRtcp(packets: RtcpPacket[]): Uint8Array {
  const parts = packets.map(p => {
    let body: number[] = [];
    let count = 0, pt = 0;
    const w32 = (n: number) => body.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
    const block = (b: ReportBlock) => {
      w32(b.ssrc);
      w32(((b.fractionLost & 255) << 24) | (b.cumulativeLost & 0xffffff));
      w32(b.extHighestSeq); w32(b.jitter); w32(b.lsr); w32(b.dlsr);
    };
    if (p.type === 'SR') {
      pt = 200; count = p.blocks.length;
      w32(p.ssrc); w32(p.sender.ntpSec); w32(p.sender.ntpFrac); w32(p.sender.rtpTs); w32(p.sender.packets); w32(p.sender.octets);
      p.blocks.forEach(block);
    } else if (p.type === 'RR') {
      pt = 201; count = p.blocks.length;
      w32(p.ssrc); p.blocks.forEach(block);
    } else if (p.type === 'SDES') {
      pt = 202; count = 1;
      w32(p.ssrc);
      const t = [...new TextEncoder().encode(p.cname)];
      body.push(1, t.length, ...t, 0); // CNAME item, then the END item
      while (body.length % 4) body.push(0);
    } else {
      pt = 203; count = p.ssrcs.length;
      p.ssrcs.forEach(w32);
      if (p.reason) {
        const t = [...new TextEncoder().encode(p.reason)];
        body.push(t.length, ...t);
        while (body.length % 4) body.push(0);
      }
    }
    const len = 4 + body.length;
    const head = [0x80 | count, pt, ((len / 4 - 1) >> 8) & 255, (len / 4 - 1) & 255];
    body = [...head, ...body];
    return body;
  });
  return new Uint8Array(parts.flat());
}

/** Reads a compound RTCP packet and describes each field. */
export function decodeRtcp(b: Uint8Array): DecodedRtcp {
  const fields: RtcpField[] = [];
  const issues: string[] = [];
  const packets: DecodedRtcp['packets'] = [];
  const parsed: RtcpPacket[] = [];
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const add = (f: Omit<RtcpField, 'shown'> & { shown?: string }) => fields.push({ shown: String(f.value), label: cellLabel(f.key), ...f });
  let o = 0, n = 0;
  if (b.length < 8) return { ok: false, packets, fields, issues: [`${b.length} bytes: an RTCP packet is at least 8 bytes.`], parsed };

  while (o + 4 <= b.length) {
    const v = b[o]! >> 6, p = (b[o]! >> 5) & 1, rc = b[o]! & 31, pt = b[o + 1]!, words = dv.getUint16(o + 2);
    const len = (words + 1) * 4;
    const type = RTCP_TYPES[pt] ?? `PT ${pt}`;
    const part = `rtcp${n % 2}`;
    const base = o * 8;
    packets.push({ type, offset: o, length: len });
    if (v !== 2) issues.push(`Packet ${n + 1}: version ${v}, not 2.`);
    if (o + len > b.length) { issues.push(`Packet ${n + 1} (${type}) says ${len} bytes, but only ${b.length - o} are left.`); break; }
    add({ key: `${n}V`, name: 'Version', bit: base, bits: 2, value: v, part, rule: 'rfc3550-6.1-compound', explain: 'RTP version 2, as in RTP packets.' });
    add({ key: `${n}P`, name: 'Padding', bit: base + 2, bits: 1, value: p, part, rule: 'rfc3550-6.1-compound', explain: p ? 'Padding at the end of this packet.' : 'No padding.' });
    add({ key: `${n}RC`, name: type === 'SDES' || type === 'BYE' ? 'Source count' : 'Report count', bit: base + 3, bits: 5, value: rc, part, rule: 'rfc3550-6.4-sr-rr',
      explain: type === 'SDES' ? `${rc} chunk${rc === 1 ? '' : 's'} of source description.` : type === 'BYE' ? `${rc} source${rc === 1 ? '' : 's'} leaving.` : `${rc} report block${rc === 1 ? '' : 's'}: one for each source this side receives from.` });
    add({ key: `${n}PT`, name: 'Packet type', bit: base + 8, bits: 8, value: pt, shown: `${pt} (${type})`, part, rule: 'rfc3550-6.1-compound',
      explain: { SR: 'Sender report: this side also sends RTP.', RR: 'Receiver report: this side only receives.', SDES: 'Source description: the CNAME that names this endpoint.', BYE: 'This source is leaving the RTP session.', APP: 'Application-defined.', RTPFB: 'Transport feedback, such as NACK (RFC 4585).', PSFB: 'Payload-specific feedback, such as PLI or FIR (RFC 4585, RFC 5104).', XR: 'Extended report (RFC 3611), such as VoIP metrics.' }[type] ?? 'An RTCP type this decoder does not know.' });
    add({ key: `${n}len`, name: 'Length', bit: base + 16, bits: 16, value: words, shown: `${words} (${len} bytes)`, part, rule: 'rfc3550-6.1-compound',
      explain: `The length in 32-bit words, minus one: ${words} + 1 = ${words + 1} words, ${len} bytes. It lets the receiver find the next packet in the compound packet.` });

    const at = (k: number) => o + 4 + k;
    if (type === 'SR' || type === 'RR') {
      const ssrc = dv.getUint32(at(0));
      add({ key: `${n}ssrc`, name: 'SSRC of sender', bit: at(0) * 8, bits: 32, value: ssrc, shown: hex8(ssrc), part, rule: 'rfc3550-6.4-sr-rr', explain: 'The SSRC of the side that sends this report: the same SSRC as in its RTP packets.' });
      let k = 4;
      let sender: SenderInfo | undefined;
      if (type === 'SR') {
        sender = { ntpSec: dv.getUint32(at(4)), ntpFrac: dv.getUint32(at(8)), rtpTs: dv.getUint32(at(12)), packets: dv.getUint32(at(16)), octets: dv.getUint32(at(20)) };
        add({ key: `${n}ntp`, name: 'NTP timestamp', bit: at(4) * 8, bits: 64, value: sender.ntpSec, shown: `${hex8(sender.ntpSec)}:${hex8(sender.ntpFrac).slice(2)}`, part, rule: 'rfc3550-6.4.1-ntp',
          explain: `The wallclock time when this report was sent: ${sender.ntpSec} s since 1900, plus ${(sender.ntpFrac / 2 ** 32).toFixed(3)} s. Its middle 32 bits come back as LSR.` });
        add({ key: `${n}rtpts`, name: 'RTP timestamp', bit: at(12) * 8, bits: 32, value: sender.rtpTs, part, rule: 'rfc3550-6.4.1-rtpts', explain: 'The same instant on the RTP clock of this stream. It ties RTP time to wallclock time, for lip sync.' });
        add({ key: `${n}pkts`, name: "Sender's packet count", bit: at(16) * 8, bits: 32, value: sender.packets, part, rule: 'rfc3550-6.4.1-counts', explain: `RTP packets sent so far: ${sender.packets} (${(sender.packets / 50).toFixed(0)} s at 50 packets per second).` });
        add({ key: `${n}octs`, name: "Sender's octet count", bit: at(20) * 8, bits: 32, value: sender.octets, part, rule: 'rfc3550-6.4.1-counts', explain: `Payload bytes sent so far: ${sender.octets}. Headers are not counted.` });
        k = 24;
      }
      const blocks: ReportBlock[] = [];
      for (let i = 0; i < rc && at(k + 24) <= o + len; i++, k += 24) {
        const B = at(k);
        const word = dv.getUint32(B + 4);
        const blk: ReportBlock = { ssrc: dv.getUint32(B), fractionLost: word >>> 24, cumulativeLost: (word << 8) >> 8, extHighestSeq: dv.getUint32(B + 8), jitter: dv.getUint32(B + 12), lsr: dv.getUint32(B + 16), dlsr: dv.getUint32(B + 20) };
        blocks.push(blk);
        const bp = `${part}b`;
        const q = `${n}.${i}`;
        add({ key: `${q}ssrc`, name: 'SSRC of source', bit: B * 8, bits: 32, value: blk.ssrc, shown: hex8(blk.ssrc), part: bp, rule: 'rfc3550-6.4-sr-rr', explain: 'The stream this report block is about: the SSRC of the other side\'s RTP.' });
        add({ key: `${q}fl`, name: 'Fraction lost', bit: B * 8 + 32, bits: 8, value: blk.fractionLost, shown: `${blk.fractionLost}/256 (${((blk.fractionLost / 256) * 100).toFixed(1)}%)`, part: bp, rule: 'rfc3550-6.4.1-fraction', explain: 'The share of packets lost since the last report, in 1/256. 0 is perfect; 5 is about 2%.' });
        add({ key: `${q}cl`, name: 'Cumulative lost', bit: B * 8 + 40, bits: 24, value: blk.cumulativeLost, part: bp, rule: 'rfc3550-6.4.1-cumulative', explain: 'Packets lost since the stream started: expected minus received. Late packets count as received; duplicates can make it negative.' });
        add({ key: `${q}seq`, name: 'Extended highest sequence', bit: B * 8 + 64, bits: 32, value: blk.extHighestSeq, shown: `${blk.extHighestSeq} (cycles ${blk.extHighestSeq >>> 16}, seq ${blk.extHighestSeq & 0xffff})`, part: bp, rule: 'rfc3550-6.4.1-cumulative', explain: 'The highest sequence number received, with the number of times it wrapped at 65535 in the top 16 bits.' });
        add({ key: `${q}jit`, name: 'Interarrival jitter', bit: B * 8 + 96, bits: 32, value: blk.jitter, shown: `${blk.jitter} (${(blk.jitter / 8).toFixed(1)} ms at 8000 Hz)`, part: bp, rule: 'rfc3550-6.4.1-jitter', explain: 'The RFC 3550 jitter estimate, in RTP timestamp units. Divide by the clock rate for seconds.' });
        add({ key: `${q}lsr`, name: 'Last SR (LSR)', bit: B * 8 + 128, bits: 32, value: blk.lsr, shown: blk.lsr ? fixed16(blk.lsr) : '0 (no SR yet)', part: bp, rule: 'rfc3550-6.4.1-lsr', explain: 'The middle 32 bits of the NTP timestamp in the last SR received from that source. The source uses it to find the round-trip time.' });
        add({ key: `${q}dlsr`, name: 'Delay since last SR', bit: B * 8 + 160, bits: 32, value: blk.dlsr, shown: `${fixed16(blk.dlsr)} (${((blk.dlsr / 65536) * 1000).toFixed(0)} ms)`, part: bp, rule: 'rfc3550-6.4.1-lsr', explain: 'How long this side held that SR before it sent this report, in 1/65536 s.' });
      }
      parsed.push(type === 'SR' ? { type: 'SR', ssrc, sender: sender!, blocks } : { type: 'RR', ssrc, blocks });
    } else if (type === 'SDES' && len >= 12) {
      const ssrc = dv.getUint32(at(0));
      add({ key: `${n}ssrc`, name: 'SSRC', bit: at(0) * 8, bits: 32, value: ssrc, shown: hex8(ssrc), part, rule: 'rfc3550-6.5.1-cname', explain: 'The source that this description is about.' });
      const itemType = b[at(4)]!, itemLen = b[at(5)]!;
      const text = new TextDecoder().decode(b.slice(at(6), at(6) + itemLen));
      add({ key: `${n}it`, name: 'Item type', bit: at(4) * 8, bits: 8, value: itemType, shown: itemType === 1 ? '1 (CNAME)' : String(itemType), part, rule: 'rfc3550-6.5.1-cname', explain: itemType === 1 ? 'CNAME: a name for this endpoint that does not change when its SSRC does.' : 'A source description item.' });
      add({ key: `${n}il`, name: 'Item length', bit: at(5) * 8, bits: 8, value: itemLen, part, rule: 'rfc3550-6.5.1-cname', explain: `${itemLen} bytes of text follow.` });
      add({ key: `${n}cn`, name: 'CNAME', bit: at(6) * 8, bits: (len - 10) * 8, value: itemLen, shown: `"${text}"`, part, rule: 'rfc3550-6.5.1-cname', explain: 'Often user@host, or a random string for privacy. Audio and video from the same endpoint share it, which allows lip sync.' });
      if (itemType === 1) parsed.push({ type: 'SDES', ssrc, cname: text });
    } else if (type === 'BYE') {
      const ssrcs: number[] = [];
      for (let i = 0; i < rc; i++) {
        const s = dv.getUint32(at(i * 4));
        ssrcs.push(s);
        add({ key: `${n}s${i}`, name: 'SSRC leaving', bit: at(i * 4) * 8, bits: 32, value: s, shown: hex8(s), part, rule: 'rfc3550-6.6-bye', explain: 'This source stops sending. The RTP stream ends; the SIP dialog does not.' });
      }
      let reason: string | undefined;
      const r = at(rc * 4);
      if (r < o + len) {
        const rl = b[r]!;
        reason = new TextDecoder().decode(b.slice(r + 1, r + 1 + rl));
        add({ key: `${n}why`, name: 'Reason', bit: r * 8, bits: (o + len - r) * 8, value: rl, shown: `"${reason}"`, part, rule: 'rfc3550-6.6-bye', explain: 'Optional text: why the source is leaving.' });
      }
      parsed.push({ type: 'BYE', ssrcs, reason });
    } else if (len > 4) {
      add({ key: `${n}body`, name: `${type} body`, bit: at(0) * 8, bits: (len - 4) * 8, value: len - 4, shown: `${len - 4} bytes`, part, rule: 'rfc3550-6.1-compound', explain: 'The body of this packet type.' });
    }
    o += len; n++;
  }

  if (packets.length && !['SR', 'RR'].includes(packets[0]!.type)) issues.push(`The compound packet starts with ${packets[0]!.type}; it must start with an SR or RR.`);
  if (packets.length && !packets.some(p => p.type === 'SDES')) issues.push('No SDES with a CNAME: every compound packet must carry one.');
  if (packets.length === 1) issues.push('Only one packet: RTCP is always sent as a compound packet of at least two.');
  return { ok: issues.length === 0, packets, fields, issues, parsed };
}

/** A 32-bit value with 16 integer and 16 fraction bits, as RFC 3550 Figure 2 writes it. */
export function fixed16(n: number): string {
  const v = u32(n);
  return `0x${(v >>> 16).toString(16).padStart(4, '0')}:${(v & 0xffff).toString(16).padStart(4, '0')} (${(v / 65536).toFixed(3)} s)`;
}

/** The middle 32 bits of a 64-bit NTP timestamp. */
export const ntpMiddle = (sec: number, frac: number) => u32(((sec & 0xffff) << 16) | (frac >>> 16));

/** Seconds as a 32-bit 16.16 value. */
export const toFixed16 = (s: number) => u32(Math.round(s * 65536));

/** RFC 3550 §6.4.1: round-trip time = A − LSR − DLSR, all in 1/65536 s. Returns seconds. */
export function roundTrip(a: number, lsr: number, dlsr: number): number {
  return u32(a - lsr - dlsr) / 65536;
}

/** RFC 3550 Appendix A.3: fraction lost in the interval, in 1/256. */
export function fractionLost(expectedInterval: number, receivedInterval: number): number {
  const lost = expectedInterval - receivedInterval;
  return expectedInterval === 0 || lost <= 0 ? 0 : Math.floor((lost * 256) / expectedInterval);
}

// ---------------------------------------------------------------------------
// E-model

export interface EmodelCodec { id: string; name: string; ie: number; bpl: number }

/** Equipment impairment Ie and packet-loss robustness Bpl, from ITU-T G.113 Appendix I. */
export const EMODEL_CODECS: EmodelCodec[] = [
  { id: 'g711plc', name: 'G.711 with PLC', ie: 0, bpl: 25.1 },
  { id: 'g711', name: 'G.711 without PLC', ie: 0, bpl: 4.3 },
  { id: 'g729a', name: 'G.729A with VAD', ie: 11, bpl: 19 },
];

export interface EmodelInput {
  codec: EmodelCodec;
  /** One-way mouth-to-ear delay, ms. */
  delay: number;
  /** Packet loss, including jitter-buffer discards, percent. */
  loss: number;
  /** Burst ratio: 1 for random loss, more than 1 for bursty loss. */
  burstR: number;
}

export interface Emodel { r: number; mos: number; id: number; ieEff: number; band: string }

/**
 * A simplified E-model (ITU-T G.107), as monitoring tools use it:
 * R = 93.2 − Id − Ie,eff, where Id comes from the one-way delay and
 * Ie,eff from the codec and the loss.
 */
export function emodel(i: EmodelInput): Emodel {
  const d = i.delay;
  const id = 0.024 * d + (d > 177.3 ? 0.11 * (d - 177.3) : 0);
  const ieEff = i.codec.ie + (95 - i.codec.ie) * (i.loss / (i.loss / i.burstR + i.codec.bpl));
  const r = Math.max(0, Math.min(100, 93.2 - id - ieEff));
  return { r, mos: mosFromR(r), id, ieEff, band: band(r) };
}

/** ITU-T G.107: estimated conversational MOS from R. */
export function mosFromR(r: number): number {
  if (r <= 0) return 1;
  if (r >= 100) return 4.5;
  return 1 + 0.035 * r + r * (r - 60) * (100 - r) * 7e-6;
}

/** User satisfaction for an R value (ITU-T G.107 Annex B). */
export function band(r: number): string {
  return r >= 90 ? 'Very satisfied' : r >= 80 ? 'Satisfied' : r >= 70 ? 'Some users dissatisfied' : r >= 60 ? 'Many users dissatisfied' : r >= 50 ? 'Nearly all users dissatisfied' : 'Not recommended';
}
