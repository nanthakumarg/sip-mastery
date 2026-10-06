/**
 * Site search: a header button (and ⌘K, Ctrl+K, or /) opens a dialog that
 * searches every module section, glossary term, header, response code, and
 * RFC. The index (/search.json) loads the first time the dialog opens.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { KIND_LABEL, search, snippet, type SearchDoc } from '../lib/search.ts';

const INDEX_URL = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/search.json`;
let indexPromise: Promise<SearchDoc[]> | undefined;
const loadIndex = () => (indexPromise ??= fetch(INDEX_URL).then(r => {
  if (!r.ok) throw new Error(`search.json: ${r.status}`);
  return r.json() as Promise<SearchDoc[]>;
}).catch(e => { indexPromise = undefined; throw e; }));

const EXAMPLES = ['486', 'Record-Route', 'jitter buffer', 'sngrep', 'PRACK', 'STIR'];

export default function SiteSearch() {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const [docs, setDocs] = useState<SearchDoc[] | null>(null);
  const [error, setError] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [mac, setMac] = useState(true);

  const hits = useMemo(() => (docs ? search(docs, q, 30) : []), [docs, q]);

  const open = () => {
    const d = dialog.current;
    if (!d || d.open) return;
    d.showModal();
    input.current?.select();
    if (!docs) loadIndex().then(setDocs, () => setError(true));
  };

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); open(); }
      else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); open(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const go = (doc: SearchDoc | undefined) => {
    if (!doc?.u) return;
    dialog.current?.close();
    document.dispatchEvent(new Event('sip:navigate'));
    window.location.href = doc.u;
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(hits.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(hits[sel]?.doc); }
  };

  return (
    <>
      <button type="button" className="search-btn" onClick={open} aria-haspopup="dialog" aria-label="Search the course">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        <span className="search-btn-label">Search</span>
        <kbd>{mac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      <dialog ref={dialog} className="search-dialog" aria-label="Search the course" onClick={e => { if (e.target === dialog.current) dialog.current.close(); }}>
        <div className="search-box">
          <div className="search-field">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            <input
              ref={input}
              type="search"
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Search modules, terms, headers, codes, RFCs"
              aria-label="Search"
              aria-controls="search-results"
              aria-activedescendant={hits.length ? `search-hit-${sel}` : undefined}
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" className="search-close" onClick={() => dialog.current?.close()}>Esc</button>
          </div>

          {error ? <p className="search-msg">The search index did not load. Check the connection and try again.</p>
            : !docs ? <p className="search-msg">Loading the index…</p>
            : !q.trim() ? (
              <div className="search-msg">
                <p>Try:</p>
                <p className="search-examples">{EXAMPLES.map(x => <button key={x} type="button" onClick={() => { setQ(x); input.current?.focus(); }}>{x}</button>)}</p>
              </div>
            )
            : !hits.length ? <p className="search-msg">No results for “{q.trim()}”. Every word must match; try fewer words.</p>
            : (
              <ol ref={list} className="search-hits" id="search-results" role="listbox" aria-label="Results">
                {hits.map(({ doc }, i) => (
                  <li key={`${doc.k}:${doc.t}:${doc.u}:${i}`} id={`search-hit-${i}`} data-i={i} role="option" aria-selected={i === sel}
                    className={`search-hit k-${doc.k}${doc.u ? '' : ' no-link'}`} onMouseMove={() => setSel(i)} onClick={() => go(doc)}>
                    <p className="search-hit-head">
                      <span className="search-kind">{KIND_LABEL[doc.k]}</span>
                      {doc.u ? <a href={doc.u} onClick={e => { e.stopPropagation(); document.dispatchEvent(new Event('sip:navigate')); }} tabIndex={-1}>{doc.t}</a> : <b>{doc.t}</b>}
                      <span className="search-where">{doc.s}</span>
                    </p>
                    <p className="search-snip">{snippet(doc.x, q, doc.u ? 160 : 400).map((s, j) => s.mark ? <mark key={j}>{s.t}</mark> : <span key={j}>{s.t}</span>)}</p>
                    {doc.r && <a className="search-rfc" href={doc.r} rel="noopener" onClick={e => e.stopPropagation()} tabIndex={-1}>Read the RFC ↗</a>}
                  </li>
                ))}
              </ol>
            )}
          <p className="search-keys" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>Enter</kbd> open <kbd>Esc</kbd> close</p>
        </div>
      </dialog>
    </>
  );
}
