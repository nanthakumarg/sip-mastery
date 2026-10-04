/**
 * Address classifier (Module 2.1): type or pick an address and see which
 * range it belongs to, and what that means when it appears in a SIP message.
 */
import { useState } from 'react';
import { classify } from '../net/address.ts';

const PRESETS = ['192.168.1.20', '10.20.30.40', '172.20.5.9', '100.72.10.3', '203.0.113.20', '8.8.8.8', '169.254.7.7', 'fd00:1::20', '2001:db8::10'];

const RANGES: [string, string, string][] = [
  ['10.0.0.0/8', 'Private', 'RFC 1918'],
  ['172.16.0.0/12', 'Private', 'RFC 1918'],
  ['192.168.0.0/16', 'Private', 'RFC 1918'],
  ['100.64.0.0/10', 'Shared (carrier-grade NAT)', 'RFC 6598'],
  ['127.0.0.0/8', 'Loopback', 'RFC 1122'],
  ['169.254.0.0/16', 'Link-local', 'RFC 3927'],
  ['192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24', 'Documentation (examples)', 'RFC 5737'],
  ['fc00::/7', 'Unique local (IPv6)', 'RFC 4193'],
  ['fe80::/10', 'Link-local (IPv6)', 'RFC 4291'],
  ['2001:db8::/32', 'Documentation (IPv6)', 'RFC 3849'],
];

export default function AddressClassifier() {
  const [value, setValue] = useState('192.168.1.20');
  const c = classify(value);
  const notPublic = ['private', 'cgnat', 'loopback', 'link-local', 'ula'].includes(c.kind);
  const hitRow = (cidr: string) => c.range !== undefined && cidr.split(', ').includes(c.range);

  return (
    <figure className="stage addrc">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Address check</p>
          <p className="stage-title">Is this address reachable from the Internet?</p>
        </div>
      </header>
      <div className="ac-main">
        <div className="ac-left">
          <label className="ac-input">
            <span className="eyebrow">IP address</span>
            <input value={value} onChange={e => setValue(e.target.value)} spellCheck={false} autoComplete="off" aria-describedby="ac-result" />
          </label>
          <div className="ac-presets" aria-label="Examples">
            {PRESETS.map(p => <button key={p} type="button" onClick={() => setValue(p)} aria-pressed={value === p}>{p}</button>)}
          </div>
          <div id="ac-result" className={`ac-result k-${c.kind}${notPublic ? ' is-local' : ''}`} aria-live="polite">
            <p className="ac-kind">{notPublic ? '⚠ ' : ''}{c.label}</p>
            {c.range && <p className="ac-range">IPv{c.version} · in {c.range}{c.rfc ? ` · RFC ${c.rfc}` : ''}</p>}
            <p>{c.reachable}</p>
            {notPublic && (
              <p className="ac-sip"><b>In a SIP trace:</b> this address in a Via, Contact, or SDP <code>c=</code> line that reaches the Internet is a NAT problem waiting to happen (Module 20).</p>
            )}
          </div>
        </div>
        <table className="ac-table">
          <thead><tr><th>Range</th><th>Kind</th><th>Defined in</th></tr></thead>
          <tbody>
            {RANGES.map(([cidr, kind, rfc]) => (
              <tr key={cidr} className={hitRow(cidr) ? 'is-hit' : ''}><td><code>{cidr}</code></td><td>{kind}</td><td>{rfc}</td></tr>
            ))}
            <tr className={c.kind === 'public' ? 'is-hit' : ''}><td><code>everything else</code></td><td>Public</td><td>—</td></tr>
          </tbody>
        </table>
      </div>
    </figure>
  );
}
