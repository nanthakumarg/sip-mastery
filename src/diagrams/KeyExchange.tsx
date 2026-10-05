/**
 * Key exchange comparison (Module 18): SDES over UDP, SDES over TLS,
 * DTLS-SRTP, and ZRTP. A small ladder shows where the keys travel, and a
 * capture view shows what three attackers can read: one on the network,
 * one inside a proxy or SBC, and one who can change the SDP.
 */
import { useState } from 'react';
import { markKeywords } from './Inspector.tsx';
import type { ClientQuote } from './types.ts';

interface Props { quotes: Record<string, ClientQuote> }

type Kind = 'sip' | 'sipkey' | 'dtls' | 'zrtp' | 'srtp';
interface Msg { from: 0 | 1 | 2; to: 0 | 1 | 2; label: string; kind: Kind; tls?: boolean }
type Verdict = 'safe' | 'exposed' | 'partly';
interface Method {
  id: string;
  name: string;
  where: string;
  msgs: Msg[];
  capture: { what: string; seen: string; verdict: Verdict }[];
  verdicts: [string, Verdict, string][];
  rule: string;
}

const LANES = ['Alice', 'Proxy', 'Bob'];

const METHODS: Method[] = [
  {
    id: 'sdes-udp', name: 'SDES over UDP', where: 'In the SDP, in plain text',
    msgs: [
      { from: 0, to: 1, label: 'INVITE · a=crypto key A', kind: 'sipkey' },
      { from: 1, to: 2, label: 'INVITE · a=crypto key A', kind: 'sipkey' },
      { from: 2, to: 1, label: '200 OK · a=crypto key B', kind: 'sipkey' },
      { from: 1, to: 0, label: '200 OK · a=crypto key B', kind: 'sipkey' },
      { from: 0, to: 2, label: 'SRTP', kind: 'srtp' },
    ],
    capture: [
      { what: 'INVITE (UDP 5060)', seen: 'a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:WVNfX19zZW1j…', verdict: 'exposed' },
      { what: '200 OK (UDP 5060)', seen: 'a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:PS1uQCVeeCFC…', verdict: 'exposed' },
      { what: 'SRTP', seen: 'Header readable; payload encrypted, but the keys are known', verdict: 'exposed' },
    ],
    verdicts: [
      ['Eavesdropper on the network', 'exposed', 'Reads both keys from the SIP, and decrypts the call.'],
      ['A proxy or SBC on the path', 'exposed', 'Reads the keys.'],
      ['Attacker who can change the SDP', 'exposed', 'Replaces the keys, or removes a=crypto.'],
    ],
    rule: 'rfc4568-8.3-tls',
  },
  {
    id: 'sdes-tls', name: 'SDES over TLS', where: 'In the SDP, inside TLS on each hop',
    msgs: [
      { from: 0, to: 1, label: 'INVITE · a=crypto key A', kind: 'sipkey', tls: true },
      { from: 1, to: 2, label: 'INVITE · a=crypto key A', kind: 'sipkey', tls: true },
      { from: 2, to: 1, label: '200 OK · a=crypto key B', kind: 'sipkey', tls: true },
      { from: 1, to: 0, label: '200 OK · a=crypto key B', kind: 'sipkey', tls: true },
      { from: 0, to: 2, label: 'SRTP', kind: 'srtp' },
    ],
    capture: [
      { what: 'INVITE (TLS 5061)', seen: 'TLS records: encrypted', verdict: 'safe' },
      { what: '200 OK (TLS 5061)', seen: 'TLS records: encrypted', verdict: 'safe' },
      { what: 'SRTP', seen: 'Header readable; payload encrypted', verdict: 'safe' },
    ],
    verdicts: [
      ['Eavesdropper on the network', 'safe', 'Sees only TLS and SRTP.'],
      ['A proxy or SBC on the path', 'exposed', 'TLS ends at each hop: every proxy reads the keys in the clear.'],
      ['Attacker who can change the SDP', 'partly', 'Only a proxy on the path can; it could also change the keys.'],
    ],
    rule: 'rfc4568-8.3-intermediaries',
  },
  {
    id: 'dtls', name: 'DTLS-SRTP', where: 'In a DTLS handshake on the media path',
    msgs: [
      { from: 0, to: 1, label: 'INVITE · a=fingerprint A', kind: 'sip' },
      { from: 1, to: 2, label: 'INVITE · a=fingerprint A', kind: 'sip' },
      { from: 2, to: 1, label: '200 OK · a=fingerprint B', kind: 'sip' },
      { from: 1, to: 0, label: '200 OK · a=fingerprint B', kind: 'sip' },
      { from: 2, to: 0, label: 'DTLS handshake', kind: 'dtls' },
      { from: 0, to: 2, label: 'SRTP', kind: 'srtp' },
    ],
    capture: [
      { what: 'INVITE', seen: 'a=fingerprint:sha-256 4A:AD:B9:…  (public: a hash, not a key)', verdict: 'safe' },
      { what: 'DTLS handshake', seen: 'Certificates and a key exchange: no key can be read from it', verdict: 'safe' },
      { what: 'SRTP', seen: 'Header readable; payload encrypted', verdict: 'safe' },
    ],
    verdicts: [
      ['Eavesdropper on the network', 'safe', 'The keys never travel; they come from the DTLS handshake.'],
      ['A proxy or SBC on the path', 'safe', 'Sees only fingerprints. It cannot decrypt.'],
      ['Attacker who can change the SDP', 'partly', 'Could replace the fingerprints and sit in the middle, unless the SDP is signed (Identity, Module 28).'],
    ],
    rule: 'rfc5763-5-media-path',
  },
  {
    id: 'zrtp', name: 'ZRTP', where: 'In the media stream; the users compare a code',
    msgs: [
      { from: 0, to: 1, label: 'INVITE · plain SDP', kind: 'sip' },
      { from: 1, to: 2, label: 'INVITE · plain SDP', kind: 'sip' },
      { from: 2, to: 0, label: 'ZRTP Hello … DHPart', kind: 'zrtp' },
      { from: 0, to: 2, label: 'SRTP · say "alpha bravo"', kind: 'srtp' },
    ],
    capture: [
      { what: 'INVITE', seen: 'Nothing about keys', verdict: 'safe' },
      { what: 'ZRTP Diffie-Hellman', seen: 'Public values: no key can be read from them', verdict: 'safe' },
      { what: 'SRTP', seen: 'Header readable; payload encrypted', verdict: 'safe' },
    ],
    verdicts: [
      ['Eavesdropper on the network', 'safe', 'The keys come from a Diffie-Hellman exchange.'],
      ['A proxy or SBC on the path', 'safe', 'ZRTP does not use the SIP path at all.'],
      ['Attacker who can change the SDP', 'partly', 'A man in the middle shows the two users different codes, if they compare them.'],
    ],
    rule: 'rfc6189-1-sas',
  },
];

