/**
 * Header journey (Module 7): one INVITE crosses several elements. A table
 * shows every header (rows) at every hop (columns), and marks what each
 * element added, changed, or removed. Select a row to compare its full
 * values hop by hop.
 */
import { Fragment, useMemo, useState } from 'react';
import { safeParse } from './diff.ts';
import type { ClientFlow, ClientRef } from './types.ts';

interface Props { flow: ClientFlow; refData: ClientRef }

type State = 'same' | 'added' | 'changed' | 'removed' | 'absent';
const GLYPH: Record<State, string> = { same: '', added: '+', changed: '~', removed: '−', absent: '' };

export default function HeaderJourney({ flow, refData }: Props) {
  const steps = flow.steps.filter(s => s.wire);
  const laneLabel = (id: string) => flow.lanes.find(l => l.id === id)?.label ?? id;

  const { rows, hops } = useMemo(() => {
    const hops = steps.map(s => {
      const m = safeParse(s.wire)!;
      const values = new Map<string, string[]>();
      values.set('Request-URI', [m.requestUri ?? '']);
      for (const h of m.headers) values.set(h.name, [...(values.get(h.name) ?? []), h.value]);
      for (const line of m.body.split('\r\n')) {
        if (line.startsWith('c=')) values.set('SDP c=', [line.slice(2)]);
        if (line.startsWith('o=')) values.set('SDP o=', [line.slice(2)]);
      }
      return { step: s, values };
    });
    const names: string[] = [];
    for (const h of hops) for (const n of h.values.keys()) if (!names.includes(n)) names.push(n);
    const rows = names.map(name => {
      let prev: string | undefined;
      const cells = hops.map((h, i) => {
        const v = h.values.get(name)?.join('\n');
        let state: State;
        if (v === undefined) state = i > 0 && prev !== undefined ? 'removed' : 'absent';
        else if (i === 0 || prev === undefined) state = i === 0 ? 'same' : 'added';
        else state = v === prev ? 'same' : 'changed';
        prev = v;
        return { v, state };
      });
      const changes = cells.filter(c => c.state !== 'same' && c.state !== 'absent').length;
      return { name, cells, changes };
    });
    return { rows, hops };
  }, [steps]);

  const [only, setOnly] = useState(false);
  const [sel, setSel] = useState('Via');
  const shown = only ? rows.filter(r => r.changes > 0) : rows;
  const row = rows.find(r => r.name === sel) ?? rows[0]!;
  const info = refData.headers[row.name];

  return (
    <figure className="stage hjourney">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Header journey</p>
          <p className="stage-title">{flow.title}: what each element changes</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><span className="eg-g st-added">+</span>Added here</li>
          <li><span className="eg-g st-changed">~</span>Changed here</li>
          <li><span className="eg-g st-removed">−</span>Removed here</li>
        </ul>
      </header>

      <label className="hj-only">
        <input type="checkbox" checked={only} onChange={e => setOnly(e.target.checked)} /> Show only the headers that change
      </label>

      <div className="hj-table-wrap">
        <table className="hj-table">
          <thead>
            <tr>
              <th scope="col">Header</th>
              {hops.map((h, i) => (
                <th key={i} scope="col"><span className="hj-hop">Hop {i + 1}</span>{laneLabel(h.step.from)} → {laneLabel(h.step.to)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.name} className={r.name === sel ? 'is-sel' : ''} onClick={() => setSel(r.name)}>
                <th scope="row">
                  <button type="button" aria-pressed={r.name === sel} onClick={() => setSel(r.name)}>{r.name}</button>
                </th>
                {r.cells.map((c, i) => (
                  <td key={i} className={`hj-cell s-${c.state}`} title={c.v}>
                    {GLYPH[c.state] && <span className="hj-glyph" aria-label={c.state}>{GLYPH[c.state]}</span>}
                    <span className="hj-val">{c.state === 'removed' ? 'removed' : c.v === undefined ? '—' : c.v.split('\n').map((x, k) => <Fragment key={k}>{k > 0 && <br />}{x}</Fragment>)}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="hj-detail" aria-live="polite">
        <p className="insp-ex-name">{row.name}</p>
        {info ? <p>{info.summary}{info.url && <> <a href={info.url} target="_blank" rel="noopener">{info.label} ↗</a></>}</p> : row.name.startsWith('SDP') ? <p>A line of the SDP body. A B2BUA or SBC that relays the media rewrites it.</p> : row.name === 'Request-URI' ? <p>The target of the request. A proxy replaces it when it finds the next target.</p> : null}
        <ol className="hj-steps">
          {row.cells.map((c, i) => (
            <li key={i}>
              <b>{laneLabel(hops[i]!.step.from)} → {laneLabel(hops[i]!.step.to)}</b>
              <span className={`hj-state s-${c.state}`}>{c.state === 'same' ? 'unchanged' : c.state === 'absent' ? 'not present' : c.state}</span>
              {c.v !== undefined && <code>{c.v}</code>}
            </li>
          ))}
        </ol>
      </div>
    </figure>
  );
}
