/**
 * Location service view (Module 12): a ladder on the left, and the registrar's
 * bindings on the right, updated at each step. The bindings come from the
 * registrar model (src/sip/registrar.ts) run over the flow's REGISTER requests,
 * so the table shows what RFC 3261 §10.3 says the registrar must store; the
 * registrar-model lint rule checks that the flow's 200 OK responses agree.
 */
import { useMemo, useState } from 'react';
import Ladder from './Ladder.tsx';
import { PlayerControls, usePlayer } from './player.tsx';
import { safeParse } from './diff.ts';
import { DEFAULT_POLICY, formatQ, lookup, runRegistrar, type ActionKind, type Binding } from '../sip/registrar.ts';
import { quoteSource } from '../lib/rfc-ref.ts';
import type { ClientFlow, ClientQuote } from './types.ts';

interface Props {
  flows: ClientFlow[];
  /** Button labels when there is more than one flow. */
  labels?: string[];
  quotes: Record<string, ClientQuote>;
}

type RowState = ActionKind | 'kept';
interface Row { b: Binding; state: RowState; was?: string }

const GLYPH: Record<RowState, string> = { added: '+', refreshed: '↻', replaced: '⇄', removed: '−', expired: '⌛', kept: '' };
const STATE_TEXT: Record<RowState, string> = { added: 'added', refreshed: 'refreshed', replaced: 'replaced', removed: 'removed', expired: 'expired', kept: '' };

/** "3480 s" with minutes for longer times. */
function dur(s: number): string {
  if (s < 120) return `${s} s`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}

const short = (uri: string) => uri.replace(/^sips?:/, '');

export default function RegistrarView({ flows, labels, quotes }: Props) {
  const [k, setK] = useState(0);
  const flow = flows[k]!;
  return <Inner key={flow.id} flow={flow} quotes={quotes} pick={flows.length > 1 ? { labels: labels ?? flows.map(f => f.title), k, setK } : undefined} />;
}

