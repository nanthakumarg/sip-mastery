/**
 * Digest calculator (RFC 3261 §22.4, RFC 7616 §3.4.1, RFC 8760).
 * Every input says where its value comes from. Focus an input to highlight
 * where it is used in each hash and in the final header.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { computeDigest, type DigestAlgorithm, type DigestInput, type DigestSteps } from '../sip/digest.ts';

type Key = keyof DigestInput;

interface Field { key: Key; label: string; source: string }

const FIELDS: Field[] = [
  { key: 'username', label: 'username', source: 'phone settings' },
  { key: 'password', label: 'password', source: 'phone settings (never sent)' },
  { key: 'realm', label: 'realm', source: 'the challenge' },
  { key: 'nonce', label: 'nonce', source: 'the challenge' },
  { key: 'method', label: 'method', source: 'the request' },
  { key: 'uri', label: 'digest URI', source: 'the Request-URI' },
  { key: 'nc', label: 'nc (nonce count)', source: 'the UAC counts' },
  { key: 'cnonce', label: 'cnonce', source: 'the UAC chooses' },
];

interface Props {
  initial: DigestInput;
  /** Header to build: 401 → Authorization, 407 → Proxy-Authorization */
  header?: 'Authorization' | 'Proxy-Authorization';
  /** A known-good response, e.g. from the call flow on the same page */
  expected?: { response: string; label: string };
}

export default function DigestCalculator({ initial, header = 'Proxy-Authorization', expected }: Props) {
  const [d, setD] = useState<DigestInput>(initial);
  const [r, setR] = useState<DigestSteps | null>(null);
  const [focus, setFocus] = useState<Key | null>(null);
  const [showPw, setShowPw] = useState(false);

  useEffect(() => {
    let live = true;
    computeDigest(d).then(x => { if (live) setR(x); });
    return () => { live = false; };
  }, [d]);

  const set = (k: Key, v: string) => setD(prev => ({ ...prev, [k]: v }));
  const seg = (k: Key, text: string): ReactNode => (
    <span className={`dg-seg${focus === k ? ' is-hot' : ''}`} data-k={k}>{k === 'password' && !showPw ? '•'.repeat(Math.min(text.length, 12)) : text}</span>
  );
  const hashSeg = (name: 'HA1' | 'HA2', value?: string) => <span className="dg-seg dg-hash" title={name}>{value ?? '…'}</span>;
  const sep = <span className="dg-sep">:</span>;
  const match = expected && r ? r.response === expected.response : undefined;

  return (
    <div className="digest">
      <div className="dg-inputs">
        <div className="dg-row2">
          <label className="dg-field">
            <span className="dg-label">algorithm <em>the challenge</em></span>
            <select value={d.algorithm} onChange={e => set('algorithm', e.target.value as DigestAlgorithm)}>
              <option value="MD5">MD5</option>
              <option value="SHA-256">SHA-256 (RFC 8760)</option>
            </select>
          </label>
          <label className="dg-field">
            <span className="dg-label">qop <em>the challenge</em></span>
            <select value={d.qop} onChange={e => set('qop', e.target.value)}>
              <option value="auth">auth</option>
              <option value="">none (old RFC 2069 form)</option>
            </select>
          </label>
        </div>
        {FIELDS.map(f => (
          <label key={f.key} className={`dg-field${focus === f.key ? ' is-hot' : ''}`}>
            <span className="dg-label">{f.label} <em>{f.source}</em></span>
            <span className="dg-input-wrap">
              <input
                type={f.key === 'password' && !showPw ? 'password' : 'text'}
                value={d[f.key]}
                spellCheck={false}
                autoComplete="off"
                disabled={(f.key === 'nc' || f.key === 'cnonce') && !d.qop}
                onFocus={() => setFocus(f.key)}
                onBlur={() => setFocus(null)}
                onChange={e => set(f.key, e.target.value)}
              />
              {f.key === 'password' && (
                <button type="button" className="dg-eye" onClick={() => setShowPw(s => !s)} aria-pressed={showPw}>{showPw ? 'hide' : 'show'}</button>
              )}
            </span>
          </label>
        ))}
        <button type="button" className="dg-reset" onClick={() => setD(initial)}>↺ Reset to the call flow values</button>
      </div>

      <ol className="dg-steps">
        <li>
          <p className="dg-step-name"><b>HA1</b> = {d.algorithm}( username : realm : password )</p>
          <p className="dg-in">{seg('username', d.username)}{sep}{seg('realm', d.realm)}{sep}{seg('password', d.password)}</p>
          <p className="dg-out">→ {r?.ha1 ?? '…'}</p>
          <p className="dg-note">A server can store HA1 instead of the password.</p>
        </li>
        <li>
          <p className="dg-step-name"><b>HA2</b> = {d.algorithm}( method : digest URI )</p>
          <p className="dg-in">{seg('method', d.method)}{sep}{seg('uri', d.uri)}</p>
          <p className="dg-out">→ {r?.ha2 ?? '…'}</p>
        </li>
        <li>
          <p className="dg-step-name"><b>response</b> = {d.algorithm}( {d.qop ? 'HA1 : nonce : nc : cnonce : qop : HA2' : 'HA1 : nonce : HA2'} )</p>
          <p className="dg-in">
            {hashSeg('HA1', r?.ha1)}{sep}{seg('nonce', d.nonce)}{sep}
            {d.qop && <>{seg('nc', d.nc)}{sep}{seg('cnonce', d.cnonce)}{sep}{seg('qop', d.qop)}{sep}</>}
            {hashSeg('HA2', r?.ha2)}
          </p>
          <p className="dg-out dg-final">→ {r?.response ?? '…'}</p>
        </li>
      </ol>

      <div className="dg-header">
        <p className="eyebrow">The header Alice sends</p>
        <p className="dg-hline">
          <span className="h-name">{header}</span>: Digest username="{seg('username', d.username)}", realm="{seg('realm', d.realm)}",
          nonce="{seg('nonce', d.nonce)}", uri="{seg('uri', d.uri)}", response="<span className="dg-seg dg-resp">{r?.response ?? '…'}</span>",
          algorithm={d.algorithm}{d.qop && <>, qop={d.qop}, nc={seg('nc', d.nc)}, cnonce="{seg('cnonce', d.cnonce)}"</>}
        </p>
        {expected && match !== undefined && (
          <p className={`dg-match ${match ? 'ok' : 'no'}`}>
            {match ? `✓ Same response as ${expected.label}.` : `✕ Different from ${expected.label}. The server would reject this request.`}
          </p>
        )}
      </div>
    </div>
  );
}
