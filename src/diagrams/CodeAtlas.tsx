/**
 * Response code atlas (Module 6): a filterable grid of SIP response codes.
 * Select a code to see what it means, what usually causes it, what the
 * caller hears, and a ladder that shows which element creates it and how
 * it travels back. A second view groups the codes by the element that
 * usually creates them ("who stops the call?").
 */
import { useMemo, useState } from 'react';
import Ladder from './Ladder.tsx';
import type { ClientFlow, ClientStep } from './types.ts';

export interface Code {
  code: number;
  phrase: string;
  rfc: number;
  section?: string;
  url: string;
  origin: 'proxyA' | 'proxyB' | 'bob' | 'registrar';
  method?: string;
  act?: 'caller' | 'network' | 'callee';
  meaning: string;
  causes: string[];
  phone: string;
  q850?: number[];
}

interface Props { codes: Code[]; initial?: number }

const CLASSES: [number, string, string][] = [
  [1, '1xx', 'Provisional'], [2, '2xx', 'Success'], [3, '3xx', 'Redirection'],
  [4, '4xx', 'Client error'], [5, '5xx', 'Server error'], [6, '6xx', 'Global failure'],
];
const ACT_LABEL = { caller: 'The caller must fix the request', network: 'A server or the network failed', callee: 'The callee said no' } as const;
const NAME: Record<string, string> = { alice: 'Alice', proxyA: 'Proxy A', proxyB: 'Proxy B', bob: 'Bob', registrar: 'Registrar' };
const WHO: Record<string, string> = { alice: 'Alice\'s phone', proxyA: 'Proxy A', proxyB: 'Proxy B', bob: 'Bob\'s phone', registrar: 'The Registrar' };
const ELEMENTS: Code['origin'][] = ['proxyA', 'proxyB', 'bob', 'registrar'];

/** Builds the ladder: the request travels to the element that answers, and the response comes back hop by hop. */
function ladder(c: Code): ClientFlow {
  const method = c.method ?? 'INVITE';
  const path = c.origin === 'registrar' ? ['alice', 'registrar'] : ['alice', 'proxyA', 'proxyB', 'bob'];
  const end = path.indexOf(c.origin);
  const label = `${c.code} ${c.phrase}`;
  const proto = c.code >= 400 ? 'err' : 'sip';
  const steps: Omit<ClientStep, 'index'>[] = [];
  const add = (from: string, to: string, l: string, caption: string, p: ClientStep['proto'] = 'sip') =>
    steps.push({ kind: 'msg', from, to, label: l, caption, proto: p });
  const reqLabel = c.code === 491 ? 'INVITE (re-INVITE)' : method;

  if (c.code === 100) {
    for (let i = 0; i < path.length - 1; i++) {
      add(path[i]!, path[i + 1]!, method, i === 0 ? `${WHO[path[i]!]} sends the ${method}.` : `${WHO[path[i]!]} forwards the ${method}.`);
      if (i < path.length - 2) add(path[i + 1]!, path[i]!, label, `${WHO[path[i + 1]!]} answers 100 Trying on this hop only. It is never forwarded.`);
    }
    return { id: 'atlas', title: label, summary: '', lanes: path.map(id => ({ id, label: NAME[id]!, kind: id === 'alice' || id === 'bob' ? 'ua' : id === 'registrar' ? 'registrar' : 'proxy' })), steps: steps.map((s, index) => ({ ...s, index })) };
  }

  for (let i = 0; i < end; i++) add(path[i]!, path[i + 1]!, reqLabel, i === 0 ? `${WHO[path[i]!]} sends the ${method}.` : `${WHO[path[i]!]} forwards the ${method}.`);
  add(path[end]!, path[end - 1]!, label, `${WHO[path[end]!]} creates the ${c.code}. ${c.meaning.split('. ')[0]!.replace(/\.$/, '')}.`, proto);
  // RFC 3261 §16.7: a proxy does not pass a 503 upstream; it sends 500 instead.
  let code = c.code;
  for (let i = end - 1; i > 0; i--) {
    if (method === 'INVITE' && code >= 300) add(path[i]!, path[i + 1]!, 'ACK', `${WHO[path[i]!]} confirms the ${code} on its own hop.`);
    if (code === 503) {
      code = 500;
      add(path[i]!, path[i - 1]!, '500 Server Internal Error', `${WHO[path[i]!]} does not forward a 503: that would mean "I am down". It sends 500 instead.`, 'err');
    } else {
      add(path[i]!, path[i - 1]!, `${code} ${code === c.code ? c.phrase : 'Server Internal Error'}`, `${WHO[path[i]!]} forwards the ${code} toward Alice's phone.`, proto);
    }
  }
  if (method === 'INVITE' && code >= 300) add('alice', path[1]!, 'ACK', `Alice's phone confirms the ${code}. The call attempt ends.`);
  if (method === 'INVITE' && c.code >= 200 && c.code < 300) add('alice', 'bob', 'ACK', 'Alice\'s phone confirms the 200 OK, end to end. The call is up.');

  return {
    id: 'atlas', title: label, summary: '',
    lanes: path.map(id => ({ id, label: NAME[id]!, kind: id === 'alice' || id === 'bob' ? 'ua' : id === 'registrar' ? 'registrar' : 'proxy' })),
    steps: steps.map((s, index) => ({ ...s, index })),
  };
}

