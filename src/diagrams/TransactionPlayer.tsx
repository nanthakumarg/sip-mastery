/**
 * Transaction player (Module 8): the client and server state machines of
 * RFC 3261 §17 beside a ladder of one hop. Pick a request, a final response,
 * and a transport; then lose any message and watch the timers fire and the
 * retransmissions start. The simulation is in src/sip/transaction.ts.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { PlayerControls, usePlayer } from './player.tsx';
import { secs, simulate, type Side, type SimRow } from '../sip/transaction.ts';

// ---------- State machine diagrams ----------

type Route = 'down' | 'left1' | 'left2' | 'right1' | 'right2' | 'elbow';
interface MNode { id: string; x: number; y: number; loops?: string }
interface MEdge { from: string; to: string; on: string; route: Route }
interface Machine { title: string; nodes: MNode[]; edges: MEdge[] }

const W = 340, H = 316, NW = 100, NH = 30, CX = 150, SX = 282;
const col = (id: string, row: number, loops?: string): MNode => ({ id, x: CX, y: 28 + row * 82 + (row === 3 ? 18 : 0), loops });

function machine(kind: 'invite' | 'non-invite', side: Side, rfc6026: boolean): Machine {
  if (kind === 'invite' && side === 'client') {
    const nodes = [col('Calling', 0, 'Timer A: send again'), col('Proceeding', 1, '1xx: pass to TU'), col('Completed', 2, 'copy of 300–699: ACK again'), col('Terminated', 3)];
    const edges: MEdge[] = [
      { from: 'Calling', to: 'Proceeding', on: '1xx', route: 'down' },
      { from: 'Proceeding', to: 'Completed', on: '300–699', route: 'down' },
      { from: 'Calling', to: 'Completed', on: '300–699', route: 'left1' },
      { from: 'Completed', to: 'Terminated', on: 'Timer D', route: 'down' },
      { from: 'Calling', to: 'Terminated', on: 'Timer B', route: 'left2' },
    ];
    if (rfc6026) {
      nodes.push({ id: 'Accepted', x: SX, y: 192, loops: '2xx: pass to TU' });
      edges.push({ from: 'Calling', to: 'Accepted', on: '2xx', route: 'elbow' }, { from: 'Proceeding', to: 'Accepted', on: '2xx', route: 'elbow' }, { from: 'Accepted', to: 'Terminated', on: 'Timer M', route: 'elbow' });
    } else {
      edges.push({ from: 'Calling', to: 'Terminated', on: '2xx', route: 'right2' }, { from: 'Proceeding', to: 'Terminated', on: '2xx', route: 'right1' });
    }
    return { title: 'INVITE client transaction', nodes, edges };
  }
  if (kind === 'invite') {
    const nodes = [col('Proceeding', 0, 'INVITE again: send 1xx again'), col('Completed', 1, 'Timer G: send again'), col('Confirmed', 2, 'ACK again: absorb'), col('Terminated', 3)];
    const edges: MEdge[] = [
      { from: 'Proceeding', to: 'Completed', on: '300–699', route: 'down' },
      { from: 'Completed', to: 'Confirmed', on: 'ACK', route: 'down' },
      { from: 'Confirmed', to: 'Terminated', on: 'Timer I', route: 'down' },
      { from: 'Completed', to: 'Terminated', on: 'Timer H', route: 'left1' },
    ];
    if (rfc6026) {
      nodes.push({ id: 'Accepted', x: SX, y: 150, loops: 'INVITE again: absorb' });
      edges.push({ from: 'Proceeding', to: 'Accepted', on: '2xx', route: 'elbow' }, { from: 'Accepted', to: 'Terminated', on: 'Timer L', route: 'elbow' });
    } else {
      edges.push({ from: 'Proceeding', to: 'Terminated', on: '2xx', route: 'right2' });
    }
    return { title: 'INVITE server transaction', nodes, edges };
  }
  if (side === 'client') {
    return {
      title: 'Non-INVITE client transaction',
      nodes: [col('Trying', 0, 'Timer E: send again'), col('Proceeding', 1, 'Timer E: send again'), col('Completed', 2, 'copy of final: absorb'), col('Terminated', 3)],
      edges: [
        { from: 'Trying', to: 'Proceeding', on: '1xx', route: 'down' },
        { from: 'Proceeding', to: 'Completed', on: '200–699', route: 'down' },
        { from: 'Trying', to: 'Completed', on: '200–699', route: 'left1' },
        { from: 'Completed', to: 'Terminated', on: 'Timer K', route: 'down' },
        { from: 'Trying', to: 'Terminated', on: 'Timer F', route: 'right2' },
        { from: 'Proceeding', to: 'Terminated', on: 'Timer F', route: 'right1' },
      ],
    };
  }
  return {
    title: 'Non-INVITE server transaction',
    nodes: [col('Trying', 0, 'request again: absorb'), col('Proceeding', 1, 'request again: send 1xx again'), col('Completed', 2, 'request again: send final again'), col('Terminated', 3)],
    edges: [
      { from: 'Trying', to: 'Proceeding', on: '1xx from TU', route: 'down' },
      { from: 'Proceeding', to: 'Completed', on: '200–699', route: 'down' },
      { from: 'Trying', to: 'Completed', on: '200–699', route: 'left1' },
      { from: 'Completed', to: 'Terminated', on: 'Timer J', route: 'down' },
    ],
  };
}

/** SVG path and label position for one edge. */
function edgePath(m: Machine, e: MEdge): { d: string; lx: number; ly: number; anchor: 'start' | 'middle' | 'end' } {
  const a = m.nodes.find(n => n.id === e.from)!, b = m.nodes.find(n => n.id === e.to)!;
  const hw = NW / 2, hh = NH / 2;
  const my = (a.y + b.y) / 2;
  switch (e.route) {
    case 'down': return { d: `M${a.x} ${a.y + hh} V${b.y - hh - 2}`, lx: a.x + 7, ly: my + 4, anchor: 'start' };
    case 'left1': case 'left2': {
      const k = e.route === 'left1' ? 40 : 88;
      const x = a.x - hw;
      return { d: `M${x} ${a.y} C${x - k} ${a.y} ${x - k} ${b.y} ${x - 4} ${b.y}`, lx: x - k * 0.75, ly: my + 4, anchor: 'middle' };
    }
    case 'right1': case 'right2': {
      const k = e.route === 'right1' ? 40 : 88;
      const x = a.x + hw;
      return { d: `M${x} ${a.y} C${x + k} ${a.y} ${x + k} ${b.y} ${x + 4} ${b.y}`, lx: x + k * 0.75, ly: my + 4, anchor: 'middle' };
    }
    case 'elbow':
      if (b.x > a.x) return { d: `M${a.x + hw} ${a.y} H${b.x} V${b.y - hh - 2}`, lx: (a.x + hw + b.x) / 2 + 6, ly: a.y - 6, anchor: 'middle' };
      return { d: `M${a.x} ${a.y + hh} V${b.y} H${b.x + hw + 4}`, lx: a.x - 6, ly: (a.y + hh + b.y) / 2 + 4, anchor: 'end' };
  }
}

