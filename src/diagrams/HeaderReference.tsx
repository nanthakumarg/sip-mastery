/**
 * Header reference (Module 7): every common SIP header, searchable and
 * filtered by group. Each entry says what the header means and who adds it,
 * who changes it, and who removes it on the way.
 */
import { useMemo, useState } from 'react';

export interface RefHeader {
  name: string;
  compact?: string;
  category: string;
  mandatory?: 'request' | 'invite';
  summary: string;
  adds: string;
  changes: string;
  removes: string;
  example: string;
  url?: string;
  label?: string;
}

interface Props {
  headers: RefHeader[];
  categories: { id: string; label: string }[];
  initial?: string;
}

export default function HeaderReference({ headers, categories, initial = 'Via' }: Props) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [sel, setSel] = useState(initial);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return headers.filter(h =>
      (!cat || h.category === cat)
      && (!s || h.name.toLowerCase().includes(s) || h.compact === s || `${h.summary} ${h.adds} ${h.changes} ${h.removes}`.toLowerCase().includes(s)));
  }, [headers, q, cat]);
  const h = headers.find(x => x.name === sel) ?? headers[0]!;
  const catLabel = (id: string) => categories.find(c => c.id === id)?.label ?? id;

  return (
    <section className="href" aria-label="Header reference">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Header reference</p>
          <p className="stage-title">{headers.length} headers: what they mean, who touches them</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><span className="eg-g st-added">+</span>Adds</li>
          <li><span className="eg-g st-changed">~</span>Changes</li>
          <li><span className="eg-g st-removed">−</span>Removes</li>
        </ul>
      </header>

      <div className="ca-controls">
        <label className="ca-search">
          <span className="eyebrow">Find</span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Via, identity, timer…" spellCheck={false} />
        </label>
        <div className="seg hr-cats" role="group" aria-label="Group">
          <button type="button" aria-pressed={cat === ''} onClick={() => setCat('')}>All</button>
          {categories.map(c => <button key={c.id} type="button" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.label}</button>)}
        </div>
      </div>

      <div className="hr-body">
        <div className="hr-list" role="list" aria-label="Headers">
          {categories.filter(c => shown.some(x => x.category === c.id)).map(c => (
            <div key={c.id} className="hr-group" role="listitem">
              <p className="ca-class-title"><b>{c.label}</b></p>
              <div className="hr-names">
                {shown.filter(x => x.category === c.id).map(x => (
                  <button key={x.name} type="button" className={`hr-name${x.name === sel ? ' is-sel' : ''}`} aria-pressed={x.name === sel}
                    aria-controls="hr-detail" onClick={() => setSel(x.name)}>
                    {x.name}{x.compact && <span className="hr-compact">{x.compact}</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {!shown.length && <p className="insp-hint">No header matches.</p>}
        </div>

        <article className="hr-detail" id="hr-detail" aria-live="polite">
          <p className="hr-title"><span className="h-name">{h.name}</span>{h.compact && <span className="hr-compact">compact: {h.compact}</span>}</p>
          <p className="ca-class-line">
            {catLabel(h.category)}
            {h.mandatory && <span className="mc-chip is-dialog hr-must">{h.mandatory === 'request' ? 'in every request' : 'in every INVITE'}</span>}
          </p>
          <p className="ca-meaning">{h.summary}</p>
          <dl className="hr-life">
            <dt><span className="eg-g st-added" aria-hidden="true">+</span>Adds</dt><dd>{h.adds}</dd>
            <dt><span className="eg-g st-changed" aria-hidden="true">~</span>Changes</dt><dd>{h.changes}</dd>
            <dt><span className="eg-g st-removed" aria-hidden="true">−</span>Removes</dt><dd>{h.removes}</dd>
          </dl>
          <pre className="hr-example">{h.example}</pre>
          {h.url && <a className="hr-link" href={h.url} target="_blank" rel="noopener">{h.label} ↗</a>}
        </article>
      </div>
    </section>
  );
}
