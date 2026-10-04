/**
 * Forking tree (Module 9.5): Proxy B forks one INVITE to Bob's devices. Step
 * through the call and watch each branch ring, answer, or end, and watch
 * Alice's early dialogs appear, become confirmed, or end.
 */
import { useMemo, useState } from 'react';
import { PlayerControls, usePlayer } from './player.tsx';
import { safeParse } from './diff.ts';
import { trackDialogs } from '../sip/dialog.ts';
import { cseq, isResponse, tagOf, type SipMessage } from '../sip/parse.ts';
import type { ClientFlow } from './types.ts';

interface Props { flows: ClientFlow[]; labels: string[] }

type Branch = 'idle' | 'trying' | 'ringing' | 'answered' | 'in call' | 'cancelling' | 'cancelled' | 'ending' | 'ended';

/** The state of the branch between the proxy and one device, after a message on that branch. */
function nextBranch(b: Branch, m: SipMessage): Branch {
  const c = cseq(m);
  if (m.kind === 'request') {
    if (m.method === 'INVITE') return 'trying';
    if (m.method === 'CANCEL') return 'cancelling';
    if (m.method === 'ACK') return b === 'answered' ? 'in call' : b;
    if (m.method === 'BYE') return 'ending';
    return b;
  }
  if (c?.method === 'INVITE') {
    if (m.status! >= 180 && m.status! < 200) return 'ringing';
    if (m.status! >= 200 && m.status! < 300) return 'answered';
    if (m.status! >= 300) return 'cancelled';
  }
  if (c?.method === 'BYE' && isResponse(m, 2)) return 'ended';
  return b;
}

const W = 760, H = 320;

