/**
 * Attack surface map (Module 14): atlanta.example's network, with each attack
 * drawn as a coral path from the attacker to what it hits. Turn on a defence
 * and the paths it closes turn grey. The model is src/sip/attacks.ts.
 */
import { useMemo, useState } from 'react';
import { ATTACKS, attackStates, DEFENCES, type DefenceId } from '../sip/attacks.ts';
import { quoteSource } from '../lib/rfc-ref.ts';
import type { ClientQuote } from './types.ts';

interface Props { quotes: Record<string, ClientQuote> }

const W = 1000, H = 500;
const NODES: Record<string, { x: number; y: number; label: string; sub: string }> = {
  attacker: { x: 130, y: 110, label: 'Attacker', sub: 'on the Internet' },
  alice: { x: 130, y: 390, label: 'Alice', sub: 'phone, home Wi-Fi' },
  sbc: { x: 430, y: 250, label: 'SBC', sub: 'the edge' },
  proxyA: { x: 660, y: 160, label: 'Proxy A', sub: 'proxy.atlanta.example' },
  registrar: { x: 660, y: 360, label: 'Registrar', sub: 'atlanta.example' },
  carrier: { x: 890, y: 160, label: 'Carrier gateway', sub: 'SIP trunk' },
};
const LINKS: Record<string, [string, string, number]> = {
  access: ['alice', 'sbc', -10],
  media: ['alice', 'sbc', 14],
  inner1: ['sbc', 'proxyA', 0],
  inner2: ['sbc', 'registrar', 0],
  trunk: ['proxyA', 'carrier', 0],
};
const BW = 176, BH = 54;

function point(id: string): [number, number] {
  const n = NODES[id];
  if (n) return [n.x, n.y];
  const [a, b, off] = LINKS[id]!;
  const A = NODES[a]!, B = NODES[b]!;
  return [(A.x + B.x) / 2, (A.y + B.y) / 2 + off];
}

/** A path through the points; k bends it a little so parallel attacks stay apart. */
function pathOf(ids: string[], k: number): string {
  const pts = ids.map(point);
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!, [x1, y1] = pts[i]!;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const bend = k * 14;
    d += ` Q${mx - ((y1 - y0) / len) * bend},${my + ((x1 - x0) / len) * bend} ${x1},${y1}`;
  }
  return d;
}

const PRESETS: { label: string; on: DefenceId[] }[] = [
  { label: 'No defences', on: [] },
  { label: 'TLS only', on: ['tls'] },
  { label: 'All defences', on: DEFENCES.map(d => d.id) },
];

