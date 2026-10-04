/**
 * Element gallery (Module 3): one card per SIP element. Each card shows the
 * message the element receives, the message it sends, and the line-by-line
 * changes between them — what this kind of element may and may not change.
 */
import { useRef, useState, type KeyboardEvent } from 'react';
import Inspector, { markKeywords } from './Inspector.tsx';
import { safeParse } from './diff.ts';
import type { ClientFlow, ClientQuote, ClientRef } from './types.ts';

export interface GalleryCard {
  id: string;
  name: string;
  short: string;
  kind: string;
  flow: string;
  in: number;
  out: number;
  role: string;
  state: string;
  media: string;
  changes: string[];
  keeps: string[];
  examples: string;
  quote: string;
}

interface Props {
  cards: GalleryCard[];
  flows: Record<string, ClientFlow>;
  refData: ClientRef;
  quotes: Record<string, ClientQuote>;
  initial?: string;
}

const GLYPH_STATE: Record<string, string> = { '+': 'added', '~': 'changed', '−': 'removed' };

function Shape({ kind, x, y, w, h, active }: { kind: string; x: number; y: number; w: number; h: number; active?: boolean }) {
  const double = kind === 'b2bua' || kind === 'sbc';
  return (
    <g className={`eg-shape${active ? ' is-active' : ''}`}>
      <rect className="eg-box" x={x} y={y} width={w} height={h} rx={kind === 'ua' ? 14 : 3} />
      {double && <rect className="eg-box-inner" x={x + 4} y={y + 4} width={w - 8} height={h - 8} rx={2} />}
    </g>
  );
}

function Icon({ kind }: { kind: string }) {
  return (
    <svg className="eg-icon" viewBox="0 0 40 26" aria-hidden="true">
      <Shape kind={kind} x={2} y={2} w={36} h={22} />
    </svg>
  );
}

