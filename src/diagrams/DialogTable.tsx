/**
 * Live dialog table (Module 9): step through a call; each user agent's dialog
 * state (RFC 3261 §12) updates at each message. Changed fields are marked.
 * Below, the four layers one message belongs to: call, session, dialog, and
 * transaction (Module 9.8).
 */
import { Fragment, useMemo } from 'react';
import Ladder from './Ladder.tsx';
import { PlayerControls, usePlayer } from './player.tsx';
import { safeParse } from './diff.ts';
import { dialogKey, trackDialogs, type DialogField, type DialogState } from '../sip/dialog.ts';
import { cseq, getHeader, tagOf, topVia } from '../sip/parse.ts';
import type { ClientFlow } from './types.ts';

interface Props { flow: ClientFlow }

const ROWS: { f: DialogField | 'id' | 'role'; label: string; show: (d: DialogState) => string }[] = [
  { f: 'id', label: 'Dialog ID', show: d => `${d.callId}\nlocal ${d.localTag} · remote ${d.remoteTag}` },
  { f: 'state', label: 'State', show: d => d.state },
  { f: 'role', label: 'Created as', show: d => d.role },
  { f: 'localSeq', label: 'Local CSeq', show: d => d.localSeq === undefined ? 'empty' : String(d.localSeq) },
  { f: 'remoteSeq', label: 'Remote CSeq', show: d => d.remoteSeq === undefined ? 'empty' : String(d.remoteSeq) },
  { f: 'localUri', label: 'Local URI', show: d => d.localUri },
  { f: 'remoteUri', label: 'Remote URI', show: d => d.remoteUri },
  { f: 'remoteTarget', label: 'Remote target', show: d => d.remoteTarget },
  { f: 'routeSet', label: 'Route set', show: d => d.routeSet.length ? d.routeSet.join('\n') : 'empty' },
];

export default function DialogTable({ flow }: Props) {
  const parsed = useMemo(() => flow.steps.map(s => ({ from: s.from, to: s.to, msg: safeParse(s.wire) })), [flow]);
  const uas = flow.lanes.filter(l => l.kind === 'ua');
  const tracks = useMemo(() => flow.lanes.filter(l => l.kind === 'ua').map(u => trackDialogs(parsed, u.id)), [flow, parsed]);
  const p = usePlayer(flow.steps.length, 2600);
  const step = flow.steps[p.current]!;
  const m = parsed[p.current]!.msg;
  const sdpO = m?.body.split('\r\n').find(l => l.startsWith('o='));

  return (
    <figure className="stage dtable" tabIndex={0} onKeyDown={p.onKey} aria-label="Live dialog table">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Live dialog table</p>
          <p className="stage-title">{flow.title}</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><span className="eg-g st-added">+</span>New dialog</li>
          <li><span className="eg-g st-changed">~</span>Changed at this step</li>
        </ul>
      </header>

      <div className="dt-main">
        <div className="dt-left">
          <div className="stage-ladder dt-ladder"><Ladder flow={flow} current={p.current} onSelect={p.go} compact /></div>
          <div className="stage-caption" aria-live="polite">
            <span className="cap-num">{String(p.current + 1).padStart(2, '0')}<span>/{flow.steps.length}</span></span>
            <div><p className="cap-text">{step.caption}</p></div>
          </div>
          <PlayerControls p={p} />
          {m && (
            <dl className="dt-layers" aria-label="What this message belongs to">
              <dt>Call</dt><dd>Call-ID <code>{getHeader(m, 'Call-ID')}</code></dd>
              <dt>Session</dt><dd>{sdpO ? <>SDP <code>{sdpO}</code></> : <span className="dt-none">no SDP in this message</span>}</dd>
              <dt>Dialog</dt><dd>From tag <code>{tagOf(m, 'From') ?? '—'}</code> · To tag <code>{tagOf(m, 'To') ?? '— (none yet)'}</code></dd>
              <dt>Transaction</dt><dd>branch <code>{topVia(m)?.branch}</code> · {cseq(m)?.method}</dd>
            </dl>
          )}
        </div>

        <div className="dt-sides">
          {uas.map((u, ui) => {
            const snap = tracks[ui]![p.current]!;
            return (
              <section key={u.id} className="dt-side" aria-label={`${u.label}: dialog state`}>
                <p className="dt-who">{u.label}<span>{snap.dialogs.length === 1 ? '1 dialog' : `${snap.dialogs.length} dialogs`}</span></p>
                {!snap.dialogs.length && <p className="dt-empty">No dialog yet. A dialog starts with a 101–199 response that has a To tag, or with a 2xx.</p>}
                {snap.dialogs.map(d => {
                  const ch = snap.changed[dialogKey(d)] ?? [];
                  const isNew = ch.includes('new');
                  return (
                    <table key={dialogKey(d)} className={`dt-dialog is-${d.state}`}>
                      <tbody>
                        {ROWS.map(r => {
                          const mark = isNew ? '+' : ch.includes(r.f as DialogField) ? '~' : '';
                          return (
                            <tr key={r.f} className={mark ? 'is-changed' : ''}>
                              <th scope="row">{r.label}</th>
                              <td>
                                {mark && <span className="dt-mark" aria-label={isNew ? 'new' : 'changed'}>{mark}</span>}
                                {r.f === 'state' ? <span className={`dt-state is-${d.state}`}>{d.state}</span>
                                  : r.show(d).split('\n').map((x, i) => <Fragment key={i}>{i > 0 && <br />}{x}</Fragment>)}
                                {r.f === 'state' && d.note && <span className="dt-note">{d.note}</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  );
                })}
              </section>
            );
          })}
        </div>
      </div>
    </figure>
  );
}