export default function CodeAtlas({ codes, initial = 486 }: Props) {
  const [cls, setCls] = useState(0);
  const [act, setAct] = useState<'' | 'caller' | 'network' | 'callee'>('');
  const [q, setQ] = useState('');
  const [view, setView] = useState<'grid' | 'element'>('grid');
  const [sel, setSel] = useState(initial);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return codes.filter(c =>
      (!cls || Math.floor(c.code / 100) === cls)
      && (!act || c.act === act)
      && (!s || String(c.code).startsWith(s) || `${c.phrase} ${c.meaning} ${c.causes.join(' ')}`.toLowerCase().includes(s)));
  }, [codes, cls, act, q]);

  const c = codes.find(x => x.code === sel)!;
  const flow = useMemo(() => ladder(c), [c]);
  const decisive = flow.steps.findIndex(s => s.label.startsWith(String(c.code)));

  // When the detail is below the grid (narrow screens), bring it into view.
  const pick = (code: number) => {
    setSel(code);
    if (window.matchMedia('(max-width: 1279px)').matches) {
      requestAnimationFrame(() => document.getElementById('ca-detail')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
    }
  };

  const tile = (x: Code) => (
    <button key={x.code} type="button" className={`ca-tile${x.code === sel ? ' is-sel' : ''}${x.code >= 400 ? ' is-fail' : ''}`}
      aria-pressed={x.code === sel} aria-controls="ca-detail" onClick={() => pick(x.code)}>
      <span className="ca-code">{x.code}</span>
      <span className="ca-phrase">{x.phrase}</span>
    </button>
  );

  return (
    <section className="catlas" aria-label="Response code atlas">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Response code atlas</p>
          <p className="stage-title">{codes.length} codes you meet in real traces</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><i className="lg-sip" />SIP</li>
          <li><i className="lg-err" />Failure response</li>
        </ul>
      </header>

      <div className="ca-controls">
        <label className="ca-search">
          <span className="eyebrow">Find</span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="486, busy, codec…" spellCheck={false} />
        </label>
        <div className="seg" role="group" aria-label="Class">
          <button type="button" aria-pressed={cls === 0} onClick={() => setCls(0)}>All</button>
          {CLASSES.map(([n, k]) => <button key={n} type="button" aria-pressed={cls === n} onClick={() => setCls(n)}>{k}</button>)}
        </div>
        <div className="seg" role="group" aria-label="Who must act">
          <button type="button" aria-pressed={act === ''} onClick={() => setAct('')}>Anyone</button>
          <button type="button" aria-pressed={act === 'caller'} onClick={() => setAct('caller')}>Caller fixes</button>
          <button type="button" aria-pressed={act === 'network'} onClick={() => setAct('network')}>Network failed</button>
          <button type="button" aria-pressed={act === 'callee'} onClick={() => setAct('callee')}>Callee said no</button>
        </div>
        <div className="seg" role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>By class</button>
          <button type="button" aria-pressed={view === 'element'} onClick={() => setView('element')}>By element</button>
        </div>
      </div>

      <div className="ca-body">
        <div className="ca-list">
          {view === 'grid' ? (
            <div className="ca-grid">
              {CLASSES.map(([n, k, name]) => {
                const list = shown.filter(x => Math.floor(x.code / 100) === n);
                if (!list.length) return null;
                return (
                  <div key={n} className="ca-class">
                    <p className="ca-class-title"><b>{k}</b> {name}</p>
                    <div className="ca-tiles">{list.map(tile)}</div>
                  </div>
                );
              })}
              {!shown.length && <p className="insp-hint">No code matches. Clear the search or the filters.</p>}
            </div>
          ) : (
            <div className="ca-elements">
              <p className="ca-elements-note">Who usually creates each code, in the course network: Alice → Proxy A → Proxy B → Bob.</p>
              <div className="ca-columns">
                {ELEMENTS.map(e => (
                  <div key={e} className="ca-col">
                    <p className="ca-col-title">{NAME[e]}</p>
                    <div className="ca-tiles">{shown.filter(x => x.origin === e).map(tile)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        <div className="ca-detail" id="ca-detail" aria-live="polite">
          <div className="ca-facts">
            <p className="ca-title"><span>{c.code}</span> {c.phrase}</p>
            <p className="ca-class-line">{CLASSES[Math.floor(c.code / 100) - 1]![2]} · <a href={c.url} target="_blank" rel="noopener">RFC {c.rfc}{c.section ? ` §${c.section}` : ''} ↗</a></p>
            <p className="ca-meaning">{c.meaning}</p>
            <dl className="eg-facts">
              <dt>Created by</dt><dd>{WHO[c.origin]}, usually</dd>
              {c.act && <><dt>Next step</dt><dd>{ACT_LABEL[c.act]}</dd></>}
              <dt>Caller hears</dt><dd>{c.phone}</dd>
              {c.q850 && <><dt>Q.850 causes</dt><dd>{c.q850.join(', ')} <span className="ca-small">(RFC 3398)</span></dd></>}
            </dl>
            <p className="eyebrow ca-causes-title">Typical causes</p>
            <ul className="ca-causes">{c.causes.map(x => <li key={x}>{x}</li>)}</ul>
          </div>
          <div className="ca-ladder">
            <Ladder flow={flow} current={decisive} compact />
            <ol className="cl-captions">
              {flow.steps.map(s => <li key={s.index} className={s.index === decisive ? 'is-cur' : ''}><b>{s.label}.</b> {s.caption}</li>)}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
