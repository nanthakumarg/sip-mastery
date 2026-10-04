/**
 * Via stack (Module 10.2): step through a call and watch the Via headers of
 * each message. A request gains one Via at each hop; a response loses one at
 * each hop. The panel shows where the message goes next and which rule says so
 * (RFC 3261 §16.12, §18.2.2; RFC 3581 §4).
 */
import { useMemo } from 'react';
import Ladder from './Ladder.tsx';
import { PlayerControls, usePlayer } from './player.tsx';
import { safeParse } from './diff.ts';
import { cseq, getHeader, getHeaders, type SipMessage } from '../sip/parse.ts';
import { responseTarget, viaList, type ViaValue } from '../sip/routing.ts';
import type { ClientFlow } from './types.ts';

interface Props { flow: ClientFlow }

type RowState = 'added' | 'kept' | 'removed';
interface Row { via: ViaValue; state: RowState; filled: boolean }

const RULE_TEXT: Record<ReturnType<typeof responseTarget>['rule'], string> = {
  'received + rport': 'the received address and the rport port (RFC 3581)',
  received: 'the received address and the sent-by port',
  'sent-by': 'the sent-by address of the Via',
  connection: 'the connection the request came on',
};

export default function ViaStack({ flow }: Props) {
  const msgs = useMemo(() => flow.steps.map(s => safeParse(s.wire)), [flow]);
  const p = usePlayer(flow.steps.length, 2600);
  const cur = p.current;
  const step = flow.steps[cur]!;
  const m = msgs[cur];

  const owner = (v: ViaValue) => flow.lanes.find(l => l.sub?.split(/[\s·]+/).includes(v.host))?.label ?? v.host;

  const view = useMemo(() => {
    if (!m) return undefined;
    const vias = viaList(m);
    const same = (a: SipMessage) => getHeader(a, 'Call-ID') === getHeader(m, 'Call-ID') && cseq(a)?.seq === cseq(m)?.seq;
    const branches = (a: SipMessage) => viaList(a).map(v => v.branch);
    let rows: Row[];
    let note: string;
    if (m.kind === 'request') {
      // The request this proxy received: its top Via is the second Via here.
      const j = vias[1] ? msgs.slice(0, cur).findLastIndex(q => q?.kind === 'request' && q.method === m.method && same(q) && viaList(q)[0]?.branch === vias[1]!.branch) : -1;
      const before = j >= 0 ? viaList(msgs[j]!) : [];
      rows = vias.map((v, k) => ({ via: v, state: k === 0 ? 'added' : 'kept', filled: !!(v.received || v.rport) && !(before[k - 1]?.received || before[k - 1]?.rport) }));
      note = vias.length === 1 ? `${laneLabel(step.from)} creates the request, so it has one Via: its own.` : `${laneLabel(step.from)} forwards the request and puts its Via on top.`;
    } else {
      // The response one hop earlier: it had one Via more, on top.
      const key = branches(m).join();
      const j = msgs.slice(0, cur).findLastIndex(q => q?.kind === 'response' && same(q) && branches(q).slice(1).join() === key);
      rows = vias.map(v => ({ via: v, state: 'kept', filled: false }));
      if (j >= 0) {
        rows.unshift({ via: viaList(msgs[j]!)[0]!, state: 'removed', filled: false });
        note = `${laneLabel(step.from)} removes the top Via, its own, and sends the response to the next one.`;
      } else note = `${laneLabel(step.from)} answers. The response copies the Via headers of the request, in order.`;
    }
    return { rows, note };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m, cur, msgs]);

  function laneLabel(id: string) { return flow.lanes.find(l => l.id === id)?.label ?? id; }

  let next: { to: string; why: string } | undefined;
  if (m?.kind === 'request') {
    const route = getHeaders(m, 'Route')[0]?.value.split(',')[0]?.replace(/[<>\s]/g, '');
    next = route ? { to: route, why: 'the first Route header' } : { to: m.requestUri ?? '', why: 'the Request-URI: no Route header is left' };
  } else if (m) {
    const top = viaList(m)[0];
    if (top) {
      const t = responseTarget(top);
      next = { to: `${t.host}:${t.port}`, why: RULE_TEXT[t.rule] };
    }
  }

  return (
    <figure className="stage vstack" tabIndex={0} onKeyDown={p.onKey} aria-label="Via stack">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Via stack</p>
          <p className="stage-title">{flow.title}</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><span className="eg-g st-added">+</span>Added at this hop</li>
          <li><span className="eg-g st-removed">−</span>Removed at this hop</li>
        </ul>
      </header>

      <div className="vs-main">
        <div className="vs-left">
          <div className="stage-ladder vs-ladder"><Ladder flow={flow} current={cur} onSelect={p.go} compact /></div>
          <div className="stage-caption" aria-live="polite">
            <span className="cap-num">{String(cur + 1).padStart(2, '0')}<span>/{flow.steps.length}</span></span>
            <div><p className="cap-text">{step.caption}</p></div>
          </div>
          <PlayerControls p={p} />
        </div>

        <section className="vs-panel" aria-label="Via headers of this message">
          <p className="vs-head">
            <span className="vs-msg">{step.label}</span>
            <span>{laneLabel(step.from)} → {laneLabel(step.to)} · {m?.kind === 'request' ? 'request' : 'response'}</span>
          </p>
          {view && <p className="vs-note">{view.note}</p>}
          <ol className="vs-stack">
            {view?.rows.map((r, k) => (
              <li key={`${r.via.branch}-${k}`} className={`vs-via is-${r.state}${k === (view.rows[0]?.state === 'removed' ? 1 : 0) ? ' is-top' : ''}`}>
                <span className="vs-glyph" aria-label={r.state}>{r.state === 'added' ? '+' : r.state === 'removed' ? '−' : ''}</span>
                <div className="vs-body">
                  <p className="vs-owner">{owner(r.via)}{r.state === 'removed' && <span> removed</span>}</p>
                  <code className="vs-sentby">{r.via.transport} {r.via.host}{r.via.port ? `:${r.via.port}` : ''}</code>
                  <p className="vs-params">
                    <span>branch=<b>{r.via.branch}</b></span>
                    {r.via.rport !== undefined && <span className={r.filled ? 'is-filled' : ''}>{r.via.rport === '' ? 'rport (empty)' : <>rport=<b>{r.via.rport}</b></>}</span>}
                    {r.via.received && <span className={r.filled ? 'is-filled' : ''}>received=<b>{r.via.received}</b></span>}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          {next && (
            <div className="vs-next">
              <p className="vs-nlabel">{m?.kind === 'request' ? 'Sent to' : 'Response sent to'}</p>
              <p><code>{next.to}</code></p>
              <p className="vs-why">from {next.why}</p>
            </div>
          )}
        </section>
      </div>
    </figure>
  );
}
