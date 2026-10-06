/**
 * Voice quality budget (Module 29): the one-way delay of a call built from
 * its parts, jitter-buffer discards from the jitter, transcoding stages, and
 * the result through the simplified E-model of src/net/rtcp.ts. Also the
 * DSCP classes for voice, video, and signaling. Pure TypeScript.
 *
 * Simplifications, stated in the lesson:
 *  - Delay variation is exponential, with a mean equal to the RFC 3550 jitter J.
 *    A buffer of depth B then plays out all but e^(−B/J) of the packets.
 *  - An adaptive buffer settles at 5 × J (at least 20 ms): about 0.7 % late packets.
 *  - Light in fibre: 5 µs per km. Each transcoding stage adds a G.729A stage
 *    (Ie 11, the additive rule of ITU-T G.113) and one packet time of delay.
 */
import { emodel, EMODEL_CODECS, type Emodel } from './rtcp.ts';

export interface QualityInput {
  codec: 'g711plc' | 'g729a';
  ptime: 20 | 40;
  /** One-way queuing and processing in the access networks and the core, ms. */
  network: number;
  /** Route length, km. */
  distance: number;
  /** Interarrival jitter (RFC 3550), ms. */
  jitter: number;
  /** Jitter buffer: 'adaptive', or a fixed depth in ms. */
  buffer: 'adaptive' | number;
  /** Packet loss in the network, percent. */
  loss: number;
  bursty: boolean;
  /** Extra G.729A stages in the path (transcoding at gateways or SBCs). */
  transcodes: 0 | 1 | 2;
}

export interface BudgetPart { key: string; name: string; ms: number }

export interface Budget extends Emodel {
  parts: BudgetPart[];
  delay: number;
  bufferMs: number;
  /** Packets that arrive after their play-out time, percent. */
  discards: number;
  /** Network loss and discards together, percent. */
  totalLoss: number;
  ie: number;
  advice: string[];
}

/** ITU-T G.114: below 150 ms most users are satisfied; above 400 ms is not acceptable for planning. */
export const G114 = { good: 150, limit: 400 };

const CODEC_DELAY = { g711plc: 1, g729a: 15 } as const; // look-ahead and processing at both ends

export function adaptiveDepth(jitter: number): number {
  return Math.min(400, Math.max(20, Math.round(5 * jitter)));
}

export function lateFraction(buffer: number, jitter: number): number {
  return jitter <= 0 ? 0 : 100 * Math.exp(-buffer / jitter);
}

export function budget(i: QualityInput): Budget {
  const bufferMs = i.buffer === 'adaptive' ? adaptiveDepth(i.jitter) : i.buffer;
  const parts: BudgetPart[] = [
    { key: 'pkt', name: 'Packetisation', ms: i.ptime },
    { key: 'codec', name: 'Codec look-ahead and processing', ms: CODEC_DELAY[i.codec] },
    { key: 'net', name: 'Networks: access, queues, routers', ms: i.network },
    { key: 'dist', name: 'Distance (light in fibre)', ms: Math.round(i.distance * 0.005) },
    { key: 'jb', name: 'Jitter buffer', ms: bufferMs },
    ...(i.transcodes ? [{ key: 'tx', name: `Transcoding (${i.transcodes} stage${i.transcodes > 1 ? 's' : ''})`, ms: i.transcodes * (i.ptime + CODEC_DELAY.g729a) }] : []),
  ];
  const delay = parts.reduce((s, p) => s + p.ms, 0);
  const discards = lateFraction(bufferMs, i.jitter);
  const totalLoss = 100 * (1 - (1 - i.loss / 100) * (1 - discards / 100));
  const base = EMODEL_CODECS.find(c => c.id === i.codec)!;
  const ie = base.ie + 11 * i.transcodes;
  const e = emodel({ codec: { ...base, ie }, delay, loss: totalLoss, burstR: i.bursty ? 2 : 1 });

  const advice: string[] = [];
  const biggest = [...parts].sort((a, b) => b.ms - a.ms)[0]!;
  if (delay > G114.limit) advice.push(`The delay is over ${G114.limit} ms: people talk over each other. The biggest part is ${biggest.name.toLowerCase()}.`);
  else if (delay > G114.good) advice.push(`The delay is over ${G114.good} ms: users start to notice it. The biggest part is ${biggest.name.toLowerCase()}.`);
  if (discards >= 1 && discards > i.loss) advice.push(`The jitter buffer discards ${discards.toFixed(1)} % of the packets: they arrive too late. The network loses only ${i.loss} %. A deeper buffer, or less jitter, fixes it.`);
  if (i.buffer !== 'adaptive' && bufferMs > 3 * Math.max(i.jitter, 10)) advice.push('The fixed jitter buffer is deeper than this jitter needs: it adds delay for nothing.');
  if (i.transcodes) advice.push(`Each transcoding stage costs ${11} points of R and ${i.ptime + CODEC_DELAY.g729a} ms. Avoid it where both sides share a codec.`);
  if (i.bursty && i.loss > 0) advice.push('Losses in bursts hurt more than the same loss spread out: packet loss concealment cannot hide a long gap.');
  if (!advice.length) advice.push('Every part of the budget is within its limits.');
  return { ...e, parts, delay, bufferMs, discards, totalLoss, ie, advice };
}

