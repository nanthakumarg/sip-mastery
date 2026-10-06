/**
 * WebRTC and SIP (Module 26): a browser calls Bob's SIP phone through a
 * WebRTC gateway (an ICE-lite B2BUA with a media relay). The generator has
 * options for the network (open, or UDP blocked), a TURN server, trickle ICE
 * over SIP INFO (RFC 8840), whether the gateway converts the media, and the
 * codecs. The same SDP builders feed the SDP comparison and the gateway view.
 * Every combination passes lint-flow.ts and lint-diagram.ts.
 */
import type { FlowData } from './flow.ts';
import { BOB, FlowWriter, sdp, withTag, type Msg, type Node } from './sipgen.ts';

// ---------------------------------------------------------------------------
// The network

export const BROWSER: Node = { id: 'browser', label: 'Browser', kind: 'ua', ip: '192.168.1.20', contact: 'sip:k3x9q2fd@df7jal23ls0d.invalid;transport=ws', tag: 'jsp41ac', br: 'ws' };
export const TURN: Node = { id: 'turn', label: 'TURN server', kind: 'server', ip: '203.0.113.60', br: 'tu' };
export const GATEWAY: Node = { id: 'gw', label: 'WebRTC gateway', kind: 'sbc', ip: '203.0.113.80', contact: 'sip:gw@203.0.113.80:5060', br: 'gw' };
const SRFLX = '198.51.100.77';
const FINGERPRINT_BROWSER = 'sha-256 D2:FA:0E:C3:22:59:5E:14:95:69:92:3D:13:B4:84:24:2C:C2:A2:C0:3E:FD:34:8E:5E:EA:6F:AF:52:CE:E6:0F';
const FINGERPRINT_GW = 'sha-256 7B:8B:F0:65:5F:78:E2:51:3B:AC:6F:F3:3F:46:1B:35:DC:B8:5F:64:1A:24:C2:43:F0:A1:58:D0:A1:2C:19:08';

// ---------------------------------------------------------------------------
// SDP

const RTPMAP: Record<number, string> = { 0: 'PCMU/8000', 8: 'PCMA/8000', 111: 'opus/48000/2', 126: 'telephone-event/8000' };

export interface WebrtcSdpSpec {
  /** Browser offer or gateway answer. */
  role: 'offer' | 'answer';
  pts: number[];
  /** Candidate lines in the SDP; none with trickle ICE. */
  candidates: string[];
  /** Adds a video m= line in the same BUNDLE group (for the SDP comparison). */
  video?: boolean;
}

export const BROWSER_CANDIDATES = {
  host: 'candidate:1467250027 1 udp 2122260223 192.168.1.20 54400 typ host',
  srflx: `candidate:842163049 1 udp 1686052607 ${SRFLX} 54400 typ srflx raddr 192.168.1.20 rport 54400`,
  relay: `candidate:3745188117 1 udp 41885439 203.0.113.60 49152 typ relay raddr ${SRFLX} rport 54400`,
};
const GW_CANDIDATE = 'candidate:1 1 udp 2130706431 203.0.113.80 40000 typ host';

