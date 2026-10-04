/**
 * HTTP and SIP side by side (Module 1.3). Point at a line: its counterpart in
 * the other protocol lights up, with a note on what is the same and what differs.
 */
import { useState } from 'react';

type Line = [text: string, group: string];
interface Pair { http: Line[]; sip: Line[] }

/**
 * Replaces {len} with the byte length of the body (the lines after the empty line).
 * SDP lines each end with CRLF; an HTTP JSON body has no line ending.
 */
function withLength(lines: Line[], crlfLines = true): Line[] {
  const blank = lines.findIndex(([t]) => t === '');
  const parts = blank < 0 ? [] : lines.slice(blank + 1).map(([t]) => t);
  const body = crlfLines ? parts.map(t => t + '\r\n').join('') : parts.join('\r\n');
  const len = new TextEncoder().encode(body).length;
  return lines.map(([t, g]) => [t.replace('{len}', String(len)), g]);
}

const SDP_OFFER: Line[] = [
  ['v=0', 'body'], ['o=alice 2890844526 2890844526 IN IP4 192.0.2.10', 'body'], ['s=-', 'body'],
  ['c=IN IP4 192.0.2.10', 'body'], ['t=0 0', 'body'], ['m=audio 49170 RTP/AVP 0', 'body'], ['a=rtpmap:0 PCMU/8000', 'body'],
];
const SDP_ANSWER: Line[] = [
  ['v=0', 'body'], ['o=bob 2808844564 2808844564 IN IP4 203.0.113.20', 'body'], ['s=-', 'body'],
  ['c=IN IP4 203.0.113.20', 'body'], ['t=0 0', 'body'], ['m=audio 3456 RTP/AVP 0', 'body'], ['a=rtpmap:0 PCMU/8000', 'body'],
];
const SIP_ID: Line[] = [
  ['From: Alice <sip:alice@atlanta.example>;tag=9fxced76sl', 'from'],
  ['Call-ID: 3848276298220188511@192.0.2.10', 'callid'],
];

const PAIRS: Record<string, Pair> = {
  request: {
    http: withLength([
      ['POST /calls HTTP/1.1', 'start'],
      ['Host: api.atlanta.example', 'host'],
      ['User-Agent: ExampleApp/1.0', 'ua'],
      ['Accept: application/json', 'accept'],
      ['Content-Type: application/json', 'ctype'],
      ['Content-Length: {len}', 'clen'],
      ['', 'blank'],
      ['{"to":"bob@biloxi.example"}', 'body'],
    ], false),
    sip: withLength([
      ['INVITE sip:bob@biloxi.example SIP/2.0', 'start'],
      ['Via: SIP/2.0/UDP 192.0.2.10:5060;branch=z9hG4bK74bf9', 'via'],
      ['Max-Forwards: 70', 'maxf'],
      SIP_ID[0]!,
      ['To: Bob <sip:bob@biloxi.example>', 'to'],
      SIP_ID[1]!,
      ['CSeq: 1 INVITE', 'cseq'],
      ['Contact: <sip:alice@192.0.2.10:5060>', 'contact'],
      ['User-Agent: ExamplePhone/1.0', 'ua'],
      ['Accept: application/sdp', 'accept'],
      ['Content-Type: application/sdp', 'ctype'],
      ['Content-Length: {len}', 'clen'],
      ['', 'blank'],
      ...SDP_OFFER,
    ]),
  },
  response: {
    http: withLength([
      ['HTTP/1.1 200 OK', 'start'],
      ['Server: ExampleServer/2.4', 'ua'],
      ['Content-Type: application/json', 'ctype'],
      ['Content-Length: {len}', 'clen'],
      ['', 'blank'],
      ['{"status":"ringing"}', 'body'],
    ], false),
    sip: withLength([
      ['SIP/2.0 200 OK', 'start'],
      ['Via: SIP/2.0/UDP 192.0.2.10:5060;branch=z9hG4bK74bf9', 'via'],
      SIP_ID[0]!,
      ['To: Bob <sip:bob@biloxi.example>;tag=314159', 'to'],
      SIP_ID[1]!,
      ['CSeq: 1 INVITE', 'cseq'],
      ['Contact: <sip:bob@203.0.113.20:5060>', 'contact'],
      ['Server: ExamplePhone/1.0', 'ua'],
      ['Content-Type: application/sdp', 'ctype'],
      ['Content-Length: {len}', 'clen'],
      ['', 'blank'],
      ...SDP_ANSWER,
    ]),
  },
  challenge: {
    http: withLength([
      ['HTTP/1.1 401 Unauthorized', 'start'],
      ['WWW-Authenticate: Digest realm="api.atlanta.example", qop="auth", nonce="7ypf/xlj9XXwfDPEoM4URrv", algorithm=SHA-256', 'auth'],
      ['Content-Length: {len}', 'clen'],
      ['', 'blank'],
    ]),
    sip: withLength([
      ['SIP/2.0 401 Unauthorized', 'start'],
      ['Via: SIP/2.0/UDP 192.0.2.10:5060;branch=z9hG4bKnashds7', 'via'],
      ['From: Alice <sip:alice@atlanta.example>;tag=a73kszlfl', 'from'],
      ['To: Alice <sip:alice@atlanta.example>;tag=1410948204', 'to'],
      ['Call-ID: 1j9FpLxk3uxtm8tn@192.0.2.10', 'callid'],
      ['CSeq: 1 REGISTER', 'cseq'],
      ['WWW-Authenticate: Digest realm="atlanta.example", qop="auth", nonce="ea9c8e88df84f1cec4341ae6cbe5a359", algorithm=MD5', 'auth'],
      ['Content-Length: {len}', 'clen'],
      ['', 'blank'],
    ]),
  },
};

