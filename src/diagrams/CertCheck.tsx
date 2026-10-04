/**
 * Certificate check (Module 14): Proxy A resolved sips:bob@biloxi.example with
 * DNS, reached sip1.biloxi.example, and got a certificate. Pick a certificate
 * and follow RFC 5922 §7: which values are SIP domain identities, and does one
 * of them match biloxi.example? The model is src/sip/cert.ts.
 */
import { useState } from 'react';
import { CERT_EXAMPLES, checkServer, type ValueVerdict } from '../sip/cert.ts';
import { quoteSource } from '../lib/rfc-ref.ts';
import type { ClientQuote } from './types.ts';

interface Props { quotes: Record<string, ClientQuote> }

const URI = 'sips:bob@biloxi.example';
const VERDICT: Record<ValueVerdict, string> = {
  identity: 'SIP domain identity',
  'not-sip': 'ignored: not a sip URI',
  'user-part': 'ignored: names a user, not a domain',
  'dns-ignored': 'ignored: the certificate has a sip URI',
  'cn-ignored': 'ignored: the certificate has subjectAltName',
};

export default function CertCheck({ quotes }: Props) {
  const [id, setId] = useState(CERT_EXAMPLES[0]!.id);
  const ex = CERT_EXAMPLES.find(e => e.id === id)!;
  const r = checkServer(URI, ex.cert);
  const [focus, setFocus] = useState<string | undefined>();
  const rule = focus ?? r.rule;
  const quote = quotes[rule];

  return (
    <figure className="stage ccheck" aria-label="Certificate check">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Certificate check · RFC 5922</p>
          <p className="stage-title">Is this server really biloxi.example?</p>
        </div>
      </header>

      <ol className="cc-steps">
        <li><span>Proxy A resolves</span><code>{URI}</code></li>
        <li><span>DNS (SRV, A) gives</span><code>sip1.biloxi.example 203.0.113.11:5061</code></li>
        <li><span>The server's certificate must name</span><code className="cc-want">biloxi.example</code></li>
      </ol>

      <div className="seg cc-pick" role="group" aria-label="Certificate">
        {CERT_EXAMPLES.map(e => <button key={e.id} type="button" aria-pressed={e.id === id} onClick={() => { setId(e.id); setFocus(undefined); }}>{e.label}</button>)}
      </div>

      <div className="cc-main">
        <section className="cc-cert" aria-label="Certificate">
          <p className="cc-ctitle">Certificate<span className={ex.cert.valid ? '' : 'is-bad'}>{ex.cert.valid ? 'signed by a trusted CA' : 'self-signed: not trusted'}</span></p>
          <p className="cc-note">{ex.note}</p>
          <table className="cc-table">
            <thead><tr><th scope="col">Value</th><th scope="col">RFC 5922 §7.1</th></tr></thead>
            <tbody>
              {r.values.map(v => (
                <tr key={v.value} className={`v-${v.verdict}${v.identity && v.identity === r.matched ? ' is-match' : ''}`} onClick={() => setFocus(v.rule)}>
                  <th scope="row"><code>{v.value}</code></th>
                  <td>{VERDICT[v.verdict]}{v.identity && <> <code>{v.identity}</code></>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className={`cc-result${r.ok ? ' is-ok' : ' is-bad'}`} aria-live="polite">
          <p className="cc-verdict">{r.ok ? 'Authenticated' : 'Not authenticated'}</p>
          <p className="cc-ids">Identities found: {r.identities.length ? r.identities.map(i => <code key={i}>{i}</code>) : <em>none</em>}</p>
          <p className="cc-why">{r.reason}</p>
          {!r.ok && <p className="cc-then">Proxy A closes the connection and tries the next server, or fails the request.</p>}
          {quote && (
            <div className="rv-quote">
              <p className="insp-q-src">{quoteSource(quote)}</p>
              <p>“{quote.text.replace(/\s+/g, ' ')}”</p>
              <a href={quote.url} target="_blank" rel="noopener">Read the section ↗</a>
            </div>
          )}
        </section>
      </div>
    </figure>
  );
}
