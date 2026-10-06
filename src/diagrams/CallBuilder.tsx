/**
 * Call flow builder (Module 21): choose the path, what happens to the call,
 * and "what if" options, and see the complete call flow with every message.
 * The flows come from src/sip/callflow.ts, and every combination passes the
 * same protocol checks as the flow files (tests/callflow.test.ts).
 */
import { useEffect, useState } from 'react';
import FlowStage from './FlowStage.tsx';
import { toClientFlow } from './client-flow.ts';
import type { ClientFlow, ClientQuote, ClientRef } from './types.ts';
import { applyChange, buildCall, callKey, inactive, LOSSES, OUTCOMES, PATHS, type CallOptions } from '../sip/callflow.ts';
import { prepareFlow } from '../sip/flow.ts';

interface Props {
  options: CallOptions;
  /** The flow for `options`, prepared at build time. */
  flow: ClientFlow;
  /** Quotes and header notes for that flow only. The rest comes from /call-builder.json. */
  quotes: Record<string, ClientQuote>;
  refData: ClientRef;
  eyebrow?: string;
}

const TOGGLES = [
  ['recordRoute', 'Record-Route'],
  ['auth', '407 challenge'],
  ['lateOffer', 'Late offer'],
  ['earlyMedia', 'Early media (183)'],
] as const;

interface Shared { quotes: Record<string, ClientQuote>; refData: ClientRef }
let shared: Promise<Shared | undefined> | undefined;
/** One request for every builder on the page. Without it, the builders keep the data of their first flow. */
const loadShared = () => (shared ??= fetch(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/call-builder.json`)
  .then(r => (r.ok ? (r.json() as Promise<Shared>) : undefined)).catch(() => undefined));

function Choice<T extends string>({ label, items, value, onPick, disabled }: {
  label: string; items: Record<T, string>; value: T; onPick: (v: T) => void; disabled?: string;
}) {
  return (
    <div className="cb-group" role="group" aria-label={label} title={disabled}>
      <span className="cb-label">{label}</span>
      <div className="cb-opts">
        {(Object.keys(items) as T[]).map(k => (
          <button key={k} type="button" aria-pressed={value === k} disabled={!!disabled} onClick={() => onPick(k)}>{items[k]}</button>
        ))}
      </div>
    </div>
  );
}

export default function CallBuilder({ options, flow: built, quotes: firstQuotes, refData: firstRef, eyebrow = 'Call flow builder · change any option' }: Props) {
  const [o, setO] = useState(options);
  const [{ quotes, refData }, setData] = useState<Shared>({ quotes: firstQuotes, refData: firstRef });
  useEffect(() => {
    let live = true;
    loadShared().then(d => { if (d && live) setData(d); });
    return () => { live = false; };
  }, []);
  const [notes, setNotes] = useState<string[]>([]);
  const [flow, setFlow] = useState(built);
  const key = callKey(o);

  useEffect(() => {
    if (flow.id === `call-${key}`) return;
    let live = true;
    prepareFlow(buildCall(o)).then(f => { if (live) setFlow(toClientFlow(f)); });
    return () => { live = false; };
  }, [key]);

  const change = (c: Partial<CallOptions>) => {
    const r = applyChange(o, c);
    setO(r.options);
    setNotes(r.notes);
  };
  const off = inactive(o);
  const changed = key !== callKey(options);

  const toolbar = (
    <div className="cb-controls">
      <Choice label="Path" items={PATHS} value={o.path} onPick={path => change({ path })} />
      <Choice label="Outcome" items={OUTCOMES} value={o.outcome} onPick={outcome => change({ outcome })} />
      <div className="cb-group" role="group" aria-label="What if">
        <span className="cb-label">What if</span>
        <div className="cb-opts">
          {TOGGLES.map(([k, label]) => {
            const why = k === 'recordRoute' ? off.recordRoute : undefined;
            const on = o[k] && !why;
            return (
              <button key={k} type="button" className="rl-toggle" aria-pressed={on} disabled={!!why} title={why} onClick={() => change({ [k]: !o[k] })}>
                <span aria-hidden="true">{on ? '●' : '○'}</span>{label}
              </button>
            );
          })}
        </div>
      </div>
      <Choice label="Lost packet" items={LOSSES} value={o.lose} onPick={lose => change({ lose })} />
      <Choice label="Hangs up" items={{ alice: 'Alice', bob: 'Bob' }} value={o.hangup} onPick={hangup => change({ hangup })} disabled={off.hangup} />
      <div className="cb-foot">
        <p className="cb-notes" aria-live="polite">{notes.join(' ')}</p>
        {changed && <button type="button" className="cb-reset" onClick={() => { setO(options); setNotes([]); }}>↺ Back to this section's call</button>}
      </div>
    </div>
  );

  return <FlowStage flow={flow} quotes={quotes} refData={refData} eyebrow={changed ? 'Call flow builder · your own combination' : eyebrow} toolbar={toolbar} />;
}