export default function AttackMap({ quotes }: Props) {
  const [on, setOn] = useState<Set<DefenceId>>(new Set());
  const [sel, setSel] = useState(ATTACKS[0]!.id);
  const states = useMemo(() => attackStates(on), [on]);
  const open = ATTACKS.filter(a => states[a.id]!.open).length;
  const attack = ATTACKS.find(a => a.id === sel)!;
  const st = states[sel]!;
  const quote = quotes[attack.rfc];
  const label = (d: DefenceId) => DEFENCES.find(x => x.id === d)!.label;
  const toggle = (d: DefenceId) => setOn(s => { const n = new Set(s); if (n.has(d)) n.delete(d); else n.add(d); return n; });

  const closers = (a: (typeof ATTACKS)[number]): string =>
    a.needs ? `needs a stolen password: ${a.needs.map(n => ATTACKS.find(x => x.id === n)!.name.toLowerCase()).join(' or ')}`
      : a.closedBy.map(set => set.map(label).join(' + ')).join(', or ');

  return (
    <figure className="stage amap" aria-label="Attack surface map">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Attack surface map</p>
          <p className="stage-title">What an attacker can reach in atlanta.example</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><i className="lg-sip" />SIP</li>
          <li><i className="lg-rtp" />RTP</li>
          <li><i className="lg-err" />Open attack</li>
          <li><i className="am-lg-closed" />Closed</li>
        </ul>
      </header>

      <div className="am-controls">
        <div className="seg am-presets" role="group" aria-label="Presets">
          {PRESETS.map(p => <button key={p.label} type="button" aria-pressed={p.on.length === on.size && p.on.every(d => on.has(d))} onClick={() => setOn(new Set(p.on))}>{p.label}</button>)}
        </div>
        <div className="am-defs" role="group" aria-label="Defences">
          {DEFENCES.map(d => (
            <button key={d.id} type="button" className="rl-toggle am-def" aria-pressed={on.has(d.id)} onClick={() => toggle(d.id)} title={d.detail}>
              <span aria-hidden="true">{on.has(d.id) ? '●' : '○'}</span>{d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="am-map">
        <svg className="am-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${open} of ${ATTACKS.length} attacks open`}>
          <defs>
            <marker id="am-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--err)" /></marker>
          </defs>
          <g className="am-zones">
            <rect x="16" y="20" width="290" height="460" rx="10" /><text x="32" y="46">Internet</text>
            <rect x="350" y="20" width="420" height="460" rx="10" /><text x="366" y="46">atlanta.example</text>
            <rect x="790" y="20" width="194" height="460" rx="10" /><text x="806" y="46">Carrier</text>
          </g>
          {Object.entries(LINKS).map(([id, [a, b, off]]) => {
            const A = NODES[a]!, B = NODES[b]!;
            return <line key={id} className={`am-link k-${id === 'media' ? 'rtp' : 'sip'}`} x1={A.x} y1={A.y + off} x2={B.x} y2={B.y + off} />;
          })}
          {ATTACKS.map((a, i) => {
            const s = states[a.id]!;
            return (
              <path key={a.id} d={pathOf(a.path, (i % 5) - 2)}
                className={`am-path${s.open ? ' is-open' : ' is-closed'}${a.id === sel ? ' is-sel' : ''}`}
                markerEnd={s.open ? 'url(#am-arrow)' : undefined}
                onClick={() => setSel(a.id)} />
            );
          })}
          {Object.entries(NODES).map(([id, n]) => (
            <g key={id} className={`am-node${id === 'attacker' ? ' is-attacker' : ''}`} transform={`translate(${n.x - BW / 2},${n.y - BH / 2})`}>
              <rect width={BW} height={BH} rx="7" />
              <text x={BW / 2} y="23" textAnchor="middle">{n.label}</text>
              <text className="am-sub" x={BW / 2} y="41" textAnchor="middle">{n.sub}</text>
            </g>
          ))}
          {DEFENCES.filter(d => on.has(d.id)).map(d => {
            const same = DEFENCES.filter(x => on.has(x.id) && x.at === d.at);
            const [x, y] = point(d.at);
            const k = same.indexOf(d);
            const isNode = !!NODES[d.at];
            return (
              <g key={d.id} className="am-shield" transform={`translate(${x - 80},${y + (isNode ? BH / 2 + 6 : 12) + k * 22})`}>
                <rect width="160" height="19" rx="4" />
                <text x="80" y="13.5" textAnchor="middle">✓ {d.label}</text>
              </g>
            );
          })}
        </svg>
        <p className={`am-count${open ? ' is-bad' : ''}`}><b>{open}</b> of {ATTACKS.length} attacks open</p>
      </div>

      <div className="am-bottom">
        <ol className="am-list">
          {ATTACKS.map(a => {
            const s = states[a.id]!;
            return (
              <li key={a.id}>
                <button type="button" className={`am-item${s.open ? ' is-open' : ''}${a.id === sel ? ' is-sel' : ''}`} onClick={() => setSel(a.id)} aria-pressed={a.id === sel}>
                  <span>{a.name}</span><em>{s.open ? 'Open' : 'Closed'}</em>
                </button>
              </li>
            );
          })}
        </ol>
        <section className={`am-detail${st.open ? ' is-open' : ''}`} aria-live="polite">
          <p className="am-dtitle">{attack.name}<span>{st.open ? 'Open' : `Closed by ${st.closedBy!.map(label).join(' + ')}`}</span></p>
          <dl>
            <dt>The attacker</dt><dd>{attack.how}</dd>
            <dt>The cost</dt><dd>{attack.impact}</dd>
            <dt>Closed by</dt><dd>{closers(attack)}</dd>
          </dl>
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
