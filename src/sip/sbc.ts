/**
 * SBC function explorer (Module 25.3): a company PBX sends an INVITE to the
 * SBC on its inside interface; the SBC sends its own INVITE to the carrier.
 * Each function of the SBC can be turned on or off, and changes the INVITE
 * on the outside, the media path, and what an attacker on the Internet can
 * do. With every function off, the SBC is a transparent B2BUA: new Via,
 * tags, and Contact, and everything else copied. Pure TypeScript.
 */

export const FUNCTIONS = {
  hide: 'Topology hiding',
  normalise: 'Normalisation',
  media: 'Media anchoring (NAT)',
  transcode: 'Transcoding',
  security: 'Security (TLS, SRTP, access list)',
  cac: 'Call admission control',
} as const;
export type SbcFunction = keyof typeof FUNCTIONS;
export type SbcOptions = Record<SbcFunction, boolean> & { /** Calls already up on the trunk; the limit is 30. */ busy: boolean };

export const DEFAULT_SBC: SbcOptions = { hide: false, normalise: false, media: false, transcode: false, security: false, cac: false, busy: false };
export const CALL_LIMIT = 30;

/** Transcoding and SRTP need the media to flow through the SBC. */
export function applySbc(o: SbcOptions, change: Partial<SbcOptions>): { options: SbcOptions; notes: string[] } {
  const n = { ...o, ...change };
  const notes: string[] = [];
  if ((n.transcode || n.security) && !n.media) {
    if (change.media === false) {
      if (n.transcode) { n.transcode = false; notes.push('Transcoding: off. The SBC can only transcode media that flows through it.'); }
      if (n.security) { n.security = false; notes.push('Security: off. The SBC can only encrypt media that flows through it.'); }
    } else {
      n.media = true;
      notes.push(`Media anchoring: on. ${n.transcode ? 'Transcoding' : 'SRTP'} needs the media to flow through the SBC.`);
    }
  }
  return { options: n, notes };
}

export interface Check { what: string; ok: boolean; text: string }

export interface SbcResult {
  inside: string;
  /** The INVITE to the carrier; undefined when the SBC rejects the call itself. */
  outside?: string;
  /** The SBC's answer to the PBX when it rejects the call. */
  reject?: string;
  /** What the carrier answers. */
  carrier: string;
  checks: Check[];
  /** Requests from the Internet, and what happens to them. */
  attacks: { what: string; blocked: boolean }[];
  mediaPath: 'direct' | 'anchored';
}

const INSIDE_SDP = ['v=0', 'o=pbx 1001 1001 IN IP4 10.1.1.20', 's=-', 'c=IN IP4 10.1.1.20', 't=0 0',
  'm=audio 20000 RTP/AVP 9 101', 'a=rtpmap:9 G722/8000', 'a=rtpmap:101 telephone-event/8000'];

export const INSIDE = [
  'INVITE sip:4045550199@10.1.1.1;user=phone SIP/2.0',
  'Via: SIP/2.0/UDP 10.1.1.20:5060;branch=z9hG4bKpx4a1c',
  'Max-Forwards: 70',
  'From: "Alice" <sip:4045550101@pbx.corp.internal>;tag=px81a2',
  'To: <sip:4045550199@10.1.1.1;user=phone>',
  'Call-ID: 5f0c1e9a@10.1.1.20',
  'CSeq: 1 INVITE',
  'Contact: <sip:4045550101@10.1.1.20:5060>',
  'Remote-Party-ID: "Alice" <sip:4045550101@pbx.corp.internal>;party=calling;screen=yes;privacy=off',
  'User-Agent: CorpPBX 13.4.2',
  'X-Corp-Route: trunk-group-3',
  'Content-Type: application/sdp',
  'Content-Length: {auto}',
  '',
  ...INSIDE_SDP,
].join('\n') + '\n';

