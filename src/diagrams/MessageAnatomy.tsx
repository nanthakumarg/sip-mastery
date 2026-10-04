/**
 * Message layers (Module 4): one SIP message, split into its four parts —
 * start line, headers, empty line, body — with the byte count of each.
 * Point at any line or token to see what it means. Switches show the line
 * endings, the compact form, and repeated headers combined into one row.
 */
import { useMemo, useState, type KeyboardEvent } from 'react';
import { byteLength, COMPACT, parseMessage } from '../sip/parse.ts';
import type { ClientRef, ClientRefEntry } from './types.ts';

export interface Sample { id: string; label: string; wire: string }

interface Props { samples: Sample[]; refData: ClientRef }

type BodyKind = 'sdp' | 'boundary' | 'part-header' | 'part-blank' | 'other';

interface Row {
  key: string;
  zone: 'start' | 'header' | 'blank' | 'body';
  text: string;
  name?: string;
  shown?: string;
  rows?: number;
  bodyKind?: BodyKind;
}

const LONG_TO_COMPACT = Object.fromEntries(Object.entries(COMPACT).map(([k, v]) => [v, k]));
const NOT_COMBINABLE = new Set(['WWW-Authenticate', 'Authorization', 'Proxy-Authenticate', 'Proxy-Authorization']);
const bytes = (s: string) => byteLength(s);

function build(wire: string, compact: boolean, combine: boolean) {
  const msg = parseMessage(wire);
  const rows: Row[] = [{ key: 'start', zone: 'start', text: msg.startLine }];

  // Headers: optionally combined (RFC 3261 §7.3.1) and written in compact form (§7.3.3).
  const groups: { name: string; values: string[] }[] = [];
  for (const h of msg.headers) {
    const g = combine && !NOT_COMBINABLE.has(h.name) ? groups.find(x => x.name === h.name) : undefined;
    if (g) g.values.push(h.value);
    else groups.push({ name: h.name, values: [h.value] });
  }
  groups.forEach((g, i) => {
    const shown = compact && LONG_TO_COMPACT[g.name] ? LONG_TO_COMPACT[g.name]! : g.name;
    rows.push({ key: `h${i}`, zone: 'header', name: g.name, shown, rows: g.values.length, text: `${shown}: ${g.values.join(', ')}` });
  });
  rows.push({ key: 'blank', zone: 'blank', text: '' });

  // Body, with multipart structure when there is one.
  const ctype = msg.headers.find(h => h.name === 'Content-Type')?.value ?? '';
  const boundary = /boundary="?([^";]+)"?/i.exec(ctype)?.[1];
  const lines = msg.body ? msg.body.replace(/\r\n$/, '').split('\r\n') : [];
  let partType = ctype.split(';')[0]!.trim().toLowerCase();
  let inPartHeaders = false;
  lines.forEach((text, i) => {
    let kind: BodyKind = partType === 'application/sdp' ? 'sdp' : 'other';
    if (boundary && (text === `--${boundary}` || text === `--${boundary}--`)) { kind = 'boundary'; inPartHeaders = text === `--${boundary}`; partType = ''; }
    else if (boundary && inPartHeaders) {
      if (text === '') { kind = 'part-blank'; inPartHeaders = false; }
      else { kind = 'part-header'; const m = /^content-type\s*:\s*([^;\s]+)/i.exec(text); if (m) partType = m[1]!.toLowerCase(); }
    } else if (boundary && partType === '') kind = 'other';
    rows.push({ key: `b${i}`, zone: 'body', text, bodyKind: kind });
  });

  const startBytes = bytes(msg.startLine) + 2;
  const headerBytes = rows.filter(r => r.zone === 'header').reduce((n, r) => n + bytes(r.text) + 2, 0);
  const bodyBytes = bytes(msg.body);
  const cl = msg.headers.find(h => h.name === 'Content-Length')?.value;
  return { msg, rows, ctype: ctype.split(';')[0]!.trim(), startBytes, headerBytes, bodyBytes, cl, total: startBytes + headerBytes + 2 + bodyBytes };
}

/** Explanations for the tokens of the start line. */
function tokenInfo(isRequest: boolean, i: number, tok: string): { title: string; text: string } {
  if (isRequest) {
    return [
      { title: 'Method', text: `${tok}: what the request asks for. Methods are case-sensitive and written in capitals (Module 5).` },
      { title: 'Request-URI', text: 'The target of the request. Each proxy may replace it with the next target. It never has angle brackets.' },
      { title: 'SIP version', text: 'Always SIP/2.0. Separated from the other parts by exactly one space.' },
    ][i]!;
  }
  return [
    { title: 'SIP version', text: 'Always SIP/2.0.' },
    { title: 'Status code', text: `${tok}: three digits for machines. The first digit is the class: ${tok[0]}xx (Module 6).` },
    { title: 'Reason phrase', text: 'Text for people. Software must not depend on it: "180 Ringing" and "180 Ringing, please wait" mean the same.' },
  ][i]!;
}

