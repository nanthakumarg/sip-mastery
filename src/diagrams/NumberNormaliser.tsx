/**
 * Number normaliser (Module 24.2): type what a user dialled on a PBX phone
 * and see how the PBX turns it into E.164, and the URIs it sends on the trunk.
 */
import { useState } from 'react';
import { normalise, PLANS, type DialPlan } from '../sip/numbers.ts';

const PRESETS: Record<DialPlan['id'], string[]> = {
  us: ['9 555 0199', '9 404 555 0199', '9 1 404 555 0199', '9 011 44 20 7946 0123', '+1 404 555 0199', '9 911', '555 0199', '9 0199'],
  uk: ['9 7946 0123', '9 020 7946 0123', '9 00 1 404 555 0199', '9 0161 496 0123', '+44 20 7946 0123', '9 999', '020 7946 0123'],
};

const KIND: Record<string, string> = {
  e164: 'Already E.164', international: 'International number', national: 'National number', local: 'Local number',
  emergency: 'Emergency number', invalid: 'Cannot normalise',
};

export default function NumberNormaliser() {
  const [planId, setPlanId] = useState<DialPlan['id']>('us');
  const [value, setValue] = useState(PRESETS.us[0]!);
  const plan = PLANS[planId];
  const r = normalise(value, plan);
  const pick = (id: DialPlan['id']) => { setPlanId(id); setValue(PRESETS[id][0]!); };

  return (
    <figure className="stage numnorm">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Number normaliser</p>
          <p className="stage-title">From what the user dialled to what the trunk carries</p>
        </div>
        <div className="seg" role="group" aria-label="Dial plan">
          {Object.values(PLANS).map(p => (
            <button key={p.id} type="button" aria-pressed={p.id === planId} onClick={() => pick(p.id)}>{p.label}</button>
          ))}
        </div>
      </header>
      <div className="ac-main">
        <div className="ac-left">
          <label className="ac-input">
            <span className="eyebrow">Dialled on a PBX phone</span>
            <input value={value} onChange={e => setValue(e.target.value)} spellCheck={false} autoComplete="off" inputMode="tel" aria-describedby="nn-result" />
          </label>
          <div className="ac-presets" aria-label="Examples">
            {PRESETS[planId].map(p => <button key={p} type="button" onClick={() => setValue(p)} aria-pressed={value === p}>{p}</button>)}
          </div>
          <p className="nn-plan">
            Outside line <code>{plan.outside}</code> · international prefix <code>{plan.intl}</code> · country code <code>+{plan.cc}</code> · area code <code>{plan.area}</code>
          </p>
        </div>
        <div id="nn-result" className={`ac-result${r.kind === 'invalid' ? ' is-local' : ''}`} aria-live="polite">
          <p className="ac-kind">{r.kind === 'invalid' ? '⚠ ' : ''}{KIND[r.kind]}</p>
          {r.steps.length > 0 && (
            <ol className="nn-steps">
              {r.steps.map((s, i) => <li key={i}><span>{s.what}</span> <code>{s.result}</code></li>)}
            </ol>
          )}
          {(r.e164 || r.sip) && (
            <dl className="nn-out">
              {r.e164 && <><dt>E.164</dt><dd><code>{r.e164}</code></dd></>}
              {r.tel && <><dt>tel URI</dt><dd><code>{r.tel}</code></dd></>}
              {r.sip && <><dt>Request-URI</dt><dd><code>{r.sip}</code></dd></>}
              {r.localTel && <><dt>Unnormalised</dt><dd><code>{r.localTel}</code></dd></>}
              {r.isup && <><dt>ISUP, at a gateway in this country</dt><dd><code>{r.isup.digits}</code> ({r.isup.noa} number)</dd></>}
            </dl>
          )}
          {r.localTel && <p>A local number in a URI must say where it is valid, with <code>phone-context</code>. Most carriers accept only E.164, so the PBX adds the country and area code.</p>}
          {r.note && <p>{r.note}</p>}
        </div>
      </div>
    </figure>
  );
}