export function runSbc(options: SbcOptions): SbcResult {
  const o = applySbc(options, {}).options;
  const attacks = [
    { what: 'REGISTER scan from 192.0.2.66, guessing extensions', blocked: o.security },
    { what: 'INVITE to an international premium number from 198.51.100.99', blocked: o.security },
    { what: '400 INVITEs per second from 203.0.113.250', blocked: o.security },
  ];
  const mediaPath = o.media ? 'anchored' : 'direct';

  if (o.cac && o.busy) {
    return {
      inside: INSIDE, mediaPath, attacks,
      reject: ['SIP/2.0 503 Service Unavailable', 'Via: SIP/2.0/UDP 10.1.1.20:5060;branch=z9hG4bKpx4a1c', 'From: "Alice" <sip:4045550101@pbx.corp.internal>;tag=px81a2',
        'To: <sip:4045550199@10.1.1.1;user=phone>;tag=sbc0e1', 'Call-ID: 5f0c1e9a@10.1.1.20', 'CSeq: 1 INVITE', 'Retry-After: 30',
        'Reason: Q.850;cause=34;text="No circuit/channel available"', 'Content-Length: {auto}'].join('\n') + '\n',
      carrier: 'The carrier never sees the call.',
      checks: [{ what: 'Call limit', ok: true, text: `${CALL_LIMIT} of ${CALL_LIMIT} calls are up. The SBC rejects the 31st call itself, with 503, so the PBX can try another route.` }],
    };
  }

  const num = (n: string) => (o.normalise ? `+1${n}` : n);
  const host = o.hide ? 'corp.example' : 'pbx.corp.internal';
  const transport = o.security ? 'TLS' : 'UDP';
  const port = o.security ? 5061 : 5060;
  const ip = o.media ? '203.0.113.1' : '10.1.1.20';
  const mport = o.media ? 40000 : 20000;
  const pts = o.transcode ? [8, 0, 101] : [9, 101];
  const RTPMAP: Record<number, string> = { 0: 'PCMU/8000', 8: 'PCMA/8000', 9: 'G722/8000', 101: 'telephone-event/8000' };
  const sdp = ['v=0', `o=${o.media ? 'sbc 7001 7001' : 'pbx 1001 1001'} IN IP4 ${ip}`, 's=-', `c=IN IP4 ${ip}`, 't=0 0',
    `m=audio ${mport} RTP/${o.security ? 'SAVP' : 'AVP'} ${pts.join(' ')}`, ...pts.map(p => `a=rtpmap:${p} ${RTPMAP[p]}`),
    ...(o.security ? ['a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:WVNfX19zZW1jdGwgKCkgewkyMjA7fQp9CnVubGVz'] : [])];
  const identity = o.normalise
    ? `P-Asserted-Identity: "Alice" <sip:+14045550101@${host};user=phone>`
    : `Remote-Party-ID: "Alice" <sip:4045550101@${host}>;party=calling;screen=yes;privacy=off`;
  const outside = [
    `INVITE sip:${num('4045550199')}@sip.carrier.example;user=phone SIP/2.0`,
    `Via: SIP/2.0/${transport} 203.0.113.1:${port};branch=z9hG4bKsb93c7`,
    'Max-Forwards: 69',
    `From: "Alice" <sip:${num('4045550101')}@${host}${o.normalise ? ';user=phone' : ''}>;tag=sb20d4`,
    `To: <sip:${num('4045550199')}@${o.hide ? 'sip.carrier.example' : '10.1.1.1'};user=phone>`,
    `Call-ID: ${o.hide ? 'b8e21d07a4f3c5' : '5f0c1e9a@10.1.1.20'}`,
    'CSeq: 1 INVITE',
    `Contact: <sip:${num('4045550101')}@203.0.113.1:${port}${o.security ? ';transport=tls' : ''}>`,
    identity,
    ...(o.hide ? [] : ['User-Agent: CorpPBX 13.4.2', 'X-Corp-Route: trunk-group-3']),
    'Content-Type: application/sdp',
    'Content-Length: {auto}',
    '',
    ...sdp,
  ].join('\n') + '\n';

  const checks: Check[] = [
    o.normalise
      ? { what: 'Number format', ok: true, text: 'E.164 in the Request-URI, From, and To, and P-Asserted-Identity in place of the old Remote-Party-ID header.' }
      : { what: 'Number format', ok: false, text: 'The carrier expects E.164 and P-Asserted-Identity. It gets ten digits and Remote-Party-ID, a header from an old draft.' },
    o.transcode
      ? { what: 'Codec', ok: true, text: 'The carrier gets PCMA and PCMU. The SBC converts G.722 on the inside to G.711 on the outside, at a cost in CPU or DSP capacity.' }
      : { what: 'Codec', ok: false, text: 'The PBX offers only G.722. The carrier supports only G.711, so it answers 488 Not Acceptable Here.' },
    o.media
      ? { what: 'Media address', ok: true, text: 'The SDP gives the SBC\'s public address. The SBC relays the RTP to the PBX, and latches onto the address it really comes from.' }
      : { what: 'Media address', ok: false, text: 'The SDP gives 10.1.1.20, a private address. The carrier\'s RTP never arrives: a call with no audio.' },
    o.hide
      ? { what: 'Internal names', ok: true, text: 'No inside address, host name, or product version leaves the network. The Call-ID is new and random.' }
      : { what: 'Internal names', ok: false, text: 'The Call-ID, From, To, User-Agent, and X-Corp-Route show inside addresses, host names, the PBX product, and its version.' },
    o.security
      ? { what: 'Transport', ok: true, text: 'TLS for the signaling and SRTP for the media on the Internet side. Inside, the PBX keeps UDP and RTP.' }
      : { what: 'Transport', ok: false, text: 'Plain UDP and RTP over the Internet: anyone on the path can read the call and listen to it.' },
    o.cac
      ? { what: 'Call limit', ok: true, text: `${o.busy ? CALL_LIMIT : 12} of ${CALL_LIMIT} calls are up. The SBC counts every call on the trunk.` }
      : { what: 'Call limit', ok: !o.busy, text: o.busy ? `${CALL_LIMIT} calls are already up. The carrier rejects the 31st, or bills it as an extra channel.` : 'Nobody counts the calls. Fine at 12 calls; a problem when the trunk is full, or under attack.' },
  ];
  const carrier = o.busy ? `The carrier answers 503 Service Unavailable: all ${CALL_LIMIT} channels of the trunk are in use.`
    : !o.normalise ? 'The carrier answers 404 Not Found: it cannot route ten digits with no country code.'
    : !o.transcode ? 'The carrier answers 488 Not Acceptable Here: no codec in common.'
    : !o.media ? 'The carrier answers 200 OK, but sends its RTP to 10.1.1.20. Nobody hears anything.'
    : 'The carrier answers 200 OK, and the call works.';
  return { inside: INSIDE, outside, carrier, checks, attacks, mediaPath };
}
