/**
 * The RFC map (Module 1.4): every RFC in the course on a timeline, one band
 * per area. Select an RFC to see what it does, what replaced it, what it
 * updates, and which module teaches it. Data: src/content/rfcs.yaml plus the
 * official RFC index (src/content/rfc-index.json).
 */
import { useMemo, useState } from 'react';

export interface RfcModuleLink { n: number; title: string; url?: string }

export interface RfcNode {
  n: number;
  area: string;
  proto?: string;
  short: string;
  summary: string;
  modules: RfcModuleLink[];
  title: string;
  month: string;
  year: number;
  status: string;
  obsoletes: number[];
  obsoletedBy: number[];
  updates: number[];
  updatedBy: number[];
}

interface Props {
  areas: { id: string; label: string }[];
  rfcs: RfcNode[];
  initial?: number;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const LEFT = 150;
const PX_YEAR = 46;
const PILL_W = 44;
const ROW_H = 27;
const BAND_PAD = 14;
const TOP = 34;

const STATUS: Record<string, string> = {
  'PROPOSED STANDARD': 'Proposed Standard',
  'DRAFT STANDARD': 'Draft Standard',
  'INTERNET STANDARD': 'Internet Standard',
  'BEST CURRENT PRACTICE': 'Best Current Practice',
  INFORMATIONAL: 'Informational',
  EXPERIMENTAL: 'Experimental',
  HISTORIC: 'Historic',
};
const rfcUrl = (n: number) => `https://www.rfc-editor.org/rfc/rfc${n}`;

interface Placed extends RfcNode { x: number; y: number }

function layout(areas: Props['areas'], rfcs: RfcNode[]) {
  const minYear = Math.min(...rfcs.map(r => r.year));
  const maxYear = Math.max(...rfcs.map(r => r.year));
  const xOf = (r: RfcNode) => LEFT + (r.year - minYear + (MONTHS.indexOf(r.month) + 0.5) / 12) * PX_YEAR;
  const placed: Placed[] = [];
  const bands: { id: string; label: string; y: number; h: number }[] = [];
  let y = TOP;
  for (const a of areas) {
    const inArea = rfcs.filter(r => r.area === a.id).sort((p, q) => xOf(p) - xOf(q));
    const rowsEnd: number[] = [];
    const rowOf = new Map<number, number>();
    for (const r of inArea) {
      const x = xOf(r);
      let row = rowsEnd.findIndex(end => x - end >= PILL_W + 4);
      if (row === -1) { row = rowsEnd.length; rowsEnd.push(x); } else rowsEnd[row] = x;
      rowOf.set(r.n, row);
    }
    const h = Math.max(1, rowsEnd.length) * ROW_H + BAND_PAD * 2;
    for (const r of inArea) placed.push({ ...r, x: xOf(r), y: y + BAND_PAD + rowOf.get(r.n)! * ROW_H + ROW_H / 2 });
    bands.push({ id: a.id, label: a.label, y, h });
    y += h + 6;
  }
  const width = LEFT + (maxYear - minYear + 1) * PX_YEAR + 30;
  return { placed, bands, width, height: y + 4, minYear, maxYear };
}

export default function RfcMap({ areas, rfcs, initial = 3261 }: Props) {
  const { placed, bands, width, height, minYear, maxYear } = useMemo(() => layout(areas, rfcs), [areas, rfcs]);
  const byN = useMemo(() => new Map(placed.map(r => [r.n, r])), [placed]);
  const [sel, setSel] = useState<number>(initial);
  const [area, setArea] = useState<string>('all');
  const [query, setQuery] = useState('');
  const r = byN.get(sel)!;

  const q = query.trim().toLowerCase();
  const matches = (x: RfcNode) => !q || String(x.n).includes(q) || x.short.toLowerCase().includes(q) || x.title.toLowerCase().includes(q);
  const inFocus = (x: RfcNode) => (area === 'all' || x.area === area) && matches(x);

  const related = new Set([...r.obsoletes, ...r.obsoletedBy, ...r.updates, ...r.updatedBy]);
  const edges: { a: Placed; b: Placed; kind: 'obsoletes' | 'updates' }[] = [];
  for (const n of r.obsoletes) if (byN.has(n)) edges.push({ a: r as Placed, b: byN.get(n)!, kind: 'obsoletes' });
  for (const n of r.obsoletedBy) if (byN.has(n)) edges.push({ a: byN.get(n)!, b: r as Placed, kind: 'obsoletes' });
  for (const n of r.updates) if (byN.has(n)) edges.push({ a: r as Placed, b: byN.get(n)!, kind: 'updates' });
  for (const n of r.updatedBy) if (byN.has(n)) edges.push({ a: byN.get(n)!, b: r as Placed, kind: 'updates' });

  const relList = (label: string, list: number[]) => list.length > 0 && (
    <div className="rm-rel">
      <span className="rm-rel-label">{label}</span>
      <span className="rm-rel-list">
        {list.map(n => byN.has(n)
          ? <button key={n} type="button" onClick={() => setSel(n)}>{n}</button>
          : <a key={n} href={rfcUrl(n)} target="_blank" rel="noopener" title="Not on this map: opens rfc-editor.org">{n}</a>)}
      </span>
    </div>
  );

  return (
    <figure className="stage rfcmap">
      <header className="stage-head">
        <div>
          <p className="eyebrow">RFC map</p>
          <p className="stage-title">{rfcs.length} RFCs that this course uses, {minYear}–{maxYear}</p>
        </div>
        <label className="rm-search">
          <span className="sr-only">Find an RFC</span>
          <input type="search" placeholder="Find: 3261, ICE, PRACK…" value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { const hit = placed.find(x => q && matches(x)); if (hit) setSel(hit.n); } }}
            aria-describedby="rm-search-hint" />
          <span id="rm-search-hint" className="sr-only">Press Enter to open the first match.</span>
        </label>
      </header>

