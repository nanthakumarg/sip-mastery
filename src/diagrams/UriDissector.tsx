/**
 * URI dissector (Module 3.6): type a SIP, SIPS, or tel URI — or a header value
 * with angle brackets — and see each part labelled, what it means, and what
 * is wrong with it. Select a part to read about it.
 */
import { useMemo, useState } from 'react';
import { markKeywords } from './Inspector.tsx';
import type { ClientQuote } from './types.ts';
import { caseSensitive, dissect, PARAM_TEXT, PART_LABEL, ROLE_TEXT, type Dissection, type UriPart } from '../sip/uri.ts';

interface Props { quotes: Record<string, ClientQuote> }

const RANK = { error: 0, warn: 1, info: 2 } as const;

const PRESETS: [string, string][] = [
  ['AOR', 'sip:alice@atlanta.example'],
  ['Contact', 'sip:alice@192.0.2.10:5060;transport=udp'],
  ['To header', 'Bob <sip:bob@biloxi.example>;tag=314159'],
  ['Record-Route', '<sip:proxy.atlanta.example;lr>'],
  ['SIPS', 'sips:bob@biloxi.example'],
  ['Phone number in SIP', 'sip:+12025550123@carrier.example;user=phone'],
  ['tel, global', 'tel:+1-202-555-0123'],
  ['tel, local', 'tel:7042;phone-context=atlanta.example'],
  ['IPv6', 'sip:bob@[2001:db8::20]:5060'],
  ['Find the problems', 'sips:alice:secret@192.168.1.20;transport=udp'],
];

