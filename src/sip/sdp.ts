/**
 * SDP (RFC 8866) and the offer/answer model (RFC 3264), for Module 15.
 *  - parseSdp: reads an SDP body line by line, explains each line, and flags errors.
 *  - buildSdp: writes an SDP body from a short description.
 *  - negotiate: builds the answer to an offer, as an answerer with a given set of codecs would.
 *  - checkAnswer, checkNewVersion: the offer/answer rules that the flow lint uses.
 *  - answerDirection, mediaFlow, holdStep: direction attributes, hold and resume.
 * The diagrams are src/diagrams/OfferAnswer.tsx, SdpLinter.tsx, and HoldPlayer.tsx.
 */
import { classify } from '../net/address.ts';
import { parseCrypto, SETUP_ANSWERS, type SetupRole } from '../net/srtp.ts';

export type Direction = 'sendrecv' | 'sendonly' | 'recvonly' | 'inactive';
export const DIRECTIONS: Direction[] = ['sendrecv', 'sendonly', 'recvonly', 'inactive'];
const isDirection = (s: string): s is Direction => (DIRECTIONS as string[]).includes(s);

export type Severity = 'error' | 'warn' | 'info';

export interface SdpIssue {
  /** Quote id of the rule (rfc-quotes.yaml). */
  rule: string;
  severity: Severity;
  /** 0-based line index, when the issue belongs to one line. */
  line?: number;
  message: string;
}

export interface SdpLine {
  n: number;
  raw: string;
  type: string;
  value: string;
  /** -1 for the session level, else the index of the media section. */
  media: number;
  /** One sentence in plain words. */
  explain: string;
  /** Quote id that defines this line. */
  rule?: string;
}

export interface Codec {
  pt: number;
  name: string;
  rate: number;
  channels?: number;
  fmtp?: string;
  /** Mapped by the RTP/AVP profile, not by an rtpmap line. */
  fromProfile?: boolean;
}

export interface Connection { nettype: string; addrtype: string; address: string; line: number }

export interface Origin {
  username: string;
  sessId: string;
  version: number;
  nettype: string;
  addrtype: string;
  address: string;
}

export interface MediaSection {
  index: number;
  line: number;
  media: string;
  port: number;
  proto: string;
  fmts: string[];
  /** The connection for this stream: its own c= line, or the session one. */
  c?: Connection;
  /** The direction in force: media level, else session level, else sendrecv. */
  direction: Direction;
  codecs: Codec[];
  attrs: { name: string; value?: string; line: number }[];
  ptime?: number;
  rtcpMux: boolean;
  mid?: string;
}

export interface Sdp {
  text: string;
  lines: SdpLine[];
  origin?: Origin;
  c?: Connection;
  media: MediaSection[];
  /** Session-level attributes. */
  attrs: { name: string; value?: string; line: number }[];
  issues: SdpIssue[];
}

/** Static payload types of the RTP/AVP profile (RFC 3551 Tables 4 and 5) that SIP still meets. */
export const STATIC_PT: Record<number, [string, number]> = {
  0: ['PCMU', 8000], 3: ['GSM', 8000], 4: ['G723', 8000], 8: ['PCMA', 8000], 9: ['G722', 8000],
  13: ['CN', 8000], 15: ['G728', 8000], 18: ['G729', 8000], 26: ['JPEG', 90000], 31: ['H261', 90000], 34: ['H263', 90000],
};

/** What each encoding is, in a few words. */
export const CODEC_INFO: Record<string, string> = {
  pcmu: 'G.711 μ-law, 64 kbit/s, the North American and Japanese default',
  pcma: 'G.711 A-law, 64 kbit/s, the default in most other countries',
  g722: 'G.722 wideband audio, 64 kbit/s. It samples at 16 kHz, but its RTP clock rate is 8000, for historical reasons (RFC 3551)',
  g729: 'G.729, 8 kbit/s, narrowband',
  opus: 'Opus, 6 to 510 kbit/s, narrowband to fullband. Its rtpmap is always opus/48000/2',
  'telephone-event': 'DTMF digits sent as RTP events (RFC 4733)',
  cn: 'comfort noise, sent during silence',
  'amr-wb': 'AMR-WB, the wideband codec of VoLTE',
  evs: 'EVS, the newer VoLTE codec',
  ilbc: 'iLBC, a narrowband codec built for packet loss',
  h264: 'H.264 video',
  vp8: 'VP8 video',
  h263: 'H.263 video',
  gsm: 'GSM full rate, 13 kbit/s',
  red: 'redundant audio (RFC 2198)',
};

const SESSION_ORDER = 'vosiuepcbtrzka';
const MEDIA_ORDER = 'micbka';
/** Lines that may appear more than once at their level. */
const REPEATS = new Set(['e', 'p', 'b', 't', 'r', 'a']);
const KNOWN_MEDIA = ['audio', 'video', 'text', 'application', 'message', 'image'];

export function isDynamic(pt: number): boolean {
  return pt >= 96 && pt <= 127;
}

export const codecKey = (c: { name: string; rate: number }) => `${c.name.toLowerCase()}/${c.rate}`;

/** An address that nobody outside its own network can reach. */
export function isPrivateAddress(addr: string): boolean {
  return ['private', 'cgnat', 'loopback', 'link-local', 'ula'].includes(classify(addr).kind);
}

const MEDIA_NAME: Record<string, string> = { audio: 'Audio', video: 'Video', text: 'Text', application: 'Application', message: 'Message', image: 'Image (fax)' };