/** A browser offer (as JSEP writes it) or the gateway's ICE-lite answer. */
export function webrtcSdp(s: WebrtcSdpSpec): string {
  const offer = s.role === 'offer';
  const relay = s.candidates.find(c => c.includes('typ relay'));
  const def = !s.candidates.length ? { ip: '0.0.0.0', port: 9 }
    : offer ? (s.candidates.some(c => c.includes('typ srflx')) ? { ip: SRFLX, port: 54400 } : relay ? { ip: '203.0.113.60', port: 49152 } : { ip: '192.168.1.20', port: 54400 })
    : { ip: GATEWAY.ip, port: 40000 };
  const mids = s.video ? '0 1' : '0';
  const audio = [
    `m=audio ${def.port} UDP/TLS/RTP/SAVPF ${s.pts.join(' ')}`,
    `c=IN IP4 ${def.ip}`,
    ...s.candidates.map(c => `a=${c}`),
    ...(offer || !s.candidates.length ? [] : ['a=end-of-candidates']),
    `a=ice-ufrag:${offer ? 'EsAw' : 'gW7c'}`,
    `a=ice-pwd:${offer ? 'P2uYro0UCOQ4zxjKXaWCBui1' : 'xK9mT2qLw4ZbN8vR1sYc6dHf'}`,
    ...(offer ? ['a=ice-options:trickle'] : []),
    `a=fingerprint:${offer ? FINGERPRINT_BROWSER : FINGERPRINT_GW}`,
    `a=setup:${offer ? 'actpass' : 'passive'}`,
    'a=mid:0',
    ...(offer ? ['a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level'] : []),
    'a=sendrecv',
    ...(offer ? ['a=msid:stream0 track0'] : []),
    'a=rtcp-mux',
    ...s.pts.flatMap(pt => [`a=rtpmap:${pt} ${RTPMAP[pt]}`, ...(pt === 111 ? ['a=rtcp-fb:111 transport-cc', 'a=fmtp:111 minptime=10;useinbandfec=1'] : [])]),
    ...(offer ? ['a=ssrc:3570614608 cname:4TOk42mSjXCkVIa6'] : []),
  ];
  const video = s.video ? [
    `m=video ${def.port} UDP/TLS/RTP/SAVPF 96 97`,
    `c=IN IP4 ${def.ip}`,
    'a=ice-ufrag:EsAw', 'a=ice-pwd:P2uYro0UCOQ4zxjKXaWCBui1', 'a=ice-options:trickle',
    `a=fingerprint:${FINGERPRINT_BROWSER}`, 'a=setup:actpass', 'a=mid:1', 'a=sendrecv', 'a=msid:stream0 track1',
    'a=rtcp-mux', 'a=rtcp-rsize', 'a=rtpmap:96 VP8/90000', 'a=rtcp-fb:96 nack', 'a=rtcp-fb:96 nack pli', 'a=rtcp-fb:96 goog-remb',
    'a=rtpmap:97 rtx/90000', 'a=fmtp:97 apt=96', 'a=ssrc:2231627014 cname:4TOk42mSjXCkVIa6',
  ] : [];
  return [
    'v=0',
    offer ? 'o=- 4611731400430051336 2 IN IP4 127.0.0.1' : `o=gw 6001 6001 IN IP4 ${GATEWAY.ip}`,
    's=-',
    't=0 0',
    `a=group:BUNDLE ${mids}`,
    ...(offer ? ['a=msid-semantic:WMS stream0'] : ['a=ice-lite']),
    ...audio,
    ...video,
  ].join('\n') + '\n';
}

/** The same call on the SIP side: one port per stream, plain RTP, no ICE, no DTLS. */
export const classicSdp = (pts: number[], video = false, ip = GATEWAY.ip, user = 'gw', id = 6101) => {
  const base = sdp({ user, id, ip, port: 30000, pts: pts.filter(p => p !== 126 && p !== 111) });
  const extra = (pts.includes(126) ? 'a=rtpmap:101 telephone-event/8000\n' : '');
  const lines = base.trimEnd().split('\n');
  if (pts.includes(126)) lines[5] = `${lines[5]} 101`;
  return [...lines, ...(extra ? [extra.trimEnd()] : []), 'a=sendrecv', ...(video ? ['m=video 30002 RTP/AVP 96', 'a=rtpmap:96 H264/90000', 'a=sendrecv'] : [])].join('\n') + '\n';
};

// ---------------------------------------------------------------------------
// The SDP comparison (26.2): groups of lines that differ, and why

export interface SdpDiff {
  id: string;
  title: string;
  /** Matches lines of the WebRTC SDP. */
  webrtc: RegExp;
  /** Matches lines of the classic SDP. */
  classic?: RegExp;
  text: string;
  /** What a gateway does about it. */
  gateway: string;
}