function partText(p: UriPart, d: Dissection): string {
  switch (p.kind) {
    case 'display': return 'A name for people to read. Elements do not use it to route. Put it in quotes if it has spaces or special characters.';
    case 'scheme':
      return d.scheme === 'sips' ? 'sips: the request must use TLS on every hop up to the domain of the URI.'
        : d.scheme === 'tel' ? 'tel: a telephone number, not a host. A proxy or gateway must turn it into a SIP URI to route it.'
        : 'sip: the normal SIP scheme. Any transport is allowed: UDP, TCP, TLS, or WebSocket.';
    case 'user': return 'The user, or the resource, at the host. Often a user name, an extension, or a phone number.';
    case 'password': return 'A password inside the URI. The syntax allows it, but RFC 3261 does NOT RECOMMEND it: everyone on the path can read it.';
    case 'host': return /^[\d.]+$|^\[/.test(p.text)
      ? 'An IP address: one specific machine. Typical for a Contact address.'
      : 'A domain name. The sender asks DNS for the SIP servers of this domain (Module 11).';
    case 'port': return 'The port to send the request to. Without a port, DNS SRV records or the default port decide.';
    case 'uri-param': return PARAM_TEXT[p.name ?? ''] ?? 'An extension parameter. Elements that do not understand it ignore it.';
    case 'uri-header': return 'A header field for the request that is built from this URI, as in a link on a web page. Not allowed in a Request-URI.';
    case 'header-param': return `${PARAM_TEXT[p.name ?? ''] ?? 'A parameter of the header.'} It is outside the angle brackets, so it is a header parameter, not part of the URI.`;
    case 'number': return p.text.startsWith('+')
      ? 'A global number: "+", the country code, and the national number (E.164).'
      : 'A local number. It is valid only inside its phone-context.';
    case 'tel-param': return PARAM_TEXT[p.name ?? ''] ?? 'A tel URI parameter.';
    default: return '';
  }
}

export default function UriDissector({ quotes }: Props) {
  const [value, setValue] = useState(PRESETS[2]![1]);
  const d = useMemo(() => dissect(value), [value]);
  const labelled = d.parts.filter(p => p.kind !== 'sep');
  const [selStart, setSelStart] = useState<number | null>(null);
  const [hoverStart, setHoverStart] = useState<number | null>(null);
  const focusStart = hoverStart ?? selStart;
  const sel = labelled.find(p => p.start === focusStart) ?? labelled.find(p => p.kind === 'host') ?? labelled[0];

  return (
    <figure className="stage urid">
      <header className="stage-head">
        <div>
          <p className="eyebrow">URI dissector</p>
          <p className="stage-title">What does each part of this URI do?</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><i className="lg-sip" />SIP</li>
          <li><span className="ud-aa">Aa</span>Case-sensitive</li>
          <li><span className="lg-warn">⚠</span>Problem</li>
        </ul>
      </header>

      <label className="ac-input ud-input">
        <span className="eyebrow">URI or header value</span>
        <input value={value} onChange={e => { setValue(e.target.value); setSelStart(null); }} spellCheck={false} autoComplete="off" />
      </label>
      <div className="ac-presets" aria-label="Examples">
        {PRESETS.map(([label, v]) => (
          <button key={v} type="button" onClick={() => { setValue(v); setSelStart(null); }} aria-pressed={value === v} title={v}>{label}</button>
        ))}
      </div>

      <div className="ud-parts" role="group" aria-label="Parts of the URI" onMouseLeave={() => setHoverStart(null)}>
        {d.parts.map(p => p.kind === 'sep'
          ? <span key={`s${p.start}`} className="ud-sep" aria-hidden="true">{p.text}</span>
          : (
            <button
              key={p.start}
              type="button"
              className={`ud-part k-${p.kind}${sel === p ? ' is-sel' : ''}`}
              onMouseEnter={() => setHoverStart(p.start)}
              onFocus={() => setHoverStart(p.start)}
              onBlur={() => setHoverStart(null)}
              onClick={() => setSelStart(p.start)}
            >
              <span className="ud-text">{p.text}</span>
              <span className="ud-bracket" aria-hidden="true" />
              <span className="ud-label">
                {p.name && p.kind !== 'uri-header' ? `${p.name}` : PART_LABEL[p.kind]}
                {caseSensitive(p.kind) && <span className="ud-aa" title="Compared case-sensitively">Aa</span>}
              </span>
            </button>
          ))}
      </div>

      <div className="ud-main">
        <div className="ud-explain" aria-live="polite">
          {sel ? (
            <>
              <p className="pe-name">{PART_LABEL[sel.kind]}{sel.name && sel.kind !== 'uri-header' ? ` · ${sel.name}` : ''}</p>
              <p className="pe-val">{sel.text}</p>
              <p>{partText(sel, d)}</p>
              {sel.kind !== 'display' && sel.kind !== 'header-param' && sel.kind !== 'uri-header' && (
                <p className="ud-case">{caseSensitive(sel.kind)
                  ? 'Compared case-sensitively: "Alice" and "alice" are different.'
                  : 'Compared case-insensitively: "ATLANTA.example" and "atlanta.example" are the same.'}</p>
              )}
            </>
          ) : <p className="insp-hint">Type a URI to see its parts.</p>}
          {d.role && <p className="ud-role"><b>Role:</b> {ROLE_TEXT[d.role]}</p>}
        </div>

        <ul className="ud-notes" aria-label="Notes">
          {[...d.notes].sort((x, y) => RANK[x.level] - RANK[y.level]).map((n, i) => {
            const q = n.quote ? quotes[n.quote] : undefined;
            return (
              <li key={i} className={`ud-note is-${n.level}`}>
                <p>
                  {n.level === 'info' ? <span className="ud-dot" aria-hidden="true">•</span> : <span className="ud-warn" aria-hidden="true">⚠</span>}
                  {n.level === 'error' && <b>Not valid: </b>}
                  {n.level === 'warn' && <b>Risk: </b>}
                  {n.text}
                </p>
                {q && (
                  <p className="ud-q">
                    “{markKeywords(q.text)}” <a href={q.url} target="_blank" rel="noopener">RFC {q.rfc} §{q.section} ↗</a>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </figure>
  );
}