export default function ElementGallery({ cards, flows, refData, quotes, initial }: Props) {
  const [id, setId] = useState(initial ?? cards[0]!.id);
  const [view, setView] = useState<'in' | 'out'>('out');
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const card = cards.find(c => c.id === id)!;
  const flow = flows[card.flow]!;
  const inStep = flow.steps[card.in - 1]!;
  const outStep = flow.steps[card.out - 1]!;
  const laneLabel = (lane: string) => flow.lanes.find(l => l.id === lane)?.label ?? lane;
  const lane = (lane: string) => flow.lanes.find(l => l.id === lane)!;

  const a = safeParse(inStep.wire);
  const b = safeParse(outStep.wire);
  const comparable = a?.kind === 'request' && b?.kind === 'request' && a.method === b.method;
  const step = view === 'out' ? outStep : inStep;
  const quote = quotes[card.quote];

  const select = (i: number) => {
    const c = cards[(i + cards.length) % cards.length]!;
    setId(c.id);
    setView('out');
    tabs.current[(i + cards.length) % cards.length]?.focus();
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); select(i + 1); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); select(i - 1); }
  };

  // Mini topology: upstream → element → downstream, or upstream ⇄ element when the element answers.
  const back = outStep.to === inStep.from;
  const W = 640, BW = 132, BH = 52;
  const CY = back ? 75 : 84;
  const H = back ? 156 : 124;
  const nodes = back
    ? [{ id: inStep.from, x: 140 }, { id: inStep.to, x: 500 }]
    : [{ id: inStep.from, x: 90 }, { id: inStep.to, x: 320 }, { id: outStep.to, x: 550 }];
  const X = Object.fromEntries(nodes.map(n => [n.id, n.x]));
  const top = CY - BH / 2, bottom = CY + BH / 2;
  const arrows = [inStep, outStep].map((s, k) => {
    const which = k === 0 ? 'in' as const : 'out' as const;
    const x1 = X[s.from]!, x2 = X[s.to]!;
    const dir = x2 > x1 ? 1 : -1;
    const mid = (x1 + x2) / 2;
    if (!back) {
      return { which, s, d: `M${x1 + dir * (BW / 2 + 3)} ${CY} H${x2 - dir * (BW / 2 + 5)}`, lx: mid, ly: 30, tick: `M${mid} 38 V${CY - 5}` };
    }
    return which === 'in'
      ? { which, s, d: `M${x1} ${top - 2} V22 H${x2} V${top - 5}`, lx: mid, ly: 15, tick: '' }
      : { which, s, d: `M${x1} ${bottom + 2} V128 H${x2} V${bottom + 5}`, lx: mid, ly: 148, tick: '' };
  });

  return (
    <section className="egallery" aria-label="Element gallery">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Element gallery</p>
          <p className="stage-title">What each element may change in a message</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><i className="lg-sip" />SIP</li>
          <li><span className="eg-g st-added">+</span>Adds</li>
          <li><span className="eg-g st-changed">~</span>Changes</li>
          <li><span className="eg-g st-removed">−</span>Removes</li>
        </ul>
      </header>

      <div className="eg-tabs" role="tablist" aria-label="SIP elements">
        {cards.map((c, i) => (
          <button
            key={c.id}
            ref={el => { tabs.current[i] = el; }}
            type="button"
            role="tab"
            id={`eg-tab-${c.id}`}
            aria-selected={c.id === id}
            aria-controls="eg-panel"
            tabIndex={c.id === id ? 0 : -1}
            className={`eg-tab${c.id === id ? ' is-sel' : ''}`}
            onClick={() => select(i)}
            onKeyDown={e => onKey(e, i)}
          >
            <Icon kind={c.kind} />
            <span className="eg-tab-name">{c.name}</span>
            <span className="eg-tab-short">{c.short}</span>
          </button>
        ))}
      </div>

      <div className="eg-body" id="eg-panel" role="tabpanel" aria-labelledby={`eg-tab-${id}`}>
        <div className="eg-left">
          <div className="eg-topo-wrap">
            <svg className="eg-topo" viewBox={`0 0 ${W} ${H}`} role="img"
              aria-label={`${laneLabel(inStep.from)} sends ${inStep.label} to ${laneLabel(inStep.to)}. ${laneLabel(outStep.from)} sends ${outStep.label} to ${laneLabel(outStep.to)}.`}>
              <defs>
                <marker id="eg-mk" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0 L10 5 L0 10 z" style={{ fill: 'var(--sip)' }} />
                </marker>
              </defs>
              {nodes.map(n => {
                const l = lane(n.id);
                return (
                  <g key={n.id}>
                    <Shape kind={l.kind} x={n.x - BW / 2} y={top} w={BW} h={BH} active={n.id === inStep.to} />
                    <text className="eg-node-label" x={n.x} y={l.sub ? CY - 2 : CY + 5} textAnchor="middle">{l.label}</text>
                    {l.sub && <text className="eg-node-sub" x={n.x} y={CY + 15} textAnchor="middle">{l.sub}</text>}
                  </g>
                );
              })}
              {arrows.map(({ which, s, d, lx, ly, tick }) => (
                <g key={which} className={`eg-arrow${view === which ? ' is-sel' : ''}`} onClick={() => setView(which)} role="button" tabIndex={0}
                  aria-label={`Show F${s.index + 1}: ${s.label}`} aria-pressed={view === which}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setView(which); } }}>
                  <path className="eg-hit" d={d} />
                  <path className="eg-wire" d={d} markerEnd="url(#eg-mk)" />
                  {tick && <path className="eg-tick" d={tick} />}
                  <text className="eg-arrow-label" x={lx} y={ly} textAnchor="middle">F{s.index + 1} {s.label}</text>
                </g>
              ))}
            </svg>
          </div>

          <p className="eg-role">{card.role}</p>
          <dl className="eg-facts">
            <dt>State</dt><dd>{card.state}</dd>
            <dt>Media path</dt><dd>{card.media}</dd>
            <dt>Examples</dt><dd>{card.examples}</dd>
          </dl>
          <div className="eg-lists">
            <div>
              <p className="eyebrow">What it does</p>
              <ul className="eg-list">
                {card.changes.map(c => {
                  const g = c.slice(0, 1);
                  return <li key={c}><span className={`eg-g st-${GLYPH_STATE[g] ?? 'same'}`} aria-label={GLYPH_STATE[g]}>{g}</span>{c.slice(2)}</li>;
                })}
              </ul>
            </div>
            <div>
              <p className="eyebrow">What it keeps</p>
              <ul className="eg-list">
                {card.keeps.map(k => <li key={k}><span className="eg-g st-same" aria-hidden="true">=</span>{k}</li>)}
              </ul>
            </div>
          </div>
          {quote && (
            <blockquote className="insp-quote">
              <p className="insp-q-src">RFC {quote.rfc} §{quote.section} · {quote.title}</p>
              <p>“{markKeywords(quote.text)}”</p>
              <a href={quote.url} target="_blank" rel="noopener">Read the section ↗</a>
            </blockquote>
          )}
        </div>

        <div className="eg-right">
          <div className="seg eg-seg" role="group" aria-label="Message to show">
            <button type="button" aria-pressed={view === 'in'} onClick={() => setView('in')}>Received · F{inStep.index + 1}</button>
            <button type="button" aria-pressed={view === 'out'} onClick={() => setView('out')}>Sent · F{outStep.index + 1}</button>
          </div>
          <Inspector
            key={`${id}-${view}`}
            step={step}
            prev={view === 'out' && comparable ? inStep : undefined}
            laneLabel={laneLabel}
            refData={refData}
          />
          {view === 'out' && !comparable && (
            <p className="eg-note">The {card.name.toLowerCase()} does not forward this request. It answers it, so there is nothing to compare.</p>
          )}
        </div>
      </div>
    </section>
  );
}