export const SDP_DIFFS: SdpDiff[] = [
  { id: 'proto', title: 'Transport profile', webrtc: /^m=/, classic: /^m=/,
    text: 'UDP/TLS/RTP/SAVPF: SRTP keyed with DTLS, with RTCP feedback. A classic phone offers RTP/AVP: plain RTP, no feedback.',
    gateway: 'Terminates DTLS-SRTP on the browser side, and sends plain RTP (or SDES-SRTP) on the SIP side.' },
  { id: 'ice', title: 'ICE', webrtc: /^a=(candidate|ice-|end-of-candidates)/,
    text: 'Candidates, a username fragment, and a password for the connectivity checks. A browser never sends media without ICE.',
    gateway: 'Answers the checks (often as ICE lite, with one public address). The SIP side has no ICE at all.' },
  { id: 'dtls', title: 'DTLS', webrtc: /^a=(fingerprint|setup)/,
    text: 'The hash of the certificate that the DTLS handshake will use, and who starts the handshake. The SRTP keys come from that handshake (Module 18).',
    gateway: 'Runs the DTLS handshake itself, as a DTLS server (setup:passive).' },
  { id: 'bundle', title: 'BUNDLE and mid', webrtc: /^a=(group:BUNDLE|mid)/,
    text: 'All streams share one port, named by mid. Audio and video arrive on the same 5-tuple; the receiver tells them apart by SSRC and payload type.',
    gateway: 'Splits the bundle: one port per stream on the SIP side, as classic phones expect.' },
  { id: 'rtcp', title: 'rtcp-mux, rtcp-rsize', webrtc: /^a=rtcp-(mux|rsize)/,
    text: 'RTCP on the same port as RTP, and reduced-size RTCP. WebRTC requires rtcp-mux.',
    gateway: 'Sends RTCP on port + 1 on the SIP side, unless the phone also offers rtcp-mux.' },
  { id: 'codec', title: 'Codecs', webrtc: /^a=(rtpmap|fmtp|rtcp-fb)/, classic: /^a=rtpmap/,
    text: 'Opus first, with G.711 behind it; dynamic payload types; RTCP feedback (transport-cc, NACK, PLI) per codec.',
    gateway: 'Chooses a codec that both sides share, or transcodes Opus to G.711. Ends the RTCP feedback on its side.' },
  { id: 'msid', title: 'Streams and tracks', webrtc: /^a=(msid|ssrc|extmap)/,
    text: 'msid ties each stream to a JavaScript MediaStream and track; ssrc and cname name the RTP sources; extmap names RTP header extensions.',
    gateway: 'Drops them: a SIP phone has no use for them.' },
  { id: 'addr', title: 'Connection address', webrtc: /^(c=|o=)/, classic: /^(c=|o=)/,
    text: 'With trickle ICE, c= is 0.0.0.0 and the port 9: placeholders. The candidates carry the real addresses. o= uses a random session ID and no real address.',
    gateway: 'Gives the SIP side its own media address in c= and the m= port.' },
];

// ---------------------------------------------------------------------------
// The gateway view (26.5): what the gateway converts, layer by layer

export interface Layer { name: string; browser: string; sip: string; action: string; without: string }
export const LAYERS: Layer[] = [
  { name: 'Signaling transport', browser: 'SIP over secure WebSocket (WSS), TCP 443', sip: 'SIP over UDP, TCP, or TLS, port 5060 or 5061',
    action: 'Keeps the WebSocket connection open and sends the browser\'s calls and requests over it.', without: 'A SIP phone or carrier cannot open a WebSocket connection to the browser.' },
  { name: 'Addresses', browser: 'Via and Contact with a random .invalid host', sip: 'Real IP addresses and ports',
    action: 'Replaces the .invalid addresses with its own, and remembers which WebSocket connection each Contact belongs to.', without: 'In-dialog requests go to a host name that does not exist.' },
  { name: 'ICE', browser: 'Candidates, connectivity checks, consent checks every 5 s', sip: 'No ICE: the address in c= and m=',
    action: 'Answers the browser\'s checks, usually as ICE lite with one public address.', without: 'The browser never sends media: no ICE, no audio.' },
  { name: 'Media security', browser: 'DTLS-SRTP, required', sip: 'RTP, or SRTP with SDES keys',
    action: 'Ends DTLS-SRTP, and encrypts or decrypts every packet.', without: 'The phone answers 488: it does not know UDP/TLS/RTP/SAVPF.' },
  { name: 'Ports', browser: 'BUNDLE and rtcp-mux: everything on one port', sip: 'One port per stream, RTCP on port + 1',
    action: 'Splits the bundle into separate ports, and RTCP onto its own port.', without: 'The phone sends video and RTCP to ports where nobody listens.' },
  { name: 'Codecs', browser: 'Opus (48 kHz), G.711, VP8 or H.264', sip: 'G.711, G.722, G.729; sometimes H.264',
    action: 'Chooses G.711 if both sides have it; otherwise transcodes Opus to G.711.', without: 'No codec in common: 488 Not Acceptable Here.' },
  { name: 'RTCP feedback', browser: 'NACK, PLI, transport-cc, REMB', sip: 'Plain RTCP reports',
    action: 'Answers the feedback itself, or passes on what the phone understands.', without: 'The browser cannot adapt its bit rate to the network.' },
];

// ---------------------------------------------------------------------------
// The generator

export const NETWORKS = { open: 'Open', restrictive: 'UDP blocked' } as const;
export const CODECS = { g711: 'Opus and G.711', 'opus-transcode': 'Opus only, transcoded', 'opus-none': 'Opus only, no transcoding' } as const;

export interface WebrtcOptions {
  network: keyof typeof NETWORKS;
  turn: boolean;
  trickle: boolean;
  /** The gateway converts the media (DTLS-SRTP, ICE, BUNDLE) for the SIP side. */
  convert: boolean;
  codec: keyof typeof CODECS;
}

