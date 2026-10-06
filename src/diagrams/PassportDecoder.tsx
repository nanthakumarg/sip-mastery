/**
 * PASSporT decoder (Module 28.2–28.4): an Identity header split into its
 * header, payload, and signature, with each claim explained. Change a claim
 * or the verifier's clock, and the browser checks the real ES256 signature
 * again with Web Crypto. "Sign again" signs with the example key, as the
 * carrier's signing service would.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  b64uJson, canonicalTn, display, FRESHNESS, identityHeader, parseIdentity, signPassport, verifyChecks, verifyJws, X5U, X5U_B,
  type PassportPayload, type Verstat,
} from '../sip/stir.ts';
import { EXAMPLE_PRIVATE_JWK, EXAMPLE_PUBLIC_JWK, TOKENS } from '../sip/stir-data.ts';

const PRESETS = {
  'A.ok': { label: 'A: Alice', from: '+14045550101', to: '+12285550222', phone: 'Bob' },
  'B.ok': { label: 'B: company PBX', from: '+18885550199', to: '+12285550222', phone: 'Bob' },
  'C.ok': { label: 'C: from a PSTN gateway', from: '+442071234567', to: '+12285550222', phone: 'Bob' },
  div: { label: 'div: Bob forwards to Carol', from: '+14045550101', to: '+12285550333', phone: 'Carol' },
} as const;
type Preset = keyof typeof PRESETS;

const HEADER_NOTES: Record<string, string> = {
  alg: 'ES256: ECDSA with the P-256 curve and SHA-256. SHAKEN uses no other algorithm.',
  ppt: 'The PASSporT extension: shaken adds attest and origid; div records a diversion.',
  typ: 'Always passport.',
  x5u: 'Where the verifier fetches the signer\'s certificate, over HTTPS.',
};
const PAYLOAD_NOTES: Record<string, string> = {
  attest: 'The attestation level: A full, B partial, C gateway.',
  dest: 'Who is called: one or more telephone numbers, digits only.',
  div: 'The number that the call was for, before the diversion.',
  iat: 'Issued at: when the signer signed, in seconds since 1970.',
  orig: 'Who calls: the telephone number, digits only.',
  origid: 'A UUID for the source of the call, so carriers can trace it back.',
};

export default function PassportDecoder() {
  const [preset, setPreset] = useState<Preset>('A.ok');
  const base = useMemo(() => parseIdentity(identityHeader(TOKENS[preset]!, preset === 'div' ? X5U_B : X5U, preset === 'div' ? 'div' : 'shaken')), [preset]);
  const [orig, setOrig] = useState(base.payload!.orig.tn);
  const [attest, setAttest] = useState(base.payload!.attest ?? '');
  const [age, setAge] = useState(2);
  const [resigned, setResigned] = useState<string | null>(null);
  const [sigOk, setSigOk] = useState<boolean | null>(null);
  const pick = (p: Preset) => {
    const t = parseIdentity(identityHeader(TOKENS[p]!, X5U));
    setPreset(p); setOrig(t.payload!.orig.tn); setAttest(t.payload!.attest ?? ''); setAge(2); setResigned(null);
  };

  const payload: PassportPayload = { ...base.payload!, orig: { tn: orig }, ...(base.payload!.attest ? { attest: attest as 'A' } : {}) };
  const edited = b64uJson(payload) !== base.parts[1];
  const jws = resigned ?? `${base.parts[0]}.${b64uJson(payload)}.${base.parts[2]}`;
  const header = identityHeader(jws, base.info!, base.ppt);
  const parsed = parseIdentity(header);

  useEffect(() => {
    let live = true;
    setSigOk(null);
    verifyJws(jws, EXAMPLE_PUBLIC_JWK).then(ok => { if (live) setSigOk(ok); });
    return () => { live = false; };
  }, [jws]);
  // A new edit makes an old re-signature stale.
  useEffect(() => { if (resigned && !resigned.includes(`.${b64uJson(payload)}.`)) setResigned(null); }, [orig, attest]);

  const p = PRESETS[preset];
  const result = verifyChecks({ parsed, signatureValid: !!sigOk, now: payload.iat + age, from: p.from, to: p.to, certTrusted: true });
  const verstat: Verstat = sigOk === null ? 'No-TN-Validation' : result.verstat;
  const sign = async () => setResigned(await signPassport(base.header!, payload, EXAMPLE_PRIVATE_JWK));

  return (
    <figure className="stage ppd">
      <header className="stage-head">
        <div>
          <p className="eyebrow">PASSporT decoder</p>
          <p className="stage-title">What an Identity header says, and whether it holds</p>
        </div>
        <div className="seg" role="group" aria-label="Example">
          {(Object.keys(PRESETS) as Preset[]).map(k => <button key={k} type="button" aria-pressed={k === preset} onClick={() => pick(k)}>{PRESETS[k].label}</button>)}
        </div>
      </header>

      <p className="ppd-raw" aria-label="The Identity header">
        <span className="ppd-k">Identity: </span>
        <span className="ppd-h">{parsed.parts[0]}</span>.<span className={`ppd-p${edited && !resigned ? ' is-edited' : ''}`}>{parsed.parts[1]}</span>.<span className="ppd-s">{parsed.parts[2]}</span>
        <span className="ppd-k">;info=&lt;{parsed.info}&gt;;alg={parsed.alg};ppt={parsed.ppt}</span>
      </p>

      <div className="ppd-cols">
        <section className="ppd-box is-h">
          <p className="eyebrow">Header</p>
          <dl>{Object.entries(parsed.header ?? {}).map(([k, v]) => <div key={k}><dt>{k}</dt><dd><code>{JSON.stringify(v)}</code><span>{HEADER_NOTES[k]}</span></dd></div>)}</dl>
        </section>
        <section className="ppd-box is-p">
          <p className="eyebrow">Payload</p>
          <dl>{Object.entries(payload).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd><code>{JSON.stringify(v)}</code>
              <span>{PAYLOAD_NOTES[k]}{k === 'iat' ? ` ${new Date((v as number) * 1000).toUTCString()}.` : ''}</span></dd></div>
          ))}</dl>
        </section>
        <section className="ppd-box is-s">
          <p className="eyebrow">Signature</p>
          <p><code>{Array.from(parsed.signature).map(b => b.toString(16).padStart(2, '0')).join('').replace(/(.{32})/g, '$1 ')}</code></p>
          <p className="ppd-note">64 bytes: r and s of the ECDSA signature, over <code>BASE64URL(header) . BASE64URL(payload)</code>. Only the holder of the private key can make it; anyone with the certificate can check it.</p>
        </section>
      </div>

      <div className="ppd-edit">
        <label>orig.tn<input value={orig} onChange={e => setOrig(e.target.value.replace(/\D/g, ''))} inputMode="numeric" spellCheck={false} /></label>
        {base.payload!.attest && (
          <label>attest<select value={attest} onChange={e => setAttest(e.target.value)}><option>A</option><option>B</option><option>C</option></select></label>
        )}
        <label className="ppd-age">The verifier checks it {age} s after iat<input type="range" min={0} max={600} step={1} value={age} onChange={e => setAge(Number(e.target.value))} /></label>
        <button type="button" className="ppd-sign" disabled={!edited || !!resigned} onClick={sign}>{resigned ? 'Signed again ✓' : 'Sign again with the carrier\'s key'}</button>
      </div>

      <div className={`ppd-result v-${verstat}`} aria-live="polite">
        <p className="ppd-verdict">{sigOk === null ? 'Checking the signature…' : `verstat=${result.verstat}`}</p>
        <ul>{result.checks.map(c => <li key={c.what} className={c.ok ? 'is-ok' : 'is-bad'}><b>{c.ok ? '✓' : '✗'} {c.what}.</b> {c.text}</li>)}</ul>
        <p><b>The call is for {canonicalTn(p.to)}, from {canonicalTn(p.from)}.</b> {sigOk === null ? '' : `${p.phone}'s phone shows ${display(result.verstat, payload.attest).replace(/^The /, 'the ')}`}</p>
        {edited && !resigned && sigOk === false && <p className="ppd-hint">You changed the payload, but not the signature: this is what an attacker without the key can do. Try "Sign again", as the carrier would.</p>}
        {age > FRESHNESS && <p className="ppd-hint">Older than {FRESHNESS} s: a replayed call, or a clock that is wrong at the signer or the verifier.</p>}
      </div>
    </figure>
  );
}