function Inner({ flow, quotes, pick }: { flow: ClientFlow; quotes: Record<string, ClientQuote>; pick?: { labels: string[]; k: number; setK: (k: number) => void } }) {
  const cfg = flow.registrar!;
  const policy = { ...DEFAULT_POLICY, ...cfg };
  const snaps = useMemo(
    () => runRegistrar(flow.steps.map(s => ({ from: s.from, to: s.to, at: s.at, message: safeParse(s.wire) })), cfg.lane, policy, cfg.lookup ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flow],
  );
  const p = usePlayer(flow.steps.length, 2600);
  const cur = p.current;
  const step = flow.steps[cur]!;
  const snap = snaps[cur]!;
  const r = snap.result;
  const laneLabel = (id: string) => flow.lanes.find(l => l.id === id)?.label ?? id;
  const aor = snaps.find(s => s.result)?.result?.bindings[0]?.aor ?? 'sip:bob@biloxi.example';

  // The rows: live bindings, plus the ones this step removed or that ran out since the step before.
  const rows: Row[] = useMemo(() => {
    const acts = new Map((r?.actions ?? []).map(a => [a.contact, a]));
    const out: Row[] = snap.bindings.filter(b => b.aor === aor).map(b => {
      const a = acts.get(b.contact);
      return { b, state: a && a.kind !== 'removed' && a.kind !== 'expired' ? a.kind : 'kept', was: a?.was };
    });
    const before = snaps[cur - 1]?.bindings ?? [];
    for (const a of r?.actions ?? []) {
      const b = a.kind === 'removed' && before.find(x => x.contact === a.contact);
      if (b) out.push({ b, state: 'removed' });
    }
    for (const b of snap.expired) if (b.aor === aor) out.push({ b, state: 'expired' });
    return out;
  }, [snap, snaps, cur, r, aor]);

  const live = rows.filter(x => x.state !== 'removed' && x.state !== 'expired');
  const order = lookup(snap.bindings, aor, snap.at);
  const ruleId = r?.rule ?? step.rfc;
  const quote = ruleId ? quotes[ruleId] : undefined;

  let note: string;
  if (r) note = r.note;
  else if (snap.lookup) {
    note = snap.lookup.targets.length
      ? `${laneLabel(step.to)} asks the location service for ${short(snap.lookup.uri)} and finds ${snap.lookup.targets.length === 1 ? 'one Contact' : `${snap.lookup.targets.length} Contacts`}.`
      : `${laneLabel(step.to)} asks the location service for ${short(snap.lookup.uri)} and finds no binding.`;
  } else if (step.to === cfg.lane && step.from !== cfg.lane && !step.wire) note = 'The registrar answers the keepalive. The bindings do not change.';
  else note = step.from === cfg.lane ? 'The registrar sends its answer.' : 'The registrar does not see this message.';
  if (snap.expired.length) note =`${snap.expired.length === 1 ? 'A binding' : `${snap.expired.length} bindings`} ran out before this step. ${note}`;

  return (
    <figure className="stage regv" tabIndex={0} onKeyDown={p.onKey} aria-label="Location service view">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Location service view</p>
          <p className="stage-title">{flow.title}</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><span className="eg-g">+</span>Added</li>
          <li><span className="eg-g">↻</span>Refreshed</li>
          <li><span className="eg-g">−</span>Removed or expired</li>
        </ul>
      </header>

      {pick && (
        <div className="seg rv-pick" role="group" aria-label="Scenario">
          {pick.labels.map((l, i) => <button key={l} type="button" aria-pressed={pick.k === i} onClick={() => pick.setK(i)}>{l}</button>)}
        </div>
      )}

      <div className={`rv-main${flow.lanes.length > 4 ? ' is-wide' : ''}`}>
        <div className="rv-left">
          <div className="stage-ladder rv-ladder"><Ladder flow={flow} current={cur} onSelect={p.go} compact /></div>
          <div className="stage-caption" aria-live="polite">
            <span className="cap-num">{String(cur + 1).padStart(2, '0')}<span>/{flow.steps.length}</span></span>
            <div>
              <p className="cap-text">{step.caption}</p>
              {step.warn && <p className="cap-warn">⚠ {step.warn}</p>}
            </div>
          </div>
          <PlayerControls p={p} />
        </div>

        <section className="rv-panel" aria-label="Bindings in the location service">
          <p className="rv-head">
            <span className="rv-title">Location service</span>
            <span className="rv-clock">t = {snap.at} s{snap.at >= 120 ? ` · ${dur(snap.at)}` : ''}</span>
          </p>
          <p className="rv-aor"><span>AOR</span><code>{aor}</code></p>
          <p className="rv-policy">Registrar policy: Min-Expires {policy.minExpires} s · at most {policy.maxExpires} s{policy.outbound ? ' · SIP Outbound' : ''}{policy.gruu ? ' · GRUU' : ''}</p>

          {rows.length ? (
            <ol className="rv-rows">
              {rows.map(({ b, state, was }) => {
                const left = Math.max(0, Math.round(b.expiresAt - snap.at));
                const gone = state === 'removed' || state === 'expired';
                return (
                  <li key={`${b.contact}-${state}`} className={`rv-row is-${state}`}>
                    <span className="vs-glyph" aria-label={STATE_TEXT[state]}>{GLYPH[state]}</span>
                    <div className="rv-body">
                      <p className="rv-contact"><code>{b.contact}</code>{b.q !== undefined && <span className="rv-q">q={formatQ(b.q)}</span>}</p>
                      <p className="rv-meta">
                        {gone ? <span className="rv-gone">{state === 'removed' ? 'removed' : 'expired: not refreshed in time'}</span>
                          : <span>expires in <b>{dur(left)}</b></span>}
                        <span>Call-ID {b.callId.split('@')[0]} · CSeq {b.cseq}</span>
                      </p>
                      {!gone && <span className="rv-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (left / policy.maxExpires) * 100)}%` }} /></span>}
                      {was && <p className="rv-extra">replaces <code>{was}</code></p>}
                      {b.path.length > 0 && <p className="rv-extra">Path <code>{b.path.join(', ')}</code></p>}
                      {b.instance && <p className="rv-extra">instance <code>{b.instance}</code>{b.regId && <> · reg-id <code>{b.regId}</code></>}</p>}
                      {b.pubGruu && <p className="rv-extra">pub-gruu <code>{b.pubGruu}</code></p>}
                      {b.tempGruu && <p className="rv-extra">temp-gruu <code>{b.tempGruu}</code></p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : <p className="rv-empty">No bindings. A call to {short(aor)} gets 480 Temporarily Unavailable.</p>}

          {r && <p className={`rv-answer${r.status >= 300 ? ' is-err' : ''}`}><span>The registrar answers</span><b>{r.status} {r.reason}</b>{r.minExpires !== undefined && <code>Min-Expires: {r.minExpires}</code>}</p>}
          <p className="rv-note">{note}</p>

          {snap.lookup && snap.lookup.targets.length > 0 && (
            <div className="rv-lookup">
              <p className="vs-nlabel">{laneLabel(step.to)} sends the request to</p>
              {snap.lookup.targets.map(t => (
                <p key={t.contact}><code>{t.contact}</code>{t.route.length > 0 && <span> with Route <code>{t.route.join(', ')}</code></span>}</p>
              ))}
            </div>
          )}
          {!snap.lookup && live.length > 1 && (
            <div className="rv-lookup">
              {live.some(x => x.b.q !== undefined) ? <>
                <p className="vs-nlabel">A call to the AOR tries, by q value</p>
                <ol>{order.map(t => <li key={t.contact}><code>{t.contact}</code> <span>q={formatQ(t.q)}</span></li>)}</ol>
              </> : <>
                <p className="vs-nlabel">A call to the AOR forks to all of them</p>
                <ul>{order.map(t => <li key={t.contact}><code>{t.contact}</code></li>)}</ul>
              </>}
            </div>
          )}

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