export const DEFAULT_WEBRTC: WebrtcOptions = { network: 'open', turn: false, trickle: false, convert: true, codec: 'g711' };

export function applyWebrtc(o: WebrtcOptions, change: Partial<WebrtcOptions>): { options: WebrtcOptions; notes: string[] } {
  return { options: { ...o, ...change }, notes: [] };
}

/** Without conversion, the phone rejects the offer, so nothing after it matters. */
export function webrtcInactive(o: WebrtcOptions): Partial<Record<'codec' | 'network' | 'turn', string>> {
  if (!o.convert) {
    const why = 'Bob\'s phone rejects the WebRTC offer, so the call never gets this far.';
    return { codec: why, network: why, turn: why };
  }
  if (o.codec === 'opus-none') {
    const why = 'Bob\'s phone rejects the offer: no codec in common.';
    return { network: why, turn: why };
  }
  return {};
}

export const webrtcKey = (o: WebrtcOptions) => {
  const off = webrtcInactive(o);
  return [off.network ? '' : o.network, o.turn && !off.turn ? 'turn' : '', o.trickle ? 'trickle' : '', o.convert ? '' : 'noconvert', off.codec ? '' : o.codec]
    .filter(Boolean).join('.');
};

export function allWebrtc(): WebrtcOptions[] {
  const out = new Map<string, WebrtcOptions>();
  for (const network of Object.keys(NETWORKS) as WebrtcOptions['network'][])
    for (const turn of [false, true]) for (const trickle of [false, true]) for (const convert of [true, false])
      for (const codec of Object.keys(CODECS) as WebrtcOptions['codec'][]) {
        const o = { network, turn, trickle, convert, codec };
        out.set(webrtcKey(o), o);
      }
  return [...out.values()];
}

export const WEBRTC_QUOTES = [
  'rfc7118-5.1-via', 'rfc8840-3-info', 'rfc8840-4.3-dialog', 'rfc8838-1-gathering', 'rfc8445-2.2-checks', 'rfc5763-5-active',
  'rfc5764-3-overview', 'rfc9143-5-bundle', 'rfc7874-3-codecs', 'rfc8827-6.5-dtls', 'rfc8835-3.4-turn', 'rfc3262-3-require', 'rfc8445-2.5-lite',
] as const;

const BOB_AOR = 'sip:bob@biloxi.example';

