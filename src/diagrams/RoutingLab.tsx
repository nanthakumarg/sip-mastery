/**
 * Routing visualiser (Module 10.4): turn Record-Route and its lr on or off for
 * each proxy, and watch the path of the INVITE, of its 200 OK, and of a later
 * request: an ACK, a re-INVITE or BYE from either side, a CANCEL, or a BYE
 * after a target refresh. The call is built by src/sip/routing.ts, so every message on
 * screen follows RFC 3261 §12 and §16; tests/routing.test.ts lints all of them.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Inspector from './Inspector.tsx';
import Ladder, { ladderWidth } from './Ladder.tsx';
import { PlayerControls, usePlayer } from './player.tsx';
import { comparableIndex, safeParse } from './diff.ts';
import { toWire } from '../sip/flow.ts';
import { getHeaders } from '../sip/parse.ts';
import { callerOnly, trapezoidCall, type LaterRequest, type Party } from '../sip/routing.ts';
import type { ClientFlow, ClientQuote, ClientRef } from './types.ts';

interface Props { quotes: Record<string, ClientQuote>; refData: ClientRef }

const LATER: { id: LaterRequest; label: string }[] = [
  { id: 'ack', label: 'ACK' },
  { id: 'reinvite', label: 're-INVITE' },
  { id: 'bye', label: 'BYE' },
  { id: 'cancel', label: 'CANCEL' },
  { id: 'refresh', label: 'Target refresh' },
];
const PARTIES: { id: Party; label: string }[] = [{ id: 'alice', label: 'Alice' }, { id: 'bob', label: 'Bob' }];

const NODE_X: Record<string, number> = { alice: 90, proxyA: 320, proxyB: 550, bob: 780 };
const ORDER = ['alice', 'proxyA', 'proxyB', 'bob'];
const W = 870, STRIP = 114, NODE_W = 128, NODE_H = 40;

const short = (uri: string) => uri.replace(/^sip:/, '').replace(/;lr$/, '');

interface Strip { key: string; title: string; rule: string; steps: number[] }

export default function RoutingLab({ quotes, refData }: Props) {
  const [rrA, setRrA] = useState(true);
  const [rrB, setRrB] = useState(true);
  const [lrA, setLrA] = useState(true);
  const [lrB, setLrB] = useState(true);
  const [later, setLater] = useState<LaterRequest>('bye');
  const [sender, setSender] = useState<Party>('alice');
  const fixedSender = callerOnly(later);
  const by: Party = fixedSender ? 'alice' : sender;

  const call = useMemo(() => trapezoidCall({ rrA, rrB, lrA, lrB, later, by }), [rrA, rrB, lrA, lrB, later, by]);
  const flow: ClientFlow = useMemo(() => ({
    id: call.flow.id, title: call.flow.title, lanes: call.flow.lanes,
    steps: call.flow.steps.map((s, index) => ({
      index, kind: 'msg' as const, from: s.from, to: s.to, proto: 'sip' as const, label: s.label, caption: s.caption, rfc: s.rfc, wire: toWire(s.message!),
    })),
  }), [call]);

  const p = usePlayer(flow.steps.length, 2200, call.parts.later[0]);
  // A new call starts at the later request: that is the part that changes.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    p.go(call.parts.later[0]!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call]);
  const cur = Math.min(p.current, flow.steps.length - 1);
  const step = flow.steps[cur]!;
  const wires = useMemo(() => flow.steps.map(s => s.wire), [flow]);
  const prevIndex = comparableIndex(wires, cur);
  const laneLabel = (id: string) => flow.lanes.find(l => l.id === id)?.label ?? id;

  const strips: Strip[] = [
    { key: 'invite', title: 'INVITE', rule: 'Route, then Request-URI', steps: call.parts.invite },
    { key: 'answer', title: flow.steps[call.parts.answer[0]!]!.label, rule: 'Via, top first', steps: call.parts.answer },
    { key: 'later', title: call.focusTitle, rule: call.focusRule, steps: call.parts.focus },
  ];

  const hops = call.parts.focus.map(i => {
    const m = safeParse(flow.steps[i]!.wire)!;
    return { i, s: flow.steps[i]!, ruri: m.requestUri ?? '', route: getHeaders(m, 'Route').map(h => short(h.value.replace(/[<>]/g, ''))) };
  });

  return (
    <figure className="stage rlab" style={{ ['--lw' as string]: `${ladderWidth(4, true)}px` }} tabIndex={0} onKeyDown={p.onKey} aria-label="Routing visualiser">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Routing visualiser</p>
          <p className="stage-title">Who adds Record-Route decides who sees the rest of the call</p>
        </div>
      </header>

      <div className="rl-controls">
        <div className="rl-group" role="group" aria-label="Record-Route">
          <span className="rl-glabel">Adds Record-Route</span>
          <button type="button" className="rl-toggle" aria-pressed={rrA} onClick={() => setRrA(v => !v)}><span aria-hidden="true">{rrA ? '●' : '○'}</span>Proxy A</button>
          <button type="button" className="rl-toggle" aria-pressed={rrB} onClick={() => setRrB(v => !v)}><span aria-hidden="true">{rrB ? '●' : '○'}</span>Proxy B</button>
        </div>
        <div className="rl-group" role="group" aria-label="Record-Route has lr">
          <span className="rl-glabel">Record-Route has ;lr</span>
          <button type="button" className="rl-toggle" aria-pressed={lrA} disabled={!rrA} title={rrA ? undefined : 'Proxy A adds no Record-Route'} onClick={() => setLrA(v => !v)}><span aria-hidden="true">{lrA ? '●' : '○'}</span>Proxy A</button>
          <button type="button" className="rl-toggle" aria-pressed={lrB} disabled={!rrB} title={rrB ? undefined : 'Proxy B adds no Record-Route'} onClick={() => setLrB(v => !v)}><span aria-hidden="true">{lrB ? '●' : '○'}</span>Proxy B</button>
        </div>
        <div className="rl-group">
          <span className="rl-glabel">Later request</span>
          <div className="seg" role="group" aria-label="Later request">
            {LATER.map(l => <button key={l.id} type="button" aria-pressed={later === l.id} onClick={() => setLater(l.id)}>{l.label}</button>)}
          </div>
        </div>
        <div className="rl-group">
          <span className="rl-glabel">{later === 'refresh' ? 'Moves' : 'Sent by'}</span>
          <div className="seg" role="group" aria-label={later === 'refresh' ? 'Moves' : 'Sent by'}>
            {PARTIES.map(pt => <button key={pt.id} type="button" aria-pressed={by === pt.id} disabled={fixedSender} onClick={() => setSender(pt.id)}>{pt.label}</button>)}
          </div>
          {fixedSender && <span className="rl-note">only the caller sends it</span>}
        </div>
      </div>

      <div className="rl-top">
        <div className="rl-mapwrap">
          <svg className="rl-map" viewBox={`0 0 ${W} ${STRIP * 3 + 8}`} role="img"
            aria-label={strips.map(s => `${s.title}: ${s.steps.map(i => laneLabel(flow.steps[i]!.from)).concat(laneLabel(flow.steps[s.steps.at(-1)!]!.to)).join(' to ')}`).join('. ')}>
            <defs>
              <marker id="rl-mk" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" style={{ fill: 'var(--sip)' }} />
              </marker>
            </defs>
            {strips.map((s, si) => {
              const y0 = si * STRIP + 8;
              const cy = y0 + 72;
              const visited = new Set(s.steps.flatMap(i => [flow.steps[i]!.from, flow.steps[i]!.to]));
              const focus = s.steps.includes(cur);
              return (
                <g key={s.key} className={`rl-strip${focus ? ' is-focus' : ''}${s.key === 'later' ? ' is-later' : ''}`}>
                  <text className="rl-stitle" x={14} y={y0 + 14}>{s.title}<tspan className="rl-srule" dx={10}>follows {s.rule}</tspan></text>
                  {ORDER.map(id => {
                    const x = NODE_X[id]!;
                    const on = visited.has(id);
                    const ua = id === 'alice' || id === 'bob';
                    return (
                      <g key={id} className={`rl-node${on ? '' : ' is-skipped'}`}>
                        <rect x={x - NODE_W / 2} y={cy - NODE_H / 2} width={NODE_W} height={NODE_H} rx={ua ? 12 : 3} />
                        <text x={x} y={cy + 5} textAnchor="middle">{laneLabel(id)}</text>
                        {!on && <text className="rl-skip" x={x} y={cy + NODE_H / 2 + 14} textAnchor="middle">not in path</text>}
                      </g>
                    );
                  })}
                  {s.steps.map(i => {
                    const st = flow.steps[i]!;
                    const x1 = NODE_X[st.from]!, x2 = NODE_X[st.to]!;
                    const dir = Math.sign(x2 - x1);
                    const a = x1 + dir * NODE_W / 2, b = x2 - dir * (NODE_W / 2 + 2);
                    const span = Math.abs(ORDER.indexOf(st.to) - ORDER.indexOf(st.from));
                    const lift = span > 1 ? 24 + span * 4 : 0;
                    const d = span > 1
                      ? `M${x1 + dir * 30} ${cy - NODE_H / 2} C ${x1 + dir * 60} ${cy - NODE_H / 2 - lift}, ${x2 - dir * 60} ${cy - NODE_H / 2 - lift}, ${x2 - dir * 30} ${cy - NODE_H / 2 - 2}`
                      : `M${a} ${cy} L${b} ${cy}`;
                    return (
                      <path key={i} d={d} className={`rl-hop${i === cur ? ' is-cur' : ''}`} markerEnd="url(#rl-mk)"
                        onClick={() => p.go(i)}><title>{`${st.label}: ${laneLabel(st.from)} → ${laneLabel(st.to)}`}</title></path>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </div>

        <div className="rl-side">
          <div className="rl-sets">
            {(['alice', 'bob'] as const).map(ua => (
              <div key={ua} className="rl-set">
                <p className="rl-sname">{ua === 'alice' ? "Alice's route set" : "Bob's route set"}<span>{ua === 'alice' ? 'Record-Route, reversed' : 'Record-Route, in order'}{later === 'cancel' ? ', from the 180' : ''}</span></p>
                {call.routeSets[ua].length
                  ? <ol>{call.routeSets[ua].map(u => <li key={u}><code>{u}</code></li>)}</ol>
                  : <p className="rl-empty">empty: requests go straight to the remote target</p>}
              </div>
            ))}
          </div>
          {later === 'cancel' && <p className="rl-empty">The CANCEL does not use the route set of the early dialog.</p>}
          <table className="rl-hops">
            <caption>{call.focusTitle}, hop by hop</caption>
            <thead><tr><th scope="col">Hop</th><th scope="col">Request-URI</th><th scope="col">Route</th></tr></thead>
            <tbody>
              {hops.map(h => (
                <tr key={h.i} className={h.i === cur ? 'is-cur' : ''} onClick={() => p.go(h.i)}>
                  <th scope="row"><button type="button" onClick={() => p.go(h.i)}>{laneLabel(h.s.from)} → {laneLabel(h.s.to)}</button></th>
                  <td><code>{short(h.ruri)}</code></td>
                  <td>{h.route.length ? h.route.map(r => <code key={r}>{r}</code>) : <span className="rl-none">none</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="stage-main rl-main">
        <div className="stage-left">
          <div className="stage-ladder rl-ladder"><Ladder flow={flow} current={cur} onSelect={p.go} compact /></div>
          <div className="stage-caption" aria-live="polite">
            <span className="cap-num">{String(cur + 1).padStart(2, '0')}<span>/{String(flow.steps.length).padStart(2, '0')}</span></span>
            <div><p className="cap-text">{step.caption}</p></div>
          </div>
          <PlayerControls p={p} />
        </div>
        <aside className="stage-inspector">
          <Inspector key={`${flow.id}-${cur}`} step={step} prev={prevIndex >= 0 ? flow.steps[prevIndex] : undefined}
            laneLabel={laneLabel} quote={step.rfc ? quotes[step.rfc] : undefined} refData={refData} />
        </aside>
      </div>
    </figure>
  );
}