export const QUALITY_PRESETS: { label: string; input: QualityInput }[] = [
  { label: 'Office, same city', input: { codec: 'g711plc', ptime: 20, network: 5, distance: 50, jitter: 2, buffer: 'adaptive', loss: 0, bursty: false, transcodes: 0 } },
  { label: 'Atlanta to Singapore', input: { codec: 'g711plc', ptime: 20, network: 30, distance: 16000, jitter: 5, buffer: 'adaptive', loss: 0.5, bursty: false, transcodes: 0 } },
  { label: 'Busy Wi-Fi, fixed 20 ms buffer', input: { codec: 'g711plc', ptime: 20, network: 20, distance: 300, jitter: 12, buffer: 20, loss: 0.5, bursty: true, transcodes: 0 } },
  { label: 'G.729 WAN, transcoded twice', input: { codec: 'g711plc', ptime: 20, network: 25, distance: 2000, jitter: 5, buffer: 'adaptive', loss: 0.5, bursty: false, transcodes: 2 } },
];

// ---------------------------------------------------------------------------
// DSCP (29.2)

export interface TrafficClass {
  id: string;
  name: string;
  dscp: number;
  dscpName: string;
  /** IEEE 802.1p priority (CoS) usually mapped on Ethernet, and the Wi-Fi access category (RFC 8325). */
  cos: number;
  wifi: string;
  queue: string;
  note: string;
}

export const TRAFFIC_CLASSES: TrafficClass[] = [
  { id: 'rtp', name: 'Voice (RTP)', dscp: 46, dscpName: 'EF', cos: 5, wifi: 'AC_VO (voice)', queue: 'Strict priority queue, with a rate limit', note: 'Expedited Forwarding: the packet goes before everything else, so queues stay short.' },
  { id: 'video', name: 'Video calls (RTP)', dscp: 34, dscpName: 'AF41', cos: 4, wifi: 'AC_VI (video)', queue: 'A guaranteed share of the link', note: 'Assured Forwarding class 4: a share of the bandwidth, not strict priority, so video cannot starve voice.' },
  { id: 'sip-rfc', name: 'SIP signaling (RFC 4594)', dscp: 40, dscpName: 'CS5', cos: 5, wifi: 'AC_VI (video)', queue: 'A guaranteed share of the link', note: 'RFC 4594 puts telephony signaling in CS5.' },
  { id: 'sip-vendor', name: 'SIP signaling (common practice)', dscp: 24, dscpName: 'CS3', cos: 3, wifi: 'AC_BE (best effort)', queue: 'A guaranteed share of the link', note: 'Many phones and switches use CS3 for SIP; older ones use AF31 (26). What matters is that the whole network agrees.' },
  { id: 'netctl', name: 'Routing protocols', dscp: 48, dscpName: 'CS6', cos: 6, wifi: 'AC_VO (voice)', queue: 'Network control queue', note: 'Routers mark their own control traffic, such as BGP and OSPF, with CS6.' },
  { id: 'be', name: 'Everything else', dscp: 0, dscpName: 'DF (CS0)', cos: 0, wifi: 'AC_BE (best effort)', queue: 'Best effort', note: 'Default forwarding: web, e-mail, backups. It gets what is left.' },
];

/** The old IPv4 ToS byte: DSCP in the top six bits, ECN in the bottom two. */
export const tosByte = (dscp: number, ecn = 0) => (dscp << 2) | ecn;
/** What a device does if someone types a ToS value into a DSCP field, or the other way round. */
export const dscpFromTos = (tos: number) => tos >> 2;