function StateDiagram({ m, state, moves, side }: { m: Machine; state: string; moves: SimRow['moves']; side: Side }) {
  const mine = moves.filter(x => x.side === side);
  const taken = (e: MEdge) => mine.some(x => x.from === e.from && x.to === e.to);
  const looped = (n: MNode) => mine.some(x => x.from === n.id && x.to === n.id);
  return (
    <svg className="tp-machine" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${m.title}: state ${state === '—' ? 'not created' : state}`}>
      <defs>
        <marker id={`tp-arr-${side}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" className="tp-arrowhead" />
        </marker>
        <marker id={`tp-arr-${side}-on`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" className="tp-arrowhead is-on" />
        </marker>
      </defs>
      {m.edges.map(e => {
        const p = edgePath(m, e);
        const on = taken(e);
        return (
          <g key={`${e.from}-${e.to}-${e.on}`} className={`tp-edge${on ? ' is-on' : ''}`}>
            <path d={p.d} markerEnd={`url(#tp-arr-${side}${on ? '-on' : ''})`} />
            <text x={p.lx} y={p.ly} textAnchor={p.anchor}>{e.on}</text>
          </g>
        );
      })}
      {m.nodes.map(n => {
        const cur = n.id === state;
        return (
          <g key={n.id} className={`tp-node${cur ? ' is-cur' : ''}${n.id === 'Terminated' ? ' is-end' : ''}${n.id === 'Accepted' ? ' is-6026' : ''}`}>
            <rect x={n.x - NW / 2} y={n.y - NH / 2} width={NW} height={NH} rx={n.id === 'Terminated' ? 15 : 4} />
            <text x={n.x} y={n.y + 4.5} textAnchor="middle">{n.id}</text>
            {n.loops && <text className={`tp-loop${cur && looped(n) ? ' is-on' : ''}`} x={n.x + NW / 2 + 3} y={n.y - NH / 2 + 3}><title>{`Stays in ${n.id}: ${n.loops}`}</title>↻</text>}
          </g>
        );
      })}
    </svg>
  );
}

// ---------- One-hop ladder ----------

const LX = { client: 128, server: 348 } as const;
const LW = 420, ROW = 34, TOP = 58;

function OneHop({ rows, current, onSelect }: { rows: SimRow[]; current: number; onSelect: (i: number) => void }) {
  const height = TOP + rows.length * ROW + 10;
  return (
    <svg className="tp-ladder" viewBox={`0 0 ${LW} ${height}`} role="img" aria-label={`One hop, step ${current + 1} of ${rows.length}`}>
      <defs>
        {(['sip', 'err'] as const).map(p => (
          <marker key={p} id={`tp-mk-${p}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" style={{ fill: `var(--${p})` }} />
          </marker>
        ))}
      </defs>
      {(['client', 'server'] as const).map(s => (
        <g key={s} className="tp-lane">
          <line x1={LX[s]} y1={44} x2={LX[s]} y2={height - 4} />
          <rect x={LX[s] - 66} y={2} width={132} height={40} rx={14} />
          <text className="tp-lane-label" x={LX[s]} y={20} textAnchor="middle">{s === 'client' ? 'Alice' : 'Bob'}</text>
          <text className="tp-lane-sub" x={LX[s]} y={34} textAnchor="middle">{s === 'client' ? 'client transaction' : 'server transaction'}</text>
        </g>
      ))}
      {rows.map((r, i) => {
        const y = TOP + i * ROW + ROW / 2;
        const st = i === current ? 'is-current' : i < current ? 'is-past' : 'is-future';
        const m = r.msg;
        const proto = m && /^[3-6]\d\d/.test(m.label) ? 'err' : 'sip';
        let wire = null;
        if (m) {
          const x1 = LX[m.from], x2 = LX[m.from === 'client' ? 'server' : 'client'];
          const dir = x2 > x1 ? 1 : -1;
          const end = m.lost ? x1 + (x2 - x1) * 0.62 : x2 - dir * 8;
          wire = (
            <>
              <path className="tp-wire" d={`M${x1 + dir * 3} ${y} H${end}`} style={{ stroke: `var(--${proto})` }} markerEnd={m.lost ? undefined : `url(#tp-mk-${proto})`} />
              {m.lost && <text className="tp-lost" x={end} y={y + 6} textAnchor="middle">✕</text>}
              <text className="tp-label" x={(LX.client + LX.server) / 2} y={y - 7} textAnchor="middle">
                {m.label}{m.retrans && <tspan className="tp-tag"> again</tspan>}{m.core && <tspan className="tp-tag"> · core</tspan>}
              </text>
            </>
          );
        }
        return (
          <g key={i} className={`tp-row ${st}`} onClick={() => onSelect(i)}>
            <rect className="tp-hit" x={0} y={y - ROW / 2} width={LW} height={ROW} />
            {i === current && <rect className="tp-band" x={2} y={y - ROW / 2 + 2} width={LW - 4} height={ROW - 4} rx={4} />}
            <text className="tp-time" x={6} y={y + 4}>{secs(r.t)}</text>
            {wire}
            {r.timer && (
              <g className="tp-timer">
                <circle cx={LX[r.timer.side]} cy={y} r={7} />
                <path d={`M${LX[r.timer.side]} ${y - 4} V${y} H${LX[r.timer.side] + 3}`} />
                {!m && <text x={LX[r.timer.side] + (r.timer.side === 'client' ? 14 : -14)} y={y + 4} textAnchor={r.timer.side === 'client' ? 'start' : 'end'}>{r.timer.name} fires</text>}
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ---------- Player ----------

type Loss = 'none' | 'down' | 'acks';
const LOSS: Record<Loss, string[]> = { none: [], down: ['server*'], acks: ['ACK*'] };

function Timers({ row, side }: { row: SimRow; side: Side }) {
  const list = row.timers.filter(t => t.side === side);
  return (
    <ul className="tp-timers" aria-label={`${side === 'client' ? 'Alice' : 'Bob'}: running timers`}>
      {list.length ? list.map(t => (
        <li key={t.name}><b>{t.name}</b> fires at {secs(t.at)} <span>in {secs(t.at - row.t)}</span></li>
      )) : <li className="tp-none">No timer runs.</li>}
    </ul>
  );
}

export default function TransactionPlayer() {
  const [kind, setKind] = useState<'invite' | 'non-invite'>('invite');
  const [final, setFinal] = useState(486);
  const [transport, setTransport] = useState<'udp' | 'tcp'>('udp');
  const [rfc6026, setRfc6026] = useState(true);
  const [slow, setSlow] = useState(false);
  const [loss, setLoss] = useState<Loss>('none');
  const [extra, setExtra] = useState<string[]>([]);

  const drop = useMemo(() => [...LOSS[loss], ...extra], [loss, extra]);
  const rows = useMemo(() => simulate({ kind, transport, final: kind === 'invite' ? final : 200, rfc6026, slow, drop }), [kind, transport, final, rfc6026, slow, drop]);
  const p = usePlayer(rows.length, 2200);
  const cur = Math.min(p.current, rows.length - 1);
  const row = rows[cur]!;

  // A new scenario starts at the first step; a lost message keeps its place.
  const reset = (f: () => void) => { f(); setExtra([]); p.go(0); };

  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const y = TOP + cur * ROW;
    const scale = box.clientWidth / LW;
    const top = y * scale, bottom = (y + ROW) * scale;
    if (top < box.scrollTop + 40 * scale || bottom > box.scrollTop + box.clientHeight - 10) {
      box.scrollTo({ top: Math.max(0, top - box.clientHeight / 2), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  }, [cur, rows]);

  const m = row.msg;
  const byPreset = m && (LOSS[loss].includes('server*') ? m.from === 'client' : LOSS[loss].includes(`${m.id.split('#')[0]}*`));
  const toggleLoss = () => {
    if (!m) return;
    setExtra(x => (x.includes(m.id) ? x.filter(y => y !== m.id) : [...x, m.id]));
  };

  return (
    <figure className="stage tplayer" tabIndex={0} onKeyDown={p.onKey} aria-label="Transaction player">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Transaction player</p>
          <p className="stage-title">One hop: two state machines and their timers</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><i className="lg-sip" />SIP</li>
          <li><i className="lg-err" />Failure response</li>
          <li><span className="lg-warn" style={{ color: 'var(--down)' }}>✕</span>Lost</li>
          <li><span className="tp-key-cur" />Current state</li>
        </ul>
      </header>

      <div className="tp-controls">
        <div className="seg" role="group" aria-label="Request">
          <button type="button" aria-pressed={kind === 'invite'} onClick={() => reset(() => setKind('invite'))}>INVITE</button>
          <button type="button" aria-pressed={kind === 'non-invite'} onClick={() => reset(() => setKind('non-invite'))}>OPTIONS</button>
        </div>
        {kind === 'invite' ? (
          <div className="seg" role="group" aria-label="Final response">
            <button type="button" aria-pressed={final === 486} onClick={() => reset(() => setFinal(486))}>486 Busy</button>
            <button type="button" aria-pressed={final === 200} onClick={() => reset(() => setFinal(200))}>200 OK</button>
          </div>
        ) : (
          <div className="seg" role="group" aria-label="Server speed">
            <button type="button" aria-pressed={!slow} onClick={() => reset(() => setSlow(false))}>Answers at once</button>
            <button type="button" aria-pressed={slow} onClick={() => reset(() => setSlow(true))}>Answers after 6 s</button>
          </div>
        )}
        <div className="seg" role="group" aria-label="Transport">
          <button type="button" aria-pressed={transport === 'udp'} onClick={() => reset(() => setTransport('udp'))}>UDP</button>
          <button type="button" aria-pressed={transport === 'tcp'} onClick={() => reset(() => setTransport('tcp'))}>TCP</button>
        </div>
        <div className="seg" role="group" aria-label="Network">
          <button type="button" aria-pressed={loss === 'none'} onClick={() => reset(() => setLoss('none'))}>Nothing lost</button>
          <button type="button" aria-pressed={loss === 'down'} onClick={() => reset(() => setLoss('down'))}>Bob is down</button>
          {kind === 'invite' && transport === 'udp' && <button type="button" aria-pressed={loss === 'acks'} onClick={() => reset(() => setLoss('acks'))}>Every ACK lost</button>}
        </div>
        {kind === 'invite' && (
          <label className="tp-check">
            <input type="checkbox" checked={rfc6026} onChange={e => reset(() => setRfc6026(e.target.checked))} /> RFC 6026 (Accepted state)
          </label>
        )}
      </div>

      <div className="tp-main">
        <div className="tp-side tp-client">
          <p className="tp-mtitle">Alice · {machine(kind, 'client', rfc6026).title}</p>
          <StateDiagram m={machine(kind, 'client', rfc6026)} state={row.client} moves={row.moves} side="client" />
          <Timers row={row} side="client" />
        </div>
        <div className="tp-center">
          <div className="tp-scroll" ref={scroller}>
            <OneHop rows={rows} current={cur} onSelect={p.go} />
          </div>
        </div>
        <div className="tp-side tp-server">
          <p className="tp-mtitle">Bob · {machine(kind, 'server', rfc6026).title}</p>
          <StateDiagram m={machine(kind, 'server', rfc6026)} state={row.server} moves={row.moves} side="server" />
          <Timers row={row} side="server" />
        </div>

        <div className="tp-panel">
          <div className="stage-caption tp-caption" aria-live="polite">
            <span className="cap-num">{secs(row.t)}<br /><span>{cur + 1}/{rows.length}</span></span>
            <div>
              <p className="cap-text">{row.text}</p>
              {row.moves.map((x, i) => (
                <p key={i} className="tp-move"><b>{x.side === 'client' ? 'Alice' : 'Bob'}</b>{x.from === x.to ? `stays in ${x.to}` : `${x.from === '—' ? 'new' : x.from} → ${x.to}`} <span>on {x.on}</span></p>
              ))}
              {m && (
                transport === 'tcp'
                  ? <p className="tp-hint">Over TCP, the transport delivers each message or reports an error. Nothing to lose here.</p>
                  : byPreset
                    ? <p className="tp-hint">The “{loss === 'down' ? 'Bob is down' : 'Every ACK lost'}” setting loses this message.</p>
                    : <button type="button" className="tp-lose" onClick={toggleLoss}>{m.lost ? `Deliver this ${m.label}` : `Lose this ${m.label}`}</button>
              )}
            </div>
          </div>
          <PlayerControls p={p} />
        </div>
      </div>
    </figure>
  );
}