const DIR_EXPLAIN: Record<Direction, string> = {
  sendrecv: 'Send and receive. This is also the default when no direction is given.',
  sendonly: 'Send only: this side sends media and does not want to receive any. Used to put the other side on hold.',
  recvonly: 'Receive only: this side receives media and sends none. The usual answer to sendonly.',
  inactive: 'Inactive: no media in either direction. RTCP still flows.',
};

/**
 * Parses an SDP body. It never throws: problems become issues, so the linter
 * can show every line even when some are wrong.
 */
export function parseSdp(text: string): Sdp {
  const raw = text.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
  const sdp: Sdp = { text, lines: [], media: [], attrs: [], issues: [] };
  const issue = (rule: string, severity: Severity, message: string, line?: number) =>
    sdp.issues.push({ rule, severity, message, line });

  let rank = -1;
  let level = -1; // -1 session, else media index
  const seen = new Set<string>();
  let sessionDir: Direction | undefined;
  const sessionDirs: number[] = [];
  const mediaDirs = new Map<number, number[]>();

  raw.forEach((rawLine, n) => {
    const m = /^([a-zA-Z])=(.*)$/.exec(rawLine);
    if (!m) {
      const spaced = /^([a-zA-Z])\s*=\s*/.exec(rawLine);
      if (rawLine.trim() === '') issue('rfc8866-5-type', 'error', 'An empty line. Every SDP line is <type>=<value>.', n);
      else if (spaced) issue('rfc8866-5-type', 'error', `No spaces are allowed around "=": write "${spaced[1]}=${rawLine.slice(spaced[0].length)}".`, n);
      else issue('rfc8866-5-type', 'error', `"${rawLine}" is not an SDP line. Every line is one letter, "=", and a value.`, n);
      sdp.lines.push({ n, raw: rawLine, type: '?', value: rawLine, media: level, explain: 'Not a valid SDP line.' });
      return;
    }
    const type = m[1]!;
    const value = m[2]!;
    const line: SdpLine = { n, raw: rawLine, type, value, media: level, explain: '' };
    sdp.lines.push(line);

    if (n === 0 && type !== 'v') issue('rfc8866-5-order', 'error', 'An SDP body starts with the v= line.', n);

    // Order (RFC 8866 §5): session lines v o s i u e p c b t r z k a, then m i c b k a for each stream.
    if (type === 'm') {
      level = sdp.media.length;
      line.media = level;
      rank = 0;
      seen.clear();
    } else {
      const order = level < 0 ? SESSION_ORDER : MEDIA_ORDER;
      const r = order.indexOf(type);
      if (r < 0) {
        if (!/[a-z]/.test(type) || !(SESSION_ORDER + 'm').includes(type)) {
          issue('rfc8866-5-unknown', 'error', `"${type}=" is not an SDP line type. A receiver must reject or ignore the whole SDP.`, n);
        } else {
          issue('rfc8866-5-order', 'error', `"${type}=" is not allowed inside a media section. It belongs at the session level, before the first m= line.`, n);
        }
      } else {
        const tRestart = level < 0 && type === 't' && rank >= SESSION_ORDER.indexOf('t') && rank <= SESSION_ORDER.indexOf('z');
        if (r < rank && !tRestart) {
          issue('rfc8866-5-order', 'error', `"${type}=" is out of order. ${level < 0 ? 'Session lines go v, o, s, i, u, e, p, c, b, t, r, z, k, a' : 'Inside a media section, lines go m, i, c, b, k, a'}.`, n);
        } else if (r === rank && seen.has(type) && !REPEATS.has(type) && !(level >= 0 && type === 'c')) {
          issue('rfc8866-5-order', 'error', `A second "${type}=" line. Only one is allowed ${level < 0 ? 'at the session level' : 'in a media section'}.`, n);
        }
        rank = Math.max(rank, r);
      }
      seen.add(type);
    }

    switch (type) {
      case 'v':
        line.rule = 'rfc8866-5.1-version';
        line.explain = 'SDP version. It is always 0.';
        if (value !== '0') issue('rfc8866-5.1-version', 'error', `The version is "${value}"; the only SDP version is 0.`, n);
        break;
      case 'o': {
        line.rule = 'rfc8866-5.2-origin';
        const f = value.split(' ');
        if (f.length !== 6) {
          issue('rfc8866-5.2-origin', 'error', `o= has ${f.length} fields; it needs 6: username, session ID, version, IN, IP4 or IP6, and an address.`, n);
          line.explain = 'Origin: who created this SDP, and its version.';
          break;
        }
        const [username, sessId, ver, nettype, addrtype, address] = f as [string, string, string, string, string, string];
        if (!/^\d+$/.test(sessId) || !/^\d+$/.test(ver)) issue('rfc8866-5.2-origin', 'error', 'The session ID and the version in o= must be numbers.', n);
        sdp.origin = { username, sessId, version: Number(ver), nettype, addrtype, address };
        line.explain = `Origin: created by "${username}" on ${address}. Session ID ${sessId}, version ${ver}. The version goes up by one each time this side changes its SDP.`;
        break;
      }
      case 's':
        line.rule = 'rfc8866-5.3-s';
        line.explain = value === '-' || value === ' ' ? 'Session name. SIP calls have none, so it is "-".' : `Session name: "${value}". SIP ignores it.`;
        if (value === '') issue('rfc8866-5.3-s', 'error', 'The s= line must not be empty. Use "s=-".', n);
        break;
      case 'c': {
        line.rule = 'rfc8866-5.7-c';
        const f = value.split(' ');
        const conn: Connection = { nettype: f[0] ?? '', addrtype: f[1] ?? '', address: (f[2] ?? '').split('/')[0]!, line: n };
        if (f.length < 3 || conn.nettype !== 'IN' || !['IP4', 'IP6'].includes(conn.addrtype)) {
          issue('rfc8866-5.7-c', 'error', 'c= needs three fields: IN, IP4 or IP6, and an address.', n);
        }
        if (level < 0) sdp.c = conn; else sdp.media[level]!.c = conn;
        const who = level < 0 ? 'every stream without its own c= line' : 'this stream';
        line.explain = `Connection: media for ${who} goes to ${conn.address}.`;
        if (conn.address === '0.0.0.0') {
          line.explain += ' 0.0.0.0 is the old way to put a call on hold (RFC 2543): send nothing.';
          issue('rfc3264-8.4-zero', 'warn', 'c=IN IP4 0.0.0.0 is the old RFC 2543 hold. Use a=sendonly or a=inactive, and keep the real address.', n);
        } else if (isPrivateAddress(conn.address)) {
          line.explain += ' This is a private address: nobody outside that network can send to it.';
          issue('rfc6314-3-private', 'warn', `${conn.address} is a private address. If the other side is outside this network, its media will not arrive (one-way audio).`, n);
        }
        break;
      }
      case 't':
        line.rule = 'rfc3264-5-t';
        line.explain = value === '0 0' ? 'Timing: "0 0" means no fixed start or end. SIP starts and ends the session.' : `Timing: ${value}. For a SIP call it should be "0 0".`;
        if (value !== '0 0') issue('rfc3264-5-t', 'warn', 'For SIP, t= should be "0 0".', n);
        break;
      case 'b': {
        const [bt, bw] = value.split(':');
        line.rule = 'rfc3264-5.1-bandwidth';
        line.explain = bt === 'AS' ? `Bandwidth: at most ${bw} kbit/s for ${level < 0 ? 'the session' : 'this stream'}, the receiver asks.` : `Bandwidth (${bt}): ${bw}.`;
        break;
      }
      case 'k':
        line.explain = 'Encryption key. This line is obsolete; SRTP keys go in a=crypto or come from DTLS.';
        issue('rfc8866-5-order', 'warn', 'k= is obsolete. Do not use it.', n);
        break;
      case 'i': line.explain = 'Information: free text about the session or stream.'; break;
      case 'u': line.explain = 'A URI with more information.'; break;
      case 'e': case 'p': line.explain = type === 'e' ? 'An email address.' : 'A phone number.'; break;
      case 'r': case 'z': line.explain = 'Repeat times or time zones. SIP calls do not use them.'; break;
      case 'm': {
        line.rule = 'rfc8866-5.14-m';
        const f = value.split(' ');
        const [media = '', portStr = '', proto = '', ...fmts] = f;
        const port = Number(portStr.split('/')[0]);
        const sec: MediaSection = { index: level, line: n, media, port, proto, fmts, direction: 'sendrecv', codecs: [], attrs: [], rtcpMux: false };
        sdp.media.push(sec);
        if (!KNOWN_MEDIA.includes(media)) issue('rfc8866-5.14-m', 'error', `"${media}" is not a media type. Use audio, video, text, application, message, or image.`, n);
        if (!/^\d+(\/\d+)?$/.test(portStr) || port > 65535) issue('rfc8866-5.14-m', 'error', `"${portStr}" is not a port.`, n);
        if (!proto) issue('rfc8866-5.14-m', 'error', 'm= has no transport protocol, such as RTP/AVP.', n);
        if (!fmts.length) issue('rfc8866-5.14-m', 'error', 'm= lists no formats. At least one is required, even on a rejected stream.', n);
        if (/RTP\//.test(proto)) {
          for (const fm of fmts) {
            if (!/^\d+$/.test(fm) || Number(fm) > 127) issue('rfc8866-6.6-rtpmap', 'error', `"${fm}" is not an RTP payload type. Payload types are numbers from 0 to 127.`, n);
          }
        }
        line.explain = port === 0
          ? `${MEDIA_NAME[media] ?? media} stream with port 0: the stream is rejected or removed. No media flows on it.`
          : `${MEDIA_NAME[media] ?? media} stream: send it to port ${port}, with ${proto}${proto === 'RTP/AVP' ? ' (plain RTP)' : /SAVP/.test(proto) ? ' (SRTP, encrypted)' : ''}. Formats, most preferred first: ${fmts.join(', ')}.`;
        break;
      }
      case 'a':
        parseAttribute(sdp, line, level, issue, { sessionDirs, mediaDirs });
        if (level < 0 && isDirection(value)) sessionDir = value;
        break;
    }
  });

  // Required lines (RFC 8866 §5).
  const types = new Set(sdp.lines.filter(l => l.media < 0).map(l => l.type));
  for (const [t, rule, what] of [['v', 'rfc8866-5.1-version', 'v='], ['o', 'rfc8866-5.2-origin', 'o='], ['s', 'rfc8866-5.3-s', 's='], ['t', 'rfc3264-5-t', 't=']] as const) {
    if (!types.has(t)) issue(rule, 'error', `The SDP has no ${what} line. It is required.`);
  }
  if (!sdp.c && sdp.media.some(s => !s.c)) {
    const missing = sdp.media.filter(s => !s.c).map(s => s.media);
    issue('rfc8866-5.7-c', 'error', `No c= line for ${missing.join(' and ')}: there is none at the session level, and none in the stream.`);
  }
  if (sdp.media.length === 0 && sdp.lines.length > 0) issue('rfc3264-5-zero', 'info', 'No m= lines: no media yet. An offer with zero streams is allowed but unusual.');

  // Directions: at most one per level (RFC 8866 §6.7).
  if (sessionDirs.length > 1) issue('rfc8866-6.7-one', 'error', 'More than one direction attribute at the session level.', sessionDirs[1]);
  for (const [, lines] of mediaDirs) if (lines.length > 1) issue('rfc8866-6.7-one', 'error', 'More than one direction attribute in one media section.', lines[1]);

  // Per stream: resolve codecs, check rtpmap and fmtp.
  for (const sec of sdp.media) {
    sec.c ??= sdp.c;
    const own = sec.attrs.find(a => isDirection(a.name));
    sec.direction = own ? own.name as Direction : sessionDir ?? 'sendrecv';
    if (!/RTP\//.test(sec.proto)) continue;
    const maps = new Map<number, { codec: Codec; line: number }>();
    for (const a of sec.attrs.filter(x => x.name === 'rtpmap')) {
      const mm = /^(\d+) ([^/\s]+)\/(\d+)(?:\/(\d+))?$/.exec(a.value ?? '');
      if (!mm) { issue('rfc8866-6.6-rtpmap', 'error', 'a=rtpmap is <payload type> <encoding>/<clock rate>[/<channels>].', a.line); continue; }
      const pt = Number(mm[1]);
      if (maps.has(pt)) issue('rfc8866-6.6-rtpmap', 'error', `A second a=rtpmap for payload type ${pt}. Only one is allowed for each format.`, a.line);
      maps.set(pt, { codec: { pt, name: mm[2]!, rate: Number(mm[3]), channels: mm[4] ? Number(mm[4]) : undefined }, line: a.line });
      if (!sec.fmts.includes(String(pt))) issue('rfc8866-6.15-format', 'warn', `a=rtpmap:${pt} describes a payload type that is not on the m= line.`, a.line);
      const st = STATIC_PT[pt];
      if (st && (st[0].toLowerCase() !== mm[2]!.toLowerCase() || st[1] !== Number(mm[3]))) {
        issue('rfc3551-3-static', 'warn', `Payload type ${pt} is ${st[0]}/${st[1]} in the RTP/AVP profile, but this rtpmap says ${mm[2]}/${mm[3]}.`, a.line);
      }
    }
    for (const a of sec.attrs.filter(x => x.name === 'fmtp')) {
      const pt = Number((a.value ?? '').split(' ')[0]);
      if (!sec.fmts.includes(String(pt))) issue('rfc8866-6.15-format', 'warn', `a=fmtp:${pt} describes a payload type that is not on the m= line.`, a.line);
    }
    for (const fm of sec.fmts) {
      if (!/^\d+$/.test(fm)) continue;
      const pt = Number(fm);
      const mapped = maps.get(pt)?.codec;
      const st = STATIC_PT[pt];
      const codec: Codec | undefined = mapped ?? (st ? { pt, name: st[0], rate: st[1], fromProfile: true } : undefined);
      if (!codec) {
        if (sec.port !== 0) issue('rfc3551-3-mapping', 'error', `Payload type ${pt} has no a=rtpmap. It is ${isDynamic(pt) ? 'dynamic' : 'not a static payload type'}, so the other side cannot know which codec it is.`, sec.line);
        continue;
      }
      const f = sec.attrs.find(x => x.name === 'fmtp' && (x.value ?? '').startsWith(`${pt} `));
      if (f) codec.fmtp = f.value!.slice(String(pt).length + 1);
      sec.codecs.push(codec);
    }
    if (sec.media === 'audio' && sec.port !== 0 && !sec.codecs.some(c => c.name.toLowerCase() === 'telephone-event')) {
      issue('rfc4733-2.5.1.1-negotiate', 'info', 'No telephone-event format: keypad digits (DTMF) cannot be sent as RTP events on this stream.', sec.line);
    }
  }

  // Explain each a= line, now that the codecs are known.
  for (const l of sdp.lines) if (l.type === 'a') l.explain = explainAttribute(l, sdp);
  return sdp;
}

function parseAttribute(
  sdp: Sdp, line: SdpLine, level: number,
  issue: (rule: string, severity: Severity, message: string, line?: number) => void,
  dirs: { sessionDirs: number[]; mediaDirs: Map<number, number[]> },
) {
  const i = line.value.indexOf(':');
  const name = i < 0 ? line.value : line.value.slice(0, i);
  const value = i < 0 ? undefined : line.value.slice(i + 1);
  const attr = { name, value, line: line.n };
  if (level < 0) sdp.attrs.push(attr); else sdp.media[level]!.attrs.push(attr);
  const sec = level < 0 ? undefined : sdp.media[level]!;
  if (isDirection(name)) {
    if (level < 0) dirs.sessionDirs.push(line.n);
    else dirs.mediaDirs.set(level, [...(dirs.mediaDirs.get(level) ?? []), line.n]);
  }
  switch (name) {
    case 'ptime': case 'maxptime': {
      const v = Number(value);
      if (!(v > 0)) issue('rfc3264-5.1-ptime', 'error', `a=${name} must be greater than zero.`, line.n);
      if (sec && name === 'ptime') sec.ptime = v;
      if (level < 0) issue('rfc8866-6.4-ptime', 'warn', `a=${name} is a media-level attribute. Put it under the m= line.`, line.n);
      break;
    }
    case 'rtcp':
      if (level < 0) issue('rfc3605-2.1-rtcp', 'error', 'a=rtcp is a media-level attribute; it must not be used at the session level.', line.n);
      break;
    case 'rtcp-mux':
      if (sec) sec.rtcpMux = true;
      break;
    case 'mid':
      if (sec) sec.mid = value;
      break;
    case 'crypto': {
      if (level < 0) { issue('rfc4568-4-media', 'error', 'a=crypto is a media-level attribute; it must not be at the session level.', line.n); break; }
      const c = parseCrypto(value ?? '');
      for (const e of c.issues) issue('rfc4568-6.1-inline', 'error', `a=crypto: ${e}`, line.n);
      if (sec && !/SAVP/.test(sec.proto)) issue('rfc4568-6-savp', 'warn', `a=crypto on ${sec.proto}: "best-effort SRTP". RFC 4568 defines a=crypto only for RTP/SAVP and RTP/SAVPF.`, line.n);
      break;
    }
    case 'setup':
      if (!['actpass', 'active', 'passive', 'holdconn'].includes(value ?? '')) issue('rfc8842-5.2-actpass', 'error', `a=setup:${value} is not a role. Use actpass, active, passive, or holdconn.`, line.n);
      break;
  }
}

function explainAttribute(l: SdpLine, sdp: Sdp): string {
  const i = l.value.indexOf(':');
  const name = i < 0 ? l.value : l.value.slice(0, i);
  const value = i < 0 ? '' : l.value.slice(i + 1);
  const sec = l.media >= 0 ? sdp.media[l.media] : undefined;
  if (isDirection(name)) {
    l.rule = 'rfc8866-6.7-default';
    return `${DIR_EXPLAIN[name]}${l.media < 0 ? ' At the session level, it applies to every stream without its own direction.' : ''}`;
  }
  switch (name) {
    case 'rtpmap': {
      l.rule = 'rfc8866-6.6-rtpmap';
      const mm = /^(\d+) ([^/\s]+)\/(\d+)(?:\/(\d+))?$/.exec(value);
      if (!mm) return 'Maps a payload type number to a codec.';
      const info = CODEC_INFO[mm[2]!.toLowerCase()];
      const dyn = isDynamic(Number(mm[1])) ? ' A dynamic number: it means this only in this SDP.' : '';
      return `Payload type ${mm[1]} is ${mm[2]} with an RTP clock of ${mm[3]} Hz${mm[4] ? `, ${mm[4]} channels` : ''}.${info ? ` ${info[0]!.toUpperCase()}${info.slice(1)}.` : ''}${dyn}`;
    }
    case 'fmtp': {
      l.rule = 'rfc8866-6.15-fmtp';
      const [pt, ...rest] = value.split(' ');
      const params = rest.join(' ');
      const codec = sec?.codecs.find(c => String(c.pt) === pt);
      if (codec?.name.toLowerCase() === 'telephone-event') {
        l.rule = 'rfc4733-2.5.1.1-events';
        return `Events this side can receive as telephone-event: ${params}. 0–9 are the digits, 10 is *, 11 is #, 12–15 are A–D, 16 is flash.`;
      }
      return `Parameters for payload type ${pt}${codec ? ` (${codec.name})` : ''}: ${params}. Only that codec reads them.`;
    }
    case 'ptime': l.rule = 'rfc8866-6.4-ptime'; return `Packet time: this side wants to receive ${value} ms of audio in each RTP packet.`;
    case 'maxptime': l.rule = 'rfc8866-6.5-maxptime'; return `At most ${value} ms of audio in each packet.`;
    case 'rtcp': l.rule = 'rfc3605-2.1-rtcp'; return `Send RTCP for this stream to port ${value.split(' ')[0]}, not to the RTP port + 1.`;
    case 'rtcp-mux': l.rule = 'rfc5761-5.1.1-offer'; return 'RTP and RTCP share one port: the m= port. Both sides must include it, or neither multiplexes.';
    case 'mid': l.rule = 'rfc9143-5-bundle'; return `Media ID "${value}". BUNDLE and other groups refer to the stream by this name.`;
    case 'group': l.rule = 'rfc9143-5-bundle'; return value.startsWith('BUNDLE')
      ? `BUNDLE: the streams ${value.split(' ').slice(1).join(' and ')} share one address and port (RFC 9143).`
      : `A group of streams: ${value}.`;
    case 'crypto': {
      l.rule = 'rfc4568-8.3-tls';
      const c = parseCrypto(value);
      return `SDES key ${c.tag}: suite ${c.suiteName}, and the master key and salt in base64. Anyone who reads this SDP can decrypt the media, so it must travel only over TLS (Module 18).`;
    }
    case 'fingerprint': l.rule = 'rfc5763-5-fingerprint'; return `The ${value.split(' ')[0]} hash of this side's DTLS certificate. The DTLS handshake on the media path must show the same certificate (DTLS-SRTP, Module 18).`;
    case 'setup': l.rule = 'rfc8842-5.2-actpass'; return {
      actpass: 'DTLS role: either. The answerer chooses; an offer for DTLS-SRTP always says actpass.',
      active: 'DTLS role: active. This side starts the DTLS handshake (it is the DTLS client).',
      passive: 'DTLS role: passive. This side waits for the other side to start the DTLS handshake.',
      holdconn: 'DTLS role: none for now. No connection yet.',
    }[value] ?? 'A DTLS (or TCP) setup role.';
    case 'tls-id': return 'An ID for the DTLS association. A new value means a new DTLS handshake (RFC 8842).';
    case 'ice-ufrag': case 'ice-pwd': return 'ICE credentials (Module 20).';
    case 'candidate': return 'An ICE candidate: an address where this side might receive media (Module 20).';
    case 'silenceSupp': return 'Silence suppression settings, an old attribute from RFC 3108.';
    default: return `The attribute "${name}". A receiver ignores attributes it does not understand.`;
  }
}

// ---------------------------------------------------------------------------
// Building SDP

export interface CodecSpec { pt: number; name: string; rate: number; channels?: number; fmtp?: string }

export interface StreamSpec {
  media: string;
  port: number;
  proto?: string;
  codecs: CodecSpec[];
  /** Written only when given. */
  direction?: Direction;
  ptime?: number;
  rtcpMux?: boolean;
  mid?: string;
}

export interface SdpSpec {
  user: string;
  sessId: string;
  version: number;
  address: string;
  streams: StreamSpec[];
  /** Adds a=group:BUNDLE with the mids of the streams. */
  bundle?: boolean;
}

export function buildSdp(spec: SdpSpec): string {
  const out = [
    'v=0',
    `o=${spec.user} ${spec.sessId} ${spec.version} IN IP4 ${spec.address}`,
    's=-',
    `c=IN IP4 ${spec.address}`,
    't=0 0',
  ];
  if (spec.bundle) out.push(`a=group:BUNDLE ${spec.streams.filter(s => s.port !== 0 && s.mid).map(s => s.mid).join(' ')}`);
  for (const s of spec.streams) {
    out.push(`m=${s.media} ${s.port} ${s.proto ?? 'RTP/AVP'} ${s.codecs.map(c => c.pt).join(' ')}`);
    if (s.port === 0) continue;
    for (const c of s.codecs) {
      out.push(`a=rtpmap:${c.pt} ${c.name}/${c.rate}${c.channels ? `/${c.channels}` : ''}`);
      if (c.fmtp) out.push(`a=fmtp:${c.pt} ${c.fmtp}`);
    }
    if (s.ptime) out.push(`a=ptime:${s.ptime}`);
    if (s.mid) out.push(`a=mid:${s.mid}`);
    if (s.rtcpMux) out.push('a=rtcp-mux');
    if (s.direction) out.push(`a=${s.direction}`);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Directions, hold and resume

export const canSend = (d: Direction) => d === 'sendrecv' || d === 'sendonly';
export const canRecv = (d: Direction) => d === 'sendrecv' || d === 'recvonly';

/**
 * RFC 3264 §6.1: the direction of a stream in the answer, given the offered
 * direction and what the answerer wants for itself.
 */
export function answerDirection(offered: Direction, want: Direction): Direction {
  switch (offered) {
    case 'sendonly': return canRecv(want) ? 'recvonly' : 'inactive';
    case 'recvonly': return canSend(want) ? 'sendonly' : 'inactive';
    case 'inactive': return 'inactive';
    default: return want;
  }
}

/** Which way media flows once the offer and answer are exchanged. */
export function mediaFlow(offerDir: Direction, answerDir: Direction): { offererSends: boolean; answererSends: boolean } {
  return {
    offererSends: canSend(offerDir) && canRecv(answerDir),
    answererSends: canSend(answerDir) && canRecv(offerDir),
  };
}

/** Allowed answers to each offered direction (RFC 3264 §6.1). */
export const ALLOWED_ANSWER: Record<Direction, Direction[]> = {
  sendrecv: ['sendrecv', 'sendonly', 'recvonly', 'inactive'],
  sendonly: ['recvonly', 'inactive'],
  recvonly: ['sendonly', 'inactive'],
  inactive: ['inactive'],
};

export type Party = 'alice' | 'bob';

export interface HoldState {
  /** What each side wants for itself: sendrecv, or its hold direction (RFC 6337 §5.3). */
  want: Record<Party, Direction>;
  /** The direction in the last SDP each side sent. */
  sent: Record<Party, Direction>;
  /** The o= version of the last SDP each side sent. */
  version: Record<Party, number>;
  aliceSends: boolean;
  bobSends: boolean;
}

export interface HoldExchange {
  by: Party;
  offerDir: Direction;
  answerDir: Direction;
  offerVersion: number;
  answerVersion: number;
  /** The offer changed the SDP but kept the version, so the answerer ignored the change. */
  ignored: boolean;
}

export const HOLD_START: HoldState = {
  want: { alice: 'sendrecv', bob: 'sendrecv' },
  sent: { alice: 'sendrecv', bob: 'sendrecv' },
  version: { alice: 2890844526, bob: 2808844564 },
  aliceSends: true,
  bobSends: true,
};

const other = (p: Party): Party => (p === 'alice' ? 'bob' : 'alice');

/**
 * One re-INVITE: `by` now wants `want` (sendrecv to resume, sendonly or
 * inactive to hold), and offers it. The other side answers from its own wish.
 * With `bumpVersion: false`, the offer keeps the old o= version; the answerer
 * treats it as the SDP it already has (RFC 3264 §8), and nothing changes.
 */
export function holdStep(s: HoldState, by: Party, want: Direction, bumpVersion = true): { state: HoldState; exchange: HoldExchange } {
  const peer = other(by);
  const changed = want !== s.sent[by];
  const ignored = changed && !bumpVersion;
  const offerVersion = changed && bumpVersion ? s.version[by] + 1 : s.version[by];
  // An ignored offer is read as the previous SDP from that side.
  const effective = ignored ? s.sent[by] : want;
  const answerDir = answerDirection(effective, s.want[peer]);
  const answerVersion = answerDir !== s.sent[peer] ? s.version[peer] + 1 : s.version[peer];
  const flow = mediaFlow(effective, answerDir);
  const state: HoldState = {
    want: { ...s.want, [by]: want },
    sent: { ...s.sent, [by]: effective, [peer]: answerDir } as Record<Party, Direction>,
    version: { ...s.version, [by]: offerVersion, [peer]: answerVersion } as Record<Party, number>,
    aliceSends: by === 'alice' ? flow.offererSends : flow.answererSends,
    bobSends: by === 'bob' ? flow.offererSends : flow.answererSends,
  };
  return { state, exchange: { by, offerDir: want, answerDir, offerVersion, answerVersion, ignored } };
}

// ---------------------------------------------------------------------------
// Offer/answer

export interface AnswerPolicy {
  /** Encodings the answerer supports, most preferred first, as "name/rate" (lower case). */
  codecs: string[];
  /** Media types the answerer accepts. */
  media: string[];
  /** What the answerer wants for itself. */
  want: Direction;
  /** List formats in the offer's order (RECOMMENDED), or in the answerer's own order. */
  order: 'offer' | 'answerer';
  /** The answerer's own payload type numbers for dynamic codecs, used instead of the offer's when set. */
  ownPts?: Record<string, number>;
  telephoneEvent: boolean;
  rtcpMux: boolean;
  user: string;
  sessId: string;
  version: number;
  address: string;
  ports: Record<string, number>;
  ptime?: number;
}

export interface StreamOutcome {
  index: number;
  media: string;
  accepted: boolean;
  /** Why the stream was accepted or rejected, in one sentence. */
  reason: string;
  rule: string;
  offerDir: Direction;
  answerDir: Direction;
  /** The codec each side sends, and the payload type number it puts in its RTP packets. */
  offererSends?: Codec;
  answererSends?: Codec;
  dtmf: boolean;
  /** Codecs in the answer, in its order. */
  answerCodecs: Codec[];
}

/** RFC 3264 §6: the answer an answerer with this policy gives to this offer. */
export function negotiate(offer: Sdp, p: AnswerPolicy): { text: string; answer: Sdp; streams: StreamOutcome[] } {
  const specs: StreamSpec[] = [];
  const streams: StreamOutcome[] = [];
  for (const sec of offer.media) {
    const base = { index: sec.index, media: sec.media, offerDir: sec.direction, dtmf: false, answerCodecs: [] as Codec[] };
    const reject = (reason: string, rule: string) => {
      specs.push({ media: sec.media, port: 0, proto: sec.proto, codecs: [{ pt: Number(sec.fmts[0] ?? 0), name: '', rate: 0 }] });
      streams.push({ ...base, accepted: false, reason, rule, answerDir: sec.direction });
    };
    if (sec.port === 0) { reject('The offer has port 0 for this stream, so the answer has port 0 too.', 'rfc3264-6-reject'); continue; }
    if (!p.media.includes(sec.media)) { reject(`The answerer does not do ${sec.media}, so it rejects the stream with port 0. The m= line stays, so the streams still line up.`, 'rfc3264-6-reject'); continue; }
    const supported = new Set(p.codecs);
    const common = sec.codecs.filter(c => supported.has(codecKey(c)));
    if (!common.length) { reject(`No ${sec.media} codec in common, so the answerer must reject the stream with port 0.`, 'rfc3264-6.1-no-common'); continue; }
    if (p.order === 'answerer') common.sort((a, b) => p.codecs.indexOf(codecKey(a)) - p.codecs.indexOf(codecKey(b)));
    const dtmfOffered = sec.codecs.find(c => c.name.toLowerCase() === 'telephone-event');
    const withDtmf = dtmfOffered && p.telephoneEvent && sec.media === 'audio' ? [...common, dtmfOffered] : common;
    const answerCodecs: Codec[] = withDtmf.map(c => {
      const own = p.ownPts?.[codecKey(c)];
      return { ...c, pt: own !== undefined && isDynamic(c.pt) ? own : c.pt, fromProfile: undefined };
    });
    const answerDir = answerDirection(sec.direction, p.want);
    specs.push({
      media: sec.media, port: p.ports[sec.media] ?? 0, proto: sec.proto, codecs: answerCodecs,
      direction: answerDir === 'sendrecv' && !sec.attrs.some(a => isDirection(a.name)) ? undefined : answerDir,
      ptime: sec.media === 'audio' ? p.ptime : undefined, rtcpMux: sec.rtcpMux && p.rtcpMux, mid: sec.mid,
    });
    // RFC 3264 §7: the offerer sends the first codec in the answer, with the answer's number.
    // §6.1: the answerer sends the most preferred codec of the offer that is in the answer, with the offer's number.
    const voice = (c: Codec) => c.name.toLowerCase() !== 'telephone-event';
    const offererSends = answerCodecs.find(voice);
    const answerKeys = new Set(answerCodecs.map(codecKey));
    const answererSends = sec.codecs.find(c => voice(c) && answerKeys.has(codecKey(c)));
    streams.push({
      ...base, accepted: true, answerDir, answerCodecs,
      reason: `${common.length === 1 ? 'One codec' : `${common.length} codecs`} in common: ${common.map(c => c.name).join(', ')}.`,
      rule: 'rfc3264-6.1-common', offererSends, answererSends, dtmf: !!(dtmfOffered && p.telephoneEvent && sec.media === 'audio'),
    });
  }
  // A rejected stream lists one format and no attributes (buildSdp writes none for port 0).
  const text = buildSdp({ user: p.user, sessId: p.sessId, version: p.version, address: p.address, streams: specs });
  return { text, answer: parseSdp(text), streams };
}

/** Normalised text, to compare two SDP bodies. */
export const sdpBody = (s: Sdp) => s.text.replace(/\r\n/g, '\n').trim().split('\n').map(l => l.trim()).join('\n');

export interface ExchangeIssue { rule: string; message: string }

/**
 * Checks an answer against its offer (RFC 3264 §6): the same m-lines in the
 * same order and of the same types; a codec in common on every accepted
 * stream; a direction that the offered direction allows.
 */
export function checkAnswer(offer: Sdp, answer: Sdp): ExchangeIssue[] {
  const out: ExchangeIssue[] = [];
  if (answer.media.length !== offer.media.length) {
    out.push({ rule: 'sdp-mlines', message: `The offer has ${offer.media.length} m= line${offer.media.length === 1 ? '' : 's'}, but the answer has ${answer.media.length}. Reject a stream with port 0; do not remove its m= line` });
  }
  const n = Math.min(offer.media.length, answer.media.length);
  for (let i = 0; i < n; i++) {
    const o = offer.media[i]!, a = answer.media[i]!;
    if (o.media !== a.media) {
      out.push({ rule: 'sdp-mlines', message: `m= line ${i + 1} is ${o.media} in the offer, but ${a.media} in the answer. The answer must keep the order of the offer` });
      continue;
    }
    if (a.port === 0 || o.port === 0) continue;
    const offered = new Set(o.codecs.filter(c => c.name.toLowerCase() !== 'telephone-event').map(codecKey));
    if (!a.codecs.some(c => offered.has(codecKey(c)))) {
      out.push({ rule: 'answer-codec', message: `The ${a.media} stream is accepted, but none of its codecs (${a.codecs.map(c => c.name).join(', ') || 'none'}) is in the offer. Without a codec in common, the answer must reject it with port 0` });
    }
    if (!ALLOWED_ANSWER[o.direction].includes(a.direction)) {
      out.push({ rule: 'answer-direction', message: `The offer is ${o.direction} for ${o.media}, so the answer must be ${ALLOWED_ANSWER[o.direction].join(' or ')}, not ${a.direction}` });
    }
  }
  return out;
}

/**
 * Checks a new SDP from the same side against its previous one (RFC 3264 §8):
 * a changed SDP has the next version, and an unchanged version means an
 * unchanged SDP. The number of m= lines never goes down.
 */
export function checkNewVersion(prev: Sdp, next: Sdp): ExchangeIssue[] {
  const out: ExchangeIssue[] = [];
  if (!prev.origin || !next.origin) return out;
  const same = sdpBody(prev) === sdpBody(next);
  const pv = prev.origin.version, nv = next.origin.version;
  if (!same && nv === pv) {
    out.push({ rule: 'sdp-version', message: `The SDP changed, but the o= version is still ${nv}. The other side treats it as the old SDP and ignores the change` });
  } else if (!same && nv !== pv + 1) {
    out.push({ rule: 'sdp-version', message: `The o= version goes from ${pv} to ${nv}; a changed SDP has the next version, ${pv + 1}` });
  }
  if (next.media.length < prev.media.length) {
    out.push({ rule: 'sdp-mlines', message: `The previous SDP had ${prev.media.length} m= lines and this one has ${next.media.length}. A stream is removed with port 0, never by deleting its m= line` });
  }
  return out;
}

/** Content-Type application/sdp, or no Content-Type and a body that starts with v=. */
export function sdpOf(contentType: string | undefined, body: string): Sdp | undefined {
  if (!body.trim()) return undefined;
  const ct = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (ct && ct !== 'application/sdp') return undefined;
  if (!ct && !/^v=/.test(body)) return undefined;
  return parseSdp(body);
}

// ---------------------------------------------------------------------------
// Media security in offers and answers (Module 18)

/** The a=setup role of a stream: media level, else session level. */
export function setupOf(sdp: Sdp, i: number): SetupRole | undefined {
  const a = sdp.media[i]?.attrs.find(x => x.name === 'setup') ?? sdp.attrs.find(x => x.name === 'setup');
  return a?.value as SetupRole | undefined;
}

const usesDtls = (sdp: Sdp, i: number) =>
  /^(UDP|TCP|DCCP)\/TLS\//.test(sdp.media[i]?.proto ?? '') || !!(sdp.media[i]?.attrs.some(a => a.name === 'fingerprint') || sdp.attrs.some(a => a.name === 'fingerprint'));

/** RFC 8842 §5.2: an offer for DTLS-SRTP says a=setup:actpass. */
export function checkDtlsOffer(offer: Sdp): ExchangeIssue[] {
  const out: ExchangeIssue[] = [];
  offer.media.forEach((m, i) => {
    if (m.port === 0 || !usesDtls(offer, i)) return;
    const role = setupOf(offer, i);
    if (role !== 'actpass') out.push({ rule: 'dtls-setup', message: `The offer for ${m.media} has a=setup:${role ?? '(none)'}; an offerer must say actpass and let the answerer choose` });
  });
  return out;
}

/** RFC 4145 §4.1, RFC 5763 §5: the answer picks active or passive, the opposite of a fixed role in the offer. */
export function checkDtlsAnswer(offer: Sdp, answer: Sdp): ExchangeIssue[] {
  const out: ExchangeIssue[] = [];
  answer.media.forEach((m, i) => {
    if (m.port === 0 || !usesDtls(answer, i)) return;
    const o = setupOf(offer, i) ?? 'active', a = setupOf(answer, i) ?? 'passive';
    if (!SETUP_ANSWERS[o]?.includes(a) || a === 'actpass') {
      const why = a === 'actpass' ? 'the answerer must choose active or passive'
        : a === 'active' ? 'both sides start a DTLS handshake as the client, and neither answers as the server'
        : a === 'passive' ? 'both sides wait for the other to start the DTLS handshake'
        : `${a} is not an answer to ${o}`;
      out.push({ rule: 'dtls-setup', message: `The offer has a=setup:${o} and the answer a=setup:${a}: ${why}` });
    }
  });
  return out;
}

/** True when any stream carries an SDES key in the SDP. */
export const hasSdesKey = (sdp: Sdp) => sdp.media.some(m => m.attrs.some(a => a.name === 'crypto' && /inline:/.test(a.value ?? '')));