function bodyInfo(r: Row, refData: ClientRef): { title: string; text: string; entry?: ClientRefEntry } {
  switch (r.bodyKind) {
    case 'sdp': {
      const e = refData.sdp[r.text.slice(0, 1)];
      return { title: `SDP ${r.text.slice(0, 1)}= line`, text: e?.summary ?? 'A line of the session description (Module 15).', entry: e };
    }
    case 'boundary': return { title: 'Boundary', text: r.text.endsWith('--') ? 'The closing boundary: the same string with "--" at the end. The multipart body ends here.' : 'A boundary line: "--" and the boundary string from Content-Type. Each body part starts with one.' };
    case 'part-header': return { title: 'Body part header', text: 'Describes this body part only: its type, and an id that a header can point to (Content-ID).' };
    case 'part-blank': return { title: 'Empty line of the part', text: 'Ends the headers of this body part, as the empty line ends the headers of the message.' };
    default: return { title: 'Body', text: 'The caller\'s location, as a PIDF-LO XML document (RFC 4119). The Geolocation header points to this part by its Content-ID.' };
  }
}

export default function MessageAnatomy({ samples, refData }: Props) {
  const [id, setId] = useState(samples[0]!.id);
  const [split, setSplit] = useState(true);
  const [crlf, setCrlf] = useState(false);
  const [compact, setCompact] = useState(false);
  const [combine, setCombine] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>('t1');

  const sample = samples.find(s => s.id === id)!;
  const base = useMemo(() => build(sample.wire, false, false), [sample]);
  const m = useMemo(() => build(sample.wire, compact, combine), [sample, compact, combine]);
  const isRequest = m.msg.kind === 'request';
  const tokens = isRequest ? m.msg.startLine.split(' ') : [m.msg.startLine.split(' ')[0]!, m.msg.startLine.split(' ')[1]!, m.msg.startLine.split(' ').slice(2).join(' ')];
  const saved = base.total - m.total;

  const key = focus ?? pinned;
  const row = m.rows.find(r => r.key === key);
  const pick = (k: string) => setPinned(p => (p === k ? null : k));
  const lineProps = (k: string) => ({
    tabIndex: 0,
    onMouseEnter: () => setFocus(k),
    onFocus: () => setFocus(k),
    onBlur: () => setFocus(null),
    onClick: () => pick(k),
    onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(k); } },
  });
  const end = crlf ? <span className="ma-crlf" aria-label="CR LF">␍␊</span> : null;

  // The explanation for the focused line or token.
  let info: { title: string; text: string; who?: string; url?: string; label?: string } | undefined;
  if (key?.startsWith('t')) info = tokenInfo(isRequest, Number(key.slice(1)), tokens[Number(key.slice(1))] ?? '');
  else if (row?.zone === 'header') {
    const e = refData.headers[row.name!];
    info = {
      title: row.name! + (row.shown !== row.name ? ` (compact form: ${row.shown})` : ''),
      text: (e?.summary ?? 'An extension header field. This course explains it in a later module.') + (row.rows! > 1 ? ` This row combines ${row.rows} rows into one, separated by commas.` : ''),
      who: e?.who, url: e?.url, label: e?.label,
    };
  } else if (row?.zone === 'blank') info = { title: 'Empty line', text: 'CR LF on its own: 2 bytes. It ends the headers. It is required even when there is no body.' };
  else if (row?.zone === 'body') { const b = bodyInfo(row, refData); info = { ...b, url: b.entry?.url, label: b.entry?.label }; }

  const headerRows = m.rows.filter(r => r.zone === 'header');
  const bodyRows = m.rows.filter(r => r.zone === 'body');
  const bodyIsSdp = m.ctype === 'application/sdp';

  return (
    <figure className="stage manat">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Message layers</p>
          <p className="stage-title">The four parts of a SIP message</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><i className="lg-sip" />SIP</li>
          <li><i className="lg-sdp" />SDP</li>
          <li><i className="lg-other" />Other body</li>
        </ul>
      </header>

      <div className="ma-controls">
        <div className="seg" role="group" aria-label="Message">
          {samples.map(s => <button key={s.id} type="button" aria-pressed={s.id === id} onClick={() => { setId(s.id); setPinned('t1'); }}>{s.label}</button>)}
        </div>
        <div className="ma-switches" role="group" aria-label="View">
          <label><input type="checkbox" checked={split} onChange={e => setSplit(e.target.checked)} /> Separate the layers</label>
          <label><input type="checkbox" checked={crlf} onChange={e => setCrlf(e.target.checked)} /> Show line endings</label>
          <label><input type="checkbox" checked={compact} onChange={e => setCompact(e.target.checked)} /> Compact form</label>
          <label><input type="checkbox" checked={combine} onChange={e => setCombine(e.target.checked)} /> Combine repeated headers</label>
        </div>
      </div>

      <div className="ma-main">
        <div className={`ma-msg${split ? ' is-split' : ''}`} onMouseLeave={() => setFocus(null)} aria-label="The message, line by line">
          <section className="ma-layer l-start">
            <p className="ma-layer-label">Start line <span>· {isRequest ? 'Request-Line' : 'Status-Line'} · {m.startBytes} bytes</span></p>
            <div className="ma-line ma-start">
              {tokens.map((t, i) => (
                <span key={i} className={`ma-tok${key === `t${i}` ? ' is-focus' : ''}`} {...lineProps(`t${i}`)}>
                  <span className="ma-tok-text">{t}</span>
                  {split && <span className="ma-tok-label">{tokenInfo(isRequest, i, t).title}</span>}
                </span>
              )).flatMap((el, i) => (i ? [<span key={`sp${i}`} className="ma-sp">{' '}</span>, el] : [el]))}
              {end}
            </div>
          </section>

          <section className="ma-layer l-headers">
            <p className="ma-layer-label">Headers <span>· {headerRows.length} rows · {m.headerBytes} bytes</span></p>
            {headerRows.map(r => {
              const at = r.text.indexOf(':');
              return (
                <div key={r.key} className={`ma-line${key === r.key ? ' is-focus' : ''}${r.rows! > 1 ? ' is-combined' : ''}`} {...lineProps(r.key)}>
                  <span className="h-name">{r.text.slice(0, at)}</span>:<span className="h-val">{r.text.slice(at + 1)}</span>{end}
                </div>
              );
            })}
          </section>

          <section className="ma-layer l-blank">
            <p className="ma-layer-label">Empty line <span>· 2 bytes</span></p>
            <div className={`ma-line ma-blank${key === 'blank' ? ' is-focus' : ''}`} {...lineProps('blank')}>
              {crlf ? <span className="ma-crlf">␍␊</span> : <span className="ma-blank-mark">(empty line)</span>}
            </div>
          </section>

          {bodyRows.length > 0 && (
            <section className={`ma-layer l-body${bodyIsSdp ? ' is-sdp' : ''}`}>
              <p className="ma-layer-label">Body <span>· {m.ctype} · {m.bodyBytes} bytes</span></p>
              {bodyRows.map(r => (
                <div key={r.key} className={`ma-line b-${r.bodyKind}${key === r.key ? ' is-focus' : ''}`} {...lineProps(r.key)}>
                  {r.bodyKind === 'sdp' ? <><span className="s-key">{r.text.slice(0, 2)}</span>{r.text.slice(2)}</> : r.text || ' '}{end}
                </div>
              ))}
            </section>
          )}
        </div>

        <aside className="ma-side">
          <div className="ma-bytes" aria-label="Bytes per part">
            <p className="eyebrow">Bytes</p>
            <div className="ma-bar" aria-hidden="true">
              <span className="seg-start" style={{ flexGrow: m.startBytes }} />
              <span className="seg-headers" style={{ flexGrow: m.headerBytes }} />
              <span className="seg-blank" style={{ flexGrow: 2 }} />
              {m.bodyBytes > 0 && <span className={`seg-body${bodyIsSdp ? ' is-sdp' : ''}`} style={{ flexGrow: m.bodyBytes }} />}
            </div>
            <table className="ma-count">
              <tbody>
                <tr><th>Start line</th><td>{m.startBytes}</td></tr>
                <tr><th>Headers</th><td>{m.headerBytes}</td></tr>
                <tr><th>Empty line</th><td>2</td></tr>
                <tr><th>Body</th><td>{m.bodyBytes}</td></tr>
                <tr className="ma-total"><th>Message</th><td>{m.total}</td></tr>
              </tbody>
            </table>
            <p className={`ma-cl${m.cl !== undefined && Number(m.cl) === m.bodyBytes ? ' is-ok' : ''}`}>
              Content-Length: <b>{m.cl ?? 'missing'}</b> {m.cl !== undefined && Number(m.cl) === m.bodyBytes ? '= the body bytes. The headers and the empty line do not count.' : ''}
            </p>
            {saved > 0 && <p className="ma-saved">This view saves <b>{saved} bytes</b> ({Math.round((saved / base.total) * 100)}%). The meaning of the message does not change.</p>}
          </div>

          <div className="ma-explain" aria-live="polite">
            {info ? (
              <>
                <p className="insp-ex-name">{info.title}</p>
                <p>{info.text}</p>
                {info.who && <p className="insp-who"><b>Who:</b> {info.who}</p>}
                {info.url && <a href={info.url} target="_blank" rel="noopener">{info.label} ↗</a>}
              </>
            ) : <p className="insp-hint">Point at a line, or at a part of the start line, to see what it means.</p>}
          </div>
        </aside>
      </div>
    </figure>
  );
}
