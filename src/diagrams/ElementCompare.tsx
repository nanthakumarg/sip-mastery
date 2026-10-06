/**
 * Proxy vs B2BUA side by side (Module 25.1): pick a message of the call and
 * see it as it reaches each element and as it leaves, with every header that
 * the element added, changed, or removed.
 */
import { useState } from 'react';
import { toWire } from '../sip/flow.ts';
import { b2buaCall, PAIR_LABELS, PAIRS, proxyCall, WHY, type PairKey } from '../sip/elements.ts';
import { inspect } from './diff.ts';

const ORDER: PairKey[] = ['invite', '180', '200', 'ack', 'bye', '200-bye'];
const FLOWS = { proxy: proxyCall(), b2bua: b2buaCall() };
const NAMES = { alice: 'Alice', bob: 'Bob', mid: '' };
const GLYPH = { same: '', added: '+', changed: '~' } as const;

export default function ElementCompare() {
  const [key, setKey] = useState<PairKey>('invite');
  const [a, b] = PAIRS[key];

  return (
    <figure className="stage elcmp">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Proxy vs B2BUA</p>
          <p className="stage-title">The same message, before and after the element</p>
        </div>
        <div className="seg" role="group" aria-label="Message">
          {ORDER.map(k => <button key={k} type="button" aria-pressed={k === key} onClick={() => setKey(k)}>{PAIR_LABELS[k]}</button>)}
        </div>
      </header>
      {(['proxy', 'b2bua'] as const).map(el => {
        const f = FLOWS[el];
        const inStep = f.steps[a]!, outStep = f.steps[b]!;
        const inWire = toWire(inStep.message!), outWire = toWire(outStep.message!);
        const view = inspect(outWire, inWire)!;
        const before = inspect(inWire)!;
        const added = view.lines.filter(l => l.state === 'added').length;
        const changed = view.lines.filter(l => l.state === 'changed').length;
        const label = el === 'proxy' ? 'Proxy' : 'B2BUA';
        return (
          <section key={el} className="elcmp-row" aria-label={label}>
            <div className="elcmp-head">
              <p className="elcmp-name">{label}</p>
              <p className="elcmp-count">
                <span>{added} added</span> · <span>{changed} changed</span> · <span>{view.removed.length} removed</span>
              </p>
            </div>
            <div className="elcmp-panes">
              <div className="elcmp-pane">
                <p className="eyebrow">Reaches the {label === 'Proxy' ? 'proxy' : 'B2BUA'}, from {NAMES[inStep.from as 'alice']}</p>
                <div className="insp-msg" role="list">
                  {before.lines.map(l => (
                    <div key={l.line} role="listitem" className={`insp-line zone-${l.zone} st-same`}><span className="insp-glyph" /><span className="insp-text">{l.text}</span></div>
                  ))}
                </div>
              </div>
              <div className="elcmp-pane">
                <p className="eyebrow">Leaves, to {NAMES[outStep.to as 'alice']}</p>
                <div className="insp-msg" role="list">
                  {view.lines.map(l => (
                    <div key={l.line} role="listitem" className={`insp-line zone-${l.zone} st-${l.state}`}>
                      <span className="insp-glyph" aria-label={l.state === 'same' ? undefined : l.state}>{GLYPH[l.state]}</span>
                      <span className="insp-text">{l.text}</span>
                    </div>
                  ))}
                  {view.removed.map((t, k) => (
                    <div key={`rm${k}`} role="listitem" className="insp-line st-removed">
                      <span className="insp-glyph" aria-label="removed">−</span><span className="insp-text">{t}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <p className="elcmp-why">{WHY[key][el]}</p>
          </section>
        );
      })}
    </figure>
  );
}