export function buildWebrtc(options: WebrtcOptions): FlowData {
  const o = applyWebrtc(options, {}).options;
  const off = webrtcInactive(o);
  const w = new FlowWriter();
  const G = GATEWAY;
  const blocked = o.network === 'restrictive' && !off.network;
  const turn = o.turn && !off.turn;
  const opusOnly = o.codec !== 'g711';
  const browserPts = opusOnly ? [111, 126] : [111, 0, 8, 126];

  // TURN: the browser gets a relay address while it gathers candidates.
  if (turn) {
    w.steps.push({ from: 'browser', to: 'turn', proto: 'dns', label: 'TURN Allocate', rfc: 'rfc8835-3.4-turn',
      caption: blocked ? 'The firewall blocks UDP, so the browser reaches its TURN server over TLS on port 443, like a web page.' : 'While it gathers candidates, the browser asks its TURN server for a relay address.',
      detail: `TLS 192.168.1.20:51200 → 203.0.113.60:443\nSTUN Allocate request\n  REQUESTED-TRANSPORT: UDP\n  USERNAME, MESSAGE-INTEGRITY (credentials from the web app)` });
    w.steps.push({ from: 'turn', to: 'browser', proto: 'dns', label: 'TURN Allocate success', caption: 'The TURN server gives the browser a relay address: 203.0.113.60:49152.',
      detail: 'STUN Allocate success response\n  XOR-RELAYED-ADDRESS: 203.0.113.60:49152\n  LIFETIME: 600' });
  }

  const cands = o.trickle ? [] : blocked ? (turn ? [BROWSER_CANDIDATES.host, BROWSER_CANDIDATES.relay] : [BROWSER_CANDIDATES.host])
    : [BROWSER_CANDIDATES.host, BROWSER_CANDIDATES.srflx, ...(turn ? [BROWSER_CANDIDATES.relay] : [])];
  const FROM = `"Alice" <sip:alice@atlanta.example>;tag=${BROWSER.tag}`, TO = `<${BOB_AOR}>`;
  let bseq = 8811;
  const inv: Msg = {
    line: `INVITE ${BOB_AOR} SIP/2.0`, via: [`SIP/2.0/WSS df7jal23ls0d.invalid;branch=${w.branch(BROWSER)}`], maxForwards: 70,
    from: FROM, to: TO, callId: 'n1h4p0q8u3c2@df7jal23ls0d.invalid', cseq: `${bseq} INVITE`, contact: `${BROWSER.contact};ob`,
    extra: [...(o.trickle ? ['Supported: trickle-ice, 100rel', 'Recv-Info: trickle-ice'] : ['Supported: 100rel'])],
    sdp: webrtcSdp({ role: 'offer', pts: browserPts, candidates: cands }),
  };
  w.msg(BROWSER, G, 'INVITE', o.trickle
    ? 'The browser sends its offer at once, with no candidates: c= and the port are placeholders. It will trickle the candidates later.'
    : `The browser waits until it has gathered all candidates, then sends the offer over its WebSocket connection.`, inv,
    { rfc: o.trickle ? 'rfc8838-1-gathering' : 'rfc7118-5.1-via' });
  w.msg(G, BROWSER, '100 Trying', 'The gateway takes the call.', w.response({ from: BROWSER, to: G, msg: inv }, '100 Trying', {}));

  // The SIP side.
  const sipPts = !o.convert ? browserPts : o.codec === 'opus-none' ? [111, 126] : [0, 8, 126];
  const sipSdp = !o.convert ? inv.sdp! : o.codec === 'opus-none'
    ? classicSdp([0]).replace('m=audio 30000 RTP/AVP 0', 'm=audio 30000 RTP/AVP 111 101').replace('a=rtpmap:0 PCMU/8000', 'a=rtpmap:111 opus/48000/2\na=rtpmap:101 telephone-event/8000')
    : classicSdp(sipPts);
  const CID2 = '41f9c2a7@203.0.113.80', TAG2 = 'gw2c81';
  const inv2: Msg = {
    line: `INVITE ${BOB.contact} SIP/2.0`, via: [o.convert ? w.via(G) : `SIP/2.0/TCP ${G.ip}:5060;branch=${w.branch(G)}`], maxForwards: 69,
    from: `"Alice" <sip:alice@atlanta.example>;tag=${TAG2}`, to: TO, callId: CID2, cseq: '1 INVITE', contact: G.contact, sdp: sipSdp,
  };
  const TAG1 = 'gw1a77';
  const answerPts = o.codec === 'g711' ? [0, 126] : [111, 126];
  const answer = webrtcSdp({ role: 'answer', pts: answerPts, candidates: [GW_CANDIDATE] });
  const resp1 = (status: string, more: Partial<Msg>) => w.response({ from: BROWSER, to: G, msg: inv }, status, { tag: TAG1, contact: G.contact, ...more });
  const resp2 = (status: string, more: Partial<Msg>) => w.response({ from: G, to: BOB, msg: inv2 }, status, { tag: BOB.tag, contact: BOB.contact, ...more });
  const sendInvite2 = () => w.msg(G, BOB, 'INVITE', !o.convert
    ? 'This gateway converts only the signaling. It sends the WebRTC SDP as it is, over TCP: it is too big for UDP.'
    : o.codec === 'opus-none' ? 'The gateway cannot transcode, so it can offer Bob only Opus.'
    : o.codec === 'opus-transcode' ? 'The gateway offers Bob G.711, and will transcode between Opus and G.711.'
    : 'The gateway calls Bob with a classic SDP: plain RTP on its own address, one port, G.711.', inv2,
    !o.convert ? { warn: 'A classic SIP phone does not know UDP/TLS/RTP/SAVPF, ICE, or BUNDLE.' } : o.codec === 'opus-transcode' ? { rfc: 'rfc7874-3-codecs' } : {});

  // Rejected on the SIP side: 488 on both sides.
  if (!o.convert || o.codec === 'opus-none') {
    sendInvite2();
    const r = resp2('488 Not Acceptable Here', { contact: undefined, extra: [!o.convert ? 'Warning: 302 bob.biloxi.example "Incompatible transport protocol"' : 'Warning: 305 bob.biloxi.example "Incompatible media format"'] });
    w.msg(BOB, G, '488 Not Acceptable Here', !o.convert ? 'Bob\'s phone does not know the transport profile, so it rejects the offer.' : 'Bob\'s phone has no Opus, so there is no codec in common.', r);
    w.msg(G, BOB, 'ACK', 'The gateway acknowledges the 488.', w.ackNon2xx({ from: G, to: BOB, msg: inv2 }, BOB.tag!));
    w.msg(G, BROWSER, '488 Not Acceptable Here', 'The gateway passes the failure to the browser. The web app shows "Call failed".', resp1('488 Not Acceptable Here', { contact: undefined }));
    w.msg(BROWSER, G, 'ACK', 'The browser acknowledges.', w.ackNon2xx({ from: BROWSER, to: G, msg: inv }, TAG1));
    return done(o, w, turn);
  }

  // ICE and DTLS on the browser side; the path goes through TURN when UDP is blocked.
  const viaTurn = blocked && turn;
  const iceAndDtls = () => {
    if (blocked && !turn) {
      w.steps.push({ from: 'browser', to: 'gw', proto: 'dns', label: 'STUN Binding request', lost: true,
        caption: 'The browser checks its only candidate pair. The firewall drops the UDP packet.', rfc: 'rfc8445-2.2-checks',
        detail: 'UDP 192.168.1.20:54400 → 203.0.113.80:40000\nSTUN Binding request\n  USE-CANDIDATE, PRIORITY, ICE-CONTROLLING\n  USERNAME: gW7c:EsAw' });
      w.steps.push({ from: 'browser', to: 'gw', proto: 'dns', label: 'STUN Binding request', lost: true,
        caption: 'The browser retries for several seconds. Every check fails, so ICE fails.',
        warn: 'No TURN server: on a network that blocks UDP, the call has no media at all.',
        detail: 'UDP 192.168.1.20:54400 → 203.0.113.80:40000\nSTUN Binding request (retransmission)' });
      return false;
    }
    if (viaTurn) {
      w.steps.push({ from: 'browser', to: 'turn', proto: 'dns', label: 'TURN Send (STUN check)', caption: 'The browser sends its check through the TURN server, over the TLS connection.',
        detail: 'TLS → 203.0.113.60:443\nTURN Send indication\n  XOR-PEER-ADDRESS: 203.0.113.80:40000\n  DATA: STUN Binding request' });
      w.steps.push({ from: 'turn', to: 'gw', proto: 'dns', label: 'STUN Binding request', caption: 'The TURN server sends the check from its relay address.', rfc: 'rfc8445-2.2-checks',
        detail: 'UDP 203.0.113.60:49152 → 203.0.113.80:40000\nSTUN Binding request\n  USE-CANDIDATE, PRIORITY, ICE-CONTROLLING' });
      w.steps.push({ from: 'gw', to: 'turn', proto: 'dns', label: 'STUN Binding response', caption: 'The gateway answers the relay address.',
        detail: 'UDP 203.0.113.80:40000 → 203.0.113.60:49152\nSTUN Binding success response' });
      w.steps.push({ from: 'turn', to: 'browser', proto: 'dns', label: 'TURN Data (STUN response)', caption: 'The pair through the relay works. ICE selects it.',
        detail: 'TLS 203.0.113.60:443 → browser\nTURN Data indication\n  DATA: STUN Binding success response' });
      w.steps.push({ from: 'browser', to: 'turn', proto: 'net', label: 'DTLS handshake (via TURN)', caption: 'The DTLS handshake runs through the relay too.', rfc: 'rfc5763-5-active',
        detail: 'ClientHello → ServerHello, Certificate → Finished\nThe gateway checks the certificate against the fingerprint in the offer.' });
      w.steps.push({ from: 'turn', to: 'gw', proto: 'net', label: 'DTLS handshake', caption: 'The gateway, as DTLS server, finishes the handshake. Both sides now have SRTP keys.', rfc: 'rfc5764-3-overview',
        detail: 'DTLS 1.2 handshake; use_srtp extension: SRTP_AES128_CM_HMAC_SHA1_80' });
      return true;
    }
    const from = blocked ? '192.168.1.20' : SRFLX;
    w.steps.push({ from: 'browser', to: 'gw', proto: 'dns', label: 'STUN Binding request', caption: 'The browser checks its candidate pairs against the gateway\'s one address.', rfc: 'rfc8445-2.2-checks',
      detail: `UDP ${from}:54400 → 203.0.113.80:40000 (through the browser's NAT)\nSTUN Binding request\n  USE-CANDIDATE, PRIORITY, ICE-CONTROLLING\n  USERNAME: gW7c:EsAw` });
    w.steps.push({ from: 'gw', to: 'browser', proto: 'dns', label: 'STUN Binding response', caption: 'The gateway, an ICE lite agent, only answers checks. The pair works.', rfc: 'rfc8445-2.5-lite',
      detail: `UDP 203.0.113.80:40000 → ${SRFLX}:54400\nSTUN Binding success response\n  XOR-MAPPED-ADDRESS: ${SRFLX}:54400` });
    w.steps.push({ from: 'browser', to: 'gw', proto: 'net', label: 'DTLS ClientHello', caption: 'On the selected pair, the browser starts the DTLS handshake: the gateway said setup:passive.', rfc: 'rfc5763-5-active',
      detail: `UDP ${SRFLX}:54400 → 203.0.113.80:40000\nDTLS 1.2 ClientHello, use_srtp extension` });
    w.steps.push({ from: 'gw', to: 'browser', proto: 'net', label: 'DTLS ServerHello, Certificate', caption: 'The browser checks the gateway\'s certificate against the fingerprint in the answer. Both sides now have SRTP keys.', rfc: 'rfc5764-3-overview',
      detail: 'DTLS ServerHello, Certificate, ServerHelloDone\n(then ClientKeyExchange, Finished in both directions)' });
    return true;
  };

  let ok = true;
  const PRACK_ANSWER = o.trickle;
  if (PRACK_ANSWER) {
    // RFC 8840: the answer in a reliable 183 creates the dialog; then the browser trickles in INFO.
    const r183 = resp1('183 Session Progress', { extra: ['Require: 100rel', 'RSeq: 1', 'Supported: trickle-ice', 'Recv-Info: trickle-ice'], sdp: answer });
    w.msg(G, BROWSER, '183 Session Progress', 'The gateway answers at once, in a reliable 183. The early dialog lets the browser trickle.', r183, { rfc: 'rfc3262-3-require' });
    const prack: Msg = { line: `PRACK ${G.contact} SIP/2.0`, via: [`SIP/2.0/WSS df7jal23ls0d.invalid;branch=${w.branch(BROWSER)}`], maxForwards: 70, from: FROM, to: withTag(TO, TAG1),
      callId: inv.callId, cseq: `${++bseq} PRACK`, extra: [`RAck: 1 ${inv.cseq}`] };
    w.msg(BROWSER, G, 'PRACK', 'The browser confirms the 183.', prack);
    w.msg(G, BROWSER, '200 OK (PRACK)', 'Both sides now know that the other can trickle, and the dialog exists.', w.response({ from: BROWSER, to: G, msg: prack }, '200 OK', {}), { rfc: 'rfc8840-4.3-dialog' });
    const frag = ['a=ice-ufrag:EsAw', 'a=ice-pwd:P2uYro0UCOQ4zxjKXaWCBui1', 'm=audio 9 RTP/AVP 0', 'a=mid:0',
      ...cands0(blocked, turn).map(c => `a=${c}`), 'a=end-of-candidates'].join('\n') + '\n';
    const info: Msg = { line: `INFO ${G.contact} SIP/2.0`, via: [`SIP/2.0/WSS df7jal23ls0d.invalid;branch=${w.branch(BROWSER)}`], maxForwards: 70, from: FROM, to: withTag(TO, TAG1),
      callId: inv.callId, cseq: `${++bseq} INFO`, extra: ['Info-Package: trickle-ice'], body: { type: 'application/trickle-ice-sdpfrag', text: frag } };
    w.msg(BROWSER, G, 'INFO', 'The browser sends its candidates as it finds them, in INFO requests in the early dialog.', info, { rfc: 'rfc8840-3-info' });
    w.msg(G, BROWSER, '200 OK (INFO)', 'The gateway takes the candidates. ICE starts while Bob\'s phone is still ringing.', w.response({ from: BROWSER, to: G, msg: info }, '200 OK', {}));
    ok = iceAndDtls();
    sendInvite2();
    w.msg(BOB, G, '180 Ringing', 'Bob\'s phone rings.', resp2('180 Ringing', {}));
  } else {
    sendInvite2();
    w.msg(BOB, G, '180 Ringing', 'Bob\'s phone rings.', resp2('180 Ringing', {}));
    w.msg(G, BROWSER, '180 Ringing', 'The gateway tells the browser. The web app plays a ringback tone.', resp1('180 Ringing', {}));
  }
  const bobAnswer = classicSdp(o.codec === 'g711' ? [0, 126] : [0, 126], false, BOB.ip, 'bob', 2890844527);
  w.msg(BOB, G, '200 OK', 'Bob answers, with G.711.', resp2('200 OK', { sdp: bobAnswer }));
  w.msg(G, BROWSER, '200 OK', PRACK_ANSWER ? 'The gateway answers the INVITE. The SDP answer went in the 183 already.'
    : o.codec === 'opus-transcode' ? 'The gateway answers the browser with Opus, ICE lite, its fingerprint, and setup:passive.'
    : 'The gateway answers the browser in WebRTC SDP: ICE lite, its fingerprint, setup:passive, and G.711.',
    resp1('200 OK', PRACK_ANSWER ? {} : { sdp: answer }));
  w.msg(BROWSER, G, 'ACK', 'The browser acknowledges.', { line: `ACK ${G.contact} SIP/2.0`, via: [`SIP/2.0/WSS df7jal23ls0d.invalid;branch=${w.branch(BROWSER)}`], maxForwards: 70, from: FROM, to: withTag(TO, TAG1), callId: inv.callId, cseq: `8811 ACK` });
  w.msg(G, BOB, 'ACK', 'The gateway acknowledges Bob\'s 200 OK.', { line: `ACK ${BOB.contact} SIP/2.0`, via: [w.via(G)], maxForwards: 70, from: inv2.from, to: withTag(TO, BOB.tag!), callId: CID2, cseq: '1 ACK' });
  if (!PRACK_ANSWER) ok = iceAndDtls();

  if (!ok) {
    const bye: Msg = { line: `BYE ${G.contact} SIP/2.0`, via: [`SIP/2.0/WSS df7jal23ls0d.invalid;branch=${w.branch(BROWSER)}`], maxForwards: 70, from: FROM, to: withTag(TO, TAG1), callId: inv.callId, cseq: `${++bseq} BYE`,
      extra: ['Reason: SIP;cause=480;text="ICE failed"'] };
    w.msg(BROWSER, G, 'BYE', 'ICE failed, so the web app ends the call. Bob answered, but heard nothing.', bye);
    w.msg(G, BROWSER, '200 OK', 'The gateway confirms.', w.response({ from: BROWSER, to: G, msg: bye }, '200 OK', {}));
    const bye2: Msg = { line: `BYE ${BOB.contact} SIP/2.0`, via: [w.via(G)], maxForwards: 70, from: inv2.from, to: withTag(TO, BOB.tag!), callId: CID2, cseq: '2 BYE' };
    w.msg(G, BOB, 'BYE', 'The gateway ends Bob\'s side too.', bye2);
    w.msg(BOB, G, '200 OK', 'Bob\'s phone confirms.', w.response({ from: G, to: BOB, msg: bye2 }, '200 OK', {}));
    return done(o, w, turn);
  }

  const codecs = o.codec === 'g711' ? 'G.711' : 'Opus';
  if (viaTurn) {
    w.media(BROWSER, TURN, 'SRTP (TLS 443)', `The browser's SRTP (${codecs}) travels to the TURN server inside the TLS connection.`);
    w.media(TURN, G, 'SRTP', 'The TURN server relays it to the gateway.', { rfc: 'rfc8827-6.5-dtls' });
  } else {
    w.media(BROWSER, G, 'SRTP', `SRTP with ${codecs}, keyed by DTLS, on one port for RTP and RTCP.`, { rfc: 'rfc8827-6.5-dtls' });
  }
  w.media(G, BOB, 'RTP', o.codec === 'opus-transcode' ? 'The gateway decrypts, transcodes Opus to G.711, and sends plain RTP to Bob.' : 'The gateway decrypts, and sends plain RTP with G.711 to Bob, RTCP on the next port.');
  return done(o, w, turn);
}