      <div className="rm-filters" role="radiogroup" aria-label="Area">
        {[{ id: 'all', label: 'All areas' }, ...areas].map(a => (
          <button key={a.id} type="button" role="radio" aria-checked={area === a.id} onClick={() => setArea(a.id)}>{a.label}</button>
        ))}
      </div>

      <div className="rm-main">
        <div className="rm-chart">
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Timeline of SIP-related RFCs by area">
            <defs>
              <marker id="rm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" style={{ fill: 'var(--text)' }} />
              </marker>
            </defs>
            {Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i).filter(y => y % 2 === 0).map(y => {
              const x = LEFT + (y - minYear) * PX_YEAR;
              return (
                <g key={y} className="rm-year">
                  <line x1={x} y1={TOP - 6} x2={x} y2={height} />
                  <text x={x + 3} y={TOP - 12}>{y}</text>
                </g>
              );
            })}
            {bands.map(b => (
              <g key={b.id} className={`rm-band${area !== 'all' && area !== b.id ? ' is-dim' : ''}`}>
                <rect x={4} y={b.y} width={width - 8} height={b.h} rx={6} />
                <text x={14} y={b.y + 20}>{b.label}</text>
              </g>
            ))}
            {edges.map(({ a, b, kind }, i) => {
              // Smooth S-curve from the newer RFC to the older one.
              const k = Math.max(30, Math.abs(a.x - b.x) * 0.4);
              const dir = b.x < a.x ? -1 : 1;
              return <path key={i} className={`rm-edge ${kind}`} d={`M${a.x} ${a.y} C${a.x + dir * k} ${a.y}, ${b.x - dir * k} ${b.y}, ${b.x} ${b.y}`} markerEnd="url(#rm-arrow)" />;
            })}
            {placed.map(x => {
              const replaced = x.obsoletedBy.length > 0;
              const cls = ['rm-node', replaced ? 'is-old' : '', x.n === sel ? 'is-sel' : '', related.has(x.n) ? 'is-rel' : '', inFocus(x) ? '' : 'is-dim'].join(' ');
              return (
                <g key={x.n} className={cls} transform={`translate(${x.x - PILL_W / 2} ${x.y - 10})`} onClick={() => setSel(x.n)}
                  role="button" tabIndex={-1} aria-label={`RFC ${x.n}: ${x.short}`}>
                  <title>{`RFC ${x.n} · ${x.short} (${x.year})`}</title>
                  <rect width={PILL_W} height={21} rx={4} />
                  {x.proto && <rect className="rm-stripe" width={3} height={21} rx={1} style={{ fill: `var(--${x.proto})` }} />}
                  <text x={PILL_W / 2 + 1} y={15} textAnchor="middle">{x.n}</text>
                </g>
              );
            })}
          </svg>
        </div>

        <aside className="rm-detail" aria-live="polite">
          <p className="rm-num">RFC {r.n}</p>
          <p className="rm-short">{r.short}</p>
          <p className="rm-title">{r.title}</p>
          <p className="rm-meta">
            <span>{r.month} {r.year}</span>
            <span className="rm-status">{STATUS[r.status] ?? r.status}</span>
          </p>
          {r.obsoletedBy.length > 0 && (
            <p className="rm-old">Replaced by {r.obsoletedBy.map((n, i) => <span key={n}>{i > 0 && ', '}<button type="button" onClick={() => byN.has(n) && setSel(n)} disabled={!byN.has(n)}>RFC {n}</button></span>)}. Do not learn from this version.</p>
          )}
          <p className="rm-summary">{r.summary}</p>
          {r.modules.length > 0 && (
            <div className="rm-mods">
              <span className="rm-rel-label">Taught in</span>
              <ul>
                {r.modules.map(m => (
                  <li key={m.n}>{m.url ? <a href={m.url}><b>{String(m.n).padStart(2, '0')}</b> {m.title}</a> : <span><b>{String(m.n).padStart(2, '0')}</b> {m.title}</span>}</li>
                ))}
              </ul>
            </div>
          )}
          {relList('Obsoletes', r.obsoletes)}
          {relList('Updates', r.updates)}
          {relList('Updated by', r.updatedBy)}
          <a className="rm-read" href={rfcUrl(r.n)} target="_blank" rel="noopener">Read RFC {r.n} ↗</a>
        </aside>
      </div>

      <ul className="legend rm-legend" aria-label="Legend">
        <li><span className="rm-key-old" />Replaced (obsoleted)</li>
        <li><span className="rm-key-line obs" />Obsoletes</li>
        <li><span className="rm-key-line upd" />Updates</li>
        <li><i className="lg-sip" />SIP</li><li><i className="lg-sdp" />SDP</li><li><i className="lg-rtp" />RTP</li><li><i className="lg-rtcp" />RTCP</li><li><i className="lg-dns" />DNS, STUN, ICE</li>
      </ul>
    </figure>
  );
}