const VERDICT_LABEL: Record<Verdict, string> = { safe: 'Cannot decrypt', exposed: 'Can decrypt', partly: 'Depends' };
const W = 560, H0 = 52, ROW = 34;
const X = [70, 280, 490];

export default function KeyExchange({ quotes }: Props) {
  const [id, setId] = useState('sdes-udp');
  const m = METHODS.find(x => x.id === id)!;
  const H = H0 + m.msgs.length * ROW + 10;
  const quote = quotes[m.rule];

  return (
    <figure className="stage kex" aria-label="Key exchange comparison">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Key exchange comparison</p>
          <p className="stage-title">Where do the SRTP keys travel, and who can read them?</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><i className="lg-sip" />SIP</li>
          <li><i className="lg-err" />Key in clear</li>
          <li><i className="lg-dns" />Key exchange</li>
          <li><i className="lg-rtp" />SRTP</li>
        </ul>
      </header>

      <div className="seg kex-tabs" role="group" aria-label="Method">
        {METHODS.map(x => <button key={x.id} type="button" aria-pressed={x.id === id} onClick={() => setId(x.id)}>{x.name}</button>)}
      </div>
      <p className="kex-where">Keys travel: <b>{m.where}</b></p>

      <div className="kex-main">
        <div className="kex-ladder">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${m.name}: ${m.where}`}>
            {LANES.map((l, i) => (
              <g key={l}>
                <text className="kex-lane" x={X[i]} y={22} textAnchor="middle">{l}</text>
                <line className="kex-life" x1={X[i]} x2={X[i]} y1={32} y2={H - 6} />
              </g>
            ))}
            {m.msgs.map((g, i) => {
              const y = H0 + i * ROW;
              const x1 = X[g.from]!, x2 = X[g.to]!;
              const dir = x2 > x1 ? 1 : -1;
              return (
                <g key={i} className={`kex-msg k-${g.kind}${g.tls ? ' is-tls' : ''}`}>
                  <line x1={x1} x2={x2 - dir * 8} y1={y} y2={y} />
                  {g.tls && <line className="kex-tls" x1={x1} x2={x2 - dir * 8} y1={y + 4} y2={y + 4} />}
                  {(g.kind === 'srtp' || g.kind === 'dtls' || g.kind === 'zrtp') && <path d={`M${x1 + dir * 8} ${y - 5} L${x1} ${y} L${x1 + dir * 8} ${y + 5}`} />}
                  <path d={`M${x2 - dir * 8} ${y - 5} L${x2} ${y} L${x2 - dir * 8} ${y + 5}`} />
                  <text x={(x1 + x2) / 2} y={y - 7} textAnchor="middle">{g.tls ? '🔒 ' : ''}{g.label}</text>
                </g>
              );
            })}
          </svg>
        </div>

        <section className="kex-capture" aria-label="Capture view">
          <p className="eyebrow">Capture view: on the network between Alice and the proxy</p>
          <ul>
            {m.capture.map(c => (
              <li key={c.what} className={`v-${c.verdict}`}>
                <span className="kex-what">{c.what}</span>
                <code>{c.seen}</code>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <table className="kex-table">
        <thead><tr><th scope="col">Attacker</th><th scope="col">Result</th><th scope="col">Why</th></tr></thead>
        <tbody>
          {m.verdicts.map(([who, v, why]) => (
            <tr key={who} className={`v-${v}`}><th scope="row">{who}</th><td><b>{VERDICT_LABEL[v]}</b></td><td>{why}</td></tr>
          ))}
        </tbody>
      </table>
      {quote && <p className="ud-q">“{markKeywords(quote.text.replace(/\s+/g, ' '))}” <a href={quote.url} target="_blank" rel="noopener">RFC {quote.rfc} §{quote.section} ↗</a></p>}
    </figure>
  );
}