/** The candidates that a trickling browser finds after it sends the offer. */
function cands0(blocked: boolean, turn: boolean): string[] {
  return blocked ? [BROWSER_CANDIDATES.host, ...(turn ? [BROWSER_CANDIDATES.relay] : [])]
    : [BROWSER_CANDIDATES.host, BROWSER_CANDIDATES.srflx, ...(turn ? [BROWSER_CANDIDATES.relay] : [])];
}

function done(o: WebrtcOptions, w: FlowWriter, turn: boolean): FlowData {
  const off = webrtcInactive(o);
  const failed = !o.convert || o.codec === 'opus-none';
  const iceFailed = !failed && o.network === 'restrictive' && !turn;
  const lanes = [BROWSER, ...(turn ? [TURN] : []), GATEWAY, BOB];
  return {
    id: `webrtc-${webrtcKey(o)}`,
    title: `A browser calls a SIP phone: ${failed ? 'the phone rejects the offer' : iceFailed ? 'ICE fails' : off.network ? '' : o.network === 'restrictive' ? 'media through TURN' : 'the call works'}`,
    lanes: lanes.map(n => ({ id: n.id, label: n.label, kind: n.kind, sub: n.id === 'browser' ? '192.168.1.20 (NAT)' : n.ip })),
    steps: w.steps,
  };
}
