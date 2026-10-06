/**
 * Flow builder (Modules 21 and 22): options above a full interactive ladder.
 * Change any option and the flow, with every message, changes with it. The
 * flows come from the generators in src/sip/generators.ts, and every
 * combination passes the same protocol checks as the flow files.
 */
import { useEffect, useState } from 'react';
import FlowStage from './FlowStage.tsx';
import { toClientFlow } from './client-flow.ts';
import type { ClientFlow, ClientQuote, ClientRef } from './types.ts';
import { GENERATORS, type GeneratorKind } from '../sip/generators.ts';
import { prepareFlow } from '../sip/flow.ts';

type Options = Record<string, string | boolean>;

interface Props {
  kind: GeneratorKind;
  options: Options;
  /** The flow for `options`, prepared at build time. */
  flow: ClientFlow;
  /** Quotes and header notes for that flow only. The rest comes from /flow-builder.json. */
  quotes: Record<string, ClientQuote>;
  refData: ClientRef;
  eyebrow?: string;
}

interface Shared { quotes: Record<string, ClientQuote>; refData: ClientRef }
let shared: Promise<Shared | undefined> | undefined;
/** One request for every builder on the page. Without it, the builders keep the data of their first flow. */
const loadShared = () => (shared ??= fetch(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/flow-builder.json`)
  .then(r => (r.ok ? (r.json() as Promise<Shared>) : undefined)).catch(() => undefined));

export default function FlowBuilder({ kind, options, flow: built, quotes: firstQuotes, refData: firstRef, eyebrow = 'Flow builder · change any option' }: Props) {
  const g = GENERATORS[kind];
  const [o, setO] = useState(options);
  const [notes, setNotes] = useState<string[]>([]);
  const [flow, setFlow] = useState(built);
  const [{ quotes, refData }, setData] = useState<Shared>({ quotes: firstQuotes, refData: firstRef });
  const key = g.key(o);
  const changed = key !== g.key(options);

  useEffect(() => {
    let live = true;
    loadShared().then(d => { if (d && live) setData(d); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (flow.id === `${kind}-${key}`) return;
    let live = true;
    prepareFlow(g.build(o)).then(f => { if (live) setFlow(toClientFlow(f)); });
    return () => { live = false; };
  }, [key]);

  const change = (c: Options) => {
    const r = g.apply(o, c);
    setO(r.options);
    setNotes(r.notes);
  };
  const off = g.inactive(o);

  const toolbar = (
    <div className="cb-controls">
      {g.rows.map(row => (
        <div className="cb-group" role="group" aria-label={row.label} key={row.label} title={row.kind === 'choice' ? off[row.key] : undefined}>
          <span className="cb-label">{row.label}</span>
          <div className="cb-opts">
            {row.kind === 'choice'
              ? Object.entries(row.items).map(([v, label]) => (
                  <button key={v} type="button" aria-pressed={o[row.key] === v} disabled={!!off[row.key]} onClick={() => change({ [row.key]: v })}>{label}</button>
                ))
              : row.items.map(([k, label]) => {
                  const why = off[k];
                  const on = !!o[k] && !why;
                  return (
                    <button key={k} type="button" className="rl-toggle" aria-pressed={on} disabled={!!why} title={why} onClick={() => change({ [k]: !o[k] })}>
                      <span aria-hidden="true">{on ? '●' : '○'}</span>{label}
                    </button>
                  );
                })}
          </div>
        </div>
      ))}
      <div className="cb-foot">
        <p className="cb-notes" aria-live="polite">{notes.join(' ')}</p>
        {changed && <button type="button" className="cb-reset" onClick={() => { setO(options); setNotes([]); }}>↺ Back to this section's example</button>}
      </div>
    </div>
  );

  return <FlowStage flow={flow} quotes={quotes} refData={refData} eyebrow={changed ? 'Flow builder · your own combination' : eyebrow} toolbar={toolbar} />;
}