const NOTES: Record<string, { both: boolean; text: string; tag?: string }> = {
  start: { both: true, text: 'Same shape in both. A request line has a method, a target, and a version. A status line has a version, a code, and a reason phrase. SIP uses a SIP URI as the target, not a path.' },
  host: { both: false, text: 'HTTP only. Names the web server. SIP puts the target in the Request-URI and in the To header instead.' },
  ua: { both: true, text: 'Same idea in both: User-Agent names the client software, Server names the server software.' },
  accept: { both: true, text: 'Same header in both: the body formats the sender can read.' },
  ctype: { both: true, text: 'Same header in both: the format of the body. In SIP it is usually application/sdp.' },
  clen: { both: true, text: 'Same header in both: the size of the body in bytes.' },
  blank: { both: true, text: 'Same in both: an empty line ends the headers. The body follows.' },
  body: { both: true, text: 'Both can carry a body. HTTP often carries HTML or JSON. SIP usually carries SDP: the media description.' },
  auth: { both: true, text: 'SIP took digest authentication from HTTP: the same 401 code, the same WWW-Authenticate header, the same parameters. Module 13 covers it.' },
  via: { both: false, text: 'SIP only. Each hop adds a Via, so the response can travel back through the same proxies.' },
  maxf: { both: false, tag: 'Mostly SIP', text: 'Limits the number of hops. HTTP also defines Max-Forwards, but uses it only for TRACE and OPTIONS. SIP uses it on every request.' },
  from: { both: false, tag: 'Mostly SIP', text: 'Who sends the request. HTTP defines a From header too, but almost never uses it. In SIP, the From tag identifies one side of the call.' },
  to: { both: false, text: 'SIP only. Who the request is for. The callee adds a tag in its response.' },
  callid: { both: false, text: 'SIP only. One ID for every message of a call. HTTP requests stand alone and need no call ID.' },
  cseq: { both: false, text: 'SIP only. A sequence number and a method. It matches responses to requests and keeps requests in order.' },
  contact: { both: false, text: 'SIP only. The direct address of the user agent. Later requests in the call go there.' },
};

const TABS = [
  ['request', 'Request'],
  ['response', 'Response'],
  ['challenge', 'Challenge (401)'],
] as const;

export default function HttpVsSip() {
  const [tab, setTab] = useState<keyof typeof PAIRS>('request');
  const [hot, setHot] = useState<string>('start');
  const pair = PAIRS[tab]!;
  const note = NOTES[hot];

  const col = (label: string, lines: Line[], cls: string) => (
    <div className={`hs-col ${cls}`}>
      <p className="eyebrow">{label}</p>
      <div className="hs-msg" role="list">
        {lines.map(([text, g], i) => {
          const only = !NOTES[g]?.both && g !== 'host';
          return (
            <div key={i} role="listitem" tabIndex={text ? 0 : -1}
              className={`hs-line${g === hot ? ' is-hot' : ''}${cls === 'sip' && only ? ' sip-only' : ''}${text === '' ? ' blank' : ''}`}
              onMouseEnter={() => setHot(g)} onFocus={() => setHot(g)}>
              {text || '(empty line)'}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <figure className="stage httpsip">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Family resemblance</p>
          <p className="stage-title">An HTTP message and a SIP message, side by side</p>
        </div>
        <div className="seg" role="radiogroup" aria-label="Message type">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={tab === id} onClick={() => { setTab(id); setHot('start'); }}>{label}</button>
          ))}
        </div>
      </header>
      <div className="hs-cols">
        {col('HTTP', pair.http, 'http')}
        {col('SIP', pair.sip, 'sip')}
      </div>
      <div className={`stage-caption hs-note${note?.both ? '' : ' only'}`} aria-live="polite">
        <span className="hs-tag">{note?.tag ?? (note?.both ? 'In both' : hot === 'host' ? 'HTTP only' : 'SIP only')}</span>
        <p className="cap-text">{note?.text}</p>
      </div>
    </figure>
  );
}