export default function ForkingTree({ flows, labels }: Props) {
  const [fi, setFi] = useState(0);
  const flow = flows[fi]!;
  const parsed = useMemo(() => flow.steps.map(s => ({ from: s.from, to: s.to, msg: safeParse(s.wire) })), [flow]);
  const alice = useMemo(() => trackDialogs(parsed, 'alice'), [parsed]);
  const p = usePlayer(flow.steps.length, 2200);
  const cur = Math.min(p.current, flow.steps.length - 1);
  const step = flow.steps[cur]!;
  const devices = flow.lanes.filter(l => l.kind === 'ua' && l.id !== 'alice');

  const branches = useMemo(() => {
    const st: Record<string, Branch> = Object.fromEntries(devices.map(d => [d.id, 'idle']));
    const tags: Record<string, string> = {};
    for (let i = 0; i <= cur; i++) {
      const s = parsed[i]!;
      const d = devices.find(x => x.id === s.from || x.id === s.to);
      if (!d || !s.msg) continue;
      st[d.id] = nextBranch(st[d.id]!, s.msg);
      const t = tagOf(s.msg, 'To');
      if (t && s.from === d.id) tags[d.id] = t;
    }
    return { st, tags };
  }, [cur, parsed, devices]);

  const dialogs = alice[cur]!.dialogs;
  const pos: Record<string, [number, number]> = { alice: [96, H / 2], proxyB: [340, H / 2] };
  devices.forEach((d, i) => { pos[d.id] = [636, devices.length === 3 ? 62 + i * 98 : 105 + i * 110]; });
  const edgeOf = (a: string, b: string) => [a, b].sort().join('|');
  const active = edgeOf(step.from, step.to);
  const direct = !pos[step.from] || !pos[step.to] ? false : !(step.from === 'proxyB' || step.to === 'proxyB');
  const proto = /^[3-6]\d\d/.test(step.label) ? 'err' : 'sip';
  const edges: [string, string][] = [['alice', 'proxyB'], ...devices.map(d => ['proxyB', d.id] as [string, string])];

  const pick = (i: number) => { setFi(i); p.go(0); };

  return (
    <figure className="stage ftree" tabIndex={0} onKeyDown={p.onKey} aria-label="Forking tree">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Forking tree</p>
          <p className="stage-title">{flow.title}</p>
        </div>
        <div className="seg" role="group" aria-label="Scenario">
          {labels.map((l, i) => <button key={l} type="button" aria-pressed={fi === i} onClick={() => pick(i)}>{l}</button>)}
        </div>
      </header>

      <div className="ft-main">
        <div className="ft-svgwrap">
        <svg className="ft-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Step ${cur + 1}: ${step.label}, ${step.from} to ${step.to}`}>
          <defs>
            {(['sip', 'err'] as const).map(pr => (
              <marker key={pr} id={`ft-mk-${pr}`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="8" markerHeight="8" orient="auto">
                <path d="M0 0 L10 5 L0 10 z" style={{ fill: `var(--${pr})` }} />
              </marker>
            ))}
          </defs>
          {edges.map(([a, b]) => {
            const [x1, y1] = pos[a]!, [x2, y2] = pos[b]!;
            const dev = b !== 'proxyB' ? b : undefined;
            const done = dev && ['cancelled', 'ended'].includes(branches.st[dev]!);
            return <line key={a + b} className={`ft-edge${done ? ' is-done' : ''}`} x1={x1} y1={y1} x2={x2} y2={y2} />;
          })}
          {/* The current message travels along its edge. */}
          {(() => {
            const a = pos[step.from], b = pos[step.to];
            if (!a || !b) return null;
            const on = edges.some(([x, y]) => edgeOf(x, y) === active);
            const [x1, y1] = a, [x2, y2] = b;
            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
            return (
              <g className="ft-msg" key={cur}>
                <path d={`M${x1} ${y1} L${x2} ${y2}`} className={`ft-wire${on ? '' : ' is-direct'}`} style={{ stroke: `var(--${proto})` }} />
                <path d={`M${x1 + (x2 - x1) * 0.5} ${y1 + (y2 - y1) * 0.5} L${x1 + (x2 - x1) * 0.56} ${y1 + (y2 - y1) * 0.56}`} markerEnd={`url(#ft-mk-${proto})`} style={{ stroke: 'none' }} />
                <text x={mx} y={my - 10} textAnchor="middle" className="ft-label">{step.label}</text>
                {direct && <text x={mx} y={my + 18} textAnchor="middle" className="ft-sub">direct</text>}
              </g>
            );
          })()}
          <g className="ft-node is-ua"><rect x={36} y={H / 2 - 24} width={120} height={48} rx={14} /><text x={96} y={H / 2 + 5} textAnchor="middle">Alice</text></g>
          <g className="ft-node"><rect x={280} y={H / 2 - 24} width={120} height={48} rx={3} /><text x={340} y={H / 2 - 2} textAnchor="middle">Proxy B</text><text className="ft-sub" x={340} y={H / 2 + 14} textAnchor="middle">forks</text></g>
          {devices.map(d => {
            const [x, y] = pos[d.id]!;
            const b = branches.st[d.id]!;
            return (
              <g key={d.id} className={`ft-node is-ua b-${b.replace(' ', '-')}`}>
                <rect x={x - 96} y={y - 31} width={192} height={62} rx={14} />
                <text x={x} y={y - 10} textAnchor="middle">{d.label}</text>
                <text className="ft-sub" x={x} y={y + 7} textAnchor="middle">{branches.tags[d.id] ? `tag ${branches.tags[d.id]}` : 'no tag yet'}</text>
                <text className="ft-branch" x={x} y={y + 23} textAnchor="middle">{b}</text>
              </g>
            );
          })}
        </svg>
        </div>

        <div className="ft-side">
          <div className="stage-caption" aria-live="polite">
            <span className="cap-num">{String(cur + 1).padStart(2, '0')}<span>/{flow.steps.length}</span></span>
            <div>
              <p className="cap-text">{step.caption}</p>
              {step.warn && <p className="cap-warn">⚠ {step.warn}</p>}
            </div>
          </div>
          <PlayerControls p={p} />
          <p className="eyebrow ft-dtitle">Alice’s dialogs</p>
          {dialogs.length ? (
            <table className="ft-dialogs">
              <thead><tr><th scope="col">Remote tag</th><th scope="col">Device</th><th scope="col">State</th></tr></thead>
              <tbody>
                {dialogs.map(d => {
                  const dev = devices.find(x => branches.tags[x.id] === d.remoteTag);
                  const isNew = alice[cur]!.changed[`${d.callId};${d.localTag};${d.remoteTag}`];
                  return (
                    <tr key={d.remoteTag} className={isNew ? 'is-changed' : ''}>
                      <td><code>{d.remoteTag}</code></td>
                      <td>{dev?.label ?? '—'}</td>
                      <td><span className={`dt-state is-${d.state}`}>{d.state}</span>{d.note && <span className="dt-note">{d.note}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <p className="dt-empty">No dialog yet: no response with a To tag has reached Alice.</p>}
        </div>
      </div>
    </figure>
  );
}
